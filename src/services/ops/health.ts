/**
 * Ops health monitor + auto-recovery.
 *
 * scanHealth() reads one snapshot of the system and runs pure detectors over it:
 *   runs     approved but never started · running with no job progress · assembling past the stale rule
 *   jobs     submitted (provider task id) / running (in-process) past an engine-specific timeout
 *   engines  24 h failure rate per engine / model
 *   renders  edit-v2 fell back to v1 (overlays lost) · silent master · missing overlays · no master
 *   spend    projects over budget · reservations open > 2 h · actual / estimate drift per kind
 *   crons    last heartbeat per cron vs its schedule
 *
 * autoRecover() acts on the issues that carry a fix — SAFE actions only, never new paid generation
 * beyond what was already approved:
 *   redrive-run          tick an approved server run nobody picked up (its own budget guard still applies)
 *   reassemble-run       tick a stale "assembling" run — the executor's stale-assembly rule re-assembles it
 *   release-reservation  settle a > 2 h open reservation whose job has finished (0 when provably unbilled)
 *   requeue-job          re-queue a job stuck at "submitted" only when the provider says the task FAILED
 * Each action taken is logged as an OpsEvent; a dry run plans them and writes nothing.
 *
 * The data source and the side effects are injectable (tests run on in-memory data); production uses
 * health-prisma.ts.
 */
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { isUnbilledError } from "./budget-guard";

export type Severity = "critical" | "warning" | "info";
export type RecoveryKind = "redrive-run" | "reassemble-run" | "release-reservation" | "requeue-job";

export interface HealthRun {
  id: string;
  projectId: string;
  status: string;
  executor: string;
  approvedAt: Date | null;
  startedAt: Date | null;
  updatedAt: Date;
  /** Newest updatedAt of the run's jobs (null = no jobs). */
  lastJobUpdateAt: Date | null;
  /** Unfinished jobs held for keyframe review (settings.hold) and unfinished jobs not held. */
  heldJobs?: number;
  pendingJobs?: number;
}

export interface HealthJob {
  id: string;
  runId: string;
  projectId: string;
  kind: string;
  nodeName: string;
  status: string;
  /** The provider task id once submitted. */
  nodeId: string | null;
  modelName: string | null;
  attempts: number;
  startedAt: Date | null;
  updatedAt: Date;
  error: string | null;
  executor: string;
  runStatus: string;
}

export interface HealthRender {
  id: string;
  projectId: string;
  executor: string;
  masterMp4Url: string | null;
  qcReport: unknown;
  completedAt: Date | null;
}

export interface HealthSpendEntry {
  id: string;
  projectId: string;
  runId: string | null;
  jobId: string | null;
  kind: string;
  model: string;
  estUsd: number;
  actualUsd: number | null;
  createdAt: Date;
  /** Status / error of the entry's LibtvJob (null = no job or job gone). */
  jobStatus?: string | null;
  jobError?: string | null;
}

export interface HealthProject {
  id: string;
  name: string;
  budgetUsd: number | null;
  spentUsd: number | null;
}

export interface HealthHeartbeat {
  name: string;
  lastRunAt: Date;
  runs: number;
}

export interface HealthSnapshot {
  now: Date;
  /** Runs in approved | claimed | running | assembling. */
  activeRuns: HealthRun[];
  /** Jobs in status "running". */
  runningJobs: HealthJob[];
  /** Image / video jobs that finished (completed | failed) in the failure-rate window. */
  recentJobs: HealthJob[];
  /** Runs completed in the render window. */
  renders: HealthRender[];
  /** Unreconciled spend entries older than the reservation limit. */
  openReservations: HealthSpendEntry[];
  /** Settled spend entries in the ratio window. */
  settledSpend: HealthSpendEntry[];
  /** Projects with a budget set. */
  budgetProjects: HealthProject[];
  heartbeats: HealthHeartbeat[];
}

export interface HealthIssue {
  code: string;
  severity: Severity;
  category: "run" | "job" | "engine" | "render" | "spend" | "cron";
  message: string;
  projectId?: string;
  target?: { type: "run" | "job" | "spend" | "project" | "kind" | "engine" | "cron"; id: string };
  fix?: RecoveryKind;
  detail?: Record<string, unknown>;
}

export interface CronStatus {
  name: string;
  everyMin: number;
  lastRunAt: string | null;
  ageMin: number | null;
  runs: number;
  stale: boolean;
}

