/**
 * Pure view-model helpers for the Planning tab: normalise the stored sp-1 brief for display, summarise a
 * platform profile, filter the hook library, merge user-pinned hooks with the auto picks, lay out a beat
 * timeline and turn an end-card layout string into boxes for the 9:16 mock. No React, no I/O — tested in
 * view-model.test.ts against the real library data and fixtures.
 */
import type { BeatPurpose, PlanBeat } from "@/services/creative/campaign-plan.types";
import type { CampaignGoal, CreativeChoice, EndCardId, HookDef, HookFamily, PlatformId, PlatformProfile } from "@/services/creative/types";

// ── Labels ──────────────────────────────────────────────────────────────────────────────────────────

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  tiktok: "TikTok",
  instagram_reels: "Instagram Reels",
  instagram_stories: "Instagram Stories",
  meta_feed: "Meta Feed",
  facebook_reels: "Facebook Reels",
  youtube_shorts: "YouTube Shorts",
  youtube_instream_skippable: "YouTube In-stream (skippable)",
  youtube_instream_nonskippable_15s: "YouTube In-stream 15s",
  youtube_bumper_6s: "YouTube Bumper 6s",
  google_demand_gen: "Google Demand Gen",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
};

export const GOALS: { id: CampaignGoal; label: string; hint: string }[] = [
  { id: "cold", label: "Cold purchase", hint: "New audiences — prove the #1 selling point fast" },
  { id: "retarget", label: "Retarget", hint: "Warm viewers — handle objections, show the deal" },
  { id: "promo", label: "Promo / sale", hint: "A live discount, code or deadline drives the close" },
  { id: "awareness", label: "Awareness", hint: "Memorable reveal + brand lockup, no hard sell" },
  { id: "app_install", label: "App install", hint: "Store badges + rating close" },
  { id: "lead", label: "Lead gen", hint: "Sign-up / learn-more close" },
];

export const HOOK_FAMILIES: HookFamily[] = ["reveal", "claim", "native", "demo"];

export const FAMILY_LABEL: Record<HookFamily, string> = {
  reveal: "Reveal",
  claim: "Claim / text",
  native: "Native / creator",
  demo: "Demo",
};

export const PURPOSE_STYLE: Record<BeatPurpose, { label: string; bar: string }> = {
  hook: { label: "Hook", bar: "bg-violet-500" },
  pitch: { label: "Pitch", bar: "bg-sky-500" },
  proof: { label: "Proof", bar: "bg-emerald-500" },
  benefit: { label: "Benefit", bar: "bg-teal-500" },
  objection: { label: "Objection", bar: "bg-amber-500" },
  offer: { label: "Offer", bar: "bg-rose-500" },
  cta: { label: "CTA", bar: "bg-fuchsia-600" },
};

// ── Product brief ───────────────────────────────────────────────────────────────────────────────────

/** Loose shape of a stored brief — tolerate older or partial rows instead of crashing the page. */
export interface StoredBrief {
  product?: { name?: string; brand?: string; model?: string; price?: number };
  category?: string;
  audience?: { primary?: string; secondary?: string[]; awarenessStage?: string };
  primaryJob?: { statement?: string };
  bigIdea?: { proposition?: string; alternates?: string[] };
  sellingPoints?: {
    id?: string;
    claim?: string;
    benefit?: string;
    proofVisual?: { shot?: string; overlayText?: string; device?: string };
    priority?: number;
    priorityScore?: number;
    evidenceStrength?: string;
    scores?: Record<string, number | undefined>;
  }[];
  objections?: { objection?: string; answer?: string; bustingVisual?: string }[];
  keywords?: { term?: string; type?: string; score?: number; placement?: string[] }[];
  gaps?: string[];
}

export interface BriefPointView {
  id: string;
  rank: number;
  claim: string;
  benefit: string;
  proofShot: string;
  overlayText?: string;
  device?: string;
  evidence?: string;
  /** 0–100 for the score bar. */
  scorePct: number;
}

