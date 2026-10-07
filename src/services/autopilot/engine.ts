/**
 * URL-to-Video Autopilot state machine: product URL (or project) → scrape → brief → plan →
 * storyboard → estimate → AWAIT_BUDGET → compile → approve → render → preflight → report.
 *
 * Each tick takes a lease on the record, then runs steps in order until it finishes, a step waits
 * (render in progress), the budget gate stops it (awaiting_approval) or the tick's time budget is
 * spent. State is saved after every step, so the next tick (cron or operator call) resumes exactly
 * there. A failing step is retried on later ticks, up to MAX_STEP_ATTEMPTS, then the run fails.
 * Pure — the step functions and the store are injected (steps.ts / store-prisma.ts in production).
 *
 * Spend: the gate only passes when the owner's approvedBudgetUsd covers the forecast's high total
 * (or the forecast is $0). The autopilot never raises a budget; it only applies the owner's number.
 */
import {
  AUTOPILOT_STEPS,
  AutopilotFatalError,
  type AutopilotInput,
  type AutopilotLogEntry,
  type AutopilotPatch,
  type AutopilotRecord,
  type AutopilotState,
  type AutopilotStep,
  type AutopilotStepName,
  type AutopilotSteps,
  type AutopilotStore,
  type StepContext,
  type StepFn,
  type StepOutcome,
} from "./types";

export const MAX_STEP_ATTEMPTS = 3;
/** Serverless tick: Vercel functions here run up to 300 s. */
export const DEFAULT_TICK_MS = 280_000;
/** Don't start a step with less than this left (brief / plan model calls take ~30–60 s). */
export const DEFAULT_MIN_STEP_MS = 45_000;
const LOG_LIMIT = 40;
const EPS = 1e-9;

export interface TickDeps {
  store: AutopilotStore;
  steps: AutopilotSteps;
  budgetMs?: number;
  minStepMs?: number;
  maxAttempts?: number;
  now?: () => number;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** AWAIT_BUDGET: pass when the owner's budget covers the forecast's high total (or it is free). */
export function budgetGate(state: AutopilotState): StepOutcome {
  const f = state.forecast;
  if (!f) throw new Error("No cost forecast — the estimate step must run first");
  const approved = state.approvedBudgetUsd ?? null;
  if (f.highUsd <= EPS) return { kind: "done", state: { approvedBudgetUsd: approved ?? 0, awaiting: null }, note: "free forecast — runs under a $0 paid-spend cap" };
  if (approved != null && f.highUsd <= approved + EPS) return { kind: "done", state: { awaiting: null }, note: `approved ${money(approved)} covers the high forecast ${money(f.highUsd)}` };
  const reason =
    approved == null
      ? `Forecast up to ${money(f.highUsd)} — waiting for the owner's budget (autopilot-approve with approvedBudgetUsd ≥ ${money(f.recommendedBudgetUsd)}).`
      : `Approved ${money(approved)} is below the high forecast ${money(f.highUsd)} — approve at least ${money(f.recommendedBudgetUsd)} to continue.`;
  return { kind: "await_approval", awaiting: { reason, forecastHighUsd: f.highUsd, recommendedBudgetUsd: f.recommendedBudgetUsd, approvedBudgetUsd: approved }, note: reason };
}

const stepIndex = (step: AutopilotStep) => (step === "done" ? AUTOPILOT_STEPS.length : AUTOPILOT_STEPS.indexOf(step));
const nextStep = (step: AutopilotStepName): AutopilotStep => AUTOPILOT_STEPS[AUTOPILOT_STEPS.indexOf(step) + 1] ?? "done";
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000);

