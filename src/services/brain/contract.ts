/**
 * Video Brain — shared contract between the Mac brain daemon (workers/video-brain), the API (/api/worker/brain,
 * /api/brain) and the /brain page. Design: ad-studio-20261104/docs/VIDEO-BRAIN-ARCHITECTURE-20261117.md.
 *
 * Storage: AppSetting rows (no schema change; a production migration needs Barron's OK):
 *   brain:snapshot   BrainSnapshot (the page's single read)
 *   brain:events     BrainEvent[]  (ring, newest first, MAX_EVENTS)
 *   brain:learnings  BrainLearning[]
 *   brain:policy     BrainPolicy
 */

export const BRAIN_KEYS = {
  snapshot: "brain:snapshot",
  events: "brain:events",
  learnings: "brain:learnings",
  policy: "brain:policy",
} as const;

export const MAX_EVENTS = 300;
export const MAX_LEARNINGS = 400;
export const SNAPSHOT_MAX_BYTES = 900_000;

/** The 7 loop stages (design §2). */
export const LOOP_STAGES = ["strategy", "project", "gate", "execute", "verify", "recover", "learn"] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

/** Project lifecycle steps in Xark (project-stages.ts ids + produce/measure). */
export const PROJECT_STEPS = ["setup", "research", "insights", "creative", "studio", "produce", "deliver", "measure"] as const;
export type ProjectStep = (typeof PROJECT_STEPS)[number];

/** The only waits allowed (design §3): a client, ad data maturing, or spend above the autonomy cap.
 *  Labels of a refused auto-approval: "estimate" (stale estimate: free re-plan) and "funds" (provider budget out). */
export type WaitingOn = "client" | "ad-data" | "budget" | "estimate" | "funds" | null;
export type LoopStatus = "active" | "waiting" | "blocked" | "idle-defect" | "done";

export interface BrainLoop {
  projectId: string;
  name: string;
  brand: string | null;
  step: ProjectStep;
  stage: LoopStage;
  status: LoopStatus;
  agent: string; // who owns the next action
  doing: string; // one line: what the brain does / will do now
  nextAction: string;
  nextCheckpointAt: string; // ISO
  verifyHow: string;
  waitingOn: WaitingOn;
  idleSince: string | null; // set when nothing moved and no legal wait applies
  runs: { active: number; awaiting: number; done: number; failed: number };
  spendUsd7d: number;
  lastActivityAt: string | null;
}

export type TaskStatus = "queued" | "gated" | "ready" | "running" | "verifying" | "done" | "failed" | "retrying";
export interface GateResult { gate: string; pass: boolean; detail: string }
export interface BrainTask {
  id: string; // usually the AdStudioRun id
  projectId: string;
  kind: "generate" | "plan" | "verify" | "followup" | "fix" | "probe";
  title: string;
  status: TaskStatus;
  step: string | null;
  progress: number;
  estUsd: number;
  actualUsd: number | null;
  gates: GateResult[];
  agent: string;
  updatedAt: string;
}

export interface BrainCheck {
  runId: string;
  projectId: string;
  at: string;
  pass: boolean;
  fields: { field: string; expected: string; actual: string; pass: boolean; source: string }[];
}

export interface BrainIncident {
  signature: string;
  kind: "code" | "config" | "model" | "platform" | "human" | "data";
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: "open" | "resolved" | "reopened";
  runbook: string;
  sample: string;
  runs: string[];
}

export interface BrainProbe { name: string; ok: boolean; detail: string; at: string }

export interface BrainEvent {
  at: string;
  agent: string;
  kind: "think" | "decide" | "call" | "check" | "learn" | "fix" | "wait";
  projectId?: string | null;
  summary: string;
  ref?: string | null;
}

export interface BrainLearning {
  id: string;
  at: string;
  who: string;
  scope: string; // global | model:<id> | category:<x> | brand:<x> | pipeline:<step>
  rule: string;
  evidence: string[];
  status: "candidate" | "confirmed" | "promoted" | "retired";
  promotedTo?: string | null;
  syncedTo?: string[];
}

export interface PatternHit { pattern: string; fixedIn: string; file: string; line: number; status: "open" | "fixed" }

export interface BrainPolicy {
  autoApprove: boolean;
  maxRunUsd: number;
  maxDayUsd: number;
  maxRunAgeH: number;
}
export const DEFAULT_POLICY: BrainPolicy = { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };

export interface BrainSnapshot {
  v: 1;
  at: string;
  tickMs: number;
  host: string;
  stageCounts: Record<LoopStage, number>;
  spend: { todayUsd: number; capUsd: number; autoApprovedTodayUsd: number };
  worker: { lastSeenAt: string | null; ok: boolean };
  loops: BrainLoop[];
  queue: BrainTask[];
  executing: BrainTask[];
  checks: BrainCheck[];
  recovery: BrainTask[];
  incidents: BrainIncident[];
  probes: BrainProbe[];
  patterns: PatternHit[];
  learnings: BrainLearning[];
  events: BrainEvent[];
}

/** The page's view: snapshot + age. */
export interface BrainView { snapshot: BrainSnapshot | null; ageSec: number | null; stale: boolean }
export const STALE_AFTER_SEC = 15 * 60;
