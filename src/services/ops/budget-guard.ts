/**
 * Budget guard — no paid model call without approved budget to cover it.
 *
 * Every paid call site (keyframe image gen/edit, clip submit, vision QC, LLM) goes through
 * withSpendGuard(scope, estimate, call):
 *   1. chargeOrRefuse reserves the estimate in the spend ledger atomically, or throws
 *      BudgetExceededError when it would push the run past its approved budget
 *      (LibtvRun.approvedBudgetUsd) or the project past Project.budgetUsd — the provider is never called;
 *   2. the call runs with AI-usage capture on, so the cost the provider reported (OpenRouter returns
 *      usage.cost) or the tokens it used are seen;
 *   3. the reservation is reconciled with that actual cost (else it stays at the estimate). A clip's
 *      real cost arrives with its poll, so video reservations stay open until then.
 *
 * Open reservations count at their estimate, settled ones at their actual cost. No budget set = no
 * cap (spend is still recorded). SPEND_GUARD=off bypasses the guard entirely (emergency switch).
 *
 * The ledger is injectable: tests use MemorySpendLedger; production uses the Prisma ledger
 * (spend-ledger-prisma.ts, SpendEntry rows, advisory-locked per project).
 */
import { captureAiUsage, type AiUsageEntry } from "@/services/ai/usage";
import { DEFAULT_PRICES, imageCostUsd, llmCostUsd, videoCostUsd, type PriceTable } from "./cost-model";

export type SpendKind = "image" | "video" | "vision_qc" | "llm" | "tts";

export interface SpendScope {
  projectId: string;
  runId?: string | null;
  jobId?: string | null;
  kind: SpendKind;
  model: string;
}

export interface SpendEntryRecord {
  id: string;
  projectId: string;
  runId: string | null;
  jobId: string | null;
  kind: string;
  model: string;
  estUsd: number;
  /** null = not reconciled yet (counts at the estimate). */
  actualUsd: number | null;
  createdAt: Date;
}

export interface SpendReservation {
  id: string;
  estUsd: number;
}

export interface BudgetState {
  budgetUsd: number | null;
  spentUsd: number;
}

export interface SpendLedger {
  /** Atomically check the budgets and record the reservation; throws BudgetExceededError. */
  reserve(scope: SpendScope, estUsd: number): Promise<SpendReservation>;
  /** Record the actual cost of a reservation. */
  settle(entryId: string, actualUsd: number): Promise<void>;
  /** The newest unreconciled reservation of a job (a clip waiting for its poll). */
  openEntryForJob(jobId: string, kind: SpendKind): Promise<SpendReservation | null>;
  /** usd null removes the cap. */
  setBudget(target: { projectId: string; runId?: string | null }, usd: number | null): Promise<void>;
  budgets(projectId: string, runId?: string | null): Promise<{ project: BudgetState; run: BudgetState | null }>;
  entries(filter: { projectId: string; runId?: string | null; since?: Date }): Promise<SpendEntryRecord[]>;
}

const EPS = 1e-9;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const money = (n: number) => `$${n < 1 ? n.toFixed(3).replace(/0$/, "") : n.toFixed(2)}`;
export const spentOf = (e: Pick<SpendEntryRecord, "estUsd" | "actualUsd">) => e.actualUsd ?? e.estUsd;

export interface BudgetRefusal {
  /** account = a member's monthly allowance across all their projects (account-allowance.ts). */
  level: "run" | "project" | "account";
  limitUsd: number;
  spentUsd: number;
}

