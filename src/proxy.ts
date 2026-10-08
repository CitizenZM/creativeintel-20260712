import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { selectAuthMode } from "@/lib/auth/mode";
import { canonicalRedirect, classifyPath, isApiPath, rewriteSluggedPath } from "@/lib/auth/paths";

/**
 * The gate in front of every route (Next 16 renamed `middleware` to `proxy`).
 * Which gate runs is decided once per process by `selectAuthMode` (src/lib/auth/mode.ts):
 *
 * - clerk     — Clerk sessions. Every page and /api route needs a signed-in user except the
 *               machine routes, /sign-in, /sign-up and /api/health. Pages redirect to /sign-in,
 *               API calls get a 401. The Cloudflare Access check is skipped entirely.
 * - cf-access — creative.xark.io behind Cloudflare Access. The same deployment is also reachable
 *               on its *.vercel.app aliases, which skip Access, so every request must carry a valid
 *               Access JWT whatever host it arrived on.
 * - none      — no gate (local dev).
 * - locked    — AUTH_PROVIDER names a provider that isn't configured: refuse rather than fail open.
 *
 * Machine routes (/api/worker, /api/cron, /api/local-files) are exempt in every mode: local
 * workers, Vercel Cron and Blob upload callbacks each check their own token.
 */
const AUTH = selectAuthMode(process.env);
if (AUTH.mode === "locked") console.error(`[auth] every non-machine route is locked: ${AUTH.reason}`);

/** Strip a brand slug from /projects/<slug>-<cuid> (see src/lib/auth/paths.ts). */
function continueRequest(request: NextRequest): NextResponse {
  const target = rewriteSluggedPath(request.nextUrl.pathname);
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url);
}

// ── Clerk ────────────────────────────────────────────────────────────────────
const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";
const SIGN_UP_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up";
// Production: creative.xark.io. Browsers on any other host are sent there (a production Clerk
// instance can't issue sessions on the *.vercel.app aliases) and only it may present sessions.
const CANONICAL_HOST = process.env.AUTH_CANONICAL_HOST?.trim() || undefined;

const clerkGate =
  AUTH.mode === "clerk"
    ? clerkMiddleware(
        async (auth, request) => {
          if (classifyPath(request.nextUrl.pathname) === "protected") {
            const { userId, redirectToSignIn } = await auth();
            if (!userId) {
              if (isApiPath(request.nextUrl.pathname)) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
              }
              return redirectToSignIn({ returnBackUrl: request.url });
            }
          }
          return continueRequest(request);
        },
        {
          signInUrl: SIGN_IN_URL,
          signUpUrl: SIGN_UP_URL,
          ...(CANONICAL_HOST ? { authorizedParties: [`https://${CANONICAL_HOST}`] } : {}),
        },
      )
    : null;

// ── Cloudflare Access ────────────────────────────────────────────────────────
const ACCESS_TEAM_DOMAIN = process.env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/+$/, "");
const ACCESS_AUD = process.env.CF_ACCESS_AUD;
// Canonical Access-protected host; browsers on any other host get sent here.
const ACCESS_HOST = process.env.CF_ACCESS_HOST;

const accessJwks =
  AUTH.mode === "cf-access" && ACCESS_TEAM_DOMAIN
    ? createRemoteJWKSet(new URL(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`))
    : null;

async function hasValidAccessJwt(request: NextRequest): Promise<boolean> {
  const token =
    request.headers.get("cf-access-jwt-assertion") ?? request.cookies.get("CF_Authorization")?.value;
  if (!token || !accessJwks) return false;
  try {
    await jwtVerify(token, accessJwks, { issuer: ACCESS_TEAM_DOMAIN, audience: ACCESS_AUD });
    return true;
  } catch {
    return false;
  }
}

function denyAccess(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Redirect only off-host, or a stale token on the Access host would loop.
  if (ACCESS_HOST && request.nextUrl.hostname !== ACCESS_HOST) {
    return NextResponse.redirect(`https://${ACCESS_HOST}${pathname}${search}`);
  }
  return new NextResponse("Unauthorized", { status: 401 });
}

// ── Gate ─────────────────────────────────────────────────────────────────────
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;
  const kind = classifyPath(pathname);
  if (kind === "machine") return continueRequest(request);

  switch (AUTH.mode) {
    case "clerk": {
      const redirect = canonicalRedirect(request.nextUrl.hostname, pathname, search, CANONICAL_HOST);
      if (redirect) return NextResponse.redirect(redirect);
      return clerkGate!(request, event);
    }
    case "cf-access":
      if (!(await hasValidAccessJwt(request))) return denyAccess(request);
      return continueRequest(request);
    case "locked":
      return isApiPath(pathname)
        ? NextResponse.json({ error: "Authentication is misconfigured" }, { status: 503 })
        : new NextResponse("Authentication is misconfigured", { status: 503 });
    case "none":
      return continueRequest(request);
  }
}

export const config = {
  // Everything except build assets, so the gate covers every route.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
