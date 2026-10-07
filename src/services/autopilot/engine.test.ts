import { describe, expect, it } from "vitest";
import {
  MAX_STEP_ATTEMPTS,
  MemoryAutopilotStore,
  advanceAutopilots,
  approveAutopilot,
  autopilotView,
  budgetGate,
  retryAutopilot,
  startAutopilot,
  tickAutopilot,
} from "./engine";
import { AutopilotFatalError, type AutopilotSteps, type StepContext, type StepOutcome } from "./types";

/** Fake pipeline: every step records its calls; ids are created once and kept in state. */
function fakeSteps(opts: { highUsd?: number; renderTicks?: number; failing?: Partial<Record<string, number>>; fatal?: string } = {}) {
  const calls: string[] = [];
  const created = { storyboards: 0, runs: 0, projects: 0 };
  const renderPolls = new Map<string, number>();
  const failLeft = { ...(opts.failing ?? {}) };
  const wrap = (name: string, fn: (ctx: StepContext) => Promise<StepOutcome> | StepOutcome) => async (ctx: StepContext) => {
    calls.push(name);
    if (opts.fatal === name) throw new AutopilotFatalError(`${name} cannot work`);
    if ((failLeft[name] ?? 0) > 0) {
      failLeft[name]!--;
      throw new Error(`${name} flaked`);
    }
    return fn(ctx);
  };
  const steps: AutopilotSteps = {
    scrape: wrap("scrape", (ctx) => {
      if (ctx.state.projectId) return { kind: "done" };
      created.projects++;
      return { kind: "done", state: { projectId: "p1" } };
    }),
    brief: wrap("brief", () => ({ kind: "done", state: { briefSellingPoints: 4 } })),
    plan: wrap("plan", () => ({ kind: "done", state: { plannedPlatforms: ["tiktok"] } })),
    storyboard: wrap("storyboard", async (ctx) => {
      if (ctx.state.storyboardId) return { kind: "done" };
      // Reserve first, then create: a crash between the two must not duplicate.
      const pending = ctx.state.pendingStoryboardId ?? "sb1";
      await ctx.save({ pendingStoryboardId: pending });
      created.storyboards++;
      return { kind: "done", state: { storyboardId: pending } };
    }),
    estimate: wrap("estimate", () => ({ kind: "done", state: { forecast: { lowUsd: 1, expectedUsd: 2, highUsd: opts.highUsd ?? 3, recommendedBudgetUsd: opts.highUsd ?? 3, source: "storyboard" } } })),
    compile: wrap("compile", (ctx) => {
      if (ctx.state.runId) return { kind: "done" };
      created.runs++;
      return { kind: "done", state: { runId: "r1" } };
    }),
    approve: wrap("approve", () => ({ kind: "done" })),
    render: wrap("render", (ctx) => {
      const n = (renderPolls.get(ctx.id) ?? 0) + 1;
      renderPolls.set(ctx.id, n);
      return n > (opts.renderTicks ?? 0) ? { kind: "done", state: { masterUrl: "https://x/master.mp4" } } : { kind: "wait", note: "rendering" };
    }),
    preflight: wrap("preflight", () => ({ kind: "done", state: { preflight: { status: "skipped" } } })),
    report: wrap("report", () => ({ kind: "done", state: { report: { htmlUrl: "h", docxUrl: "d" } } })),
  };
  return { steps, calls, created };
}

const deps = (store: MemoryAutopilotStore, steps: AutopilotSteps, extra: Record<string, unknown> = {}) => ({ store, steps, budgetMs: 60_000, minStepMs: 0, ...extra });

describe("budgetGate", () => {
  const forecast = { lowUsd: 1, expectedUsd: 2, highUsd: 4, recommendedBudgetUsd: 4, source: "storyboard" as const };
  it("continues when the approved budget covers the high forecast", () => {
    expect(budgetGate({ forecast, approvedBudgetUsd: 4 }).kind).toBe("done");
    expect(budgetGate({ forecast, approvedBudgetUsd: 10 }).kind).toBe("done");
  });
  it("waits for approval without a budget or with one below the high forecast", () => {
    const none = budgetGate({ forecast, approvedBudgetUsd: null });
    expect(none.kind).toBe("await_approval");
    const low = budgetGate({ forecast, approvedBudgetUsd: 3.99 });
    expect(low.kind).toBe("await_approval");
    if (low.kind === "await_approval") expect(low.awaiting).toMatchObject({ forecastHighUsd: 4, recommendedBudgetUsd: 4, approvedBudgetUsd: 3.99 });
  });
  it("a free forecast needs no approval and runs under a $0 cap", () => {
    const r = budgetGate({ forecast: { ...forecast, lowUsd: 0, expectedUsd: 0, highUsd: 0, recommendedBudgetUsd: 0 } });
    expect(r.kind).toBe("done");
    expect(r.state?.approvedBudgetUsd).toBe(0);
  });
  it("throws without a forecast", () => {
    expect(() => budgetGate({})).toThrow(/forecast/);
  });
});