export interface HealthReport {
  at: string;
  ok: boolean;
  counts: Record<Severity, number>;
  issues: HealthIssue[];
  heartbeats: CronStatus[];
}

/** The crons in vercel.json and their schedule in minutes. */
export const CRON_SCHEDULES: Record<string, number> = { "poll-video-jobs": 5, "hook-variants": 5, autopilot: 5, "ops-health": 10, "report-digest": 7 * 24 * 60 };

export const HEALTH_THRESHOLDS = {
  approvedNotStartedMin: 10,
  noProgressMin: 30,
  noProgressCriticalMin: 120,
  /** = server-executor STALE_ASSEMBLY_MS (kept literal so this module never loads the executor). */
  staleAssemblyMs: 6 * 60_000,
  /** Minutes a job may stay running, per engine and kind, before it is stuck. */
  jobTimeoutMin: {
    libtv: { image: 20, video: 30 },
    glm: { image: 10, video: 20 },
    comfyui: { image: 20, video: 40 },
    animatic: { image: 10, video: 10 },
    matrix: { image: 10, video: 25 },
    openrouter: { image: 10, video: 25 },
    default: { image: 15, video: 30 },
  } as Record<string, { image: number; video: number }>,
  maxRequeueAttempts: 3,
  failureRate: { windowH: 24, minSamples: 5, warn: 0.3, critical: 0.6 },
  renderWindowH: 72,
  /** Integrated loudness below this (or unmeasurable) = no audio track worth the name. */
  silentLufs: -45,
  reservationMaxAgeMin: 120,
  ratio: { windowD: 7, minSamples: 3, warn: 1.5, critical: 3, low: 0.33 },
  cron: { staleFactor: 3, criticalFactor: 12 },
};

const ACTIVE = new Set(["approved", "claimed", "running", "assembling"]);
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const minutes = (now: Date, d: Date | null | undefined) => (d ? (now.getTime() - new Date(d).getTime()) / 60_000 : Infinity);
const fmtMin = (m: number) => (m >= 120 ? `${Math.round(m / 60)} h` : `${Math.round(m)} min`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export function emptySnapshot(now = new Date()): HealthSnapshot {
  return { now, activeRuns: [], runningJobs: [], recentJobs: [], renders: [], openReservations: [], settledSpend: [], budgetProjects: [], heartbeats: [] };
}

// ─── detectors (pure) ────────────────────────────────────────────────────────

export function detectStuckRuns(s: HealthSnapshot, t = HEALTH_THRESHOLDS): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const r of s.activeRuns) {
    const server = isServerEngine(r.executor);
    const base = { category: "run" as const, projectId: r.projectId, target: { type: "run" as const, id: r.id }, detail: { executor: r.executor, status: r.status } };
    if (r.status === "approved") {
      const age = minutes(s.now, r.approvedAt ?? r.updatedAt);
      if (age >= t.approvedNotStartedMin) {
        out.push({
          ...base,
          code: "run.approved-stale",
          severity: "warning",
          message: server
            ? `Run approved ${fmtMin(age)} ago but never started (${r.executor}).`
            : `Run approved ${fmtMin(age)} ago but no worker claimed it — is the ${r.executor} worker online?`,
          ...(server ? { fix: "redrive-run" as const } : {}),
        });
      }
    } else if (r.status === "assembling") {
      const age = minutes(s.now, r.updatedAt);
      if (age * 60_000 >= t.staleAssemblyMs) {
        out.push({
          ...base,
          code: "run.assembling-stale",
          severity: "critical",
          message: `Run stuck assembling for ${fmtMin(age)} — the function was likely killed mid-assembly.`,
          ...(server ? { fix: "reassemble-run" as const } : {}),
        });
      }
    } else if (r.status === "running" || r.status === "claimed") {
      const age = minutes(s.now, r.lastJobUpdateAt ?? r.startedAt ?? r.updatedAt);
      // Everything left is held for keyframe review: waiting on the owner (release-videos), not stuck.
      if ((r.heldJobs ?? 0) > 0 && (r.pendingJobs ?? 0) === 0) {
        if (age >= t.noProgressMin) {
          out.push({
            ...base,
            code: "run.awaiting-release",
            severity: "info",
            message: `${r.heldJobs} clip(s) held for keyframe review for ${fmtMin(age)} — release them (release-videos) or cancel the run.`,
          });
        }
        continue;
      }
      if (age >= t.noProgressMin) {
        out.push({
          ...base,
          code: "run.no-progress",
          severity: age >= t.noProgressCriticalMin ? "critical" : "warning",
          message: `Run ${r.status} with no job progress for ${fmtMin(age)}.`,
        });
      }
    }
  }
  return out;
}

