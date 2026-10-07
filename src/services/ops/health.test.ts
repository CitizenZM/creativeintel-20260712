import { describe, expect, it, vi } from "vitest";
import {
  autoRecover,
  detectCronStaleness,
  detectFailureRates,
  detectRenderDefects,
  detectSpendAnomalies,
  detectStuckJobs,
  detectStuckRuns,
  emptySnapshot,
  HEALTH_THRESHOLDS,
  scanHealth,
  scanSnapshot,
  type HealthJob,
  type HealthRun,
  type HealthSnapshot,
  type HealthSpendEntry,
  type OpsEventInput,
  type ProviderStatus,
  type RecoveryDeps,
} from "./health";
import { STALE_ASSEMBLY_MS } from "@/services/video-gen/server-executor";

const NOW = new Date("2026-10-07T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function run(over: Partial<HealthRun> = {}): HealthRun {
  return { id: "r1", projectId: "p1", status: "running", executor: "openrouter", approvedAt: ago(60), startedAt: ago(60), updatedAt: ago(1), lastJobUpdateAt: ago(1), ...over };
}
function job(over: Partial<HealthJob> = {}): HealthJob {
  return { id: "j1", runId: "r1", projectId: "p1", kind: "video", nodeName: "V1", status: "running", nodeId: "task-1", modelName: "Seedance", attempts: 1, startedAt: ago(5), updatedAt: ago(5), error: null, executor: "openrouter", runStatus: "running", ...over };
}
function entry(over: Partial<HealthSpendEntry> = {}): HealthSpendEntry {
  return { id: "s1", projectId: "p1", runId: "r1", jobId: "j1", kind: "video", model: "m", estUsd: 0.5, actualUsd: null, createdAt: ago(180), jobStatus: "completed", jobError: null, ...over };
}
const snap = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({ ...emptySnapshot(NOW), ...over });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function fakeDeps(over: Partial<RecoveryDeps> = {}) {
  const base = {
    driveRun: vi.fn(async (_executor: string, _runId: string) => "running"),
    settleReservation: vi.fn(async (_id: string, _usd: number) => {}),
    providerTaskStatus: vi.fn(async (_job: { executor: string; kind: string; nodeId: string }): Promise<ProviderStatus> => ({ status: "FAIL", error: "Seedance task failed" })),
    requeueJob: vi.fn(async (_job: { id: string; nodeId: string }, _note: string) => true),
    logEvent: vi.fn(async (_e: OpsEventInput) => {}),
  };
  return { ...base, ...over } as typeof base;
}

