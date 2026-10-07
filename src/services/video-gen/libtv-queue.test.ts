import { beforeEach, describe, expect, it, vi } from "vitest";

type Run = { id: string; status: string; approvedBudgetUsd: number | null; creditCap: number | null };
const store = vi.hoisted(() => ({ runs: new Map<string, Run>() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    libtvRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const r = store.runs.get(where.id);
        return r ? { ...r, jobs: [] } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const r = store.runs.get(where.id as string);
        if (!r) return { count: 0 };
        const st = where.status as { in: string[] } | undefined;
        if (st && !st.in.includes(r.status)) return { count: 0 };
        if ("approvedBudgetUsd" in where && where.approvedBudgetUsd !== r.approvedBudgetUsd) return { count: 0 };
        for (const [k, v] of Object.entries(data)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
        return { count: 1 };
      }),
    },
  },
}));

import { approveRun } from "./libtv-queue";

beforeEach(() => {
  store.runs.clear();
  store.runs.set("r1", { id: "r1", status: "awaiting_approval", approvedBudgetUsd: null, creditCap: null });
});

describe("approveRun with a USD budget from the credit cap", () => {
  it("sets approvedBudgetUsd so the spend guard enforces the cap", async () => {
    const run = await approveRun("r1", 150, { capBudgetUsd: 1.5 });
    expect(run).not.toBeNull();
    expect(store.runs.get("r1")).toMatchObject({ status: "approved", creditCap: 150, approvedBudgetUsd: 1.5 });
  });

  it("never raises an existing lower budget", async () => {
    store.runs.get("r1")!.approvedBudgetUsd = 0.8;
    await approveRun("r1", 150, { capBudgetUsd: 1.5 });
    expect(store.runs.get("r1")!.approvedBudgetUsd).toBe(0.8);
  });

  it("lowers a higher existing budget to the cap", async () => {
    store.runs.get("r1")!.approvedBudgetUsd = 5;
    await approveRun("r1", 150, { capBudgetUsd: 1.5 });
    expect(store.runs.get("r1")!.approvedBudgetUsd).toBe(1.5);
  });

  it("leaves the budget alone without a cap budget (autopilot sets its own)", async () => {
    store.runs.get("r1")!.approvedBudgetUsd = 3;
    await approveRun("r1", 120);
    expect(store.runs.get("r1")!.approvedBudgetUsd).toBe(3);
  });
});