export function jobTimeoutMin(executor: string, kind: string, t = HEALTH_THRESHOLDS): number {
  const e = t.jobTimeoutMin[executor] ?? t.jobTimeoutMin.default;
  return kind === "video" ? e.video : e.image;
}

export function detectStuckJobs(s: HealthSnapshot, t = HEALTH_THRESHOLDS): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const j of s.runningJobs) {
    if (j.kind !== "image" && j.kind !== "video") continue;
    const limit = jobTimeoutMin(j.executor, j.kind, t);
    const age = minutes(s.now, j.startedAt ?? j.updatedAt);
    if (age < limit) continue;
    const runActive = ACTIVE.has(j.runStatus);
    const detail = { executor: j.executor, kind: j.kind, nodeId: j.nodeId, attempts: j.attempts, runId: j.runId, runStatus: j.runStatus, limitMin: limit };
    const where = `${j.nodeName} (${j.kind}, ${j.executor}${j.modelName ? ` / ${j.modelName}` : ""})`;
    if (j.nodeId) {
      const recoverable = runActive && isServerEngine(j.executor) && j.attempts < t.maxRequeueAttempts;
      out.push({
        code: "job.submitted-timeout",
        severity: "warning",
        category: "job",
        projectId: j.projectId,
        target: { type: "job", id: j.id },
        message: `${where} submitted ${fmtMin(age)} ago (limit ${limit} min)${runActive ? "" : ` — its run is ${j.runStatus}`}.`,
        detail,
        ...(recoverable ? { fix: "requeue-job" as const } : {}),
      });
    } else {
      out.push({
        code: "job.running-timeout",
        severity: "warning",
        category: "job",
        projectId: j.projectId,
        target: { type: "job", id: j.id },
        message: `${where} running ${fmtMin(age)} without a provider task (limit ${limit} min) — the invocation was likely cut off.`,
        detail,
      });
    }
  }
  return out;
}

export function detectFailureRates(s: HealthSnapshot, t = HEALTH_THRESHOLDS): HealthIssue[] {
  const groups = new Map<string, { n: number; failed: number; executor: string; model: string; lastError: string | null }>();
  for (const j of s.recentJobs) {
    if (j.status !== "completed" && j.status !== "failed") continue;
    const model = j.modelName ?? j.kind;
    const key = `${j.executor}/${model}`;
    const g = groups.get(key) ?? { n: 0, failed: 0, executor: j.executor, model, lastError: null };
    g.n++;
    if (j.status === "failed") {
      g.failed++;
      g.lastError = j.error ?? g.lastError;
    }
    groups.set(key, g);
  }
  const out: HealthIssue[] = [];
  for (const [key, g] of groups) {
    if (g.n < t.failureRate.minSamples) continue;
    const rate = g.failed / g.n;
    if (rate < t.failureRate.warn) continue;
    out.push({
      code: "engine.failure-rate",
      severity: rate >= t.failureRate.critical ? "critical" : "warning",
      category: "engine",
      target: { type: "engine", id: key },
      message: `${key}: ${g.failed} of ${g.n} jobs failed in the last ${t.failureRate.windowH} h (${Math.round(rate * 100)} %)${g.lastError ? ` — last: ${g.lastError.slice(0, 160)}` : ""}.`,
      detail: { rate, n: g.n, failed: g.failed },
    });
  }
  return out.sort((a, b) => (b.detail!.rate as number) - (a.detail!.rate as number));
}

type QcLike = { engine?: string; v2Error?: string; checks?: { key: string; value: number | null }[] };

