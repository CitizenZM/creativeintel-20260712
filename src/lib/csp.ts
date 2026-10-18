const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Enforcement requires an explicit switch AND a complete observation week.
 * Set CSP_REPORT_STARTED_AT to the actual first deployed report-only timestamp. */
export function enforceCsp(env: Record<string, string | undefined> = process.env, now = Date.now()): boolean {
  const start = Date.parse(env.CSP_REPORT_STARTED_AT || "");
  return env.CSP_MODE === "enforce" && Number.isFinite(start) && now >= start + WEEK_MS;
}

function clerkOrigin(env: Record<string, string | undefined>): string | null {
  const key = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;
  try {
    const domain = Buffer.from(key.replace(/^pk_(test|live)_/, ""), "base64").toString().replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(domain) ? `https://${domain}` : null;
  } catch { return null; }
}

export function scriptPolicy(nonce?: string, env: Record<string, string | undefined> = process.env): string {
  const sources = ["'self'", clerkOrigin(env), "https://challenges.cloudflare.com"].filter(Boolean);
  if (nonce) sources.push(`'nonce-${nonce}'`);
  if (env.NODE_ENV === "development") sources.push("'unsafe-eval'");
  return `script-src ${sources.join(" ")}; object-src 'none'; base-uri 'self'; report-uri /api/csp-report`;
}
