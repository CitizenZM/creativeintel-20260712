import { describe, expect, it } from "vitest";
import { selectAuthMode } from "./mode";

const CLERK = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_x" };
const CF = { CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com", CF_ACCESS_AUD: "aud" };

describe("selectAuthMode", () => {
  it("defaults to clerk when both Clerk keys are set", () => {
    expect(selectAuthMode({ ...CLERK }).mode).toBe("clerk");
  });

  it("prefers clerk over Cloudflare Access when both are configured", () => {
    expect(selectAuthMode({ ...CLERK, ...CF }).mode).toBe("clerk");
  });

  it("falls back to cf-access when the Clerk keys are absent", () => {
    expect(selectAuthMode({ ...CF }).mode).toBe("cf-access");
  });

  it("needs both Clerk keys — one alone keeps today's behaviour", () => {
    expect(selectAuthMode({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", ...CF }).mode).toBe("cf-access");
    expect(selectAuthMode({ CLERK_SECRET_KEY: "sk_test_x" }).mode).toBe("none");
  });

  it("treats blank values as unset", () => {
    expect(selectAuthMode({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: " ", CLERK_SECRET_KEY: "" }).mode).toBe("none");
    expect(selectAuthMode({ CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "aud" }).mode).toBe("none");
  });

  it("is none when nothing is configured (local dev)", () => {
    expect(selectAuthMode({}).mode).toBe("none");
  });

  describe("AUTH_PROVIDER override", () => {
    it("can force cf-access while Clerk keys exist", () => {
      expect(selectAuthMode({ ...CLERK, ...CF, AUTH_PROVIDER: "cf-access" }).mode).toBe("cf-access");
    });

    it("can force none", () => {
      expect(selectAuthMode({ ...CLERK, ...CF, AUTH_PROVIDER: "none" }).mode).toBe("none");
    });

    it("is case- and whitespace-insensitive", () => {
      expect(selectAuthMode({ ...CLERK, AUTH_PROVIDER: " Clerk " }).mode).toBe("clerk");
    });

    it("an empty override means the default", () => {
      expect(selectAuthMode({ ...CF, AUTH_PROVIDER: "" }).mode).toBe("cf-access");
    });

    it("fails closed when the forced provider is not configured", () => {
      const clerk = selectAuthMode({ ...CF, AUTH_PROVIDER: "clerk" });
      expect(clerk.mode).toBe("locked");
      expect(clerk.reason).toMatch(/CLERK_SECRET_KEY/);
      expect(selectAuthMode({ ...CLERK, AUTH_PROVIDER: "cf-access" }).mode).toBe("locked");
    });

    it("fails closed on an unknown value", () => {
      const d = selectAuthMode({ ...CLERK, AUTH_PROVIDER: "clerkk" });
      expect(d.mode).toBe("locked");
      expect(d.reason).toMatch(/clerkk/);
    });
  });
});
