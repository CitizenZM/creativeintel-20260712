import { NextResponse, type NextRequest } from "next/server";
import type { Principal, ProjectTenant } from "./access";
import { canAccessProject } from "./access";
import { classifyPath, isApiPath, projectIdFromPath } from "./paths";

/** Where a blocked account lands. Signed-in users may always reach it. */
export const BLOCKED_PATH = "/blocked";

export function isBlockedPath(pathname: string): boolean {
  return pathname === BLOCKED_PATH || pathname === `${BLOCKED_PATH}/`;
}

/**
 * Master-admin-only areas: platform-wide settings (AI providers and keys, users), ops status and
 * debug views, and the shared LibTV balance. A member asking for them is sent to /projects (pages)
 * or gets a 403 (API).
 */
const ADMIN_ONLY = /^\/(settings\/(ai|users)|status|api\/(settings|debug|libtv))(\/|$)/;

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY.test(pathname);
}

export type AccessDecision =
  | "allow"
  | "sign-in" // signed-out page request → Clerk sign-in
  | "unauthorized" // signed-out API request → 401
  | "blocked-page" // blocked account, page → /blocked
  | "blocked-api" // blocked account, API → 403
  | "forbidden-page" // member on an admin page, or on someone else's project → /projects
  | "forbidden-api" // member on an admin API → 403
  | "not-found-api" // member on someone else's project API → 404 (doesn't reveal it exists)
  | "unavailable"; // a lookup failed → 503 (fail closed)

/**
 * The Clerk-mode gate as a pure decision, so it can be tested as a table. Machine and public routes
 * (src/lib/auth/paths.ts) pass untouched; everything else needs a signed-in, unblocked user. Members
 * are further kept out of admin areas and out of every project their own workspace doesn't hold.
 * Lookups are only called when the answer depends on them.
 */
export async function decideAccess({
  pathname,
  userId,
  principalOf,
  projectTenant,
}: {
  pathname: string;
  userId: string | null | undefined;
  principalOf: (clerkUserId: string) => Promise<Principal>;
  projectTenant: (projectId: string) => Promise<ProjectTenant | null>;
}): Promise<AccessDecision> {
  if (classifyPath(pathname) !== "protected") return "allow";
  const api = isApiPath(pathname);
  if (!userId) return api ? "unauthorized" : "sign-in";
  if (isBlockedPath(pathname)) return "allow";

  try {
    const principal = await principalOf(userId);
    if (principal.status === "blocked") return api ? "blocked-api" : "blocked-page";
    if (principal.role === "owner") return "allow";

    if (isAdminOnlyPath(pathname)) return api ? "forbidden-api" : "forbidden-page";
    const projectId = projectIdFromPath(pathname);
    if (projectId && !canAccessProject(principal, await projectTenant(projectId))) {
      return api ? "not-found-api" : "forbidden-page";
    }
    return "allow";
  } catch (err) {
    console.error("[auth] access lookup failed:", err);
    return "unavailable";
  }
}

/** The response for every refusal except "sign-in", which Clerk's redirectToSignIn handles. */
export function deniedResponse(
  decision: Exclude<AccessDecision, "allow" | "sign-in">,
  request: NextRequest,
): NextResponse {
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    return NextResponse.redirect(url);
  };
  switch (decision) {
    case "unauthorized":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    case "blocked-page":
      return redirectTo(BLOCKED_PATH);
    case "blocked-api":
      return NextResponse.json({ error: "Account blocked" }, { status: 403 });
    case "forbidden-page":
      return redirectTo("/projects");
    case "forbidden-api":
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    case "not-found-api":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "unavailable":
      return isApiPath(request.nextUrl.pathname)
        ? NextResponse.json({ error: "Access check unavailable" }, { status: 503 })
        : new NextResponse("Access check unavailable — please retry shortly.", { status: 503 });
  }
}
