import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  currentAppUser: vi.fn(),
  findFirst: vi.fn(),
  createInvitation: vi.fn(),
  getInvitationList: vi.fn(),
  revokeInvitation: vi.fn(),
  shareProjects: vi.fn(),
  invalidateShares: vi.fn(),
}));
vi.mock("@/services/project-shares", () => ({ shareProjects: m.shareProjects }));
vi.mock("@/services/access", () => ({ invalidateShares: m.invalidateShares }));
vi.mock("@/services/app-user", () => ({ currentAppUser: m.currentAppUser }));
vi.mock("@/lib/db", () => ({ prisma: { appUser: { findFirst: m.findFirst } } }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    invitations: {
      createInvitation: m.createInvitation,
      getInvitationList: m.getInvitationList,
      revokeInvitation: m.revokeInvitation,
    },
  }),
}));

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";
import { invitationRedirectUrl } from "@/services/invitations";

const OWNER = { id: "o1", email: "barronzuo@gmail.com", role: "owner" };
const MEMBER = { id: "m1", email: "x@y.com", role: "member" };
const post = (body: unknown) =>
  POST(new Request("https://creative.xark.io/api/settings/invitations", { method: "POST", body: JSON.stringify(body) }));

describe("/api/settings/invitations", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    m.findFirst.mockResolvedValue(null);
    m.shareProjects.mockImplementation(async ({ projectIds }: { projectIds: string[] }) => ({ shared: projectIds.length, userId: null }));
    m.createInvitation.mockImplementation(async (p: { emailAddress: string }) => ({
      id: "inv_1",
      emailAddress: p.emailAddress,
      status: "pending",
      createdAt: 1,
    }));
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("is owner-only for GET, POST and DELETE", async () => {
    for (const who of [null, MEMBER]) {
      m.currentAppUser.mockResolvedValue(who);
      expect((await GET()).status).toBe(403);
      expect((await post({ email: "a@b.co" })).status).toBe(403);
      expect((await DELETE(new Request("http://x"), { params: Promise.resolve({ id: "inv_1" }) })).status).toBe(403);
    }
    expect(m.createInvitation).not.toHaveBeenCalled();
    expect(m.revokeInvitation).not.toHaveBeenCalled();
  });

  it("emails a normalized address to /sign-up, notifying, with who invited", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    const res = await post({ email: "  Affiliate@CellDigital.co " });
    expect(res.status).toBe(201);
    expect(m.createInvitation).toHaveBeenCalledWith({
      emailAddress: "affiliate@celldigital.co",
      redirectUrl: "https://creative.xark.io/sign-up",
      notify: true,
      publicMetadata: { invitedBy: "barronzuo@gmail.com" },
    });
    expect((await res.json()).invitation).toMatchObject({ id: "inv_1", email: "affiliate@celldigital.co" });
  });

  it("rejects bad emails and existing accounts; maps Clerk duplicates to 409", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    expect((await post({ email: "nope" })).status).toBe(400);
    m.findFirst.mockResolvedValueOnce({ id: "u" });
    expect((await post({ email: "x@y.com" })).status).toBe(409);
    m.createInvitation.mockRejectedValueOnce({ errors: [{ longMessage: "There's already a pending invitation for this email" }] });
    const dup = await post({ email: "a@b.co" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/pending invitation/);
  });

  it("shares only the ticked projects, at the chosen level, before inviting", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    const res = await post({ email: "affiliate@celldigital.co", projectIds: ["p1", "p2"], access: "download" });
    expect(res.status).toBe(201);
    expect(m.shareProjects).toHaveBeenCalledWith({
      projectIds: ["p1", "p2"],
      email: "affiliate@celldigital.co",
      access: "download",
      createdById: "o1",
    });
    expect(m.invalidateShares).toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ shared: 2, access: "download", existingAccount: false });
  });

  it("no projects ticked → nothing shared (a brand-new, empty account); default level is view", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    await post({ email: "new@x.co" });
    expect(m.shareProjects).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [], access: "view" }));
    expect((await post({ email: "new@x.co", access: "admin" })).status).toBe(400);
  });

  it("an existing account: shares without a new invitation; without projects it's a 409", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    m.findFirst.mockResolvedValue({ id: "u9" });
    expect((await post({ email: "x@y.com" })).status).toBe(409);
    const res = await post({ email: "x@y.com", projectIds: ["p1"], access: "edit" });
    expect(res.status).toBe(201);
    expect(m.createInvitation).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ existingAccount: true, shared: 1, access: "edit" });
  });

  it("lists pending invitations and revokes by id", async () => {
    m.currentAppUser.mockResolvedValue(OWNER);
    m.getInvitationList.mockResolvedValue({
      data: [{ id: "inv_1", emailAddress: "a@b.co", createdAt: 5, publicMetadata: { invitedBy: "barronzuo@gmail.com" } }],
    });
    expect(await (await GET()).json()).toEqual({
      invitations: [{ id: "inv_1", email: "a@b.co", createdAt: 5, invitedBy: "barronzuo@gmail.com" }],
    });
    m.revokeInvitation.mockResolvedValue({ id: "inv_1", emailAddress: "a@b.co", status: "revoked" });
    expect((await DELETE(new Request("http://x"), { params: Promise.resolve({ id: "inv_1" }) })).status).toBe(200);
    expect((await DELETE(new Request("http://x"), { params: Promise.resolve({ id: "../users" }) })).status).toBe(400);
  });

  it("redirect URL follows AUTH_CANONICAL_HOST", () => {
    expect(invitationRedirectUrl({ AUTH_CANONICAL_HOST: "app.example.com" } as unknown as NodeJS.ProcessEnv)).toBe(
      "https://app.example.com/sign-up",
    );
  });
});
