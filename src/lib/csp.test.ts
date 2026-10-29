import { describe, expect, it } from "vitest";
import { enforceCsp, scriptPolicy } from "./csp";

describe("CSP rollout", () => {
  it("requires a full observation week and explicit enforcement", () => {
    const now = Date.parse("2026-10-20T14:00:00Z");
    expect(enforceCsp({ CSP_MODE: "enforce" }, now)).toBe(false);
    expect(enforceCsp({ CSP_MODE: "enforce", CSP_REPORT_STARTED_AT: "2026-10-14T14:00:00Z" }, now)).toBe(false);
    expect(enforceCsp({ CSP_MODE: "report", CSP_REPORT_STARTED_AT: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(enforceCsp({ CSP_MODE: "enforce", CSP_REPORT_STARTED_AT: "2026-10-13T14:00:00Z" }, now)).toBe(true);
  });
  it("allows only the configured Clerk origin, uses nonces and no unsafe inline", () => {
    const key = `pk_live_${Buffer.from("clerk.creative.xark.io$").toString("base64")}`;
    const policy = scriptPolicy("nonce123", { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key, NODE_ENV: "production" });
    expect(policy).toContain("https://clerk.creative.xark.io");
    expect(policy).toContain("'nonce-nonce123'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https:\/\/\*/);
  });
});
