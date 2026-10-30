import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

/**
 * Wiring test for src/proxy.ts in Clerk mode with a signed-in session: Clerk's middleware is replaced
 * by a pass-through that hands our callback a fake auth() (the session under test, incl. its `apps`
 * claim); everything else is the real proxy. Signed-out flows use the real Clerk SDK in proxy.test.ts.
 */
const m = vi.hoisted(() => ({
  session: { userId: null as string | null, sessionClaims: {} as Record<string, unknown> },
  getPrincipal: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware:
    (cb: (auth: () => Promise<unknown>, req: NextRequest) => unknown) => (req: NextRequest) =>
      cb(async () => m.session, req),
}));
vi.mock("@/services/access", () => ({ getPrincipal: m.getPrincipal, getProjectTenant: vi.fn(async () => null) }));

let proxy: (req: NextRequest, ev: NextFetchEvent) => Promise<Response | undefined>;
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
  vi.stubEnv("AUTH_PROVIDER", "");
  vi.stubEnv("AUTH_CANONICAL_HOST", "creative.account.xark.io");
  vi.stubEnv("ACCOUNT_URL", "");
  vi.resetModules();
  ({ proxy } = (await import("./proxy")) as unknown as { proxy: typeof proxy });
});
afterAll(() => vi.unstubAllEnvs());

const call = (url: string, method = "GET") => proxy(new NextRequest(url, { method }), {} as NextFetchEvent);

describe("proxy — Xark Accounts", () => {
  beforeEach(() => {
    m.session = { userId: null, sessionClaims: {} };
    m.getPrincipal.mockResolvedValue({ appUserId: "a1", role: "member", status: "active" });
  });

  it("301s the old host to creative.account.xark.io, same path + query, before any auth", async () => {
    for (const path of ["/projects/x?tab=1", "/api/projects?a=b", "/sign-in"]) {
      const res = (await call(`https://creative.xark.io${path}`))!;
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(`https://creative.account.xark.io${path}`);
    }
    expect(m.getPrincipal).not.toHaveBeenCalled();
  });

  it("leaves machine routes on the old host alone (they carry their own tokens)", async () => {
    const res = (await call("https://creative.xark.io/api/cron/autopilot"))!;
    expect(res.status).toBe(200);
  });

  it("signed-out page → 302 account.xark.io/sign-in with the full URL; API → 401", async () => {
    const page = (await call("https://creative.account.xark.io/projects?a=1"))!;
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe(
      "https://account.xark.io/sign-in?redirect_url=" + encodeURIComponent("https://creative.account.xark.io/projects?a=1"),
    );
    const api = (await call("https://creative.account.xark.io/api/projects"))!;
    expect(api.status).toBe(401);
  });

  it("signed in without apps.creative → no-access page / 403 API; with it → through", async () => {
    m.session = { userId: "user_1", sessionClaims: { apps: { portal: "client" } } };
    const page = (await call("https://creative.account.xark.io/projects"))!;
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("https://account.xark.io/no-access?app=creative");
    expect((await call("https://creative.account.xark.io/api/projects"))!.status).toBe(403);

    m.session = { userId: "user_1", sessionClaims: { apps: { creative: "member" } } };
    expect((await call("https://creative.account.xark.io/projects"))!.status).toBe(200);
    m.session = { userId: "user_1", sessionClaims: { apps: { account: "super_admin" } } };
    expect((await call("https://creative.account.xark.io/api/projects"))!.status).toBe(200);
  });
});
