import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;

/** proxy.ts picks its gate at module load, so each test stubs the env and re-imports it. */
async function loadProxy(env: Record<string, string>) {
  vi.resetModules();
  for (const k of [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "CF_ACCESS_TEAM_DOMAIN",
    "CF_ACCESS_AUD",
    "CF_ACCESS_HOST",
    "AUTH_PROVIDER",
    "AUTH_CANONICAL_HOST",
  ]) {
    vi.stubEnv(k, env[k] ?? "");
  }
  vi.stubEnv("CLERK_TELEMETRY_DISABLED", "1");
  const { proxy } = await import("./proxy");
  return async (url: string): Promise<Response> => {
    const res = await proxy(new NextRequest(url), event);
    if (!res) throw new Error(`proxy returned no response for ${url}`);
    return res;
  };
}

const ID = "cabc123def456ghi789jkl0";
// A syntactically valid development key for a made-up Frontend API host (never contacted:
// a request without Clerk cookies is signed out without any network call).
const DUMMY_PK = `pk_test_${Buffer.from("clerk.example.test$").toString("base64")}`;
const CLERK = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: DUMMY_PK, CLERK_SECRET_KEY: "sk_test_dummy" };
const CF = { CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com", CF_ACCESS_AUD: "aud" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — none", () => {
  it("serves everything and still strips the project slug", async () => {
    const proxy = await loadProxy({});
    const res = await proxy(`http://localhost/projects/acme-${ID}/studio`);
    expect(res.headers.get("x-middleware-rewrite")).toBe(`http://localhost/projects/${ID}/studio`);
    const plain = await proxy("http://localhost/all");
    expect(plain.status).toBe(200);
    expect(plain.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy — cf-access", () => {
  it("refuses requests without an Access JWT, but not the machine routes", async () => {
    const proxy = await loadProxy({ ...CF });
    expect((await proxy("https://creative.xark.io/api/projects")).status).toBe(401);
    expect((await proxy("https://creative.xark.io/")).status).toBe(401);
    expect((await proxy("https://creative.xark.io/api/cron/autopilot")).status).toBe(200);
  });
});

describe("proxy — locked", () => {
  it("answers 503 when AUTH_PROVIDER names an unconfigured provider", async () => {
    const proxy = await loadProxy({ AUTH_PROVIDER: "clerk" });
    expect((await proxy("https://creative.xark.io/api/projects")).status).toBe(503);
    expect((await proxy("https://creative.xark.io/api/worker/operator")).status).toBe(200);
  });
});

describe("proxy — clerk", () => {
  it("401s signed-out API calls", async () => {
    const proxy = await loadProxy({ ...CLERK, ...CF });
    const res = await proxy("https://creative.xark.io/api/projects");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("redirects signed-out page loads to /sign-in with redirect_url", async () => {
    const proxy = await loadProxy({ ...CLERK });
    const res = await proxy(`https://creative.xark.io/projects/acme-${ID}`);
    expect([302, 307]).toContain(res.status);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("redirect_url")).toBe(`https://creative.xark.io/projects/acme-${ID}`);
  });

  it("leaves the auth pages, health check and machine routes open (no CF Access check)", async () => {
    const proxy = await loadProxy({ ...CLERK, ...CF });
    for (const p of ["/sign-in", "/sign-up/verify-email-address", "/api/health", "/api/worker/operator", "/theme-init.js"]) {
      const res = await proxy(`https://creative.xark.io${p}`);
      expect(res.status, p).toBe(200);
    }
  });

  it("sends page requests on an alias to the canonical host", async () => {
    const proxy = await loadProxy({ ...CLERK, AUTH_CANONICAL_HOST: "creative.xark.io" });
    const res = await proxy("https://creativeintel.vercel.app/all?x=1");
    expect(res.headers.get("location")).toBe("https://creative.xark.io/all?x=1");
    // API calls on the alias are not redirected — they are refused.
    expect((await proxy("https://creativeintel.vercel.app/api/projects")).status).toBe(401);
  });
});
