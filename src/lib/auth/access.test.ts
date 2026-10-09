import { describe, expect, it, vi } from "vitest";
import { canAccessProject, createPrincipalLookup, normalizeShareAccess, normalizeStatus, projectAccessFor, type Principal, type PrincipalRow } from "./access";
import { createTtlCache } from "./ttl-cache";

function lookup({
  row = null,
  verified = null,
  owners = "boss@xark.io",
}: { row?: PrincipalRow | null; verified?: string | null; owners?: string } = {}) {
  const deps = {
    findUser: vi.fn(async () => row),
    verifiedEmail: vi.fn(async () => verified),
    ownerEmails: () => owners,
    cache: createTtlCache<Principal>({ ttlMs: 30_000 }),
  };
  return { deps, get: createPrincipalLookup(deps) };
}

const member = (over: Partial<PrincipalRow> = {}): PrincipalRow => ({
  id: "ann",
  role: "member",
  status: "active",
  email: "ann@example.com",
  ...over,
});

describe("normalizeStatus", () => {
  it("only 'blocked' blocks; anything else (incl. legacy values) is active", () => {
    expect(normalizeStatus("blocked")).toBe("blocked");
    for (const s of ["active", "approved", "pending", "", null, undefined]) expect(normalizeStatus(s)).toBe("active");
  });
});

describe("createPrincipalLookup", () => {
  it("a member row → active member with its id, without asking Clerk", async () => {
    const { deps, get } = lookup({ row: member() });
    expect(await get("u")).toEqual({ appUserId: "ann", role: "member", status: "active" });
    expect(deps.verifiedEmail).not.toHaveBeenCalled();
  });

  it("a blocked member stays blocked", async () => {
    const { get } = lookup({ row: member({ status: "blocked" }) });
    expect((await get("u")).status).toBe("blocked");
  });

  it("an owner row is an active owner even if its status says blocked", async () => {
    const { get } = lookup({ row: member({ id: "o", role: "owner", status: "blocked" }) });
    expect(await get("u")).toEqual({ appUserId: "o", role: "owner", status: "active" });
  });

  it("no row yet: a verified OWNER_EMAILS address is the owner; anyone else a member with no id", async () => {
    expect(await lookup({ verified: "boss@xark.io" }).get("u")).toEqual({
      appUserId: null,
      role: "owner",
      status: "active",
    });
    expect(await lookup({ verified: "new@example.com" }).get("u")).toEqual({
      appUserId: null,
      role: "member",
      status: "active",
    });
    expect((await lookup({ verified: null }).get("u")).role).toBe("member");
  });

  it("a member row whose email is listed is promoted only when Clerk verifies it", async () => {
    const row = member({ email: "Boss@Xark.io" });
    expect((await lookup({ row, verified: "boss@xark.io" }).get("u")).role).toBe("owner");
    expect((await lookup({ row, verified: null }).get("u")).role).toBe("member");
  });

  it("caches per user and lets errors through uncached", async () => {
    const { deps, get } = lookup({ row: member() });
    await get("u");
    await get("u");
    expect(deps.findUser).toHaveBeenCalledTimes(1);
    deps.findUser.mockRejectedValueOnce(new Error("db down"));
    await expect(get("other")).rejects.toThrow("db down");
    expect(await get("other")).toMatchObject({ role: "member" });
  });
});

describe("canAccessProject", () => {
  const ann: Principal = { appUserId: "ann", role: "member", status: "active" };
  it("owners reach every project, including ownerless and missing ones", () => {
    const owner: Principal = { appUserId: "o", role: "owner", status: "active" };
    expect(canAccessProject(owner, { ownerId: "ann" })).toBe(true);
    expect(canAccessProject(owner, { ownerId: null })).toBe(true);
    expect(canAccessProject(owner, null)).toBe(true);
  });
  it("members reach only their own workspace's projects", () => {
    expect(canAccessProject(ann, { ownerId: "ann" })).toBe(true);
    expect(canAccessProject(ann, { ownerId: "bob" })).toBe(false);
    expect(canAccessProject(ann, { ownerId: null })).toBe(false);
    expect(canAccessProject(ann, null)).toBe(false);
    expect(canAccessProject({ ...ann, appUserId: null }, { ownerId: null })).toBe(false);
  });
});

describe("projectAccessFor", () => {
  const amy: Principal = { appUserId: "amy", role: "member", status: "active" };
  it("full for the master admin and the owning member; the share level otherwise; null without one", () => {
    expect(projectAccessFor({ appUserId: "o", role: "owner", status: "active" }, { ownerId: "x" })).toBe("full");
    expect(projectAccessFor(amy, { ownerId: "amy" })).toBe("full");
    expect(projectAccessFor(amy, { ownerId: null, share: "download" })).toBe("download");
    expect(projectAccessFor(amy, { ownerId: "bob", share: null })).toBeNull();
    expect(projectAccessFor(amy, null)).toBeNull();
  });
  it("normalizeShareAccess only accepts the three levels", () => {
    expect(normalizeShareAccess("edit")).toBe("edit");
    expect(normalizeShareAccess("admin")).toBeNull();
    expect(normalizeShareAccess(null)).toBeNull();
  });
});
