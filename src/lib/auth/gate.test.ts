import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BLOCKED_PATH, decideAccess, deniedResponse, isAdminOnlyPath } from "./gate";
import type { Principal, ProjectTenant } from "./access";

const P = "cabcdefghijklmnopqrstuvw"; // a project cuid
const OWNER: Principal = { appUserId: "owner1", role: "owner", status: "active" };
const ANN: Principal = { appUserId: "ann", role: "member", status: "active" };
const BOB: Principal = { appUserId: "bob", role: "member", status: "active" };
const NEW_MEMBER: Principal = { appUserId: null, role: "member", status: "active" };
const BLOCKED: Principal = { appUserId: "ann", role: "member", status: "blocked" };

// Project P lives in Ann's workspace; "clegacy…" in the master admin's ownerless default workspace.
const LEGACY = "clegacyprojectidxxxxxxxx";
const tenants: Record<string, ProjectTenant> = { [P]: { ownerId: "ann" }, [LEGACY]: { ownerId: null } };

function run(pathname: string, principal: Principal | null) {
  const principalOf = vi.fn(async () => principal!);
  const projectTenant = vi.fn(async (id: string) => tenants[id] ?? null);
  return {
    principalOf,
    projectTenant,
    decision: decideAccess({ pathname, userId: principal ? "clerk_user" : null, principalOf, projectTenant }),
  };
}

describe("decideAccess (proxy decision table)", () => {
  it.each([
    // pathname, principal, expected
    ["/", null, "sign-in"],
    ["/projects/new", null, "sign-in"],
    ["/api/projects", null, "unauthorized"],
    [`/api/projects/${P}`, null, "unauthorized"],

    // master admin: everything
    ["/", OWNER, "allow"],
    ["/settings/ai", OWNER, "allow"],
    ["/api/settings/users/x", OWNER, "allow"],
    [`/projects/${P}/studio`, OWNER, "allow"],
    [`/api/projects/${LEGACY}/report`, OWNER, "allow"],
    ["/api/projects/cnosuchprojectxxxxxxxxxxx", OWNER, "allow"],

    // member: their own workspace's projects only
    ["/", ANN, "allow"],
    ["/all", ANN, "allow"],
    ["/projects/new", ANN, "allow"],
    ["/library/brands", ANN, "allow"],
    ["/api/projects", ANN, "allow"],
    ["/api/workspaces", ANN, "allow"],
    [`/projects/${P}`, ANN, "allow"],
    [`/projects/acme-shoes-${P}/insights`, ANN, "allow"],
    [`/api/projects/${P}/artifacts/archive`, ANN, "allow"],
    [`/projects/${P}`, BOB, "forbidden-page"],
    [`/projects/acme-shoes-${P}/studio`, BOB, "forbidden-page"],
    [`/api/projects/${P}/artifacts/archive`, BOB, "not-found-api"],
    [`/api/projects/${LEGACY}`, ANN, "not-found-api"],
    [`/projects/${LEGACY}/history`, ANN, "forbidden-page"],
    ["/api/projects/cnosuchprojectxxxxxxxxxxx", ANN, "not-found-api"],
    ["/api/projects/not-a-cuid", ANN, "not-found-api"],
    [`/api/projects/${P}`, NEW_MEMBER, "not-found-api"],

    // member: no admin areas
    ["/settings/ai", ANN, "forbidden-page"],
    ["/settings/users", ANN, "forbidden-page"],
    ["/status", ANN, "forbidden-page"],
    ["/api/settings/ai/vision-model", ANN, "forbidden-api"],
    ["/api/settings/users/owner1", ANN, "forbidden-api"],
    ["/api/debug", ANN, "forbidden-api"],
    ["/api/libtv/balance", ANN, "forbidden-api"],

    // blocked
    ["/", BLOCKED, "blocked-page"],
    [`/projects/${P}`, BLOCKED, "blocked-page"],
    ["/api/projects", BLOCKED, "blocked-api"],
    [BLOCKED_PATH, BLOCKED, "allow"],
  ] as const)("%s · %o → %s", async (pathname, principal, expected) => {
    expect(await run(pathname, principal).decision).toBe(expected);
  });

  it.each([
    "/sign-in",
    "/sign-up/verify-email-address",
    "/api/health",
    "/api/worker/operator",
    "/api/cron/autopilot",
    "/api/local-files/upload",
    "/theme-init.js",
  ])("%s is allowed without a session or any lookup", async (pathname) => {
    for (const principal of [null, BLOCKED]) {
      const r = run(pathname, principal);
      expect(await r.decision).toBe("allow");
      expect(r.principalOf).not.toHaveBeenCalled();
      expect(r.projectTenant).not.toHaveBeenCalled();
    }
  });

  it("only looks a project up for a member on a project path", async () => {
    const owner = run(`/api/projects/${P}`, OWNER);
    await owner.decision;
    expect(owner.projectTenant).not.toHaveBeenCalled();
    const list = run("/api/projects", ANN);
    await list.decision;
    expect(list.projectTenant).not.toHaveBeenCalled();
    const one = run(`/projects/slug-${P}/studio`, ANN);
    await one.decision;
    expect(one.projectTenant).toHaveBeenCalledWith(P);
  });

  it("fails closed when a lookup throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = vi.fn(async (): Promise<never> => {
      throw new Error("db down");
    });
    const ok = vi.fn(async () => ANN);
    for (const [principalOf, projectTenant] of [
      [boom, vi.fn()],
      [ok, boom],
    ] as const) {
      expect(await decideAccess({ pathname: `/api/projects/${P}`, userId: "u", principalOf, projectTenant })).toBe(
        "unavailable",
      );
      expect(await decideAccess({ pathname: `/projects/${P}`, userId: "u", principalOf, projectTenant })).toBe(
        "unavailable",
      );
    }
    errSpy.mockRestore();
  });
});

describe("isAdminOnlyPath", () => {
  it.each([
    ["/settings/ai", true],
    ["/settings/ai/providers", true],
    ["/settings/users", true],
    ["/status", true],
    ["/api/settings/ai", true],
    ["/api/debug", true],
    ["/api/libtv/balance", true],
    ["/statuses", false],
    ["/all", false],
    ["/api/projects", false],
    ["/projects/x/settings/ai", false],
  ])("%s → %s", (p, expected) => expect(isAdminOnlyPath(p)).toBe(expected));
});

describe("deniedResponse", () => {
  const req = (path: string) => new NextRequest(`https://creative.xark.io${path}?a=1`);

  it("redirects blocked pages to /blocked and forbidden pages to /projects", () => {
    const blocked = deniedResponse("blocked-page", req("/projects/new"));
    expect(blocked.status).toBe(307);
    expect(blocked.headers.get("location")).toBe("https://creative.xark.io/blocked");
    const forbidden = deniedResponse("forbidden-page", req(`/projects/${P}`));
    expect(forbidden.headers.get("location")).toBe("https://creative.xark.io/projects");
  });

  it("answers API refusals with JSON", async () => {
    const cases = [
      ["unauthorized", 401, "Unauthorized"],
      ["blocked-api", 403, "Account blocked"],
      ["forbidden-api", 403, "Admin only"],
      ["not-found-api", 404, "Not found"],
      ["unavailable", 503, "Access check unavailable"],
    ] as const;
    for (const [decision, status, error] of cases) {
      const res = deniedResponse(decision, req("/api/projects"));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error });
    }
  });

  it("answers a failed lookup on a page with 503 text", async () => {
    const page = deniedResponse("unavailable", req("/"));
    expect(page.status).toBe(503);
    expect(await page.text()).toMatch(/unavailable/i);
  });
});
