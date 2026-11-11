import { describe, expect, it, vi } from "vitest";

// An interactive transaction runs on ONE pg connection; overlapping queries on it trigger pg's
// "client.query() when the client is already executing a query" deprecation (an error in pg@9).
let inFlight = 0;
let maxInFlight = 0;
const q = <T>(value: T) => async () => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((r) => setTimeout(r, 1));
  inFlight--;
  return value;
};
const tx = {
  project: { findUnique: q({ budgetUsd: 10 }) },
  libtvRun: { findUnique: q({ approvedBudgetUsd: 2 }) },
  spendEntry: { aggregate: q({ _sum: { estUsd: 1, actualUsd: 0.5 } }) },
};
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));

describe("PrismaSpendLedger.budgets", () => {
  it("never runs two queries at once on the transaction connection", async () => {
    const { PrismaSpendLedger } = await import("./spend-ledger-prisma");
    const b = await new PrismaSpendLedger().budgets("p1", "r1");
    expect(b).toEqual({ project: { budgetUsd: 10, spentUsd: 1.5 }, run: { budgetUsd: 2, spentUsd: 1.5 } });
    expect(maxInFlight).toBe(1);
  });
});
