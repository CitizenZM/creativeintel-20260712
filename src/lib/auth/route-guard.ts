import { safePublicError } from "@/lib/public-error";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { selectAuthMode } from "./mode";
import { decideAccess, deniedResponse } from "./gate";
import { ACTOR_HEADER } from "./actor";
import { projectIdFromPath } from "./paths";
import { withSpendScope } from "@/services/ops/spend-scope";
import { isBudgetExceeded } from "@/services/ops/budget-guard";
import { getPrincipal, getProjectTenant } from "@/services/access";

/**
 * Second line of defence for every user-facing API route (the first is src/proxy.ts).
 *
 * Every handler under src/app/api — except the machine routes (worker / cron / local-files, which
 * check their own tokens) and the public /api/health — is exported as `withAccess(handler)`. Before
 * the handler runs it re-makes the proxy's decision (decideAccess: signed in, not blocked, admin-only
 * areas, project ownership or share level) from the request itself, so a request that slipped past
 * the proxy (a framework middleware-bypass bug, a misconfigured matcher) still gets nothing:
 * - if Clerk's middleware never ran, auth() throws → 401;
 * - otherwise the same 401/403/404 the proxy would have given;
 * - an actor header that doesn't match the signed-in user (only the proxy may set it) → 403.
 * Outside Clerk mode (local dev, tests, Cloudflare Access) the proxy is the only gate, as before.
 */
export async function checkRouteAccess(request: Request): Promise<Response | null> {
  const mode = selectAuthMode(process.env).mode;
  if (mode === "locked") return NextResponse.json({ error: "Authentication is misconfigured" }, { status: 503 });
  if (mode !== "clerk") return null;

  let userId: string | null;
  try {
    userId = (await auth()).userId;
  } catch (err) {
    console.error("[auth] route reached without the Clerk proxy:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const decision = await decideAccess({
    pathname: url.pathname,
    method: request.method,
    search: url.search,
    userId,
    principalOf: getPrincipal,
    projectTenant: getProjectTenant,
  });
  if (decision === "sign-in") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (decision !== "allow") return deniedResponse(decision, new NextRequest(request));

  const claimed = request.headers.get(ACTOR_HEADER);
  if (claimed && userId) {
    const principal = await getPrincipal(userId).catch(() => null);
    if (principal && claimed !== principal.appUserId) {
      console.error(`[auth] actor header mismatch on ${url.pathname}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (request: any, ...rest: any[]) => Response | Promise<Response>;

/**
 * Wrap a route handler so checkRouteAccess runs first. Keeps the handler's exact signature.
 * For /api/projects/[projectId]/** it also opens the project's spend scope (who is paying: the
 * project, and the signed-in actor), so every paid model call the handler — or the background work
 * it starts — makes is reserved in the spend ledger; and a budget / allowance refusal that bubbles
 * out of the handler becomes a clear 402 instead of a generic 500.
 */
export function withAccess<H extends RouteHandler>(handler: H): H {
  const guarded = async (request: Request, ...rest: unknown[]) => {
    const state: { refusal?: unknown } = {};
    const run = () => handler(request, ...rest);
    const refused = (err: unknown) =>
      NextResponse.json({ error: (err as Error).message, code: "BUDGET_EXCEEDED" }, { status: 402 });
    try {
      const denied = await checkRouteAccess(request);
      if (denied) return denied;
      const projectId = projectIdFromPath(new URL(request.url).pathname);
      const res = projectId
        ? await withSpendScope({ projectId, actorId: request.headers.get(ACTOR_HEADER), state }, run)
        : await run();
      // A route that caught the refusal and answered a generic error: say what really happened.
      return isBudgetExceeded(state.refusal) && res.status >= 400 ? refused(state.refusal) : res;
    } catch (err) {
      if (isBudgetExceeded(err)) return refused(err);
      console.error("[api] request failed:", err);
      return NextResponse.json({ error: safePublicError(err) }, { status: 500 });
    }
  };
  return guarded as unknown as H;
}
