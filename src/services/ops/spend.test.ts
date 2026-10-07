import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySpendLedger, setSpendLedger } from "./budget-guard";
import { guardLlmFn } from "./spend";

afterEach(() => setSpendLedger(null));

describe("guardLlmFn", () => {
  it("reserves each call under the project / run scope and reconciles it", async () => {
    const ledger = new MemorySpendLedger();
    setSpendLedger(ledger);
    const base = vi.fn(async () => ({ items: [] }));
    const fn = guardLlmFn({ projectId: "p1", runId: "r1" }, base, { outTokens: 4000 });
    await fn({ system: "translate", user: "x".repeat(4000) });
    expect(base).toHaveBeenCalledTimes(1);
    const [e] = await ledger.entries({ projectId: "p1" });
    expect(e).toMatchObject({ runId: "r1", kind: "llm" });
    expect(e.estUsd).toBeGreaterThan(0);
  });

  it("refuses the call when the budget can't cover it, without calling the model", async () => {
    const ledger = new MemorySpendLedger();
    setSpendLedger(ledger);
    await ledger.setBudget({ projectId: "p1" }, 0);
    const base = vi.fn(async () => ({}));
    await expect(guardLlmFn({ projectId: "p1" }, base, { outTokens: 3000 })({ system: "s", user: "u" })).rejects.toThrow(/Budget exceeded/);
    expect(base).not.toHaveBeenCalled();
  });

  it("passes straight through without a project", async () => {
    const base = vi.fn(async () => 1);
    expect(await guardLlmFn({ projectId: null }, base, { outTokens: 10 })({ system: "", user: "" })).toBe(1);
  });
});