function withLog(state: AutopilotState, entry: Omit<AutopilotLogEntry, "at">, now: number): AutopilotState {
  const log = [...(state.log ?? []), { at: new Date(now).toISOString(), ...entry }].slice(-LOG_LIMIT);
  return { ...state, log };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Create the record (status running, at scrape). The caller ticks it (operator: after the response). */
export async function startAutopilot(input: AutopilotInput, store: AutopilotStore): Promise<AutopilotRecord> {
  if (!input.url && !input.projectId) throw new Error("autopilot needs a url or projectId");
  if (input.url && !isHttpUrl(input.url)) throw new Error("url must be an http(s) product page URL");
  if (input.approvedBudgetUsd != null && !(input.approvedBudgetUsd >= 0)) throw new Error("approvedBudgetUsd must be ≥ 0");
  return store.create({
    projectId: input.projectId ?? null,
    input,
    state: { ...(input.projectId ? { projectId: input.projectId } : {}), approvedBudgetUsd: input.approvedBudgetUsd ?? null, attempts: {}, log: [] },
  });
}

type Result = { ok: true; record: AutopilotRecord } | { ok: false; status: number; error: string };

/** Optimistic writes retry this often before giving up (the approval) or writing anyway (a tick). */
const CAS_TRIES = 5;

/**
 * The owner's fields — approvedBudgetUsd and the "approved" log entries — from the stored record onto
 * a tick's state. A tick works on its own copy; an approval that landed meanwhile must win over it.
 */
export function withOwnerFields(state: AutopilotState, stored: AutopilotState): AutopilotState {
  const own = state.log ?? [];
  const key = (e: AutopilotLogEntry) => `${e.at}|${e.event}|${e.note ?? ""}`;
  const seen = new Set(own.map(key));
  const approvals = (stored.log ?? []).filter((e) => e.event === "approved" && !seen.has(key(e)));
  const log = approvals.length ? [...own, ...approvals].sort((a, b) => a.at.localeCompare(b.at)).slice(-LOG_LIMIT) : own;
  return { ...state, approvedBudgetUsd: stored.approvedBudgetUsd ?? null, log };
}

/**
 * Owner approval of a USD budget. Allowed while waiting at a gate, or ahead of it (before render starts).
 * Written optimistically (on the record's updatedAt), so it never rolls back progress a running tick
 * saved meanwhile; the tick in turn never overwrites it (withOwnerFields).
 */
export async function approveAutopilot(id: string, approvedBudgetUsd: number, store: AutopilotStore, now = Date.now()): Promise<Result> {
  if (!(approvedBudgetUsd >= 0) || !Number.isFinite(approvedBudgetUsd)) return { ok: false, status: 400, error: "approvedBudgetUsd must be a number ≥ 0" };
  for (let i = 0; i < CAS_TRIES; i++) {
    const rec = await store.get(id);
    if (!rec) return { ok: false, status: 404, error: "Autopilot not found" };
    const beforeRender = rec.status === "running" && stepIndex(rec.step) < stepIndex("render");
    if (rec.status !== "awaiting_approval" && !beforeRender) return { ok: false, status: 409, error: `Nothing to approve: the autopilot is ${rec.status} at ${rec.step}` };
    const state = withLog({ ...rec.state, approvedBudgetUsd, awaiting: null }, { step: rec.step, event: "approved", note: `owner approved ${money(approvedBudgetUsd)}` }, now);
    const saved = await store.saveIf(id, { status: "running", state, error: null }, rec.updatedAt);
    if (saved) return { ok: true, record: saved };
  }
  return { ok: false, status: 409, error: "The autopilot kept changing while approving — try again" };
}

/** A tick's write: the owner's fields from the stored record win (optimistic, retried; written anyway at the end). */
async function tickSave(store: AutopilotStore, id: string, patch: AutopilotPatch): Promise<AutopilotRecord> {
  for (let i = 0; i < CAS_TRIES; i++) {
    const stored = await store.get(id);
    if (!stored) break;
    const p = patch.state ? { ...patch, state: withOwnerFields(patch.state, stored.state) } : patch;
    const saved = await store.saveIf(id, p, stored.updatedAt);
    if (saved) return saved;
  }
  const stored = await store.get(id);
  return store.save(id, patch.state && stored ? { ...patch, state: withOwnerFields(patch.state, stored.state) } : patch);
}

/** Re-open a failed autopilot at the step that failed, with that step's attempts reset. */
export async function retryAutopilot(id: string, store: AutopilotStore, now = Date.now()): Promise<Result> {
  const rec = await store.get(id);
  if (!rec) return { ok: false, status: 404, error: "Autopilot not found" };
  if (rec.status !== "failed" || rec.step === "done") return { ok: false, status: 409, error: `Only a failed autopilot can be retried (it is ${rec.status})` };
  const attempts = { ...(rec.state.attempts ?? {}), [rec.step]: 0 };
  const state = withLog({ ...rec.state, attempts }, { step: rec.step, event: "retry" }, now);
  return { ok: true, record: await store.save(id, { status: "running", state, error: null }) };
}

/** One tick: advance as far as possible within the time budget. Returns the saved record. */
export async function tickAutopilot(id: string, deps: TickDeps): Promise<AutopilotRecord | null> {
  const now = deps.now ?? Date.now;
  const start = now();
  const deadline = start + (deps.budgetMs ?? DEFAULT_TICK_MS);
  const minStep = deps.minStepMs ?? DEFAULT_MIN_STEP_MS;
  const maxAttempts = deps.maxAttempts ?? MAX_STEP_ATTEMPTS;
  const { store } = deps;

  const first = await store.get(id);
  if (!first || first.status !== "running") return first;
  // Lease a little past the deadline so a crashed tick frees the record soon after.
  if (!(await store.claim(id, new Date(deadline + 30_000), new Date(start)))) return first;

  let rec: AutopilotRecord = first;
  try {
    rec = (await store.get(id)) ?? first;
    while (rec.status === "running" && rec.step !== "done") {
      if (deadline - now() < minStep) break;
      const step = rec.step as AutopilotStepName;
      // The budget gate and the approve step read the owner's budget: take it from the store, not this tick's copy.
      if (step === "await_budget" || step === "approve") {
        const stored = await store.get(id);
        if (!stored || stored.status !== "running") break;
        rec = { ...rec, state: withOwnerFields(rec.state, stored.state) };
      }
      const fn: StepFn = step === "await_budget" ? (deps.steps.await_budget ?? (async (ctx) => budgetGate(ctx.state))) : deps.steps[step];
      let state: AutopilotState = rec.state;
      const ctx: StepContext = {
        id,
        input: rec.input,
        state,
        deadline,
        now,
        save: async (patch) => {
          rec = await tickSave(store, id, { state: { ...state, ...patch } });
          state = rec.state;
          ctx.state = state;
        },
      };

      let out: StepOutcome;
      try {
        out = await fn(ctx);
      } catch (err) {
        const attempts = { ...(state.attempts ?? {}), [step]: (state.attempts?.[step] ?? 0) + 1 };
        const fatal = err instanceof AutopilotFatalError;
        const failed = fatal || attempts[step]! >= maxAttempts;
        const msg = errText(err);
        const next = withLog({ ...state, attempts }, { step, event: "error", note: `${fatal ? "fatal: " : `attempt ${attempts[step]}/${maxAttempts}: `}${msg}` }, now());
        // A failing step is retried on the next tick (not in a tight loop within this one).
        rec = await tickSave(store, id, { state: next, error: msg, ...(failed ? { status: "failed" as const } : {}) });
        break;
      }

      let next: AutopilotState = { ...state, ...(out.state ?? {}) };
      const patch: AutopilotPatch = {};
      if (next.projectId && next.projectId !== rec.projectId) patch.projectId = next.projectId;
      if (out.kind === "done") {
        const to = nextStep(step);
        if (to === "render" && !next.renderStartedAt) next.renderStartedAt = new Date(now()).toISOString();
        next = withLog(next, { step, event: "done", note: out.note }, now());
        rec = await tickSave(store, id, { ...patch, state: next, step: to, error: null, ...(to === "done" ? { status: "completed" as const } : {}) });
        continue;
      }
      if (out.kind === "wait") {
        next = withLog(next, { step, event: "wait", note: out.note }, now());
        rec = await tickSave(store, id, { ...patch, state: next, error: null });
        break;
      }
      // An approval that landed while the gate decided on the old budget: decide again with it.
      const stored = await store.get(id);
      if (stored && (stored.state.approvedBudgetUsd ?? null) !== (state.approvedBudgetUsd ?? null)) {
        rec = { ...rec, state: withOwnerFields({ ...state, ...(out.state ?? {}) }, stored.state) };
        continue;
      }
      next = withLog({ ...next, awaiting: out.awaiting }, { step, event: "await_approval", note: out.note ?? out.awaiting.reason }, now());
      rec = await tickSave(store, id, { ...patch, state: next, status: "awaiting_approval", error: null });
      break;
    }
  } finally {
    await store.release(id).catch(() => undefined);
  }
  return (await store.get(id)) ?? rec;
}

/** Cron sweep: tick every runnable autopilot, oldest first, while the time budget lasts. */
export async function advanceAutopilots(deps: TickDeps & { limit?: number }): Promise<{ ticked: number; results: { id: string; status: string; step: string; error: string | null }[] }> {
  const now = deps.now ?? Date.now;
  const start = now();
  const budget = deps.budgetMs ?? DEFAULT_TICK_MS;
  const minStep = deps.minStepMs ?? DEFAULT_MIN_STEP_MS;
  const due = await deps.store.listRunnable(deps.limit ?? 10, new Date(start));
  const results: { id: string; status: string; step: string; error: string | null }[] = [];
  for (const r of due) {
    const left = start + budget - now();
    if (left < minStep || left <= 0) break;
    const after = await tickAutopilot(r.id, { ...deps, budgetMs: left });
    if (after) results.push({ id: after.id, status: after.status, step: after.step, error: after.error });
  }
  return { ticked: results.length, results };
}

/** Compact status view for the operator and the UI. */
export function autopilotView(rec: AutopilotRecord) {
  const s = rec.state;
  return {
    id: rec.id,
    projectId: rec.projectId,
    status: rec.status,
    step: rec.step,
    progress: `${Math.min(stepIndex(rec.step), AUTOPILOT_STEPS.length)}/${AUTOPILOT_STEPS.length}`,
    error: rec.error,
    awaiting: rec.status === "awaiting_approval" ? (s.awaiting ?? null) : null,
    forecast: s.forecast ?? null,
    approvedBudgetUsd: s.approvedBudgetUsd ?? null,
    storyboardId: s.storyboardId ?? null,
    runId: s.runId ?? null,
    platform: s.platform ?? null,
    masterUrl: s.masterUrl ?? null,
    preflight: s.preflight ?? null,
    report: s.report ?? null,
    attempts: s.attempts ?? {},
    log: (s.log ?? []).slice(-12),
    createdAt: rec.createdAt.toISOString(),
    updatedAt: rec.updatedAt.toISOString(),
  };
}

/** In-memory store (tests, scripts) with the same semantics as the Prisma one. */
export class MemoryAutopilotStore implements AutopilotStore {
  private rows = new Map<string, AutopilotRecord & { leaseUntil: Date | null }>();
  private seq = 0;
  private clock = 0;
  // Strictly increasing timestamps keep "oldest first" stable within one millisecond.
  private stamp() {
    this.clock = Math.max(this.clock + 1, Date.now());
    return new Date(this.clock);
  }
  private copy(r: AutopilotRecord): AutopilotRecord {
    const { leaseUntil: _l, ...rest } = r as AutopilotRecord & { leaseUntil?: Date | null };
    return JSON.parse(JSON.stringify(rest), (k, v) => ((k === "createdAt" || k === "updatedAt") && typeof v === "string" ? new Date(v) : v));
  }
  async create(data: { projectId: string | null; input: AutopilotInput; state: AutopilotState }) {
    const at = this.stamp();
    const id = `ap${++this.seq}`;
    this.rows.set(id, { id, projectId: data.projectId, status: "running", step: "scrape", input: data.input, state: data.state, error: null, createdAt: at, updatedAt: at, leaseUntil: null });
    return this.copy(this.rows.get(id)!);
  }
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? this.copy(r) : null;
  }
  async save(id: string, patch: AutopilotPatch) {
    const r = this.rows.get(id);
    if (!r) throw new Error(`Autopilot ${id} not found`);
    Object.assign(r, JSON.parse(JSON.stringify(patch)), { updatedAt: this.stamp() });
    return this.copy(r);
  }
  async saveIf(id: string, patch: AutopilotPatch, updatedAt: Date) {
    const r = this.rows.get(id);
    if (!r || r.updatedAt.getTime() !== updatedAt.getTime()) return null;
    return this.save(id, patch);
  }
  async claim(id: string, until: Date, now: Date) {
    const r = this.rows.get(id);
    if (!r || (r.leaseUntil && r.leaseUntil > now)) return false;
    r.leaseUntil = until;
    return true;
  }
  async release(id: string) {
    const r = this.rows.get(id);
    if (r) r.leaseUntil = null;
  }
  async listRunnable(limit: number, now: Date) {
    return [...this.rows.values()]
      .filter((r) => r.status === "running" && (!r.leaseUntil || r.leaseUntil <= now))
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit)
      .map((r) => this.copy(r));
  }
}