export function detectRenderDefects(s: HealthSnapshot, t = HEALTH_THRESHOLDS): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const r of s.renders) {
    const base = { category: "render" as const, projectId: r.projectId, target: { type: "run" as const, id: r.id } };
    if (!r.masterMp4Url) {
      out.push({ ...base, code: "render.no-master", severity: "critical", message: "Run completed without a master video." });
      continue;
    }
    const qc = (r.qcReport ?? null) as QcLike | null;
    if (!qc || typeof qc !== "object") continue;
    if (qc.engine === "v1-fallback") {
      out.push({ ...base, code: "render.v1-fallback", severity: "critical", message: `Edit engine v2 failed and the hard-cut v1 master shipped — overlays, captions and end card lost${qc.v2Error ? ` (${qc.v2Error.slice(0, 160)})` : ""}.`, detail: { v2Error: qc.v2Error ?? null } });
      continue;
    }
    const check = (key: string) => qc.checks?.find((c) => c.key === key);
    const loud = check("loudness_lufs");
    if (loud && (loud.value === null || loud.value < t.silentLufs)) {
      out.push({ ...base, code: "render.silent-master", severity: "critical", message: `Master is silent (loudness ${loud.value === null ? "unmeasurable" : `${loud.value} LUFS`}) — voiceover / music missing.` });
    }
    const hook = check("hook_headline");
    const captions = check("caption_coverage");
    const missing = [hook && hook.value === 0 ? "hook headline" : null, captions && captions.value === 0 ? "captions" : null].filter(Boolean);
    if (missing.length) out.push({ ...base, code: "render.missing-overlays", severity: "warning", message: `Master is missing its ${missing.join(" and ")}.` });
  }
  return out;
}

/** What a finished job's open reservation settles at: 0 when the work provably was not billed, else its estimate. */
export function releaseAmount(e: HealthSpendEntry): number | null {
  if (!e.jobId || !e.jobStatus) return null;
  if (e.jobStatus === "skipped") return 0;
  if (e.jobStatus === "completed") return e.estUsd;
  if (e.jobStatus === "failed") return isUnbilledError(new Error(e.jobError ?? "")) && e.jobError ? 0 : e.estUsd;
  return null; // still queued / running
}

/** When the price table was last recalibrated per spend kind (ops/cost-model.ts) — older ledger rows are skipped for drift. */
export const PRICE_CALIBRATED_AT: Record<string, string> = { vision_qc: "2026-10-07T09:30:00Z" };

export function detectSpendAnomalies(s: HealthSnapshot, t = HEALTH_THRESHOLDS): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const p of s.budgetProjects) {
    if (p.budgetUsd == null || p.spentUsd == null || p.spentUsd <= p.budgetUsd + 1e-6) continue;
    out.push({
      code: "spend.project-over-budget",
      // A settle a few cents past the cap (provider bill above the reservation) is a warning; a real overrun is critical.
      severity: p.spentUsd - p.budgetUsd <= Math.max(0.05, p.budgetUsd * 0.05) ? "warning" : "critical",
      category: "spend",
      projectId: p.id,
      target: { type: "project", id: p.id },
      message: `${p.name}: spent ${usd(p.spentUsd)} of an approved ${usd(p.budgetUsd)} (${usd(p.spentUsd - p.budgetUsd)} over).`,
    });
  }
  for (const e of s.openReservations) {
    if (e.actualUsd !== null) continue;
    const age = minutes(s.now, e.createdAt);
    if (age < t.reservationMaxAgeMin) continue;
    const settleUsd = releaseAmount(e);
    out.push({
      code: "spend.open-reservation",
      severity: "warning",
      category: "spend",
      projectId: e.projectId,
      target: { type: "spend", id: e.id },
      message:
        `${e.kind} reservation ${usd(e.estUsd)} (${e.model}) open for ${fmtMin(age)}` +
        (settleUsd !== null ? ` — its job ${e.jobStatus}; release at ${usd(settleUsd)}.` : e.jobId ? ` — its job is ${e.jobStatus ?? "gone"}.` : " — not tied to a job."),
      detail: { jobId: e.jobId, jobStatus: e.jobStatus ?? null, estUsd: e.estUsd, ...(settleUsd !== null ? { settleUsd } : {}) },
      ...(settleUsd !== null ? { fix: "release-reservation" as const } : {}),
    });
  }
  const byKind = new Map<string, { n: number; est: number; actual: number }>();
  for (const e of s.settledSpend) {
    if (e.actualUsd === null || !(e.actualUsd > 0) || !(e.estUsd > 0)) continue; // unbilled rows say nothing about price drift
    // Rows estimated before the price table was recalibrated for this kind say nothing about today's table.
    const cal = PRICE_CALIBRATED_AT[e.kind];
    if (cal && new Date(e.createdAt).getTime() < Date.parse(cal)) continue;
    const g = byKind.get(e.kind) ?? { n: 0, est: 0, actual: 0 };
    g.n++;
    g.est += e.estUsd;
    g.actual += e.actualUsd;
    byKind.set(e.kind, g);
  }
  for (const [kind, g] of byKind) {
    if (g.n < t.ratio.minSamples) continue;
    const ratio = g.actual / g.est;
    const high = ratio >= t.ratio.warn;
    if (!high && ratio > t.ratio.low) continue;
    out.push({
      code: "spend.ratio-drift",
      severity: high ? (ratio >= t.ratio.critical ? "critical" : "warning") : "info",
      category: "spend",
      target: { type: "kind", id: kind },
      message: `${kind}: actual cost is ${ratio.toFixed(1)}× the estimate over ${g.n} calls (${usd(g.actual)} vs ${usd(g.est)}) — ${high ? "the price table under-estimates it" : "reservations are far above the real cost"}.`,
      detail: { ratio, n: g.n, actualUsd: g.actual, estUsd: g.est },
    });
  }
  return out;
}

