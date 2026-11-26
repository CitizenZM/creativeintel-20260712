/** Pure helpers for the Video Brain board (sorting, labels, relative time). Tested in brain-format.test.ts. */
import type {
  BrainEvent, BrainLearning, BrainLoop, BrainView, LoopStage, LoopStatus, PatternHit, ProjectStep, TaskStatus,
} from "@/services/brain/contract";

export type Tone = "healthy" | "attention" | "urgent" | "ai" | "muted";

export const TONE_CLASS: Record<Tone, string> = {
  healthy: "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
  attention: "bg-[var(--status-attention-bg)] text-[var(--status-attention-fg)]",
  urgent: "bg-[var(--status-urgent-bg)] text-[var(--status-urgent-fg)]",
  ai: "bg-[var(--status-ai-bg)] text-[var(--status-ai-fg)]",
  muted: "bg-muted text-muted-foreground",
};

export const STAGE_LABEL: Record<LoopStage, string> = {
  strategy: "策略 Strategy",
  project: "项目循环 Project",
  gate: "闸栏 Gate",
  execute: "执行 Execute",
  verify: "二次复查 Verify",
  recover: "恢复跟进 Recover",
  learn: "学习 Learn",
};

export const STEP_LABEL: Record<ProjectStep, string> = {
  setup: "设定 Setup",
  research: "调研 Research",
  insights: "洞察 Insights",
  creative: "创意 Creative",
  studio: "工作室 Studio",
  produce: "制作 Produce",
  deliver: "交付 Deliver",
  measure: "衡量 Measure",
};

export const LOOP_STATUS_LABEL: Record<LoopStatus, string> = {
  active: "进行中 active",
  waiting: "等待 waiting",
  blocked: "阻塞 blocked",
  "idle-defect": "空转缺陷 idle",
  done: "完成 done",
};

export function loopTone(status: LoopStatus): Tone {
  switch (status) {
    case "active": return "healthy";
    case "waiting": return "attention";
    case "blocked":
    case "idle-defect": return "urgent";
    case "done": return "muted";
  }
}

export function taskTone(status: TaskStatus): Tone {
  switch (status) {
    case "done": return "healthy";
    case "failed": return "urgent";
    case "retrying":
    case "gated": return "attention";
    case "running":
    case "verifying": return "ai";
    default: return "muted";
  }
}

const LOOP_ORDER: Record<LoopStatus, number> = { "idle-defect": 0, blocked: 1, active: 2, waiting: 3, done: 4 };

/** idle-defect, blocked, active, waiting, done; ties: soonest checkpoint first, then name. */
export function sortLoops(loops: readonly BrainLoop[]): BrainLoop[] {
  return [...loops].sort(
    (a, b) =>
      LOOP_ORDER[a.status] - LOOP_ORDER[b.status] ||
      (Date.parse(a.nextCheckpointAt) || Infinity) - (Date.parse(b.nextCheckpointAt) || Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** newest first */
export function sortEvents(events: readonly BrainEvent[]): BrainEvent[] {
  return [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** "in 5m" / "3h ago" / "now". */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "now";
  const span = abs < 3600 ? `${Math.round(abs / 60)}m` : abs < 86_400 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86_400)}d`;
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

/** seconds → "42s" / "7m" / "3h" / "2d"; null → "—". */
export function ageLabel(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return "—";
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86_400)}d`;
}

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 10 ? 2 : 0)}`;
}

/** 0..100 for a progress bar; accepts 0..1 or 0..100. */
export function pct(progress: number): number {
  const p = progress <= 1 ? progress * 100 : progress;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/** The banner the page shows when the brain is not reporting, or null when it is fresh. */
export function staleMessage(view: BrainView | null): string | null {
  if (!view || !view.snapshot) return "大脑未在运行 / brain not reporting — no snapshot yet";
  if (view.stale) return `大脑未在运行 / brain not reporting — last snapshot ${ageLabel(view.ageSec)} ago`;
  return null;
}

export interface PatternGroup { pattern: string; open: number; fixed: number; hits: PatternHit[] }

/** grouped by pattern; groups with open hits first, then by size. */
export function groupPatterns(hits: readonly PatternHit[]): PatternGroup[] {
  const by = new Map<string, PatternGroup>();
  for (const h of hits) {
    const g = by.get(h.pattern) ?? { pattern: h.pattern, open: 0, fixed: 0, hits: [] };
    g[h.status] += 1;
    g.hits.push(h);
    by.set(h.pattern, g);
  }
  return [...by.values()].sort((a, b) => b.open - a.open || b.hits.length - a.hits.length || a.pattern.localeCompare(b.pattern));
}

export function learningTone(status: BrainLearning["status"]): Tone {
  switch (status) {
    case "promoted": return "healthy";
    case "confirmed": return "ai";
    case "candidate": return "attention";
    case "retired": return "muted";
  }
}

export const EVENT_TONE: Record<BrainEvent["kind"], Tone> = {
  think: "muted",
  decide: "ai",
  call: "ai",
  check: "healthy",
  learn: "healthy",
  fix: "attention",
  wait: "attention",
};

/** the project page of a loop; local/batch loops have none (render them as plain text) */
export function projectHref(projectId: string): string | null {
  return /^(local|batch):/.test(projectId) ? null : `/projects/${projectId}`;
}

/** a check row's project: its loop name (else the id) and a project link only for server cuids (same rule as the digest) */
export function checkProject(projectId: string, loops: readonly Pick<BrainLoop, "projectId" | "name">[]): { name: string; href: string | null } {
  const name = loops.find((l) => l.projectId === projectId)?.name || projectId || "—";
  return { name, href: /^c[a-z0-9]{20,30}$/.test(projectId) ? projectHref(projectId) : null };
}
