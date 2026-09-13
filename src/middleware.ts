import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = pathname.match(SLUGGED_PROJECT_PATH);
  if (!match || !match[2]) return NextResponse.next();

  const [, apiPrefix, , id, rest] = match;
  const url = request.nextUrl.clone();
  url.pathname = `${apiPrefix || ""}/projects/${id}${rest || ""}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/projects/:path*", "/api/projects/:path*"],
};
