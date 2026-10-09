import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  ensurePersonalWorkspace: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth, currentUser: m.currentUser }));
vi.mock("@/lib/db", () => ({
  prisma: { appUser: { findUnique: m.findUnique, upsert: m.upsert, update: m.update } },
}));
vi.mock("@/lib/auth/mode", () => ({ isClerkActive: () => true }));
vi.mock("@/services/personal-workspace", () => ({ ensurePersonalWorkspace: m.ensurePersonalWorkspace }));

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
});
