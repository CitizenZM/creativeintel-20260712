import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  currentAppUser: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  invalidatePrincipal: vi.fn(),
}));
vi.mock("@/services/app-user", () => ({ currentAppUser: m.currentAppUser }));
vi.mock("@/lib/db", () => ({ prisma: { appUser: { findUnique: m.findUnique, update: m.update } } }));
vi.mock("@/services/access", () => ({ invalidatePrincipal: m.invalidatePrincipal }));

import { POST } from "./route";

const OWNER = { id: "owner1", clerkUserId: "user_owner", email: "boss@xark.io", role: "owner", status: "active" };
const TARGET = { id: "m1", clerkUserId: "user_m1", email: "new@example.com", role: "member", status: "active" };

const call = (body: unknown, id = "m1") =>
  POST(
    new Request(`https://creative.xark.io/api/settings/users/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("POST /api/settings/users/[id]", () => {
  beforeEach(() => {
    vi.stubEnv("OWNER_EMAILS", "boss@xark.io");
    m.findUnique.mockResolvedValue(TARGET);
    m.update.mockImplementation(async ({ data }: { data: object }) => ({ ...TARGET, ...data }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("is 403 for a signed-out caller or a non-owner, and changes nothing", async () => {
    m.currentAppUser.mockResolvedValue(null);
    expect((await call({ action: "unblock" })).status).toBe(403);
    m.currentAppUser.mockResolvedValue({ ...OWNER, id: "x", role: "member" });
    const res = await call({ action: "unblock" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Owner only" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    expect((await call({ action: "nuke" })).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("is 404 for an unknown user", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    m.findUnique.mockResolvedValue(null);
    expect((await call({ action: "unblock" }, "missing")).status).toBe(404);
  });

  it("blocks a member and drops their cached principal", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    const res = await call({ action: "block" });
    expect(res.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "blocked", role: "member" } });
    expect(m.invalidatePrincipal).toHaveBeenCalledWith("user_m1");
    expect((await res.json()).user).toMatchObject({ id: "m1", status: "blocked" });
  });

  it("unblocks and promotes", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    expect((await call({ action: "unblock" })).status).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith({ where: { id: "m1" }, data: { status: "active" } });
    expect((await call({ action: "make-owner" })).status).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith({ where: { id: "m1" }, data: { role: "owner", status: "active" } });
  });

  it("refuses to lock the owner out", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    m.findUnique.mockResolvedValue(OWNER);
    expect((await call({ action: "block" }, "owner1")).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("sets and clears a member's monthly allowance", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    expect((await call({ monthlyAllowanceUsd: 5 })).status).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith({ where: { id: "m1" }, data: { monthlyAllowanceUsd: 5 } });
    expect((await call({ monthlyAllowanceUsd: null })).status).toBe(200);
    expect(m.update).toHaveBeenLastCalledWith({ where: { id: "m1" }, data: { monthlyAllowanceUsd: null } });
    expect((await call({ monthlyAllowanceUsd: -1 })).status).toBe(400);
  });
});
