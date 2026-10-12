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

describe("scoped model calls (text LLM under the spend guard)", () => {
  // Fresh imports so the in-memory ledger and ALS are the ones under test.
  async function setup() {
    const guard = await import("./budget-guard");
    const spend = await import("./spend");
    const scope = await import("./spend-scope");
    const ledger = new guard.MemorySpendLedger();
    guard.setSpendLedger(ledger);
    return { guard, spend, scope, ledger };
  }
  const est = { inTokens: 2_000, outTokens: 1_000 };

  it("estimateTextCall: ~4 chars per token, 1k per image, half of maxTokens out", async () => {
    const { spend } = await setup();
    expect(spend.estimateTextCall({ systemPrompt: "a".repeat(400), userPrompt: "b".repeat(400), maxTokens: 2000 })).toEqual({
      inTokens: 200,
      outTokens: 1000,
      vision: false,
    });
    expect(
      spend.estimateTextCall({ systemPrompt: "", userPrompt: [{ type: "text", text: "x".repeat(40) }, { type: "image_url", url: "u" }, { type: "image_url", url: "v" }] }),
    ).toEqual({ inTokens: 10 + 2000, outTokens: 2048, vision: true });
  });

  it("without a project scope the call just runs and nothing is recorded", async () => {
    const { spend, ledger } = await setup();
    const call = vi.fn(async () => "ok");
    expect(await spend.guardScopedLlm(est, call)).toBe("ok");
    expect((await ledger.entries({ projectId: "p1" })).length).toBe(0);
  });

  it("inside a project scope it reserves and settles in the ledger", async () => {
    const { spend, scope, ledger } = await setup();
    const out = await scope.withSpendScope({ projectId: "p1" }, () => spend.guardScopedLlm(est, async () => "ok"));
    expect(out).toBe("ok");
    const rows = await ledger.entries({ projectId: "p1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "llm" });
  });

  it("refuses over the project budget before calling the model", async () => {
    const { guard, spend, scope, ledger } = await setup();
    await ledger.setBudget({ projectId: "p1" }, 0.0001);
    const call = vi.fn(async () => "never");
    const err = await scope.withSpendScope({ projectId: "p1" }, () => spend.guardScopedLlm(est, call)).catch((e) => e);
    expect(guard.isBudgetExceeded(err)).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("a nested call inside an explicit guard is not reserved twice", async () => {
    const { guard, spend, scope, ledger } = await setup();
    await scope.withSpendScope({ projectId: "p1" }, () =>
      guard.withSpendGuard({ projectId: "p1", kind: "llm", model: "m" }, 0.01, () => spend.guardScopedLlm(est, async () => "inner")),
    );
    expect(await ledger.entries({ projectId: "p1" })).toHaveLength(1);
  });

  it("vision calls are recorded as vision_qc", async () => {
    const { spend, scope, ledger } = await setup();
    await scope.withSpendScope({ projectId: "p1" }, () => spend.guardScopedLlm({ ...est, vision: true }, async () => 1));
    expect((await ledger.entries({ projectId: "p1" }))[0]).toMatchObject({ kind: "vision_qc" });
  });
});