/** Would `estUsd` more break the run's or the project's budget? Pure. */
export function budgetCheck(estUsd: number, project: BudgetState, run: BudgetState | null): BudgetRefusal | null {
  if (run && run.budgetUsd != null && run.spentUsd + estUsd > run.budgetUsd + EPS) return { level: "run", limitUsd: run.budgetUsd, spentUsd: run.spentUsd };
  if (project.budgetUsd != null && project.spentUsd + estUsd > project.budgetUsd + EPS) return { level: "project", limitUsd: project.budgetUsd, spentUsd: project.spentUsd };
  return null;
}

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";

  static describe(scope: SpendScope, estimateUsd: number, refusal: BudgetRefusal): string {
    if (refusal.level === "account") {
      return (
        `Monthly allowance reached — refused before calling the provider: this ${scope.kind} call (est. ${money(estimateUsd)}) would bring your account to ` +
        `${money(refusal.spentUsd + estimateUsd)} of its ${money(refusal.limitUsd)} monthly AI allowance (${money(refusal.spentUsd)} used this month). ` +
        `Ask the workspace admin to raise it.`
      );
    }
    const who = refusal.level === "run" ? `run ${scope.runId}` : `project ${scope.projectId}`;
    return (
      `Budget exceeded — refused before calling the provider: this ${scope.kind} call (${scope.model}, est. ${money(estimateUsd)}) would bring ${who} to ` +
      `${money(refusal.spentUsd + estimateUsd)} of its approved ${money(refusal.limitUsd)} (${money(refusal.spentUsd)} already spent or reserved). ` +
      `Raise the budget with the operator action set-budget (after the owner approves), or stop here.`
    );
  }

  constructor(
    readonly scope: SpendScope,
    readonly estimateUsd: number,
    readonly refusal: BudgetRefusal
  ) {
    super(BudgetExceededError.describe(scope, estimateUsd, refusal));
    this.name = "BudgetExceededError";
  }
}

export function isBudgetExceeded(err: unknown): err is BudgetExceededError {
  return err instanceof BudgetExceededError || (err as { code?: string } | null)?.code === "BUDGET_EXCEEDED";
}

/**
 * A request the provider rejected before doing any work (4xx other than 408, a missing key) is not
 * billed; timeouts, 5xx and download failures are unknown, so their reservation stays at the estimate.
 */
