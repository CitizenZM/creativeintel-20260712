import { NextResponse, type NextRequest } from "next/server";

/**
 * `/projects/<brand-slug>-<cuid>/...` is what the address bar shows (see
 * `src/lib/project-slug.ts` + `ProjectUrlSync`); every page, layout, and API
 * route still keys off the bare cuid. Rewriting here means none of them have
 * to know the slug exists — a bare-id URL still works unchanged, and a
 * slugged one is stripped back to the id before Next's router ever matches
 * `[projectId]`.
 */
const SLUGGED_PROJECT_PATH = /^\/projects\/([a-z0-9][a-z0-9-]*-)?(c[a-z0-9]{20,32})(\/.*)?$/i;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = pathname.match(SLUGGED_PROJECT_PATH);
  if (!match || !match[1]) return NextResponse.next();

  const [, , id, rest] = match;
  const url = request.nextUrl.clone();
  url.pathname = `/projects/${id}${rest || ""}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/projects/:path*",
};
