/**
 * Brain-started Ad Studio batch: when a project's storyboard is ready (Studio step) but nothing has been produced, the
 * brain starts ONE variant itself instead of waiting (design §3 "never idle on our own work"). Nothing is spent here: the
 * Mac worker plans it and stops at the spend gate, where the brain's caps ($3/run, $20/day) or a person decide.
 */
export const BRAIN_BATCH = { hookTypes: ["keep"], engines: ["seedance2fast"], visualMode: "video", openingId: "auto", endCardId: "auto" } as const;
export const BRAIN_BATCH_COOLDOWN_MS = 24 * 3_600_000;

export interface BatchFacts {
  storyboards: { id: string; frames: unknown; createdAt: Date }[];
  runs: { status: string; createdAt: Date }[];
  productUrl: string | null;
}

/** pure: which storyboard to use, or why not */
export function pickBatch(f: BatchFacts, now = Date.now()): { ok: true; storyboardId: string } | { ok: false; reason: string } {
  if (!f.productUrl) return { ok: false, reason: "no product page URL (Setup)" };
  if (f.runs.some((r) => ["queued", "planning", "awaiting_approval", "approved", "generating"].includes(r.status))) return { ok: false, reason: "a run is already in progress" };
  if (f.runs.some((r) => now - new Date(r.createdAt).getTime() < BRAIN_BATCH_COOLDOWN_MS)) return { ok: false, reason: "a batch was started in the last 24 h" };
  const sb = [...f.storyboards].filter((s) => Array.isArray(s.frames) && s.frames.length > 0).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!sb) return { ok: false, reason: "no storyboard with frames" };
  return { ok: true, storyboardId: sb.id };
}
