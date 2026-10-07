import { describe, expect, it } from "vitest";
import { logAiUsage } from "@/services/ai/usage";
import {
  budgetCheck,
  BudgetExceededError,
  chargeOrRefuse,
  isUnbilledError,
  MemorySpendLedger,
  summarizeSpend,
  withSpendGuard,
} from "./budget-guard";

const scope = (over: Record<string, unknown> = {}) => ({ projectId: "p1", runId: "r1", jobId: "j1", kind: "image" as const, model: "bytedance-seed/seedream-5-0-flash", ...over });

describe("budgetCheck", () => {
  it("allows spend inside both budgets and with no budget set", () => {
    expect(budgetCheck(1, { budgetUsd: 10, spentUsd: 5 }, { budgetUsd: 2, spentUsd: 0.5 })).toBeNull();
    expect(budgetCheck(100, { budgetUsd: null, spentUsd: 5 }, null)).toBeNull();
  });
  it("refuses at the run level before the project level", () => {
    expect(budgetCheck(1, { budgetUsd: 10, spentUsd: 9.5 }, { budgetUsd: 1, spentUsd: 0.5 })).toMatchObject({ level: "run", limitUsd: 1, spentUsd: 0.5 });
    expect(budgetCheck(1, { budgetUsd: 10, spentUsd: 9.5 }, { budgetUsd: 5, spentUsd: 0 })).toMatchObject({ level: "project", limitUsd: 10 });
  });
  it("lets spend land exactly on the budget", () => {
    expect(budgetCheck(0.5, { budgetUsd: 8.5, spentUsd: 8 }, null)).toBeNull();
  });
});

