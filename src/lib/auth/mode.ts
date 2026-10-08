/**
 * Which gate fronts the app. Pure (takes the env as an argument) so the proxy,
 * the root layout and the tests all agree.
 *
 * - clerk     — Clerk sessions (email + password accounts). Skips Cloudflare Access entirely.
 * - cf-access — today's Cloudflare Access JWT check.
 * - none      — no gate (local dev).
 * - locked    — AUTH_PROVIDER names a provider that isn't configured (or is unknown): every
 *               non-machine request is refused rather than silently served without a gate.
 *
 * Default: clerk when both Clerk keys are set, else cf-access when configured, else none.
 * `AUTH_PROVIDER=clerk|cf-access|none` overrides the default.
 */
export type AuthMode = "clerk" | "cf-access" | "none" | "locked";

export interface AuthModeDecision {
  mode: AuthMode;
  reason: string;
}

type Env = Record<string, string | undefined>;

const has = (v: string | undefined) => !!v && v.trim().length > 0;

export function clerkConfigured(env: Env): boolean {
  return has(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && has(env.CLERK_SECRET_KEY);
}

export function cfAccessConfigured(env: Env): boolean {
  return has(env.CF_ACCESS_TEAM_DOMAIN) && has(env.CF_ACCESS_AUD);
}

export function selectAuthMode(env: Env): AuthModeDecision {
  const override = env.AUTH_PROVIDER?.trim().toLowerCase();
  const clerk = clerkConfigured(env);
  const cf = cfAccessConfigured(env);

  if (override) {
    switch (override) {
      case "clerk":
        return clerk
          ? { mode: "clerk", reason: "AUTH_PROVIDER=clerk" }
          : {
              mode: "locked",
              reason: "AUTH_PROVIDER=clerk but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are not both set",
            };
      case "cf-access":
        return cf
          ? { mode: "cf-access", reason: "AUTH_PROVIDER=cf-access" }
          : { mode: "locked", reason: "AUTH_PROVIDER=cf-access but CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are not both set" };
      case "none":
        return { mode: "none", reason: "AUTH_PROVIDER=none" };
      default:
        return { mode: "locked", reason: `unknown AUTH_PROVIDER "${override}" (expected clerk, cf-access or none)` };
    }
  }

  if (clerk) return { mode: "clerk", reason: "Clerk keys set" };
  if (cf) return { mode: "cf-access", reason: "Cloudflare Access configured" };
  return { mode: "none", reason: "no auth provider configured" };
}

/** True when Clerk is the active gate for this process (layout, server helpers). */
export function isClerkActive(env: Env = process.env): boolean {
  return selectAuthMode(env).mode === "clerk";
}