export function isUnbilledError(err: unknown): boolean {
  if (isBudgetExceeded(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/download|timeout|timed out|aborted/i.test(msg)) return false;
  return /\b4(0[0-79]|[1-9]\d)\b/.test(msg) || /not configured/i.test(msg);
}

/** In-memory ledger (tests, scripts). Reservation is synchronous, so concurrent calls can't over-commit. */
export class MemorySpendLedger implements SpendLedger {
  private rows: SpendEntryRecord[] = [];
  private projectBudgets = new Map<string, number>();
  private runBudgets = new Map<string, number>();
  private n = 0;

  private spent(projectId: string, runId?: string | null): number {
    return this.rows.filter((e) => e.projectId === projectId && (runId === undefined || e.runId === runId)).reduce((s, e) => s + spentOf(e), 0);
  }

  async budgets(projectId: string, runId?: string | null) {
    return {
      project: { budgetUsd: this.projectBudgets.get(projectId) ?? null, spentUsd: round(this.spent(projectId)) },
      run: runId ? { budgetUsd: this.runBudgets.get(runId) ?? null, spentUsd: round(this.spent(projectId, runId)) } : null,
    };
  }

  async reserve(scope: SpendScope, estUsd: number): Promise<SpendReservation> {
    const project = { budgetUsd: this.projectBudgets.get(scope.projectId) ?? null, spentUsd: this.spent(scope.projectId) };
    const run = scope.runId ? { budgetUsd: this.runBudgets.get(scope.runId) ?? null, spentUsd: this.spent(scope.projectId, scope.runId) } : null;
    const refusal = budgetCheck(estUsd, project, run);
    if (refusal) throw new BudgetExceededError(scope, estUsd, refusal);
    const row: SpendEntryRecord = { id: `mem-${++this.n}`, projectId: scope.projectId, runId: scope.runId ?? null, jobId: scope.jobId ?? null, kind: scope.kind, model: scope.model, estUsd, actualUsd: null, createdAt: new Date() };
    this.rows.push(row);
    return { id: row.id, estUsd };
  }

  async settle(entryId: string, actualUsd: number) {
    const row = this.rows.find((e) => e.id === entryId);
    if (row) row.actualUsd = round(actualUsd);
  }

  async openEntryForJob(jobId: string, kind: SpendKind) {
    const row = [...this.rows].reverse().find((e) => e.jobId === jobId && e.kind === kind && e.actualUsd === null);
    return row ? { id: row.id, estUsd: row.estUsd } : null;
  }

  async setBudget(target: { projectId: string; runId?: string | null }, usd: number | null) {
    const map = target.runId ? this.runBudgets : this.projectBudgets;
    const key = target.runId ?? target.projectId;
    if (usd == null) map.delete(key);
    else map.set(key, usd);
  }

  async entries(filter: { projectId: string; runId?: string | null; since?: Date }) {
    return this.rows
      .filter((e) => e.projectId === filter.projectId && (!filter.runId || e.runId === filter.runId) && (!filter.since || e.createdAt >= filter.since))
      .map((e) => ({ ...e }));
  }
}

let _ledger: SpendLedger | null = null;

/** Swap the ledger (tests, scripts). null restores the default. */
export function setSpendLedger(ledger: SpendLedger | null): void {
  _ledger = ledger;
}

export async function spendLedger(): Promise<SpendLedger> {
  if (_ledger) return _ledger;
  // Unit tests never reach the database: an empty in-memory ledger (no budgets) unless a test injects one.
  if (process.env.VITEST) return (_ledger = new MemorySpendLedger());
  const { PrismaSpendLedger } = await import("./spend-ledger-prisma");
  return (_ledger = new PrismaSpendLedger());
}

export function guardDisabled(): boolean {
  return process.env.SPEND_GUARD === "off";
}

/** Reserve `estUsd` for this call or refuse. A free call (estimate 0) records nothing and returns null. */
/** Token-billed calls (thinking models) vary most; images and clips are near-flat per call. */
export function reserveHeadroom(kind: SpendScope["kind"] | undefined): number {
  return kind === "vision_qc" || kind === "llm" ? 1.5 : 1.05;
}

export async function chargeOrRefuse(scope: SpendScope, estUsd: number, ledger?: SpendLedger): Promise<SpendReservation | null> {
  if (!(estUsd > 0) || guardDisabled()) return null;
  // Reserve with headroom so reconciling to the provider's bill can't push the total past the cap
  // (the first live run settled vision QC at 3.2× its estimate and ended $0.03 over a $2 budget).
  return (ledger ?? (await spendLedger())).reserve(scope, round(estUsd * reserveHeadroom(scope.kind)));
}

/** What the captured usage rows cost: the provider's reported cost, else tokens / images / seconds at table price. */
export function costOfUsage(entries: AiUsageEntry[], table: PriceTable = DEFAULT_PRICES): number | null {
  if (!entries.length) return null;
  let total = 0;
  for (const e of entries) {
    if (typeof e.costUsd === "number" && Number.isFinite(e.costUsd)) total += e.costUsd;
    else if (e.capability === "image") total += (imageCostUsd(table, e.model).usd ?? 0) * Math.max(1, e.images ?? 1);
    else if (e.capability === "video") total += videoCostUsd(table, e.model, e.videoSeconds ?? 5).usd ?? 0;
    else total += llmCostUsd(table, e.model, e.inputTokens ?? 0, e.outputTokens ?? 0).usd ?? 0;
  }
  return round(total);
}

export interface GuardOptions<T> {
  ledger?: SpendLedger;
  prices?: PriceTable;
  /** The actual cost read off the result, when the call returns it. */
  actual?: (result: T) => number | null | undefined;
  /** "later": an async job (clip) whose cost arrives with its poll — leave the reservation open. */
  settle?: "now" | "later";
}

/** Reserve → call (with usage capture) → reconcile. The one wrapper every paid call site uses. */
export async function withSpendGuard<T>(scope: SpendScope, estUsd: number, call: () => Promise<T>, opts: GuardOptions<T> = {}): Promise<T> {
  const ledger = opts.ledger ?? (await spendLedger());
  const res = await chargeOrRefuse(scope, estUsd, ledger);
  if (!res) return call();
  const usage: AiUsageEntry[] = [];
  let result: T;
  try {
    result = await captureAiUsage(usage, call);
  } catch (err) {
    const spent = costOfUsage(usage, opts.prices);
    // Paid work done before the failure (an image generated, then its upload failed) is still spend.
    if (spent !== null) await ledger.settle(res.id, spent).catch(() => {});
    else if (isUnbilledError(err)) await ledger.settle(res.id, 0).catch(() => {});
    throw err;
  }
  const actual = opts.actual?.(result) ?? costOfUsage(usage, opts.prices);
  if (actual != null) await ledger.settle(res.id, actual).catch(() => {});
  else if (opts.settle !== "later") await ledger.settle(res.id, round(estUsd)).catch(() => {});
  return result;
}

/**
 * Reconcile a job's open reservation (a clip) with the usage logged while `call` ran (its poll).
 * `done` = the provider settled the job; without a reported cost it is settled at the estimate, or at
 * $0 when `unbilled` says the provider did not bill it (a failed generation).
 */
export async function settleOpenJob<T>(
  projectId: string | null | undefined,
  jobId: string,
  kind: SpendKind,
  call: () => Promise<T>,
  opts: { ledger?: SpendLedger; prices?: PriceTable; done?: (r: T) => boolean; unbilled?: (r: T) => boolean } = {}
): Promise<T> {
  if (!projectId || guardDisabled()) return call();
  const usage: AiUsageEntry[] = [];
  const result = await captureAiUsage(usage, call);
  const actual = costOfUsage(usage, opts.prices);
  if (actual != null || opts.done?.(result)) {
    const ledger = opts.ledger ?? (await spendLedger());
    const open = await ledger.openEntryForJob(jobId, kind).catch(() => null);
    if (open) await ledger.settle(open.id, actual ?? (opts.unbilled?.(result) ? 0 : open.estUsd)).catch(() => {});
  }
  return result;
}

// ─── reporting ───────────────────────────────────────────────────────────────

export interface SpendBucket {
  key: string;
  calls: number;
  usd: number;
  estUsd: number;
}
export interface SpendSummary {
  totalUsd: number;
  /** Part of totalUsd still at its estimate (reservations not reconciled yet). */
  openReservedUsd: number;
  calls: number;
  byKind: SpendBucket[];
  byModel: SpendBucket[];
  byRun: SpendBucket[];
  projectBudgetUsd: number | null;
  remainingUsd: number | null;
}

export function summarizeSpend(entries: SpendEntryRecord[], budget: { projectBudgetUsd?: number | null } = {}): SpendSummary {
  const bucket = (key: (e: SpendEntryRecord) => string) => {
    const m = new Map<string, SpendBucket>();
    for (const e of entries) {
      const k = key(e);
      const b = m.get(k) ?? { key: k, calls: 0, usd: 0, estUsd: 0 };
      b.calls++;
      b.usd = round(b.usd + spentOf(e));
      b.estUsd = round(b.estUsd + e.estUsd);
      m.set(k, b);
    }
    return [...m.values()].sort((a, b) => b.usd - a.usd);
  };
  const totalUsd = round(entries.reduce((s, e) => s + spentOf(e), 0));
  const projectBudgetUsd = budget.projectBudgetUsd ?? null;
  return {
    totalUsd,
    openReservedUsd: round(entries.filter((e) => e.actualUsd === null).reduce((s, e) => s + e.estUsd, 0)),
    calls: entries.length,
    byKind: bucket((e) => e.kind),
    byModel: bucket((e) => e.model),
    byRun: bucket((e) => e.runId ?? "(no run)"),
    projectBudgetUsd,
    remainingUsd: projectBudgetUsd == null ? null : round(projectBudgetUsd - totalUsd),
  };
}
