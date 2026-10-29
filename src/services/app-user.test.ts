import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  getUser: vi.fn(),
  invalidatePrincipal: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  ensurePersonalWorkspace: vi.fn(),
  linkSharesToUser: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: m.auth,
  currentUser: m.currentUser,
  clerkClient: async () => ({ users: { getUser: m.getUser } }),
}));
vi.mock("@/lib/db", () => ({
  prisma: { appUser: { findUnique: m.findUnique, findFirst: m.findFirst, upsert: m.upsert, update: m.update } },
}));
vi.mock("@/services/access", () => ({ invalidatePrincipal: m.invalidatePrincipal }));
vi.mock("@/lib/auth/mode", () => ({ isClerkActive: () => true }));
vi.mock("@/services/personal-workspace", () => ({ ensurePersonalWorkspace: m.ensurePersonalWorkspace }));
vi.mock("@/services/project-shares", () => ({ linkSharesToUser: m.linkSharesToUser }));

import { currentAppUser } from "./app-user";
import { LEGAL_VERSION } from "@/lib/legal";

const clerkUser = (email: string, verified = true, legalAcceptedAt: number | null = null) => ({
  legalAcceptedAt,
  primaryEmailAddressId: "e1",
  emailAddresses: [{ id: "e1", emailAddress: email, verification: { status: verified ? "verified" : "unverified" } }],
  firstName: "Ann",
  lastName: null,
  username: null,
});

describe("currentAppUser — first-visit upsert", () => {
  beforeEach(() => {
    vi.stubEnv("OWNER_EMAILS", "boss@xark.io");
    m.auth.mockResolvedValue({ userId: "user_1" });
    m.findUnique.mockResolvedValue(null);
    m.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: "a1", ...create }));
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("creates a new member as active, with their own empty workspace (and logs the sign-up)", async () => {
    m.currentUser.mockResolvedValue(clerkUser("new@example.com"));
    await currentAppUser();
    const { create } = m.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ clerkUserId: "user_1", email: "new@example.com", role: "member" });
    expect(create.status).toBeUndefined(); // schema default: active
    expect(m.ensurePersonalWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/new sign-up/));
  });

  it("creates a verified OWNER_EMAILS user as the owner, with no personal workspace", async () => {
    m.currentUser.mockResolvedValue(clerkUser("boss@xark.io"));
    await currentAppUser();
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ role: "owner" });
    expect(m.ensurePersonalWorkspace).not.toHaveBeenCalled();
  });

  it("an unverified OWNER_EMAILS address is still a member", async () => {
    m.currentUser.mockResolvedValue(clerkUser("boss@xark.io", false));
    await currentAppUser();
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ role: "member" });
    expect(m.ensurePersonalWorkspace).toHaveBeenCalled();
  });

  it("unblocks an existing row when it is promoted to owner", async () => {
    const lastSeenAt = new Date();
    m.findUnique.mockResolvedValue({ id: "a1", email: "boss@xark.io", role: "member", status: "blocked", lastSeenAt });
    m.currentUser.mockResolvedValue(clerkUser("boss@xark.io"));
    m.update.mockImplementation(async ({ data }: { data: object }) => data);
    await currentAppUser();
    expect(m.update.mock.calls[0][0].data).toMatchObject({ role: "owner", status: "active" });
  });
  it("records when (and which version of) the Terms were accepted at sign-up", async () => {
    const at = Date.UTC(2026, 9, 9, 12);
    m.currentUser.mockResolvedValue(clerkUser("new@example.com", true, at));
    await currentAppUser();
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ legalAcceptedAt: new Date(at), legalVersion: LEGAL_VERSION });
  });

  it("records no consent when Clerk has none", async () => {
    m.currentUser.mockResolvedValue(clerkUser("new@example.com"));
    await currentAppUser();
    expect(m.upsert.mock.calls[0][0].create.legalAcceptedAt).toBeUndefined();
  });
  it("attaches projects already shared with the verified email, and not for an unverified one", async () => {
    m.currentUser.mockResolvedValue(clerkUser("new@example.com"));
    await currentAppUser();
    expect(m.linkSharesToUser).toHaveBeenCalledWith("a1", "new@example.com");
    vi.clearAllMocks();
    m.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: "a2", ...create }));
    m.currentUser.mockResolvedValue(clerkUser("other@example.com", false));
    await currentAppUser();
    expect(m.linkSharesToUser).not.toHaveBeenCalled();
  });
});

