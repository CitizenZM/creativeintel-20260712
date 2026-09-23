import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * creative.xark.io sits behind Cloudflare Access, but the same deployment is
 * also reachable on its *.vercel.app aliases, which skip Access entirely. So
 * every request must carry a valid Access JWT, whatever host it arrived on.
 * Off unless CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set (local dev).
 */
const ACCESS_TEAM_DOMAIN = process.env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/+$/, "");
const ACCESS_AUD = process.env.CF_ACCESS_AUD;
// Canonical Access-protected host; browsers on any other host get sent here.
const ACCESS_HOST = process.env.CF_ACCESS_HOST;

const accessJwks =
  ACCESS_TEAM_DOMAIN && ACCESS_AUD
    ? createRemoteJWKSet(new URL(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`))
    : null;

// Machine-to-machine routes: local workers, Vercel Cron and Blob upload
// callbacks can't pass Access, and each already checks its own token.
const ACCESS_EXEMPT = /^\/api\/(worker|cron|local-files)(\/|$)/;

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
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Redirect only off-host, or a stale token on the Access host would loop.
  if (ACCESS_HOST && request.nextUrl.hostname !== ACCESS_HOST) {
    return NextResponse.redirect(`https://${ACCESS_HOST}${pathname}${search}`);
  }
  return new NextResponse("Unauthorized", { status: 401 });
}

/**
 * `/projects/<brand-slug>-<cuid>/...` is what the address bar shows (see
 * `src/lib/project-slug.ts` + `ProjectUrlSync`); every page, layout, and API
 * route still keys off the bare cuid. Rewriting here means none of them have
 * to know the slug exists — a bare-id URL still works unchanged, and a
 * slugged one is stripped back to the id before Next's router ever matches
 * `[projectId]`.
 */
// Also covers /api/projects/… — client components build their fetch URLs from
// useParams().projectId, which is the slugged segment once the address bar has
// been rewritten, and every API route looks the id up verbatim.
const SLUGGED_PROJECT_PATH = /^(\/api)?\/projects\/([a-z0-9][a-z0-9-]*-)?(c[a-z0-9]{20,32})(\/.*)?$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (accessJwks && !ACCESS_EXEMPT.test(pathname) && !(await hasValidAccessJwt(request))) {
    return denyAccess(request);
  }

  const match = pathname.match(SLUGGED_PROJECT_PATH);
  if (!match || !match[2]) return NextResponse.next();

  const [, apiPrefix, , id, rest] = match;
  const url = request.nextUrl.clone();
  url.pathname = `${apiPrefix || ""}/projects/${id}${rest || ""}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything except build assets, so the Access check covers every route.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
