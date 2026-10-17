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
import { currentSpendScope } from "@/services/ops/spend-scope";
import { BudgetExceededError } from "@/services/ops/budget-guard";

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

describe("withAccess — spend scope and budget refusals", () => {
  beforeEach(() => {
    m.mode = "clerk";
    m.auth.mockResolvedValue({ userId: "clerk_ann" });
    m.getPrincipal.mockResolvedValue({ appUserId: "ann", role: "member", status: "active" });
    m.getProjectTenant.mockResolvedValue({ ownerId: "ann" });
  });
  afterEach(() => vi.resetAllMocks());

  it("opens the project's spend scope, with the signed-in actor, for the handler", async () => {
    const GET = withAccess(async (_r: Request) => Response.json(currentSpendScope() ?? null));
    const body = await (await GET(req(`/api/projects/acme-${P}/insights`, { actor: "ann" }))).json();
    expect(body).toMatchObject({ projectId: P, actorId: "ann", guarded: false });
  });

  it("has no scope outside /api/projects/[id]", async () => {
    const GET = withAccess(async (_r: Request) => Response.json({ scope: currentSpendScope() ?? null }));
    expect((await (await GET(req("/api/workspaces"))).json()).scope).toBeNull();
  });

  it("a budget / allowance refusal from the handler becomes a 402, not a 500", async () => {
    const refusal = new BudgetExceededError({ projectId: P, kind: "llm", model: "m" }, 0.05, {
      level: "account",
      limitUsd: 1,
      spentUsd: 0.99,
    });
    const POST = withAccess(async (_r: Request): Promise<Response> => {
      throw refusal;
    });
    const res = await POST(req(`/api/projects/${P}/creative/scripts`, { method: "POST" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "BUDGET_EXCEEDED", error: expect.stringMatching(/monthly AI allowance/) });
  });

  it("a refusal the route caught and turned into a generic 500 still answers 402", async () => {
    const { withSpendGuard, MemorySpendLedger } = await import("@/services/ops/budget-guard");
    const ledger = new MemorySpendLedger();
    await ledger.setBudget({ projectId: P }, 0.0001);
    const POST = withAccess(async (_r: Request) => {
      try {
        await withSpendGuard({ projectId: P, kind: "llm", model: "m" }, 0.05, async () => "never", { ledger });
        return Response.json({ ok: true });
      } catch {
        return Response.json({ error: "Failed to generate angles" }, { status: 500 }); // what many routes do
      }
    });
    const res = await POST(req(`/api/projects/${P}/creative/angles`, { method: "POST" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "BUDGET_EXCEEDED", error: expect.stringMatching(/Budget exceeded/) });
  });

  it("a successful response is never rewritten, even after a refusal was noted", async () => {
    const { noteRefusal } = await import("@/services/ops/spend-scope");
    const refusal = new BudgetExceededError({ projectId: P, kind: "llm", model: "m" }, 1, { level: "project", limitUsd: 1, spentUsd: 1 });
    const POST = withAccess(async (_r: Request) => {
      noteRefusal(refusal); // e.g. one optional step was refused, the rest succeeded
      return Response.json({ ok: true });
    });
    expect((await POST(req(`/api/projects/${P}/x`, { method: "POST" }))).status).toBe(200);
  });

  it("unexpected failures return a generic 500 without internal details", async () => {
    const GET = withAccess(async (_r: Request): Promise<Response> => {
      throw new Error("boom");
    });
    const response = await GET(req(`/api/projects/${P}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to complete this request. Please try again." });
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
  // Machine and queue routes check their own tokens; health and CSP reports are public.
  const exempt = (r: string) => /^(worker|cron|local-files|queues)\//.test(r) || r === "health/route.ts" || r === "csp-report/route.ts";

  it("found the route files", () => expect(routes.length).toBeGreaterThan(100));

  it.each(routes.filter((r) => !exempt(r)))("%s exports only withAccess(...) handlers", (r) => {
    const src = readFileSync(path.join(root, r), "utf8");
    expect(src).not.toMatch(/^export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m);
    expect(src).toMatch(/^export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withAccess\(/m);
  });
});
