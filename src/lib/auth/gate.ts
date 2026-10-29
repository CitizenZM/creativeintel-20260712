import { NextResponse, type NextRequest } from "next/server";
import type { Principal, ProjectTenant } from "./access";
import { ACCESS_RANK, projectAccessFor } from "./access";
import { classifyPath, isApiPath, projectIdFromPath } from "./paths";
import { type Apps, accountSignInUrl, canEnterCreative, isCreativeOwnerClaim, noAccessUrl } from "./account";

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

/**
 * What a request does to a project, for shared access levels:
 * - read     — pages and GET APIs (incl. playing media)
 * - download — exports and archives: the history zip, artifact downloads, the campaign export, the
 *              report as .docx, a run's export pack
 * - write    — any other change, including generation
 * - owner    — only the project's owner: delete it, set its budget, approve LibTV runs, manage sharing
 */
export type ProjectAction = "read" | "download" | "write" | "owner";

const PROJECT_API = /^\/api\/projects\/[^/]+(\/.*)?$/;
const DOWNLOAD_GET = /^\/(artifacts\/[^/]+\/download|artifacts\/archive|export)\/?$/;
const DOWNLOAD_POST = /^\/studio\/libtv-runs\/[^/]+\/export-pack\/?$/;
const OWNER_ONLY = /^\/(shares(\/.*)?|studio\/libtv-runs\/[^/]+\/approve\/?)$/;

export function projectAction(pathname: string, method = "GET", search = ""): ProjectAction {
  const m = pathname.match(PROJECT_API);
  if (!m) return "read"; // project pages
  const rest = (m[1] ?? "").replace(/\/+$/, "");
  const verb = method.toUpperCase();
  if (OWNER_ONLY.test(rest)) return "owner";
  if (rest === "" && verb === "DELETE") return "owner";
  if (rest === "/spend" && verb !== "GET" && verb !== "HEAD") return "owner";
  if (verb === "GET" || verb === "HEAD") {
    if (DOWNLOAD_GET.test(rest)) return "download";
    if (rest === "/report" && new URLSearchParams(search).get("format") === "docx") return "download";
    return "read";
  }
  if (DOWNLOAD_POST.test(rest)) return "download";
  return "write";
}

const REQUIRED_RANK: Record<ProjectAction, number> = { read: 1, download: 2, write: 3, owner: 4 };

export type AccessDecision =
  | "allow"
  | "sign-in" // signed-out page request → account.xark.io sign-in
  | "unauthorized" // signed-out API request → 401
  | "no-access-page" // signed in, but no apps.creative claim → account.xark.io/no-access
  | "no-access-api" // the same, API → 403
  | "blocked-page" // blocked account, page → /blocked
  | "blocked-api" // blocked account, API → 403
  | "forbidden-page" // member on an admin page, or on someone else's project → /projects
  | "forbidden-api" // member on an admin API → 403
  | "not-found-api" // member on someone else's project API → 404 (doesn't reveal it exists)
  | "insufficient-api" // coworker whose share level doesn't allow this action → 403
  | "unavailable"; // a lookup failed → 503 (fail closed)

/**
 * The Clerk-mode gate as a pure decision, so it can be tested as a table. Machine and public routes
 * (src/lib/auth/paths.ts) pass untouched; everything else needs a signed-in user whose Xark Accounts
 * `apps` claim opens CreativeIntel (src/lib/auth/account.ts), and who isn't blocked. Members
 * are further kept out of admin areas and out of every project their own workspace doesn't hold,
 * unless it was shared with them — then only as far as their share level allows (projectAction).
 * Lookups are only called when the answer depends on them.
 */
export async function decideAccess({
  pathname,
  method = "GET",
  search = "",
  userId,
  apps,
  principalOf,
  projectTenant,
}: {
  pathname: string;
  method?: string;
  search?: string;
  userId: string | null | undefined;
  /** The session's `apps` claim (parseApps). `apps.creative === "owner"` is an owner. */
  apps: Apps;
  principalOf: (clerkUserId: string) => Promise<Principal>;
  projectTenant: (projectId: string, appUserId: string | null) => Promise<ProjectTenant | null>;
}): Promise<AccessDecision> {
  if (classifyPath(pathname) !== "protected") return "allow";
  const api = isApiPath(pathname);
  if (!userId) return api ? "unauthorized" : "sign-in";
  if (!canEnterCreative(apps)) return api ? "no-access-api" : "no-access-page";
  if (isBlockedPath(pathname)) return "allow";

  try {
    const principal = await principalOf(userId);
    // Owners (OWNER_EMAILS, the DB role, or the apps.creative claim) are never blocked.
    const owner = principal.role === "owner" || isCreativeOwnerClaim(apps);
    if (!owner && principal.status === "blocked") return api ? "blocked-api" : "blocked-page";
    if (owner) return "allow";

    if (isAdminOnlyPath(pathname)) return api ? "forbidden-api" : "forbidden-page";
    const projectId = projectIdFromPath(pathname);
    if (projectId) {
      const access = projectAccessFor(principal, await projectTenant(projectId, principal.appUserId));
      if (!access) return api ? "not-found-api" : "forbidden-page";
      if (ACCESS_RANK[access] < REQUIRED_RANK[projectAction(pathname, method, search)]) {
        return api ? "insufficient-api" : "forbidden-page";
      }
    }
    return "allow";
  } catch (err) {
    console.error("[auth] access lookup failed:", err);
    return "unavailable";
  }
}

/** The response for every refusal. Sign-in and no-access are 302s to account.xark.io. */
export function deniedResponse(
  decision: Exclude<AccessDecision, "allow">,
  request: NextRequest,
): NextResponse {
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    return NextResponse.redirect(url);
  };
  switch (decision) {
    case "sign-in":
      return NextResponse.redirect(accountSignInUrl(request.nextUrl.href), 302);
    case "no-access-page":
      return NextResponse.redirect(noAccessUrl(), 302);
    case "no-access-api":
      return NextResponse.json({ error: "No access to CreativeIntel" }, { status: 403 });
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
    case "insufficient-api":
      return NextResponse.json(
        { error: "Your access to this shared project doesn't allow that — ask its owner for a higher level." },
        { status: 403 },
      );
    case "unavailable":
      return isApiPath(request.nextUrl.pathname)
        ? NextResponse.json({ error: "Access check unavailable" }, { status: 503 })
        : new NextResponse("Access check unavailable — please retry shortly.", { status: 503 });
  }
}
