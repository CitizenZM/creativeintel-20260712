/**
 * Xark Accounts (account.xark.io): the shared Clerk instance every Xark app signs in through.
 * Pure (env passed in) so the proxy, the pages and the tests agree. Contract:
 * ~/Projects/account-xark-20261029/docs-SSO-CONTRACT.md.
 *
 * - Sign-in / sign-up happen on ACCOUNT_URL (default https://account.xark.io), never here.
 * - The session token's `apps` claim (Clerk publicMetadata.apps) says who may open CreativeIntel:
 *   `apps.creative` (owner | member), or `apps.account === "super_admin"` for everything.
 */
type Env = Record<string, string | undefined>;

export const APP_KEY = "creative";
export const DEFAULT_ACCOUNT_URL = "https://account.xark.io";
export const DEFAULT_CANONICAL_HOST = "creative.account.xark.io";
const SUPER_ADMIN = "super_admin";

/** `apps` from the session claims: only string roles, e.g. { creative: "member", account: "super_admin" }. */
export type Apps = Record<string, string>;

export function parseApps(raw: unknown): Apps {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Apps = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && v) out[k] = v;
  return out;
}

export function canEnterCreative(apps: Apps): boolean {
  return apps.account === SUPER_ADMIN || !!apps[APP_KEY];
}

export function isCreativeOwnerClaim(apps: Apps): boolean {
  return apps[APP_KEY] === "owner";
}

export function accountUrl(env: Env = process.env): string {
  return env.ACCOUNT_URL?.trim().replace(/\/+$/, "") || DEFAULT_ACCOUNT_URL;
}

/** This app's landing page on its canonical host. */
export function appLandingUrl(env: Env = process.env): string {
  return `https://${env.AUTH_CANONICAL_HOST?.trim() || DEFAULT_CANONICAL_HOST}/`;
}

/** A return URL we pass on: https on the canonical host only, else the landing page. */
export function safeReturnUrl(raw: string | null | undefined, env: Env = process.env): string {
  const landing = appLandingUrl(env);
  try {
    const u = new URL(raw ?? "");
    if (u.protocol === "https:" && u.host === new URL(landing).host) return u.toString();
  } catch {
    // not a URL
  }
  return landing;
}

export function accountSignInUrl(returnUrl: string, env: Env = process.env): string {
  return `${accountUrl(env)}/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`;
}

export function accountSignUpUrl(returnUrl: string, env: Env = process.env): string {
  return `${accountUrl(env)}/sign-up?redirect_url=${encodeURIComponent(returnUrl)}`;
}

export function noAccessUrl(env: Env = process.env): string {
  return `${accountUrl(env)}/no-access?app=${APP_KEY}`;
}
