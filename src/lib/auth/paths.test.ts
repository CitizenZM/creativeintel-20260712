import { describe, expect, it } from "vitest";
import { canonicalRedirect, classifyPath, isApiPath, rewriteSluggedPath } from "./paths";

describe("classifyPath", () => {
  it.each([
    "/api/worker",
    "/api/worker/operator",
    "/api/cron",
    "/api/cron/autopilot",
    "/api/local-files",
    "/api/local-files/upload",
  ])("%s is a machine route", (p) => {
    expect(classifyPath(p)).toBe("machine");
  });

  it.each([
    "/sign-in",
    "/sign-in/factor-one",
    "/sign-in/sso-callback",
    "/sign-up",
    "/sign-up/verify-email-address",
    "/api/health",
    "/api/health/",
    "/theme-init.js",
    "/globe.svg",
    "/_next/webpack-hmr",
  ])("%s is public", (p) => {
    expect(classifyPath(p)).toBe("public");
  });

  it.each([
    "/",
    "/all",
    "/projects/new",
    "/projects/acme-cabc123def456ghi789jkl0/studio",
    "/settings/ai",
    "/settings/users",
    "/status",
    "/api/projects",
    "/api/workspaces/active",
    "/api/health/video",
    "/api/healthz",
    "/api/workerx",
    "/api/cronjob",
    "/sign-inx",
    "/sign-upgrade",
    "/api/sign-in",
    "/projects/x/report.png",
    "/api/foo.js",
  ])("%s is protected", (p) => {
    expect(classifyPath(p)).toBe("protected");
  });
});

describe("isApiPath", () => {
  it("matches /api and its children only", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/projects")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    expect(isApiPath("/projects/api")).toBe(false);
  });
});

describe("rewriteSluggedPath", () => {
  const id = "cabc123def456ghi789jkl0";
  it("strips the brand slug from page and API paths", () => {
    expect(rewriteSluggedPath(`/projects/acme-co-${id}`)).toBe(`/projects/${id}`);
    expect(rewriteSluggedPath(`/projects/acme-${id}/studio/runs`)).toBe(`/projects/${id}/studio/runs`);
    expect(rewriteSluggedPath(`/api/projects/acme-${id}/jobs`)).toBe(`/api/projects/${id}/jobs`);
  });

  it("leaves bare ids and other paths alone", () => {
    expect(rewriteSluggedPath(`/projects/${id}`)).toBeNull();
    expect(rewriteSluggedPath("/projects/new")).toBeNull();
    expect(rewriteSluggedPath("/all")).toBeNull();
  });
});

describe("canonicalRedirect", () => {
  it("sends other hosts to the canonical host, keeping path and query", () => {
    expect(canonicalRedirect("foo.vercel.app", "/projects", "?a=1", "creative.xark.io")).toBe(
      "https://creative.xark.io/projects?a=1",
    );
  });

  it("is a no-op on the canonical host, without a canonical host, or for API calls", () => {
    expect(canonicalRedirect("creative.xark.io", "/", "", "creative.xark.io")).toBeNull();
    expect(canonicalRedirect("CREATIVE.xark.io", "/", "", "creative.xark.io")).toBeNull();
    expect(canonicalRedirect("foo.vercel.app", "/", "", undefined)).toBeNull();
    expect(canonicalRedirect("foo.vercel.app", "/", "", "")).toBeNull();
    expect(canonicalRedirect("foo.vercel.app", "/api/projects", "", "creative.xark.io")).toBeNull();
  });
});
