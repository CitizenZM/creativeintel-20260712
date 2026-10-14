import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../../next.config";

const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("security headers (next.config.ts)", () => {
  it("blocks framing, sniffing and plugins; sets referrer, permissions, COOP, HSTS", () => {
    expect(header("Content-Security-Policy")).toMatch(/frame-ancestors 'none'/);
    expect(header("Content-Security-Policy")).toMatch(/object-src 'none'/);
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toMatch(/camera=\(\)/);
    expect(header("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
    expect(header("Strict-Transport-Security")).toMatch(/includeSubDomains/);
  });

  it("applies them to every path and hides x-powered-by", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });

  it("does not restrict scripts yet (Clerk + Next need a worked-out script-src first)", () => {
    expect(header("Content-Security-Policy")).not.toMatch(/script-src|default-src/);
    expect(header("Content-Security-Policy-Report-Only")).toMatch(/script-src 'self'/);
    expect(header("Content-Security-Policy-Report-Only")).toContain("report-uri /api/csp-report");
  });
});