describe("detectStuckRuns", () => {
  it("flags an approved run that never started, with a re-drive fix for server engines only", () => {
    const issues = detectStuckRuns(snap({ activeRuns: [run({ status: "approved", approvedAt: ago(30), startedAt: null, lastJobUpdateAt: null }), run({ id: "r2", status: "approved", executor: "libtv", approvedAt: ago(30), startedAt: null })] }));
    expect(codes(issues)).toEqual(["run.approved-stale", "run.approved-stale"]);
    expect(issues[0].fix).toBe("redrive-run");
    expect(issues[1].fix).toBeUndefined();
    expect(issues[1].message).toMatch(/worker/i);
  });

  it("leaves a freshly approved run alone", () => {
    expect(detectStuckRuns(snap({ activeRuns: [run({ status: "approved", approvedAt: ago(3), startedAt: null })] }))).toEqual([]);
  });

  it("flags a stale assembly (the executor's rule) with a re-assemble fix", () => {
    expect(HEALTH_THRESHOLDS.staleAssemblyMs).toBe(STALE_ASSEMBLY_MS);
    const issues = detectStuckRuns(snap({ activeRuns: [run({ status: "assembling", updatedAt: ago(10) }), run({ id: "r2", status: "assembling", updatedAt: ago(2) })] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "run.assembling-stale", severity: "critical", fix: "reassemble-run", target: { type: "run", id: "r1" } });
  });

  it("flags a running run with no job progress, critical after two hours", () => {
    const issues = detectStuckRuns(snap({ activeRuns: [run({ lastJobUpdateAt: ago(45) }), run({ id: "r2", lastJobUpdateAt: ago(150) }), run({ id: "r3", lastJobUpdateAt: ago(5) })] }));
    expect(issues.map((i) => [i.code, i.severity, i.target?.id])).toEqual([
      ["run.no-progress", "warning", "r1"],
      ["run.no-progress", "critical", "r2"],
    ]);
    expect(issues[0].fix).toBeUndefined();
  });
});

describe("detectStuckJobs", () => {
  it("flags a clip submitted past its engine timeout, recoverable when attempts remain", () => {
    const issues = detectStuckJobs(snap({ runningJobs: [job({ startedAt: ago(40) }), job({ id: "j2", startedAt: ago(10) }), job({ id: "j3", startedAt: ago(40), attempts: 3 })] }));
    expect(issues.map((i) => [i.code, i.target?.id, i.fix])).toEqual([
      ["job.submitted-timeout", "j1", "requeue-job"],
      ["job.submitted-timeout", "j3", undefined],
    ]);
  });

  it("uses engine-specific timeouts", () => {
    const t = HEALTH_THRESHOLDS.jobTimeoutMin;
    expect(t.comfyui.video).toBeGreaterThan(t.matrix.video);
    // 30 min is past Matrix's limit but inside ComfyUI's.
    const issues = detectStuckJobs(snap({ runningJobs: [job({ executor: "matrix", startedAt: ago(30) }), job({ id: "j2", executor: "comfyui", startedAt: ago(30) })] }));
    expect(issues.map((i) => i.target?.id)).toEqual(["j1"]);
  });

  it("flags an in-process job (no task id) without a fix — the tick re-queues it itself", () => {
    const issues = detectStuckJobs(snap({ runningJobs: [job({ kind: "image", nodeId: null, startedAt: ago(30) })] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("job.running-timeout");
    expect(issues[0].fix).toBeUndefined();
  });

  it("never offers a re-queue for a LibTV (Mac worker) job or a job of an inactive run", () => {
    const issues = detectStuckJobs(snap({ runningJobs: [job({ executor: "libtv", startedAt: ago(90) }), job({ id: "j2", runStatus: "failed", startedAt: ago(90) })] }));
    expect(issues.every((i) => i.fix === undefined)).toBe(true);
  });
});

describe("detectFailureRates", () => {
  const finished = (n: number, failed: number, over: Partial<HealthJob> = {}) =>
    Array.from({ length: n }, (_, i) => job({ id: `${over.modelName ?? "m"}-${i}`, status: i < failed ? "failed" : "completed", ...over }));

  it("flags an engine/model whose 24 h failure rate is over the threshold", () => {
    const issues = detectFailureRates(snap({ recentJobs: [...finished(10, 4, { modelName: "Seedance" }), ...finished(10, 7, { modelName: "Veo" }), ...finished(10, 1, { modelName: "Kling" })] }));
    expect(issues.map((i) => [i.code, i.severity, i.target?.id])).toEqual([
      ["engine.failure-rate", "critical", "openrouter/Veo"],
      ["engine.failure-rate", "warning", "openrouter/Seedance"],
    ]);
    expect(issues[0].message).toMatch(/7 of 10/);
  });

  it("needs a minimum sample", () => {
    expect(detectFailureRates(snap({ recentJobs: finished(3, 3) }))).toEqual([]);
  });
});

describe("detectRenderDefects", () => {
  const render = (qcReport: unknown, over: Record<string, unknown> = {}) => ({ id: "r1", projectId: "p1", executor: "openrouter", masterMp4Url: "https://x/m.mp4", qcReport, completedAt: ago(60), ...over });
  const check = (key: string, value: number | null) => ({ key, label: key, value, target: "", pass: true });

  it("flags a v1 fallback render (overlays lost)", () => {
    const issues = detectRenderDefects(snap({ renders: [render({ engine: "v1-fallback", v2Error: "drawtext failed", checks: [] })] }));
    expect(issues[0]).toMatchObject({ code: "render.v1-fallback", severity: "critical" });
    expect(issues[0].message).toMatch(/drawtext failed/);
  });

  it("flags a silent master and missing overlays on an edit-v2 render", () => {
    const issues = detectRenderDefects(
      snap({
        renders: [
          render({ engine: "edit-v2", checks: [check("loudness_lufs", null), check("hook_headline", 1), check("caption_coverage", 95)] }, { id: "silent" }),
          render({ engine: "edit-v2", checks: [check("loudness_lufs", -14), check("hook_headline", 0), check("caption_coverage", 0)] }, { id: "bare" }),
          render({ engine: "edit-v2", checks: [check("loudness_lufs", -14), check("hook_headline", 1), check("caption_coverage", 96)] }, { id: "fine" }),
        ],
      })
    );
    expect(issues.map((i) => [i.code, i.target?.id])).toEqual([
      ["render.silent-master", "silent"],
      ["render.missing-overlays", "bare"],
    ]);
  });

  it("flags a completed run without a master; ignores runs without a QC report", () => {
    const issues = detectRenderDefects(snap({ renders: [render(null, { masterMp4Url: null }), render(null, { id: "r2" })] }));
    expect(codes(issues)).toEqual(["render.no-master"]);
  });
});

describe("detectSpendAnomalies", () => {
  it("flags projects over budget", () => {
    const issues = detectSpendAnomalies(snap({ budgetProjects: [{ id: "p1", name: "TCL", budgetUsd: 2, spentUsd: 2.03 }, { id: "p2", name: "OK", budgetUsd: 2, spentUsd: 1.5 }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "spend.project-over-budget", severity: "critical", projectId: "p1" });
  });

  it("flags open reservations older than 2 h and plans a release only when the job has finished", () => {
    const issues = detectSpendAnomalies(
      snap({
        openReservations: [
          entry({ id: "done", jobStatus: "completed" }),
          entry({ id: "skipped", jobStatus: "skipped" }),
          entry({ id: "unbilled", jobStatus: "failed", jobError: "OpenRouter 400 bad request" }),
          entry({ id: "billed", jobStatus: "failed", jobError: "timed out" }),
          entry({ id: "live", jobStatus: "running" }),
          entry({ id: "fresh", createdAt: ago(30) }),
          entry({ id: "nojob", jobId: null, jobStatus: null }),
        ],
      })
    );
    const byId = Object.fromEntries(issues.map((i) => [i.target?.id, i]));
    expect(Object.keys(byId).sort()).toEqual(["billed", "done", "live", "nojob", "skipped", "unbilled"]);
    expect(byId.done).toMatchObject({ fix: "release-reservation", detail: { settleUsd: 0.5 } });
    expect(byId.skipped.detail?.settleUsd).toBe(0);
    expect(byId.unbilled.detail?.settleUsd).toBe(0);
    expect(byId.billed.detail?.settleUsd).toBe(0.5);
    expect(byId.live.fix).toBeUndefined();
    expect(byId.nojob.fix).toBeUndefined();
  });

  it("flags actual/estimate drift per kind (e.g. vision QC 3.2×)", () => {
    const settled = [
      ...Array.from({ length: 4 }, (_, i) => entry({ id: `q${i}`, kind: "vision_qc", estUsd: 0.01, actualUsd: 0.032, createdAt: ago(60) })),
      ...Array.from({ length: 4 }, (_, i) => entry({ id: `i${i}`, kind: "image", estUsd: 0.04, actualUsd: 0.04, createdAt: ago(60) })),
      // unbilled (settled at 0) rows don't count toward the ratio
      entry({ id: "z", kind: "image", estUsd: 0.04, actualUsd: 0, createdAt: ago(60) }),
    ];
    const issues = detectSpendAnomalies(snap({ settledSpend: settled }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "spend.ratio-drift", severity: "critical", target: { type: "kind", id: "vision_qc" } });
    expect(issues[0].message).toMatch(/3\.2×/);
  });
});

describe("detectCronStaleness", () => {
  it("flags stale and missing cron heartbeats", () => {
    const issues = detectCronStaleness(
      snap({
        heartbeats: [
          { name: "poll-video-jobs", lastRunAt: ago(4), runs: 10 },
          { name: "hook-variants", lastRunAt: ago(20), runs: 10 },
          { name: "autopilot", lastRunAt: ago(3), runs: 10 },
        ],
      })
    );
    expect(issues.map((i) => [i.code, i.severity, i.target?.id])).toEqual([
      ["cron.stale", "warning", "hook-variants"],
      ["cron.missing", "info", "ops-health"],
    ]);
  });

  it("goes critical after a long silence", () => {
    const issues = detectCronStaleness(snap({ heartbeats: [{ name: "poll-video-jobs", lastRunAt: ago(120), runs: 1 }, { name: "hook-variants", lastRunAt: ago(1), runs: 1 }, { name: "autopilot", lastRunAt: ago(1), runs: 1 }, { name: "ops-health", lastRunAt: ago(1), runs: 1 }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("critical");
  });
});

describe("scanSnapshot / scanHealth", () => {
  it("sorts issues by severity and counts them", () => {
    const report = scanSnapshot(
      snap({
        activeRuns: [run({ status: "assembling", updatedAt: ago(10) })],
        heartbeats: [{ name: "poll-video-jobs", lastRunAt: ago(20), runs: 1 }],
      })
    );
    expect(report.issues[0].severity).toBe("critical");
    expect(report.counts.critical).toBe(1);
    expect(report.counts.warning).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.heartbeats.find((h) => h.name === "poll-video-jobs")).toMatchObject({ stale: true, everyMin: 5 });
  });

  it("an empty system is healthy apart from crons not reporting yet", () => {
    const report = scanSnapshot(snap());
    expect(report.ok).toBe(true);
    expect(report.issues.every((i) => i.severity === "info")).toBe(true);
  });

  it("scanHealth reads through an injected source", async () => {
    const report = await scanHealth({ source: { snapshot: async () => snap({ budgetProjects: [{ id: "p", name: "x", budgetUsd: 1, spentUsd: 5 }] }) } });
    expect(codes(report.issues)).toContain("spend.project-over-budget");
  });
});

describe("autoRecover", () => {
  const stuck = () =>
    snap({
      activeRuns: [run({ id: "approved", status: "approved", approvedAt: ago(30), startedAt: null }), run({ id: "assembling", status: "assembling", updatedAt: ago(10), executor: "glm" })],
      runningJobs: [job({ id: "sub", startedAt: ago(40) })],
      openReservations: [entry({ id: "res", jobStatus: "skipped" })],
      budgetProjects: [{ id: "p1", name: "x", budgetUsd: 1, spentUsd: 5 }],
    });

  it("dry run plans every safe action and changes nothing", async () => {
    const deps = fakeDeps();
    const out = await autoRecover({ dryRun: true, deps, source: { snapshot: async () => stuck() } });
    expect(out.dryRun).toBe(true);
    expect(out.actions.map((a) => [a.action, a.targetId, a.status])).toEqual([
      ["reassemble-run", "assembling", "planned"],
      ["redrive-run", "approved", "planned"],
      ["requeue-job", "sub", "planned"],
      ["release-reservation", "res", "planned"],
    ]);
    expect(deps.driveRun).not.toHaveBeenCalled();
    expect(deps.settleReservation).not.toHaveBeenCalled();
    expect(deps.requeueJob).not.toHaveBeenCalled();
    expect(deps.logEvent).not.toHaveBeenCalled();
    // The provider read is free and decides whether a re-queue would happen.
    expect(deps.providerTaskStatus).toHaveBeenCalledTimes(1);
  });

  it("re-drives a stuck approved run and re-assembles a stale assembly, logging each", async () => {
    const deps = fakeDeps();
    const out = await autoRecover({ deps, source: { snapshot: async () => snap({ activeRuns: stuck().activeRuns }) } });
    expect(deps.driveRun.mock.calls).toEqual([
      ["glm", "assembling"],
      ["openrouter", "approved"],
    ]);
    expect(out.actions.every((a) => a.status === "done")).toBe(true);
    expect(deps.logEvent).toHaveBeenCalledTimes(2);
    expect(deps.logEvent.mock.calls[0][0]).toMatchObject({ action: "reassemble-run", issueCode: "run.assembling-stale", targetType: "run", targetId: "assembling", ok: true });
  });

  it("caps the number of runs driven per pass", async () => {
    const deps = fakeDeps();
    const many = Array.from({ length: 5 }, (_, i) => run({ id: `a${i}`, status: "approved", approvedAt: ago(30), startedAt: null }));
    const out = await autoRecover({ deps, maxDrives: 2, source: { snapshot: async () => snap({ activeRuns: many }) } });
    expect(deps.driveRun).toHaveBeenCalledTimes(2);
    expect(out.actions.filter((a) => a.status === "skipped")).toHaveLength(3);
  });

  it("releases an orphaned reservation at the planned amount", async () => {
    const deps = fakeDeps();
    await autoRecover({ deps, source: { snapshot: async () => snap({ openReservations: [entry({ id: "res", jobStatus: "failed", jobError: "OpenRouter 400" })] }) } });
    expect(deps.settleReservation).toHaveBeenCalledWith("res", 0);
    expect(deps.logEvent.mock.calls[0][0]).toMatchObject({ action: "release-reservation", targetType: "spend", targetId: "res", detail: expect.objectContaining({ settleUsd: 0 }) });
  });

  it("re-queues a stuck submitted job only when the provider says the task failed", async () => {
    const failed = fakeDeps();
    await autoRecover({ deps: failed, source: { snapshot: async () => snap({ runningJobs: [job({ startedAt: ago(40) })] }) } });
    expect(failed.providerTaskStatus).toHaveBeenCalledWith(expect.objectContaining({ executor: "openrouter", kind: "video", nodeId: "task-1" }));
    expect(failed.requeueJob).toHaveBeenCalledWith({ id: "j1", nodeId: "task-1" }, expect.stringMatching(/Seedance task failed/));
    expect(failed.logEvent.mock.calls[0][0]).toMatchObject({ action: "requeue-job", ok: true });

    for (const status of ["PROCESSING", "SUCCESS", "unknown"] as const) {
      const deps = fakeDeps({ providerTaskStatus: vi.fn(async (): Promise<ProviderStatus> => ({ status })) });
      const out = await autoRecover({ deps, source: { snapshot: async () => snap({ runningJobs: [job({ startedAt: ago(40) })] }) } });
      expect(deps.requeueJob).not.toHaveBeenCalled();
      expect(out.actions[0].status).toBe("skipped");
      expect(deps.logEvent).not.toHaveBeenCalled();
    }
  });

  it("records a failed action and keeps going", async () => {
    const deps = fakeDeps({ driveRun: vi.fn(async () => { throw new Error("db down"); }) });
    const out = await autoRecover({ deps, source: { snapshot: async () => stuck() } });
    const drives = out.actions.filter((a) => a.action === "redrive-run" || a.action === "reassemble-run");
    expect(drives.every((a) => a.status === "failed" && /db down/.test(a.note ?? ""))).toBe(true);
    expect(deps.settleReservation).toHaveBeenCalled();
    expect(deps.logEvent.mock.calls.some(([e]) => e.ok === false)).toBe(true);
  });

  it("never takes an action for an issue without a fix (over budget, no-progress)", async () => {
    const deps = fakeDeps();
    const out = await autoRecover({ deps, source: { snapshot: async () => snap({ budgetProjects: [{ id: "p1", name: "x", budgetUsd: 1, spentUsd: 5 }], activeRuns: [run({ lastJobUpdateAt: ago(300) })] }) } });
    expect(out.actions).toEqual([]);
    expect(out.issues.length).toBeGreaterThan(0);
  });
});