describe("chargeOrRefuse", () => {
  it("reserves the estimate and refuses with a clear error once the approved budget would be exceeded", async () => {
    const ledger = new MemorySpendLedger();
    await ledger.setBudget({ projectId: "p1", runId: "r1" }, 0.05);
    await chargeOrRefuse(scope(), 0.02, ledger);
    await chargeOrRefuse(scope({ jobId: "j2" }), 0.02, ledger);
    const err = await chargeOrRefuse(scope({ jobId: "j3", kind: "vision_qc", model: "google/gemini-2.5-flash" }), 0.02, ledger).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.message).toMatch(/run r1/);
    expect(err.message).toMatch(/\$0\.05/);
    expect(err.message).toMatch(/set-budget/);
    expect((await ledger.entries({ projectId: "p1" })).length).toBe(2);
  });

  it("never over-commits under concurrent reservations", async () => {
    const ledger = new MemorySpendLedger();
    await ledger.setBudget({ projectId: "p1" }, 1);
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => chargeOrRefuse(scope({ jobId: `j${i}` }), 0.1, ledger)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(10);
    const total = (await ledger.entries({ projectId: "p1" })).reduce((s, e) => s + e.estUsd, 0);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("records nothing for a free call", async () => {
    const ledger = new MemorySpendLedger();
    expect(await chargeOrRefuse(scope(), 0, ledger)).toBeNull();
    expect((await ledger.entries({ projectId: "p1" })).length).toBe(0);
  });
});

describe("withSpendGuard", () => {
  it("reconciles the reservation with the cost the provider reported", async () => {
    const ledger = new MemorySpendLedger();
    const out = await withSpendGuard(scope(), 0.018, async () => {
      logAiUsage({ provider: "openrouter", model: "bytedance-seed/seedream-5-0-flash", capability: "image", images: 1, costUsd: 0.0175 });
      return "ok";
    }, { ledger });
    expect(out).toBe("ok");
    const [e] = await ledger.entries({ projectId: "p1" });
    expect(e.estUsd).toBe(0.018);
    expect(e.actualUsd).toBeCloseTo(0.0175, 6);
  });

  it("prices a token-only usage row from the table (built-in providers log no cost)", async () => {
    const ledger = new MemorySpendLedger();
    await withSpendGuard(scope({ kind: "vision_qc", model: "gemini-2.5-flash" }), 0.003, async () => {
      logAiUsage({ provider: "gemini", model: "gemini-2.5-flash", capability: "vision", inputTokens: 1000, outputTokens: 1000 });
    }, { ledger });
    const [e] = await ledger.entries({ projectId: "p1" });
    expect(e.actualUsd).toBeCloseTo(0.0003 + 0.0025, 6);
  });

  it("falls back to the estimate when nothing was reported, and leaves a video open until its poll", async () => {
    const ledger = new MemorySpendLedger();
    await withSpendGuard(scope(), 0.02, async () => "x", { ledger });
    await withSpendGuard(scope({ kind: "video", jobId: "v1", model: "google/veo-3.1-lite" }), 0.12, async () => "task", { ledger, settle: "later" });
    const entries = await ledger.entries({ projectId: "p1" });
    expect(entries.find((e) => e.kind === "image")!.actualUsd).toBe(0.02);
    expect(entries.find((e) => e.kind === "video")!.actualUsd).toBeNull();
    const open = await ledger.openEntryForJob("v1", "video");
    expect(open?.estUsd).toBe(0.12);
  });

  it("releases the reservation when the provider rejected the request, keeps it when the outcome is unknown", async () => {
    const ledger = new MemorySpendLedger();
    await expect(withSpendGuard(scope({ jobId: "a" }), 0.1, async () => { throw new Error("OpenRouter 400: bad duration"); }, { ledger })).rejects.toThrow(/400/);
    await expect(withSpendGuard(scope({ jobId: "b" }), 0.1, async () => { throw new Error("socket hang up"); }, { ledger })).rejects.toThrow(/socket/);
    const entries = await ledger.entries({ projectId: "p1" });
    expect(entries.find((e) => e.jobId === "a")!.actualUsd).toBe(0);
    expect(entries.find((e) => e.jobId === "b")!.actualUsd).toBeNull();
  });

  it("counts a paid image whose upload then failed", async () => {
    const ledger = new MemorySpendLedger();
    await expect(
      withSpendGuard(scope(), 0.018, async () => {
        logAiUsage({ provider: "openrouter", model: "bytedance-seed/seedream-5-0-flash", capability: "image", images: 1, costUsd: 0.018 });
        throw new Error("No asset storage configured");
      }, { ledger })
    ).rejects.toThrow();
    expect((await ledger.entries({ projectId: "p1" }))[0].actualUsd).toBe(0.018);
  });

  it("never calls the provider when the budget refuses", async () => {
    const ledger = new MemorySpendLedger();
    await ledger.setBudget({ projectId: "p1" }, 0.01);
    let called = false;
    await expect(withSpendGuard(scope(), 0.02, async () => { called = true; }, { ledger })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(called).toBe(false);
  });
});

describe("isUnbilledError", () => {
  it("knows client-side rejections from unknown outcomes", () => {
    expect(isUnbilledError(new Error("OpenRouter 402: insufficient credits"))).toBe(true);
    expect(isUnbilledError(new Error("OPENROUTER_API_KEY is not configured"))).toBe(true);
    expect(isUnbilledError(new Error("OpenRouter 502: upstream"))).toBe(false);
    expect(isUnbilledError(new Error("The operation was aborted due to timeout"))).toBe(false);
  });
});

describe("summarizeSpend", () => {
  it("totals by kind, model and run, counting open reservations at their estimate", () => {
    const at = new Date("2026-10-06T10:00:00Z");
    const s = summarizeSpend(
      [
        { id: "1", projectId: "p1", runId: "r1", jobId: "a", kind: "image", model: "m1", estUsd: 0.02, actualUsd: 0.018, createdAt: at },
        { id: "2", projectId: "p1", runId: "r1", jobId: "b", kind: "video", model: "m2", estUsd: 0.12, actualUsd: null, createdAt: at },
        { id: "3", projectId: "p1", runId: null, jobId: null, kind: "llm", model: "m3", estUsd: 0.01, actualUsd: 0.005, createdAt: at },
      ],
      { projectBudgetUsd: 1 }
    );
    expect(s.totalUsd).toBeCloseTo(0.143, 6);
    expect(s.openReservedUsd).toBeCloseTo(0.12, 6);
    expect(s.byKind.find((k) => k.key === "video")!.usd).toBeCloseTo(0.12, 6);
    expect(s.byRun.find((k) => k.key === "r1")!.calls).toBe(2);
    expect(s.byRun.find((k) => k.key === "(no run)")!.usd).toBeCloseTo(0.005, 6);
    expect(s.remainingUsd).toBeCloseTo(0.857, 6);
  });
});