export function cronStatuses(s: HealthSnapshot, schedules = CRON_SCHEDULES, t = HEALTH_THRESHOLDS): CronStatus[] {
  const names = [...new Set([...Object.keys(schedules), ...s.heartbeats.map((h) => h.name)])];
  return names.map((name) => {
    const hb = s.heartbeats.find((h) => h.name === name);
    const everyMin = schedules[name] ?? 0;
    const age = hb ? minutes(s.now, hb.lastRunAt) : null;
    return { name, everyMin, lastRunAt: hb ? new Date(hb.lastRunAt).toISOString() : null, ageMin: age === null ? null : Math.round(age * 10) / 10, runs: hb?.runs ?? 0, stale: !!everyMin && (age === null || age > everyMin * t.cron.staleFactor) };
  });
}

export function detectCronStaleness(s: HealthSnapshot, schedules = CRON_SCHEDULES, t = HEALTH_THRESHOLDS): HealthIssue[] {
  const out: HealthIssue[] = [];
  for (const c of cronStatuses(s, schedules, t)) {
    if (!c.everyMin || !c.stale) continue;
    const target = { type: "cron" as const, id: c.name };
    if (c.ageMin === null) {
      out.push({ code: "cron.missing", severity: "info", category: "cron", target, message: `${c.name}: no heartbeat recorded yet (expected every ${c.everyMin} min).` });
    } else {
      out.push({
        code: "cron.stale",
        severity: c.ageMin > c.everyMin * t.cron.criticalFactor ? "critical" : "warning",
        category: "cron",
        target,
        message: `${c.name}: last ran ${fmtMin(c.ageMin)} ago (expected every ${c.everyMin} min).`,
      });
    }
  }
  return out;
}

export function scanSnapshot(s: HealthSnapshot, t = HEALTH_THRESHOLDS): HealthReport {
  const issues = [
    ...detectStuckRuns(s, t),
    ...detectStuckJobs(s, t),
    ...detectFailureRates(s, t),
    ...detectRenderDefects(s, t),
    ...detectSpendAnomalies(s, t),
    ...detectCronStaleness(s, CRON_SCHEDULES, t),
  ]
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue);
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { at: s.now.toISOString(), ok: counts.critical === 0 && counts.warning === 0, counts, issues, heartbeats: cronStatuses(s, CRON_SCHEDULES, t) };
}

// ─── data source / side effects ──────────────────────────────────────────────

export interface HealthSource {
  snapshot(now: Date): Promise<HealthSnapshot>;
}

export interface OpsEventInput {
  action: RecoveryKind;
  issueCode: string;
  targetType: string | null;
  targetId: string | null;
  projectId: string | null;
  ok: boolean;
  detail: Record<string, unknown>;
}

export type ProviderStatus = { status: "SUCCESS" | "FAIL" | "PROCESSING" | "unknown"; error?: string };

export interface RecoveryDeps {
  /** Tick a server run (its own spend guard applies); resolves to the tick result. */
  driveRun(executor: string, runId: string): Promise<string>;
  settleReservation(entryId: string, usd: number): Promise<void>;
  /** A read-only status probe of the job's provider task. */
  providerTaskStatus(job: { executor: string; kind: string; nodeId: string }): Promise<ProviderStatus>;
  /** Conditional re-queue (still running with this task id); false when someone else moved it. */
  requeueJob(job: { id: string; nodeId: string }, note: string): Promise<boolean>;
  logEvent(event: OpsEventInput): Promise<void>;
}

async function prismaHealth() {
  return import("./health-prisma");
}

