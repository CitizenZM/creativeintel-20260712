import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const m = vi.hoisted(() => ({
  mode: "clerk",
  auth: vi.fn(),
  getPrincipal: vi.fn(),
  getProjectTenant: vi.fn(),
}));
vi.mock("./mode", () => ({ selectAuthMode: () => ({ mode: m.mode }) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("@/services/access", () => ({ getPrincipal: m.getPrincipal, getProjectTenant: m.getProjectTenant }));

import { checkRouteAccess, withAccess } from "./route-guard";
import { ACTOR_HEADER } from "./actor";

const P = "cabcdefghijklmnopqrstuvw";
const req = (p: string, init: RequestInit & { actor?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.actor) headers.set(ACTOR_HEADER, init.actor);
  return new Request(`https://creative.xark.io${p}`, { ...init, headers });
};

describe("checkRouteAccess (in-handler second gate)", () => {
  beforeEach(() => {
    m.mode = "clerk";
    m.auth.mockResolvedValue({ userId: "clerk_ann" });
    m.getPrincipal.mockResolvedValue({ appUserId: "ann", role: "member", status: "active" });
    m.getProjectTenant.mockResolvedValue({ ownerId: "ann" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("passes through outside Clerk mode (dev / tests / Cloudflare Access)", async () => {
    m.mode = "none";
    expect(await checkRouteAccess(req("/api/projects"))).toBeNull();
    expect(m.auth).not.toHaveBeenCalled();
  });

  it("401 when the Clerk proxy never ran (auth() throws) — a middleware bypass gets nothing", async () => {
    m.auth.mockRejectedValue(new Error("clerkMiddleware not detected"));
    const res = await checkRouteAccess(req(`/api/projects/${P}`));
    expect(res?.status).toBe(401);
  });

  it("401 signed out; allows the owner of the project", async () => {
    m.auth.mockResolvedValueOnce({ userId: null });
    expect((await checkRouteAccess(req(`/api/projects/${P}`)))?.status).toBe(401);
    expect(await checkRouteAccess(req(`/api/projects/${P}`))).toBeNull();
  });

  it("re-applies tenancy, share levels and admin-only areas", async () => {
    m.getProjectTenant.mockResolvedValue({ ownerId: "bob", share: null });
    expect((await checkRouteAccess(req(`/api/projects/${P}`)))?.status).toBe(404);
    m.getProjectTenant.mockResolvedValue({ ownerId: "bob", share: "view" });
    expect((await checkRouteAccess(req(`/api/projects/${P}/product`, { method: "PUT" })))?.status).toBe(403);
    expect(await checkRouteAccess(req(`/api/projects/${P}`))).toBeNull();
    expect((await checkRouteAccess(req("/api/settings/users/x", { method: "POST" })))?.status).toBe(403);
  });

  it("blocked accounts get 403", async () => {
    m.getPrincipal.mockResolvedValue({ appUserId: "ann", role: "member", status: "blocked" });
    expect((await checkRouteAccess(req("/api/projects")))?.status).toBe(403);
  });

  it("403 when the actor header doesn't match the signed-in user (spoofed past the proxy)", async () => {
    expect((await checkRouteAccess(req("/api/projects", { actor: "someone-else" })))?.status).toBe(403);
    expect(await checkRouteAccess(req("/api/projects", { actor: "ann" }))).toBeNull();
  });

  it("withAccess runs the handler only when allowed, with the original arguments", async () => {
    const handler = vi.fn(async (_r: Request, ctx: { params: Promise<{ projectId: string }> }) =>
      Response.json({ id: (await ctx.params).projectId }),
    );
    const GET = withAccess(handler);
    const ctx = { params: Promise.resolve({ projectId: P }) };
    expect(await (await GET(req(`/api/projects/${P}`), ctx)).json()).toEqual({ id: P });
    m.getProjectTenant.mockResolvedValue({ ownerId: "bob", share: null });
    expect((await GET(req(`/api/projects/${P}`), ctx)).status).toBe(404);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("every user-facing API route is wrapped", () => {
  const root = path.join(process.cwd(), "src/app/api");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(path.relative(root, p));
    }
  };
  walk(root);
  // Machine routes check their own tokens; /api/health is deliberately public.
  const exempt = (r: string) => /^(worker|cron|local-files)\//.test(r) || r === "health/route.ts";

  it("found the route files", () => expect(routes.length).toBeGreaterThan(100));

  it.each(routes.filter((r) => !exempt(r)))("%s exports only withAccess(...) handlers", (r) => {
    const src = readFileSync(path.join(root, r), "utf8");
    expect(src).not.toMatch(/^export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m);
    expect(src).toMatch(/^export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withAccess\(/m);
  });
});