describe("autopilot state machine", () => {
  it("runs URL → report in one tick when the approved budget covers the forecast", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls, created } = fakeSteps({ highUsd: 3 });
    const rec = await startAutopilot({ url: "https://shop.example/p/1", approvedBudgetUsd: 5 }, store);
    expect(rec.status).toBe("running");
    expect(rec.step).toBe("scrape");
    const done = await tickAutopilot(rec.id, deps(store, steps));
    expect(done?.status).toBe("completed");
    expect(done?.step).toBe("done");
    expect(done?.projectId).toBe("p1");
    expect(calls).toEqual(["scrape", "brief", "plan", "storyboard", "estimate", "compile", "approve", "render", "preflight", "report"]);
    expect(created).toEqual({ storyboards: 1, runs: 1, projects: 1 });
    expect(done?.state.report?.htmlUrl).toBe("h");
    expect(autopilotView(done!).progress).toBe("11/11");
  });

  it("stops at the budget gate without approval and resumes after autopilot-approve", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls, created } = fakeSteps({ highUsd: 3 });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    const stopped = await tickAutopilot(rec.id, deps(store, steps));
    expect(stopped?.status).toBe("awaiting_approval");
    expect(stopped?.step).toBe("await_budget");
    expect(stopped?.state.awaiting?.forecastHighUsd).toBe(3);
    expect(calls).not.toContain("compile");

    // Ticking again changes nothing while it waits.
    await tickAutopilot(rec.id, deps(store, steps));
    expect((await store.get(rec.id))?.status).toBe("awaiting_approval");

    // Too little: still waiting, with the reason.
    const low = await approveAutopilot(rec.id, 2, store);
    expect(low.ok).toBe(true);
    const still = await tickAutopilot(rec.id, deps(store, steps));
    expect(still?.status).toBe("awaiting_approval");
    expect(still?.state.awaiting?.approvedBudgetUsd).toBe(2);

    const ok = await approveAutopilot(rec.id, 3, store);
    expect(ok.ok).toBe(true);
    const done = await tickAutopilot(rec.id, deps(store, steps));
    expect(done?.status).toBe("completed");
    expect(done?.state.approvedBudgetUsd).toBe(3);
    expect(created.storyboards).toBe(1);
    expect(created.runs).toBe(1);
    // Scrape/brief/plan/storyboard ran once each across the three ticks.
    expect(calls.filter((c) => c === "storyboard")).toHaveLength(1);
  });

  it("approval is refused for a negative budget or a record that is not waiting", async () => {
    const store = new MemoryAutopilotStore();
    const { steps } = fakeSteps({ highUsd: 0 });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    expect((await approveAutopilot(rec.id, -1, store)).ok).toBe(false);
    await tickAutopilot(rec.id, deps(store, steps));
    const r = await approveAutopilot(rec.id, 5, store);
    expect(r.ok).toBe(false);
    expect((await approveAutopilot("missing", 5, store)).ok).toBe(false);
  });

  it("an approval sent before the gate is used when the gate is reached", async () => {
    const store = new MemoryAutopilotStore();
    const { steps } = fakeSteps({ highUsd: 3 });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    expect((await approveAutopilot(rec.id, 4, store)).ok).toBe(true);
    expect((await tickAutopilot(rec.id, deps(store, steps)))?.status).toBe("completed");
  });

  it("waits on a render across ticks and resumes where it stopped (idempotent)", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls, created } = fakeSteps({ highUsd: 0, renderTicks: 2 });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    const t1 = await tickAutopilot(rec.id, deps(store, steps));
    expect(t1?.status).toBe("running");
    expect(t1?.step).toBe("render");
    const t2 = await tickAutopilot(rec.id, deps(store, steps));
    expect(t2?.step).toBe("render");
    const t3 = await tickAutopilot(rec.id, deps(store, steps));
    expect(t3?.status).toBe("completed");
    expect(calls.filter((c) => c === "render")).toHaveLength(3);
    expect(calls.filter((c) => c === "compile")).toHaveLength(1);
    expect(created.runs).toBe(1);
    expect(t3?.state.renderStartedAt).toBeTruthy();
  });

  it("retries a failing step on later ticks and continues once it succeeds", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls } = fakeSteps({ highUsd: 0, failing: { plan: 2 } });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    const t1 = await tickAutopilot(rec.id, deps(store, steps));
    expect(t1?.status).toBe("running");
    expect(t1?.step).toBe("plan");
    expect(t1?.error).toMatch(/plan flaked/);
    expect(t1?.state.attempts?.plan).toBe(1);
    const t2 = await tickAutopilot(rec.id, deps(store, steps));
    expect(t2?.state.attempts?.plan).toBe(2);
    const t3 = await tickAutopilot(rec.id, deps(store, steps));
    expect(t3?.status).toBe("completed");
    expect(t3?.error).toBeNull();
    expect(calls.filter((c) => c === "plan")).toHaveLength(3);
  });

  it(`fails after ${MAX_STEP_ATTEMPTS} attempts of one step, and retry resets that step`, async () => {
    const store = new MemoryAutopilotStore();
    const { steps } = fakeSteps({ highUsd: 0, failing: { brief: 3 } });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    for (let i = 0; i < MAX_STEP_ATTEMPTS; i++) await tickAutopilot(rec.id, deps(store, steps));
    const failed = await store.get(rec.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.step).toBe("brief");
    expect(failed?.error).toMatch(/brief flaked/);
    // A failed record is not ticked again.
    expect((await tickAutopilot(rec.id, deps(store, steps)))?.status).toBe("failed");
    expect((await store.listRunnable(10, new Date())).map((r) => r.id)).not.toContain(rec.id);

    const retried = await retryAutopilot(rec.id, store);
    expect(retried.ok).toBe(true);
    expect((await store.get(rec.id))?.state.attempts?.brief).toBe(0);
    expect((await tickAutopilot(rec.id, deps(store, steps)))?.status).toBe("completed");
  });

  it("a fatal step error fails at once", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls } = fakeSteps({ highUsd: 0, fatal: "compile" });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    const r = await tickAutopilot(rec.id, deps(store, steps));
    expect(r?.status).toBe("failed");
    expect(r?.step).toBe("compile");
    expect(calls.filter((c) => c === "compile")).toHaveLength(1);
  });

  it("stops starting new steps when the tick's time budget is spent", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls } = fakeSteps({ highUsd: 0 });
    let t = 0;
    const now = () => t;
    const slow: AutopilotSteps = { ...steps, brief: async (ctx) => { t += 50_000; return steps.brief(ctx); } };
    const rec = await startAutopilot({ projectId: "p0" }, store);
    const r = await tickAutopilot(rec.id, deps(store, slow, { budgetMs: 100_000, minStepMs: 60_000, now }));
    expect(r?.status).toBe("running");
    expect(r?.step).toBe("plan");
    expect(calls).toEqual(["scrape", "brief"]);
  });

  it("a second tick while one holds the lease does nothing", async () => {
    const store = new MemoryAutopilotStore();
    const { steps, calls } = fakeSteps({ highUsd: 0 });
    const rec = await startAutopilot({ projectId: "p0" }, store);
    expect(await store.claim(rec.id, new Date(Date.now() + 60_000), new Date())).toBe(true);
    const r = await tickAutopilot(rec.id, deps(store, steps));
    expect(r?.step).toBe("scrape");
    expect(calls).toEqual([]);
    await store.release(rec.id);
    expect((await tickAutopilot(rec.id, deps(store, steps)))?.status).toBe("completed");
  });

  it("start validates the input", async () => {
    const store = new MemoryAutopilotStore();
    await expect(startAutopilot({}, store)).rejects.toThrow(/url or projectId/);
    await expect(startAutopilot({ url: "not a url" }, store)).rejects.toThrow(/url/);
    await expect(startAutopilot({ projectId: "p", approvedBudgetUsd: -2 }, store)).rejects.toThrow(/approvedBudgetUsd/);
  });

  it("advanceAutopilots ticks every runnable record, oldest first", async () => {
    const store = new MemoryAutopilotStore();
    const { steps } = fakeSteps({ highUsd: 0, renderTicks: 1 });
    const a = await startAutopilot({ projectId: "pa" }, store);
    const b = await startAutopilot({ projectId: "pb" }, store);
    const first = await advanceAutopilots(deps(store, steps));
    expect(first.ticked).toBe(2);
    expect(first.results.map((r) => r.step)).toEqual(["render", "render"]);
    const second = await advanceAutopilots(deps(store, steps));
    expect(second.results.map((r) => [r.id, r.status])).toEqual([
      [a.id, "completed"],
      [b.id, "completed"],
    ]);
    expect((await advanceAutopilots(deps(store, steps))).ticked).toBe(0);
  });
});