export async function scanHealth(opts: { source?: HealthSource; now?: Date } = {}): Promise<HealthReport> {
  const source = opts.source ?? (await prismaHealth()).prismaHealthSource;
  return scanSnapshot(await source.snapshot(opts.now ?? new Date()));
}

export interface RecoveryAction {
  action: RecoveryKind;
  issueCode: string;
  targetType: string | null;
  targetId: string | null;
  projectId: string | null;
  status: "planned" | "done" | "skipped" | "failed";
  note?: string;
  detail: Record<string, unknown>;
}

export interface RecoveryReport {
  at: string;
  dryRun: boolean;
  actions: RecoveryAction[];
  issues: HealthIssue[];
  counts: Record<Severity, number>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Take the safe recovery actions for the scan's fixable issues. dryRun (default false) plans them and
 * writes nothing — it still reads the provider's task status, which is free, to say whether a re-queue
 * would happen. At most `maxDrives` runs are ticked per pass (the cron's time budget).
 */
export async function autoRecover(opts: { dryRun?: boolean; source?: HealthSource; deps?: RecoveryDeps; report?: HealthReport; maxDrives?: number; now?: Date } = {}): Promise<RecoveryReport> {
  const dryRun = !!opts.dryRun;
  const report = opts.report ?? (await scanHealth({ source: opts.source, now: opts.now }));
  const deps = opts.deps ?? (await prismaHealth()).prismaRecoveryDeps;
  const maxDrives = opts.maxDrives ?? 3;
  let drives = 0;
  const actions: RecoveryAction[] = [];

  for (const issue of report.issues) {
    if (!issue.fix) continue;
    const d = issue.detail ?? {};
    const a: RecoveryAction = { action: issue.fix, issueCode: issue.code, targetType: issue.target?.type ?? null, targetId: issue.target?.id ?? null, projectId: issue.projectId ?? null, status: "planned", detail: { ...d } };
    actions.push(a);
    const id = a.targetId;
    if (!id) {
      a.status = "skipped";
      a.note = "no target";
      continue;
    }
    try {
      if (a.action === "redrive-run" || a.action === "reassemble-run") {
        if (drives >= maxDrives) {
          a.status = "skipped";
          a.note = `over the ${maxDrives}-run limit for one pass — next pass`;
          continue;
        }
        drives++;
        if (dryRun) continue;
        const tick = await deps.driveRun(String(d.executor), id);
        a.status = "done";
        a.detail.tick = tick;
      } else if (a.action === "release-reservation") {
        const amount = Number(d.settleUsd);
        if (!Number.isFinite(amount)) {
          a.status = "skipped";
          a.note = "no settle amount";
          continue;
        }
        if (dryRun) continue;
        await deps.settleReservation(id, amount);
        a.status = "done";
      } else if (a.action === "requeue-job") {
        const nodeId = typeof d.nodeId === "string" ? d.nodeId : null;
        if (!nodeId) {
          a.status = "skipped";
          a.note = "no provider task id";
          continue;
        }
        const probe = await deps.providerTaskStatus({ executor: String(d.executor), kind: String(d.kind), nodeId });
        a.detail.provider = probe.status;
        if (probe.status !== "FAIL") {
          a.status = "skipped";
          a.note = probe.status === "unknown" ? "provider status unavailable — left alone" : `provider says ${probe.status} — the next tick applies it`;
          continue;
        }
        a.detail.providerError = probe.error ?? null;
        if (dryRun) continue;
        const moved = await deps.requeueJob({ id, nodeId }, `Re-queued by ops-health: provider task ${nodeId} failed${probe.error ? ` (${probe.error.slice(0, 200)})` : ""}`);
        a.status = moved ? "done" : "skipped";
        if (!moved) {
          a.note = "job moved on before the re-queue";
          continue;
        }
      }
    } catch (err) {
      a.status = "failed";
      a.note = errText(err);
    }
    if (!dryRun && (a.status === "done" || a.status === "failed")) {
      await deps
        .logEvent({ action: a.action, issueCode: a.issueCode, targetType: a.targetType, targetId: a.targetId, projectId: a.projectId, ok: a.status === "done", detail: { ...a.detail, ...(a.note ? { note: a.note } : {}) } })
        .catch((e) => console.warn("[ops-health] event log failed:", errText(e)));
    }
  }
  return { at: report.at, dryRun, actions, issues: report.issues, counts: report.counts };
}