describe("currentAppUser — relink after the move to Xark Accounts", () => {
  // A row created under the old per-app Clerk instance: same person, different Clerk user id.
  const OLD_ROW = { id: "a_old", clerkUserId: "user_old", email: "ann@example.com", role: "member", status: "active", lastSeenAt: new Date(0) };
  const notFound = Object.assign(new Error("Not Found"), { status: 404 });

  beforeEach(() => {
    vi.stubEnv("OWNER_EMAILS", "boss@xark.io");
    m.auth.mockResolvedValue({ userId: "user_new", sessionClaims: { apps: { creative: "member" } } });
    m.findUnique.mockResolvedValue(null);
    m.findFirst.mockResolvedValue(OLD_ROW);
    m.getUser.mockRejectedValue(notFound); // the old id is not a user of the shared instance
    m.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({ ...OLD_ROW, id: where.id, ...data }));
    m.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: "a_dup", ...create }));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("relinks the existing row (matched by verified email, case-insensitive) to the new Clerk id", async () => {
    m.currentUser.mockResolvedValue(clerkUser("Ann@Example.com"));
    const me = await currentAppUser();
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ email: { equals: "ann@example.com", mode: "insensitive" } });
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][0]).toMatchObject({ where: { id: "a_old" }, data: { clerkUserId: "user_new" } });
    expect(me).toMatchObject({ id: "a_old", clerkUserId: "user_new" });
    expect(m.invalidatePrincipal).toHaveBeenCalledWith("user_new");
  });

  it("never creates a duplicate row or a second workspace when it relinks", async () => {
    m.currentUser.mockResolvedValue(clerkUser("ann@example.com"));
    await currentAppUser();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.ensurePersonalWorkspace).not.toHaveBeenCalled();
  });

  it("refuses to relink on an unverified email", async () => {
    m.currentUser.mockResolvedValue(clerkUser("ann@example.com", false));
    await currentAppUser();
    expect(m.findFirst).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("does not take over a row that belongs to a live user of the shared instance", async () => {
    m.getUser.mockResolvedValue({ id: "user_old" });
    m.currentUser.mockResolvedValue(clerkUser("ann@example.com"));
    await currentAppUser();
    expect(m.getUser).toHaveBeenCalledWith("user_old");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("with no matching row, creates one as before", async () => {
    m.findFirst.mockResolvedValue(null);
    m.currentUser.mockResolvedValue(clerkUser("fresh@example.com"));
    await currentAppUser();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ clerkUserId: "user_new", email: "fresh@example.com" });
  });

  it("maps apps.creative === owner to role owner on relink and on create", async () => {
    m.auth.mockResolvedValue({ userId: "user_new", sessionClaims: { apps: { creative: "owner" } } });
    m.currentUser.mockResolvedValue(clerkUser("ann@example.com"));
    await currentAppUser();
    expect(m.update.mock.calls[0][0].data).toMatchObject({ role: "owner" });

    m.findFirst.mockResolvedValue(null);
    m.currentUser.mockResolvedValue(clerkUser("fresh@example.com"));
    await currentAppUser();
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ role: "owner" });
    expect(m.ensurePersonalWorkspace).not.toHaveBeenCalled();
  });

  it("promotes an existing member row when the claim says owner", async () => {
    m.auth.mockResolvedValue({ userId: "user_new", sessionClaims: { apps: { creative: "owner" } } });
    m.findUnique.mockResolvedValue({ ...OLD_ROW, clerkUserId: "user_new", lastSeenAt: new Date() });
    await currentAppUser();
    expect(m.update.mock.calls[0][0].data).toMatchObject({ role: "owner" });
  });

  it("a member claim keeps a member a member", async () => {
    m.findFirst.mockResolvedValue(null);
    m.currentUser.mockResolvedValue(clerkUser("fresh@example.com"));
    await currentAppUser();
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ role: "member" });
  });
});