export interface BriefView {
  productName: string;
  category: string;
  bigIdea: string;
  alternates: string[];
  audiencePrimary: string;
  audienceSecondary: string[];
  awareness?: string;
  primaryJob?: string;
  points: BriefPointView[];
  objections: { objection: string; answer?: string; bustingVisual: string }[];
  keywordGroups: { placement: string; terms: string[] }[];
  gaps: string[];
}

const PLACEMENT_ORDER = ["hook_text", "voiceover", "caption", "hashtag", "seo", "other"];
export const PLACEMENT_LABEL: Record<string, string> = {
  hook_text: "Hook text",
  voiceover: "Voice-over",
  caption: "Caption",
  hashtag: "Hashtags",
  seo: "SEO / search",
  other: "Other",
};

/** Group keyword terms by placement (a term can sit in several groups); "vo" folds into "voiceover". */
export function groupKeywordsByPlacement(keywords: StoredBrief["keywords"] = []): { placement: string; terms: string[] }[] {
  const groups = new Map<string, string[]>();
  const sorted = [...keywords].filter((k) => k.term?.trim()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const k of sorted) {
    const term = k.term!.trim();
    const places = k.placement?.length ? k.placement : ["other"];
    for (const raw of places) {
      const p = raw === "vo" ? "voiceover" : PLACEMENT_LABEL[raw] ? raw : "other";
      const list = groups.get(p) ?? [];
      if (!list.includes(term)) list.push(term);
      groups.set(p, list);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => PLACEMENT_ORDER.indexOf(a) - PLACEMENT_ORDER.indexOf(b))
    .map(([placement, terms]) => ({ placement, terms }));
}

const SCORE_WEIGHTS: Record<string, number> = { buyerImportance: 0.3, evidenceStrength: 0.25, differentiation: 0.2, visualizability: 0.15, emotionalPull: 0.1 };

function fallbackScore(scores: Record<string, number | undefined> = {}): number {
  return Object.entries(SCORE_WEIGHTS).reduce((sum, [k, w]) => sum + w * (scores[k] ?? 0.5), 0);
}

export function briefView(brief: StoredBrief | null | undefined): BriefView | null {
  if (!brief || typeof brief !== "object") return null;
  const raw = (brief.sellingPoints ?? []).filter((p) => p.claim?.trim());
  const withScore = raw.map((p) => ({ p, score: typeof p.priorityScore === "number" ? p.priorityScore : fallbackScore(p.scores) }));
  // Stored briefs are already ranked; respect `priority` when present, else score.
  withScore.sort((a, b) => (a.p.priority ?? 99) - (b.p.priority ?? 99) || b.score - a.score);
  const points: BriefPointView[] = withScore.map(({ p, score }, i) => ({
    id: p.id || `sp${i + 1}`,
    rank: i + 1,
    claim: p.claim!.trim(),
    benefit: p.benefit?.trim() ?? "",
    proofShot: p.proofVisual?.shot?.trim() ?? "",
    overlayText: p.proofVisual?.overlayText?.trim() || undefined,
    device: p.proofVisual?.device?.trim() || undefined,
    evidence: p.evidenceStrength,
    scorePct: Math.max(0, Math.min(100, Math.round(score * 100))),
  }));
  return {
    productName: [brief.product?.brand, brief.product?.name].filter(Boolean).join(" ") || "Product",
    category: brief.category ?? "other",
    bigIdea: brief.bigIdea?.proposition?.trim() ?? "",
    alternates: (brief.bigIdea?.alternates ?? []).filter((s) => s?.trim()),
    audiencePrimary: brief.audience?.primary ?? "",
    audienceSecondary: brief.audience?.secondary ?? [],
    awareness: brief.audience?.awarenessStage,
    primaryJob: brief.primaryJob?.statement || undefined,
    points,
    objections: (brief.objections ?? [])
      .filter((o) => o.objection?.trim())
      .map((o) => ({ objection: o.objection!.trim(), answer: o.answer?.trim() || undefined, bustingVisual: o.bustingVisual?.trim() ?? "" })),
    keywordGroups: groupKeywordsByPlacement(brief.keywords),
    gaps: (brief.gaps ?? []).filter((g) => g?.trim()),
  };
}

// ── Platform profile ────────────────────────────────────────────────────────────────────────────────

export interface ProfileSummary {
  id: PlatformId;
  label: string;
  rows: { label: string; value: string }[];
  dos: string[];
  donts: string[];
}

const fmtAspect = (a: string | string[]) => (Array.isArray(a) ? a.join(" / ") : a);

export function profileSummary(p: PlatformProfile): ProfileSummary {
  const sz = p.safeZone;
  return {
    id: p.id,
    label: PLATFORM_LABELS[p.id] ?? p.id,
    rows: [
      { label: "Audience", value: `${p.audience.ageCore} · ${p.audience.genderSkew}` },
      { label: "Mindset", value: p.audience.mindset },
      { label: "Tone", value: p.audience.tone },
      { label: "Duration", value: `ideal ${p.durationSec.ideal}s (${p.durationSec.range[0]}–${p.durationSec.range[1]}s, max ${p.durationSec.max}s)` },
      { label: "Aspect", value: fmtAspect(p.aspect) },
      { label: "Hook by", value: `${p.hookSec}s` },
      { label: "Pacing", value: `${p.cutsPerSec.first6s} cuts/s first 6s · ${p.cutsPerSec.body} cuts/s body` },
      { label: "Sound", value: p.soundMode === "off" ? "mostly sound-off" : p.soundMode === "on" ? "sound-on" : "mixed" },
      { label: "Voice-over", value: p.voiceTone },
      { label: "Captions", value: p.captionStyle },
      { label: "Music", value: p.musicStyle },
      { label: "CTA", value: p.ctaStyle },
      { label: "Branding", value: p.branding },
      { label: "Safe zone", value: `top ${sz.top} · bottom ${sz.bottom} · left ${sz.left} · right ${sz.right} px${sz.note ? ` — ${sz.note}` : ""}` },
    ],
    dos: p.styleTags,
    donts: p.doNots,
  };
}

// ── Hook library ────────────────────────────────────────────────────────────────────────────────────

export function filterHooks(hooks: HookDef[], family: HookFamily | "all", query = ""): HookDef[] {
  const q = query.trim().toLowerCase();
  return hooks.filter(
    (h) =>
      (family === "all" || h.family === family) &&
      (!q || [h.id, h.name, h.desc, h.categories, h.platforms, h.emotion].some((s) => s?.toLowerCase().includes(q)))
  );
}

export interface EffectivePick {
  hookId: string;
  source: "auto" | "pinned";
  score?: number;
  why: string[];
}

/**
 * Effective hooks for one platform: pinned hooks first (in pin order), then the auto picks that were not
 * pinned, capped at `max`. Unknown ids (when `known` is given) are dropped.
 */
export function mergePicks(auto: CreativeChoice["hooks"] | undefined, pinned: string[] = [], max = 3, known?: Set<string>): EffectivePick[] {
  const out: EffectivePick[] = [];
  for (const id of pinned) {
    if (out.length >= max) break;
    if (known && !known.has(id)) continue;
    if (out.some((x) => x.hookId === id)) continue;
    const a = auto?.find((x) => x.hook.id === id);
    out.push({ hookId: id, source: "pinned", score: a?.score, why: a ? ["pinned", ...a.why] : ["pinned by you"] });
  }
  for (const a of auto ?? []) {
    if (out.length >= max) break;
    if (out.some((x) => x.hookId === a.hook.id)) continue;
    out.push({ hookId: a.hook.id, source: "auto", score: a.score, why: a.why });
  }
  return out;
}

/** Toggle a pin (max `max`; pinning one more drops the oldest pin). */
export function togglePin(pins: string[], id: string, max = 3): string[] {
  if (pins.includes(id)) return pins.filter((p) => p !== id);
  const next = [...pins, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

// ── Beat timeline ───────────────────────────────────────────────────────────────────────────────────

export interface TimelineSegment extends PlanBeat {
  leftPct: number;
  widthPct: number;
}

export function timelineTotal(beats: PlanBeat[], durationSec?: number): number {
  const end = beats.reduce((m, b) => Math.max(m, b.t1), 0);
  return Math.max(end, durationSec ?? 0, 0.001);
}

const pct = (n: number) => Math.round(n * 10000) / 100;

export function beatTimeline(beats: PlanBeat[], durationSec?: number): TimelineSegment[] {
  const total = timelineTotal(beats, durationSec);
  return [...beats]
    .filter((b) => Number.isFinite(b.t0) && Number.isFinite(b.t1) && b.t1 > b.t0)
    .sort((a, b) => a.t0 - b.t0)
    .map((b) => ({ ...b, leftPct: pct(Math.max(0, b.t0) / total), widthPct: pct((Math.min(total, b.t1) - Math.max(0, b.t0)) / total) }));
}

export const fmtSec = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(1)}s`;

// ── End-card layout mock ────────────────────────────────────────────────────────────────────────────

export type LayoutKind = "logo" | "product" | "cta" | "text" | "accent";

export interface LayoutBox {
  label: string;
  kind: LayoutKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CANVAS = { w: 1080, h: 1920 } as const;
export const SAFE = { y0: 288, y1: 1220 } as const;

/** Split on " · " but not inside single-quoted copy ('4.6 · 12,480 reviews'). */
export function splitLayout(layout: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < layout.length; i++) {
    const ch = layout[i];
    if (ch === "'") {
      // An opening quote follows a space/start/"("; anything else (it's, don't) is an apostrophe.
      const prev = i === 0 ? " " : layout[i - 1];
      if (quoted || /[\s(]/.test(prev)) quoted = !quoted;
    }
    if (!quoted && ch === "·") {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function kindOf(label: string): LayoutKind {
  const l = label.toLowerCase();
  if (/logo|icon/.test(l)) return "logo";
  if (/pill|button|badges|arrow|cta/.test(l)) return "cta";
  if (/product|tile|qr/.test(l)) return "product";
  if (/starburst|ticket|chip|bar|tag|sticker|stars|quote|ribbon/.test(l)) return "accent";
  return "text";
}

function labelOf(seg: string): string {
  const quoted = seg.match(/^'([^']+)'/);
  if (quoted) return quoted[1];
  const words = seg.split(/\s+/);
  const stop = words.findIndex((w, i) => i > 0 && /^(\d|[xy]\d|at$|\(|\+|'|with$|—)/.test(w));
  const label = (stop === -1 ? words.slice(0, 3) : words.slice(0, stop)).join(" ");
  return label.replace(/[()]/g, "").trim() || seg.slice(0, 16);
}

/** Parse an END_CARDS layout string (1080×1920 coordinates) into drawable boxes. Segments without a y-range are skipped. */
export function parseEndCardLayout(layout: string): LayoutBox[] {
  const boxes: LayoutBox[] = [];
  for (const seg of splitLayout(layout)) {
    const at = seg.match(/at \((\d+),\s*(\d+)\)/);
    const size = seg.match(/(\d+)×(\d+)/);
    const yr = seg.match(/\by(\d+)[–-](\d+)/);
    const xr = seg.match(/\bx(\d+)[–-](\d+)/);
    const label = labelOf(seg);
    let x: number, y: number, w: number, h: number;
    if (at && size) {
      w = +size[1];
      h = +size[2];
      x = +at[1] - w / 2;
      y = +at[2] - h / 2;
    } else if (yr) {
      y = +yr[1];
      h = +yr[2] - y;
      if (xr) {
        x = +xr[1];
        w = +xr[2] - x;
      } else {
        // "icon 240 y320–560" gives a bare square size; logos default narrow, CTAs to the pill width.
        const square = seg.match(/^\S+\s+(\d{2,4})\s+y/);
        const kind = kindOf(label);
        w = size ? Math.min(+size[1], CANVAS.w) : square ? +square[1] : kind === "cta" ? 500 : kind === "logo" ? 360 : 720;
        x = (CANVAS.w - w) / 2;
      }
    } else continue;
    if (h <= 0 || w <= 0) continue;
    boxes.push({ label, kind: kindOf(label), x, y, w, h });
  }
  return boxes;
}

// ── Requests ────────────────────────────────────────────────────────────────────────────────────────

export interface PromoForm {
  pct: string;
  code: string;
  price: string;
  comparePrice: string;
  deadline: string;
}

export const EMPTY_PROMO: PromoForm = { pct: "", code: "", price: "", comparePrice: "", deadline: "" };

export interface PromoPayload {
  pct?: number;
  code?: string;
  price?: number;
  comparePrice?: number;
  deadline?: string;
}

const num = (s: string) => {
  const n = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Form strings → the promo object both endpoints accept; empty fields are omitted, undefined when nothing is set. */
export function promoPayload(f: PromoForm): PromoPayload | undefined {
  const out: PromoPayload = {};
  const p = num(f.pct);
  if (p !== undefined) out.pct = Math.min(95, Math.round(p));
  if (f.code.trim()) out.code = f.code.trim().slice(0, 40);
  const price = num(f.price);
  if (price !== undefined) out.price = price;
  const compare = num(f.comparePrice);
  if (compare !== undefined) out.comparePrice = compare;
  if (f.deadline.trim()) {
    const d = new Date(f.deadline);
    if (!Number.isNaN(d.getTime())) out.deadline = d.toISOString();
  }
  return Object.keys(out).length ? out : undefined;
}

export type PlanOverrides = Partial<Record<PlatformId, { hookIds?: string[]; endCardId?: EndCardId }>>;

export interface CampaignPlanRequest {
  platforms: PlatformId[];
  goal: CampaignGoal;
  promo?: PromoPayload;
  /** Optional user choices the planner may honour (pinned hooks, chosen end card). */
  overrides?: PlanOverrides;
}

export function buildPlanRequest(args: {
  platforms: PlatformId[];
  goal: CampaignGoal;
  promo: PromoForm;
  pins: Partial<Record<PlatformId, string[]>>;
  endCards: Partial<Record<PlatformId, EndCardId>>;
}): CampaignPlanRequest {
  const overrides: PlanOverrides = {};
  for (const p of args.platforms) {
    const hookIds = args.pins[p]?.length ? args.pins[p] : undefined;
    const endCardId = args.endCards[p];
    if (hookIds || endCardId) overrides[p] = { ...(hookIds ? { hookIds } : {}), ...(endCardId ? { endCardId } : {}) };
  }
  const promo = promoPayload(args.promo);
  return {
    platforms: args.platforms,
    goal: args.goal,
    ...(promo ? { promo } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
  };
}

/** Human message for a failed planner call; 404/405/501 mean the endpoint isn't deployed yet. */
export function planErrorMessage(status: number, body?: { error?: string } | null): string {
  // A real route answers 404 with a JSON error (e.g. project not found); a missing route has none.
  if ((status === 404 && !body?.error) || status === 405 || status === 501) return "Planner not deployed yet — your selections are kept; try again once it ships.";
  if (status === 409) return body?.error ?? "The planner needs a product brief first — generate the brief above.";
  return body?.error ?? `Planner failed (HTTP ${status}).`;
}
