import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ project: { findUnique: vi.fn(), findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { sameTenantProjectIds, tenantOfProject, tenantProjectWhere } from "./tenancy";

const project = (ownerId: string | null, role = "member") => ({
  workspace: ownerId === undefined ? null : { ownerId, owner: ownerId ? { role } : null },
});

describe("tenantOfProject", () => {
  afterEach(() => vi.resetAllMocks());

  it("a member's workspace → that member", async () => {
    db.project.findUnique.mockResolvedValue(project("ann"));
    expect(await tenantOfProject("p")).toBe("ann");
  });

  it("an ownerless workspace, no workspace, or an admin-owned workspace → the admin (null)", async () => {
    db.project.findUnique.mockResolvedValueOnce(project(null));
    expect(await tenantOfProject("p")).toBeNull();
    db.project.findUnique.mockResolvedValueOnce({ workspace: null });
    expect(await tenantOfProject("p")).toBeNull();
    db.project.findUnique.mockResolvedValueOnce(project("boss", "owner"));
    expect(await tenantOfProject("p")).toBeNull();
  });

  it("a missing project → undefined (and no same-tenant ids)", async () => {
    db.project.findUnique.mockResolvedValue(null);
    expect(await tenantOfProject("p")).toBeUndefined();
    expect(await sameTenantProjectIds("p")).toEqual([]);
    expect(db.project.findMany).not.toHaveBeenCalled();
  });
});

describe("tenantProjectWhere", () => {
  it("a member: only workspaces they own", () => {
    expect(tenantProjectWhere("ann")).toEqual({ workspace: { ownerId: "ann" } });
  });
  it("the admin: no workspace, ownerless, or admin-owned — never a member's", () => {
    expect(tenantProjectWhere(null)).toEqual({
      OR: [{ workspaceId: null }, { workspace: { ownerId: null } }, { workspace: { owner: { role: "owner" } } }],
    });
  });
  it("sameTenantProjectIds queries with the project's tenant", async () => {
    db.project.findUnique.mockResolvedValue(project("ann"));
    db.project.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await sameTenantProjectIds("a")).toEqual(["a", "b"]);
    expect(db.project.findMany).toHaveBeenCalledWith({ where: { workspace: { ownerId: "ann" } }, select: { id: true } });
  });
});
