/**
 * URL-to-Video Autopilot — contract shared by the state machine (engine.ts), its stores and the
 * default step functions (steps.ts). One AutopilotRun row per call; `state` keeps every id a step
 * produced so a re-run step reuses it instead of creating a second storyboard or run.
 */

export const AUTOPILOT_STEPS = [
  "scrape",
  "brief",
  "plan",
  "storyboard",
  "estimate",
  "await_budget",
  "compile",
  "approve",
  "render",
  "preflight",
  "report",
] as const;

export type AutopilotStepName = (typeof AUTOPILOT_STEPS)[number];
export type AutopilotStep = AutopilotStepName | "done";
export type AutopilotStatus = "running" | "awaiting_approval" | "completed" | "failed";

export interface AutopilotPromo {
  pct?: number | null;
  price?: number | null;
  comparePrice?: number | null;
  priceCheckedAt?: string | null;
  code?: string | null;
  deadline?: string | null;
}

export interface AutopilotInput {
  url?: string;
  projectId?: string;
  platforms?: string[];
  /** The platform whose script becomes the storyboard (default: the first planned platform). */
  platform?: string;
  goal?: string;
  promo?: AutopilotPromo;
  hookId?: string;
  cast?: string;
  setting?: string;
  ctaButton?: string;
  /** Owner-approved USD for this run. The render waits for approval when the forecast's high total is above it. */
  approvedBudgetUsd?: number;
  imageModel?: string;
  videoModel?: string;
  engine?: "kling" | "veo" | "veo1080";
  /** Client report summary: "template" (default, no model call) or "llm". */
  narrative?: "llm" | "template";
}

export interface AutopilotForecast {
  lowUsd: number;
  expectedUsd: number;
  highUsd: number;
  recommendedBudgetUsd: number;
  source: "storyboard" | "run";
}

export interface AutopilotAwaiting {
  reason: string;
  forecastHighUsd: number;
  recommendedBudgetUsd: number;
  approvedBudgetUsd: number | null;
}

export interface AutopilotLogEntry {
  at: string;
  step: AutopilotStep;
  event: "done" | "wait" | "await_approval" | "error" | "approved" | "retry";
  note?: string;
}

export interface AutopilotState {
  projectId?: string;
  /** Id reserved before the project is created, so a retried scrape finds it instead of creating another. */
  pendingProjectId?: string;
  storyboardId?: string;
  pendingStoryboardId?: string;
  runId?: string;
  platform?: string;
  hookId?: string;
  scrape?: { adapter: string | null; title: string | null; imageCount: number; price: number | null; reused?: boolean };
  briefSellingPoints?: number;
  plannedPlatforms?: string[];
  forecast?: AutopilotForecast;
  /** The owner's approved USD (from the start call or autopilot-approve); never raised by the autopilot. */
  approvedBudgetUsd?: number | null;
  awaiting?: AutopilotAwaiting | null;
  renderStartedAt?: string;
  masterUrl?: string | null;
  preflight?: { status: "scored" | "skipped"; score?: number | null; note?: string };
  report?: { htmlUrl?: string; docxUrl?: string; skipped?: string };
  /** Failed attempts per step (cap: MAX_STEP_ATTEMPTS). */
  attempts?: Partial<Record<AutopilotStepName, number>>;
  log?: AutopilotLogEntry[];
}

export interface AutopilotRecord {
  id: string;
  projectId: string | null;
  status: AutopilotStatus;
  step: AutopilotStep;
  input: AutopilotInput;
  state: AutopilotState;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AutopilotPatch = Partial<Pick<AutopilotRecord, "projectId" | "status" | "step" | "state" | "error">>;

/** Persistence for the state machine (Prisma in production, memory in tests). */
export interface AutopilotStore {
  create(data: { projectId: string | null; input: AutopilotInput; state: AutopilotState }): Promise<AutopilotRecord>;
  get(id: string): Promise<AutopilotRecord | null>;
  save(id: string, patch: AutopilotPatch): Promise<AutopilotRecord>;
  /** Take the tick lease (one tick per record at a time); false when another tick holds it. */
  claim(id: string, until: Date, now: Date): Promise<boolean>;
  release(id: string): Promise<void>;
  /** Running records not leased, oldest first (the cron sweep). */
  listRunnable(limit: number, now: Date): Promise<AutopilotRecord[]>;
}

export type StepOutcome =
  /** Step finished: move on. */
  | { kind: "done"; state?: AutopilotState; note?: string }
  /** Not finished yet (a render in progress): stop this tick, come back on the next one. */
  | { kind: "wait"; state?: AutopilotState; note?: string }
  /** Stop until the owner approves a budget (autopilot-approve); the same step re-runs then. */
  | { kind: "await_approval"; state?: AutopilotState; awaiting: AutopilotAwaiting; note?: string };

export interface StepContext {
  id: string;
  input: AutopilotInput;
  /** Current state (read-only snapshot; return changes in the outcome). */
  state: AutopilotState;
  /** Epoch ms by which this tick should be finished. */
  deadline: number;
  now: () => number;
  /** Persist part of the state mid-step (reserve an id before creating the row it names). */
  save: (patch: AutopilotState) => Promise<void>;
}

export type StepFn = (ctx: StepContext) => Promise<StepOutcome>;

/** await_budget defaults to the built-in gate (engine.budgetGate). */
export type AutopilotSteps = Record<Exclude<AutopilotStepName, "await_budget">, StepFn> & { await_budget?: StepFn };

/** A step error that retrying cannot fix (missing packshot, LibTV run, failed render): fail now. */
export class AutopilotFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutopilotFatalError";
  }
}
