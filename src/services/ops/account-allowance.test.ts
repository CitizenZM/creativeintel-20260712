import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  appUser: { findUnique: vi.fn() },
  project: { findMany: vi.fn() },
  spendEntry: { aggregate: vi.fn(), create: vi.fn() },
  aiUsage: { aggregate: vi.fn() },
  falVideoJob: { aggregate: vi.fn() },
}));
const tenancy = vi.hoisted(() => ({ tenantOfProject: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
const actor = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("./actor", () => ({ currentActorId: async () => actor.id }));
vi.mock("@/services/tenancy", () => ({
  tenantOfProject: tenancy.tenantOfProject,
  tenantProjectWhere: (t: string | null) => ({ tenant: t }),
}));

import {
  accountSpentThisMonth,
  allowanceRefusalBody,
  assertAccountAllowance,
  defaultMemberAllowance,
  monthStartUtc,
} from "./account-allowance";
import { BudgetExceededError, isBudgetExceeded } from "./budget-guard";

/** Ledger: open reservations (estUsd) and settled (actualUsd); usage + in-flight fal jobs. */
function spend({ open = 0, settled = 0, usage = 0, inflight = 0 }) {
  db.spendEntry.aggregate.mockImplementation(async ({ where }: { where: { actualUsd: unknown } }) =>
    where.actualUsd === null ? { _sum: { estUsd: open } } : { _sum: { actualUsd: settled } },
  );
  db.aiUsage.aggregate.mockResolvedValue({ _sum: { costUsd: usage } });
  db.falVideoJob.aggregate.mockResolvedValue({ _sum: { costUsd: inflight } });
}

describe("defaultMemberAllowance / monthStartUtc", () => {
  it("$1 unless MEMBER_MONTHLY_ALLOWANCE_USD is a non-negative number", () => {
    expect(defaultMemberAllowance(undefined)).toBe(1);
    expect(defaultMemberAllowance("")).toBe(1);
    expect(defaultMemberAllowance("abc")).toBe(1);
    expect(defaultMemberAllowance("-3")).toBe(1);
    expect(defaultMemberAllowance("0")).toBe(0);
    expect(defaultMemberAllowance("5.5")).toBe(5.5);
  });
  it("the UTC calendar month", () => {
    expect(monthStartUtc(new Date("2026-10-31T23:59:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("accountSpentThisMonth", () => {
  afterEach(() => vi.resetAllMocks());
  beforeEach(() => db.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]));

  it("the larger of the ledger and usage + in-flight direct video jobs", async () => {
    spend({ open: 0.2, settled: 0.3, usage: 0.1, inflight: 0.1 });
    expect(await accountSpentThisMonth("ann")).toBe(0.5);
    spend({ open: 0, settled: 0.1, usage: 0.4, inflight: 0.5 });
    expect(await accountSpentThisMonth("ann")).toBe(0.9);
  });

  it("only this account's projects, this month", async () => {
    spend({});
    await accountSpentThisMonth("ann", undefined, new Date("2026-10-08T12:00:00Z"));
    expect(db.project.findMany).toHaveBeenCalledWith({ where: { tenant: "ann" }, select: { id: true } });
    const where = db.aiUsage.aggregate.mock.calls[0][0].where;
    expect(where.projectId).toEqual({ in: ["p1", "p2"] });
    expect(where.createdAt.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("no projects of their own → only what they triggered elsewhere (ledger by actor)", async () => {
    db.project.findMany.mockResolvedValue([]);
    spend({ settled: 0.3, usage: 9 });
    expect(await accountSpentThisMonth("ann")).toBe(0.3);
    expect(db.aiUsage.aggregate).not.toHaveBeenCalled();
    expect(db.spendEntry.aggregate.mock.calls[0][0].where.OR).toEqual([{ actorId: "ann" }]);
  });

  it("counts their own projects' unattributed work plus anything they triggered", async () => {
    spend({});
    await accountSpentThisMonth("ann");
    expect(db.spendEntry.aggregate.mock.calls[0][0].where.OR).toEqual([
      { actorId: "ann" },
      { projectId: { in: ["p1", "p2"] }, OR: [{ actorId: null }, { actorId: "ann" }] },
    ]);
  });
});

describe("assertAccountAllowance", () => {
  beforeEach(() => {
    db.project.findMany.mockResolvedValue([{ id: "p1" }]);
    vi.stubEnv("MEMBER_MONTHLY_ALLOWANCE_USD", "");
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    actor.id = null;
  });
  const what = { kind: "video" as const, model: "veo" };

  it("a coworker acting on the admin's project pays from their own allowance, and it's recorded to them", async () => {
    actor.id = "amy";
    tenancy.tenantOfProject.mockResolvedValue(null); // the admin's project
    db.appUser.findUnique.mockResolvedValue({ role: "member", monthlyAllowanceUsd: null });
    db.spendEntry.create.mockResolvedValue({});
    spend({ settled: 0.7 });
    await expect(assertAccountAllowance("p1", 0.2, what)).resolves.toBeUndefined();
    expect(db.spendEntry.create).toHaveBeenCalledWith({
      data: { projectId: "p1", kind: "video", model: "veo", estUsd: 0.2, actorId: "amy" },
    });
    await expect(assertAccountAllowance("p1", 0.5, what)).rejects.toThrow(/monthly AI allowance/);
  });

  it("the admin acting anywhere is never capped", async () => {
    actor.id = "boss";
    tenancy.tenantOfProject.mockResolvedValue("ann");
    db.appUser.findUnique.mockResolvedValue({ role: "owner", monthlyAllowanceUsd: null });
    spend({ settled: 999 });
    await expect(assertAccountAllowance("p1", 50, what)).resolves.toBeUndefined();
  });

  it("never caps the admin's projects, nor calls without a project", async () => {
    tenancy.tenantOfProject.mockResolvedValue(null);
    spend({ settled: 999 });
    await expect(assertAccountAllowance("p1", 50, what)).resolves.toBeUndefined();
    await expect(assertAccountAllowance(null, 50, what)).resolves.toBeUndefined();
  });

  it("never caps a member who was made an admin", async () => {
    tenancy.tenantOfProject.mockResolvedValue("ann");
    db.appUser.findUnique.mockResolvedValue({ role: "owner", monthlyAllowanceUsd: null });
    spend({ settled: 999 });
    await expect(assertAccountAllowance("p1", 5, what)).resolves.toBeUndefined();
  });

  it("a member: allowed within the default $1, refused past it (as an account-level budget refusal)", async () => {
    tenancy.tenantOfProject.mockResolvedValue("ann");
    db.appUser.findUnique.mockResolvedValue({ role: "member", monthlyAllowanceUsd: null });
    spend({ settled: 0.6 });
    await expect(assertAccountAllowance("p1", 0.4, what)).resolves.toBeUndefined();
    const err = await assertAccountAllowance("p1", 0.5, what).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(isBudgetExceeded(err)).toBe(true);
    expect(err.refusal).toEqual({ level: "account", limitUsd: 1, spentUsd: 0.6 });
    expect(err.message).toMatch(/monthly AI allowance/);
    expect(allowanceRefusalBody(err)).toMatchObject({ code: "ACCOUNT_ALLOWANCE" });
  });

  it("uses the member's own allowance when the admin set one", async () => {
    tenancy.tenantOfProject.mockResolvedValue("ann");
    db.appUser.findUnique.mockResolvedValue({ role: "member", monthlyAllowanceUsd: 10 });
    spend({ settled: 6 });
    await expect(assertAccountAllowance("p1", 3, what)).resolves.toBeUndefined();
    await expect(assertAccountAllowance("p1", 5, what)).rejects.toThrow(/\$10\.00 monthly/);
  });

  it("an allowance of 0 refuses any paid call", async () => {
    tenancy.tenantOfProject.mockResolvedValue("ann");
    db.appUser.findUnique.mockResolvedValue({ role: "member", monthlyAllowanceUsd: 0 });
    spend({});
    await expect(assertAccountAllowance("p1", 0.01, what)).rejects.toThrow(BudgetExceededError);
  });

  it("allowanceRefusalBody ignores other errors and other budget levels", () => {
    expect(allowanceRefusalBody(new Error("x"))).toBeNull();
    const project = new BudgetExceededError({ projectId: "p", kind: "image", model: "m" }, 1, { level: "project", limitUsd: 1, spentUsd: 1 });
    expect(allowanceRefusalBody(project)).toBeNull();
  });
});
