/**
 * Route classes for the proxy gate (src/proxy.ts).
 *
 * - machine   — worker / cron / local-files: called by local workers, Vercel Cron and Blob upload
 *               callbacks with their own tokens. Never behind a user gate.
 * - public    — Clerk's sign-in / sign-up pages, /api/health (monitoring + smoke tests), the
 *               root-level files in /public (theme-init.js, svgs) and Next internals.
 * - protected — everything else, pages and /api alike.
 */
export type PathKind = "machine" | "public" | "protected";

const MACHINE = /^\/api\/(worker|cron|local-files)(\/|$)/;
const AUTH_PAGES = /^\/(sign-in|sign-up)(\/|$)/;
const HEALTH = /^\/api\/health\/?$/;
// Root-level only: a dynamic segment deeper down could end in ".png" and still render a page.
const PUBLIC_FILE = /^\/[^/]+\.(?:js|css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|txt|webmanifest)$/i;
const NEXT_INTERNAL = /^\/_next\//;

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function classifyPath(pathname: string): PathKind {
  if (MACHINE.test(pathname)) return "machine";
  if (AUTH_PAGES.test(pathname) || HEALTH.test(pathname) || NEXT_INTERNAL.test(pathname)) return "public";
  if (!isApiPath(pathname) && PUBLIC_FILE.test(pathname)) return "public";
  return "protected";
}

/**
 * `/projects/<brand-slug>-<cuid>/...` is what the address bar shows (see
 * `src/lib/project-slug.ts` + `ProjectUrlSync`); every page, layout, and API
 * route still keys off the bare cuid. Rewriting in the proxy means none of them
 * have to know the slug exists — a bare-id URL still works unchanged, and a
 * slugged one is stripped back to the id before Next's router ever matches
 * `[projectId]`.
 *
 * Also covers /api/projects/… — client components build their fetch URLs from
 * useParams().projectId, which is the slugged segment once the address bar has
 * been rewritten, and every API route looks the id up verbatim.
 */
const SLUGGED_PROJECT_PATH = /^(\/api)?\/projects\/([a-z0-9][a-z0-9-]*-)?(c[a-z0-9]{20,32})(\/.*)?$/i;

/** The bare-id pathname for a slugged project path, or null when no rewrite is needed. */
export function rewriteSluggedPath(pathname: string): string | null {
  const match = pathname.match(SLUGGED_PROJECT_PATH);
  if (!match || !match[2]) return null;
  const [, apiPrefix, , id, rest] = match;
  return `${apiPrefix || ""}/projects/${id}${rest || ""}`;
}

/**
 * Where to send a page request that arrived on a non-canonical host (the *.vercel.app aliases),
 * or null to serve it. A production Clerk instance only issues sessions for its own domain, so a
 * browser on an alias could never sign in. API calls are never redirected.
 */
export function canonicalRedirect(
  host: string,
  pathname: string,
  search: string,
  canonicalHost: string | undefined,
): string | null {
  const canonical = canonicalHost?.trim().toLowerCase();
  if (!canonical || isApiPath(pathname)) return null;
  if (host.toLowerCase() === canonical) return null;
  return `https://${canonical}${pathname}${search}`;
}
