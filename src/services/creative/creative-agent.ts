/**
 * Creative Agent — conversational edits to a stored campaign plan (and optionally a storyboard).
 *
 * One LLM call turns the instruction into a JSON list of edit operations from a closed set:
 *   swapHook(platform, hookId) · setEndCard(platform, endCardId, button?) ·
 *   editBeat(platform, scriptHookId, beatIndex, changes{vo?, onScreenText?, visual?, imagePrompt?, videoPrompt?}, target?) ·
 *   retime(platform, beatIndex, t0, t1) · addPlatform(platform) · setPromo({pct, code, deadline}) ·
 *   regenerateCopy(platform) · setCast(text) · setSetting(text)
 * Every op is validated against the creative library (H01–H35, E01–E12, platform ids) and the plan,
 * then applied in code, deterministically: beats stay contiguous and sum to the platform duration
 * (a retime moves the shared boundary with each neighbour). Invalid ops are reported, not applied.
 * Storage, the undo history and the guarded model call live in creative-agent.store.ts.
 */
import { z } from "zod";
import type { CampaignPlan, EndCardPlan, HookVariant, PlanBeat, PlanScript, PlatformPlan } from "./campaign-plan.types";
import { buildScripts, PLATFORM_LABELS, scaffoldPlatformPlan, type LlmFn } from "./campaign-planner";
import { END_CARDS, endCardById, hookById, HOOKS } from "./library";
import { PLATFORM_PROFILES } from "./platforms.data";
import type { ProductBrief } from "./product-brief";
import type { EndCardDef, EndCardId, PlatformId } from "./types";

/* ───────────────────────── op schema ───────────────────────── */

const text = (max: number) => z.string().trim().min(1).max(max);
const changesSchema = z
  .object({ vo: text(400).optional(), onScreenText: text(80).optional(), visual: text(600).optional(), imagePrompt: text(1200).optional(), videoPrompt: text(800).optional() })
  .strict();

export const creativeOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("swapHook"), platform: z.string(), hookId: z.string() }),
  z.object({ op: z.literal("setEndCard"), platform: z.string(), endCardId: z.string(), button: text(40).optional() }),
  z.object({
    op: z.literal("editBeat"),
    /** "storyboard" edits the targeted storyboard's frames (beatIndex = frame index, 0-based); default: the plan. */
    target: z.enum(["plan", "storyboard"]).optional(),
    platform: z.string().optional(),
    /** The script (hook variant) to edit, or "*" for every script of the platform. */
    scriptHookId: z.string().optional(),
    beatIndex: z.number().int().min(0),
    changes: changesSchema,
  }),
  z.object({ op: z.literal("retime"), platform: z.string(), beatIndex: z.number().int().min(0), t0: z.number().finite().min(0), t1: z.number().finite().min(0) }),
  z.object({ op: z.literal("addPlatform"), platform: z.string() }),
  z.object({ op: z.literal("setPromo"), pct: z.number().nullable().optional(), code: z.string().max(40).nullable().optional(), deadline: z.string().max(60).nullable().optional() }),
  z.object({ op: z.literal("regenerateCopy"), platform: z.string() }),
  z.object({ op: z.literal("setCast"), text: text(400) }),
  z.object({ op: z.literal("setSetting"), text: text(300) }),
]);

export type CreativeOp = z.infer<typeof creativeOpSchema>;
export const CREATIVE_OP_NAMES = ["swapHook", "setEndCard", "editBeat", "retime", "addPlatform", "setPromo", "regenerateCopy", "setCast", "setSetting"] as const;

/** A locked-script storyboard frame (plan-to-storyboard output), loosely typed. */
export type StoryboardFrameLike = Record<string, unknown> & { frameNumber?: number; imagePrompt?: string; videoPrompt?: string; textOverlay?: string; voiceover?: string; locked?: Record<string, unknown> };

export interface AgentContext {
  plan: CampaignPlan;
  /** Needed by addPlatform / regenerateCopy (the deterministic scaffold). */
  brief?: ProductBrief | null;
  /** The targeted storyboard's frames (editBeat target "storyboard", setCast / setSetting). */
  frames?: StoryboardFrameLike[] | null;
}

export interface ApplyDeps {
  /** Copy pass for regenerateCopy (production: the campaign copywriter, one guarded call). Default: scaffold copy. */
  rewrite?: (scaffold: PlatformPlan, brief: ProductBrief, plan: CampaignPlan) => Promise<PlatformPlan>;
}

export interface ApplyResult {
  plan: CampaignPlan;
  frames: StoryboardFrameLike[] | null;
  applied: { op: CreativeOp; summary: string }[];
  rejected: { op: unknown; error: string }[];
  planChanged: boolean;
  framesChanged: boolean;
  /** frameNumbers of the frames that changed (for the storyboard's frame history). */
  changedFrames: number[];
}

/* ───────────────────────── validation ───────────────────────── */

const PLATFORM_IDS = new Set<string>(PLATFORM_PROFILES.map((p) => p.id));
const MIN_BEAT_SEC = 0.5;
const EPS = 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Validation = { ok: true; op: CreativeOp } | { ok: false; error: string };

function promoFactMissing(def: EndCardDef, promo: CampaignPlan["promo"]): string | null {
  const p = promo ?? {};
  const need: Record<string, [unknown, string]> = {
    promoPct: [p.pct, "a % off (setPromo pct)"],
    couponCode: [p.code, "a coupon code (setPromo code)"],
    deadline: [p.deadline, "a deadline (setPromo deadline)"],
    comparePrice: [p.comparePrice, "a compare-at price"],
  };
  for (const r of def.requires) {
    const n = need[r];
    if (n && (n[0] == null || n[0] === "")) return `${def.id} ${def.name} needs ${n[1]}`;
  }
  return null;
}

function scriptsOf(pp: PlatformPlan): PlanScript[] {
  return pp.scripts?.length ? pp.scripts : buildScripts(pp);
}

export function validateOp(raw: unknown, ctx: AgentContext): Validation {
  const parsed = creativeOpSchema.safeParse(raw);
  if (!parsed.success) {
    const name = (raw as { op?: unknown } | null)?.op;
    const known = typeof name === "string" && (CREATIVE_OP_NAMES as readonly string[]).includes(name);
    return { ok: false, error: known ? `Invalid ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "op"} ${i.message}`).join("; ")}` : `Unknown op ${JSON.stringify(name ?? raw)?.slice(0, 60)} — allowed: ${CREATIVE_OP_NAMES.join(", ")}` };
  }
  const op = parsed.data;
  const { plan } = ctx;
  const inPlan = (platform: string | undefined) => plan.platforms.find((p) => p.platform === platform);
  const needPlatform = (platform: string | undefined): string | null => {
    if (!platform || !PLATFORM_IDS.has(platform)) return `Unknown platform "${platform}" — use one of ${[...PLATFORM_IDS].join(", ")}`;
    if (!inPlan(platform)) return `Platform ${platform} is not in the plan (add it with addPlatform first)`;
    return null;
  };
  const fail = (error: string): Validation => ({ ok: false, error });

  switch (op.op) {
    case "swapHook": {
      const e = needPlatform(op.platform);
      if (e) return fail(e);
      if (!/^H\d{2}$/.test(op.hookId) || !hookById(op.hookId)) return fail(`Unknown hook ${op.hookId} — use a library hook id H01–H35`);
      if (inPlan(op.platform)!.hookVariants[0]?.hookId === op.hookId) return fail(`${op.hookId} already leads ${op.platform}`);
      return { ok: true, op };
    }
    case "setEndCard": {
      const e = needPlatform(op.platform);
      if (e) return fail(e);
      const def = END_CARDS.find((c) => c.id === op.endCardId);
      if (!def) return fail(`Unknown end card ${op.endCardId} — use E01–E12`);
      const missing = promoFactMissing(def, plan.promo);
      if (missing) return fail(missing);
      return { ok: true, op };
    }
    case "editBeat": {
      if (!Object.values(op.changes).some((v) => typeof v === "string" && v.trim())) return fail("editBeat needs at least one change (vo, onScreenText, visual, imagePrompt, videoPrompt)");
      const target = op.target ?? (ctx.frames?.length && !op.platform ? "storyboard" : "plan");
      if (target === "storyboard") {
        if (!ctx.frames?.length) return fail("No storyboard targeted — pass storyboardId to edit frames");
        if (op.beatIndex >= ctx.frames.length) return fail(`No frame at index ${op.beatIndex} (the storyboard has ${ctx.frames.length})`);
        return { ok: true, op: { ...op, target } };
      }
      const e = needPlatform(op.platform);
      if (e) return fail(e);
      const pp = inPlan(op.platform)!;
      const scripts = scriptsOf(pp);
      const sid = op.scriptHookId ?? "*";
      const chosen = sid === "*" ? scripts : scripts.filter((s) => s.hookId === sid);
      if (!chosen.length) return fail(`No script ${sid} on ${op.platform} — scripts: ${scripts.map((s) => s.hookId).join(", ")} or "*"`);
      if (chosen.every((s) => op.beatIndex >= s.beats.length)) return fail(`No beat ${op.beatIndex} on ${op.platform} (scripts have ${chosen[0].beats.length} beats)`);
      return { ok: true, op: { ...op, target, scriptHookId: sid } };
    }
    case "retime": {
      const e = needPlatform(op.platform);
      if (e) return fail(e);
      const scripts = scriptsOf(inPlan(op.platform)!);
      if (scripts.every((s) => op.beatIndex >= s.beats.length)) return fail(`No beat ${op.beatIndex} on ${op.platform}`);
      if (!(op.t1 > op.t0)) return fail("retime needs t1 > t0");
      return { ok: true, op };
    }
    case "addPlatform": {
      if (!PLATFORM_IDS.has(op.platform)) return fail(`Unknown platform "${op.platform}" — use one of ${[...PLATFORM_IDS].join(", ")}`);
      if (inPlan(op.platform)) return fail(`${op.platform} is already in the plan`);
      if (!ctx.brief) return fail("addPlatform needs the project's product brief");
      return { ok: true, op };
    }
    case "setPromo": {
      if (op.pct === undefined && op.code === undefined && op.deadline === undefined) return fail("setPromo needs pct, code or deadline");
      if (op.pct != null && !(op.pct > 0 && op.pct < 100)) return fail("setPromo pct must be between 1 and 99 (percent off)");
      if (op.code != null && !/^[A-Za-z0-9_-]{2,40}$/.test(op.code)) return fail("setPromo code must be 2–40 letters, digits, - or _");
      return { ok: true, op };
    }
    case "regenerateCopy": {
      const e = needPlatform(op.platform);
      if (e) return fail(e);
      if (!ctx.brief) return fail("regenerateCopy needs the project's product brief");
      return { ok: true, op };
    }
    case "setCast":
    case "setSetting":
      return { ok: true, op };
  }
}

/* ───────────────────────── deterministic application ───────────────────────── */

/**
 * Move beat i to [t0, t1]; its neighbours give up / take the difference so beats stay contiguous from
 * 0 to `duration`. Throws when a neighbour would drop below MIN_BEAT_SEC or the ends would move.
 */
export function retimeBeats(beats: PlanBeat[], i: number, t0: number, t1: number, duration: number): PlanBeat[] {
  if (!beats[i]) throw new Error(`No beat ${i}`);
  const a = r2(t0);
  const b = r2(t1);
  const n = beats.length;
  if (!(b - a >= MIN_BEAT_SEC - EPS)) throw new Error(`Beat ${i} would be shorter than ${MIN_BEAT_SEC} s (t1 must exceed t0)`);
  if (i === 0 && Math.abs(a) > EPS) throw new Error("The first beat starts at 0");
  if (i === n - 1 && Math.abs(b - duration) > EPS) throw new Error(`The last beat ends at the duration (${duration} s)`);
  if (i > 0 && a - beats[i - 1].t0 < MIN_BEAT_SEC - EPS) throw new Error(`Beat ${i - 1} would be shorter than ${MIN_BEAT_SEC} s`);
  if (i < n - 1 && beats[i + 1].t1 - b < MIN_BEAT_SEC - EPS) throw new Error(`Beat ${i + 1} would be shorter than ${MIN_BEAT_SEC} s`);
  const out = beats.map((x) => ({ ...x }));
  out[i].t0 = a;
  out[i].t1 = b;
  if (i > 0) out[i - 1].t1 = a;
  if (i < n - 1) out[i + 1].t0 = b;
  if (Math.abs(out[0].t0) > EPS || Math.abs(out[n - 1].t1 - duration) > EPS) throw new Error("Beats must run from 0 to the duration");
  for (let k = 1; k < n; k++) if (Math.abs(out[k].t0 - out[k - 1].t1) > EPS) throw new Error(`Beats ${k - 1} and ${k} are not contiguous`);
  return out;
}

const fillProduct = (s: string, product: string) => s.replace(/_{2,}/g, product).replace(/\s+/g, " ").trim();

function hookBeatOf(v: HookVariant, prev?: PlanBeat): PlanBeat {
  return { ...(prev ?? { t0: 0, t1: v.durationSec, purpose: "hook" as const }), purpose: "hook", visual: v.openingVisual, shotType: v.hookId, vo: v.openingVO, onScreenText: v.openingText };
}

function swapHook(pp: PlatformPlan, hookId: string, product: string): string {
  const scripts = scriptsOf(pp);
  const idx = pp.hookVariants.findIndex((v) => v.hookId === hookId);
  const lead = pp.hookVariants[0];
  if (idx > 0) {
    pp.hookVariants = [pp.hookVariants[idx], ...pp.hookVariants.filter((_, k) => k !== idx)];
    const si = scripts.findIndex((s) => s.hookId === hookId);
    pp.scripts = si > 0 ? [scripts[si], ...scripts.filter((_, k) => k !== si)] : scripts;
    return `${pp.platform}: lead hook ${lead?.hookId} → ${hookId} (variant ${idx + 1} moved up)`;
  }
  const h = hookById(hookId)!;
  const variant: HookVariant = {
    hookId: h.id,
    name: h.name,
    family: h.family,
    durationSec: lead?.durationSec ?? scripts[0]?.beats[0]?.t1 ?? 2,
    openingVisual: clip(`${fillProduct(h.keyframe, product)} Move: ${fillProduct(h.motion, product)} Frame 1 bright, ${product} or the subject in shot.`, 420),
    // The opening copy carries over until regenerateCopy rewrites it for the new recipe.
    openingText: lead?.openingText ?? h.name,
    openingVO: lead?.openingVO ?? "",
  };
  pp.hookVariants = [variant, ...pp.hookVariants.slice(1)];
  const old = scripts.find((s) => s.hookId === lead?.hookId) ?? scripts[0];
  const body = old ? old.beats.slice(1) : pp.beats;
  const script: PlanScript = { hookId: h.id, title: `${pp.label} · ${h.id} ${h.name}`, beats: [hookBeatOf(variant, old?.beats[0]), ...body.map((b) => ({ ...b }))] };
  pp.scripts = [script, ...scripts.filter((s) => s !== old)];
  pp.notes = [...(pp.notes ?? []), `hook ${h.id} swapped in by the creative agent (opening copy carried over from ${lead?.hookId ?? "the previous hook"}; regenerateCopy rewrites it)`];
  return `${pp.platform}: lead hook ${lead?.hookId ?? "—"} → ${h.id} ${h.name}`;
}

function promoData(promo: CampaignPlan["promo"]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of ["pct", "code", "deadline", "price", "comparePrice"] as const) {
    const v = promo?.[k];
    if (v != null && v !== "") out[k] = v;
  }
  return out;
}

function defaultButton(def: EndCardDef, promo: CampaignPlan["promo"]): string {
  const data = promoData(promo);
  for (const c of def.copy) {
    const filled = c.replace(/\{(\w+)\}/g, (m, k: string) => (data[k] != null ? String(data[k]) : m));
    if (!/\{\w+\}/.test(filled)) return filled;
  }
  return "Shop now";
}

function setEndCard(pp: PlatformPlan, id: EndCardId, button: string | undefined, plan: CampaignPlan): string {
  const old = pp.endCard;
  const def = endCardById(id);
  const known = old.id === id ? old : pp.endCardAlternates.find((e) => e.id === id);
  const card: EndCardPlan = known ? { ...known, data: known.data ? { ...known.data } : undefined } : { id, name: def.name, button: defaultButton(def, plan.promo), data: promoData(plan.promo) };
  if (button) card.button = button;
  pp.endCard = card;
  if (old.id !== id) pp.endCardAlternates = [old, ...pp.endCardAlternates.filter((e) => e.id !== id && e.id !== old.id)].slice(0, 3);
  const swap = (b: PlanBeat): PlanBeat => {
    const n = { ...b };
    if (b.purpose === "cta") {
      n.onScreenText = card.button.toUpperCase();
      n.vo = `${card.button}.`;
      n.visual = b.visual.split(`"${old.button}"`).join(`"${card.button}"`).split(`${old.id} ${old.name}`).join(`${card.id} ${card.name}`);
    } else if (b.purpose === "offer" && b.shotType === old.id) {
      n.shotType = card.id;
      n.visual = b.visual.split(`${old.id} ${old.name}`).join(`${card.id} ${card.name}`);
    }
    return n;
  };
  pp.beats = pp.beats.map(swap);
  pp.scripts = scriptsOf(pp).map((s) => ({ ...s, beats: s.beats.map(swap) }));
  return `${pp.platform}: end card ${old.id} → ${card.id} ${card.name} ("${card.button}")`;
}

function editPlanBeat(pp: PlatformPlan, op: Extract<CreativeOp, { op: "editBeat" }>): string {
  const scripts = scriptsOf(pp);
  const sid = op.scriptHookId ?? "*";
  const visual = op.changes.visual ?? op.changes.imagePrompt;
  const patch = (b: PlanBeat): PlanBeat => ({
    ...b,
    ...(op.changes.vo ? { vo: op.changes.vo } : {}),
    ...(op.changes.onScreenText ? { onScreenText: op.changes.onScreenText } : {}),
    ...(visual ? { visual } : {}),
  });
  const touched: string[] = [];
  pp.scripts = scripts.map((s) => {
    if ((sid !== "*" && s.hookId !== sid) || !s.beats[op.beatIndex]) return s;
    touched.push(s.hookId);
    return { ...s, beats: s.beats.map((b, k) => (k === op.beatIndex ? patch(b) : b)) };
  });
  if (op.beatIndex === 0) {
    pp.hookVariants = pp.hookVariants.map((v) =>
      touched.includes(v.hookId)
        ? { ...v, ...(op.changes.vo ? { openingVO: op.changes.vo } : {}), ...(op.changes.onScreenText ? { openingText: op.changes.onScreenText } : {}), ...(visual ? { openingVisual: visual } : {}) }
        : v
    );
  } else if (sid === "*" && pp.beats[op.beatIndex - 1]) {
    // Every script edited: the shared body (what new hook variants are built on) follows.
    pp.beats = pp.beats.map((b, k) => (k === op.beatIndex - 1 ? patch(b) : b));
  }
  const fields = Object.keys(op.changes).join(", ");
  return `${pp.platform}: beat ${op.beatIndex} ${fields} edited in ${sid === "*" ? "every script" : `script ${sid}`}`;
}

function retimePlatform(pp: PlatformPlan, op: Extract<CreativeOp, { op: "retime" }>): string {
  const scripts = scriptsOf(pp).map((s) => (s.beats[op.beatIndex] ? { ...s, beats: retimeBeats(s.beats, op.beatIndex, op.t0, op.t1, pp.durationSec) } : s));
  pp.scripts = scripts;
  const first = scripts.find((s) => s.beats[op.beatIndex]) ?? scripts[0];
  if (first && first.beats.length === pp.beats.length + 1) pp.beats = pp.beats.map((b, k) => ({ ...b, t0: first.beats[k + 1].t0, t1: first.beats[k + 1].t1 }));
  if (first) pp.hookVariants = pp.hookVariants.map((v) => ({ ...v, durationSec: first.beats[0].t1 }));
  return `${pp.platform}: beat ${op.beatIndex} retimed to ${r2(op.t0)}–${r2(op.t1)} s (neighbours shifted)`;
}

function setPromo(plan: CampaignPlan, op: Extract<CreativeOp, { op: "setPromo" }>): string {
  const promo = { ...(plan.promo ?? {}) };
  const keys = (["pct", "code", "deadline"] as const).filter((k) => op[k] !== undefined);
  for (const k of keys) (promo as Record<string, unknown>)[k] = op[k];
  plan.promo = promo;
  const patchCard = (c: EndCardPlan): EndCardPlan => {
    const data = { ...(c.data ?? {}) };
    for (const k of keys) {
      const v = op[k];
      if (v == null || v === "") delete data[k];
      else data[k] = v;
    }
    return { ...c, data };
  };
  plan.platforms = plan.platforms.map((p) => ({ ...p, endCard: patchCard(p.endCard), endCardAlternates: p.endCardAlternates.map(patchCard) }));
  return `promo: ${keys.map((k) => `${k} ${op[k] == null ? "removed" : String(op[k])}`).join(", ")}`;
}

function scaffoldFor(brief: ProductBrief, platform: PlatformId, plan: CampaignPlan, keep?: PlatformPlan): PlatformPlan {
  const runDate = plan.runDate ?? plan.createdAt;
  return scaffoldPlatformPlan(brief, platform, plan.goal, plan.promo, runDate, {
    strictCompliance: plan.strictCompliance,
    ...(keep ? { durationSec: keep.durationSec, hookIds: keep.hookVariants.map((h) => h.hookId), endCardId: keep.endCard.id } : {}),
  });
}

const SETTING_CLAUSE = / ?Setting: [^.]*\./g;

function editFrame(frame: StoryboardFrameLike, changes: Extract<CreativeOp, { op: "editBeat" }>["changes"]): StoryboardFrameLike {
  const image = changes.imagePrompt ?? changes.visual;
  return {
    ...frame,
    ...(image ? { imagePrompt: image } : {}),
    ...(changes.videoPrompt ? { videoPrompt: changes.videoPrompt } : {}),
    ...(changes.onScreenText ? { textOverlay: changes.onScreenText } : {}),
    ...(changes.vo ? { voiceover: changes.vo } : {}),
  };
}

/** Validate and apply ops in order; each op applies to a copy and is kept only when it succeeds. */
export async function applyOps(ctx: AgentContext, rawOps: unknown[], deps: ApplyDeps = {}): Promise<ApplyResult> {
  let plan: CampaignPlan = structuredClone(ctx.plan);
  let frames: StoryboardFrameLike[] | null = ctx.frames ? structuredClone(ctx.frames) : null;
  const applied: ApplyResult["applied"] = [];
  const rejected: ApplyResult["rejected"] = [];
  const changed = new Set<number>();
  let planChanged = false;
  let framesChanged = false;
  const product = plan.productTitle || ctx.brief?.product?.name || "the product";

  for (const raw of rawOps) {
    const v = validateOp(raw, { plan, brief: ctx.brief, frames });
    if (!v.ok) {
      rejected.push({ op: raw, error: v.error });
      continue;
    }
    const op = v.op;
    const next: CampaignPlan = structuredClone(plan);
    let nextFrames = frames ? structuredClone(frames) : null;
    const pp = "platform" in op && op.platform ? next.platforms.find((p) => p.platform === op.platform) : undefined;
    let touchesPlan = true;
    let summary = "";
    try {
      switch (op.op) {
        case "swapHook":
          summary = swapHook(pp!, op.hookId, product);
          break;
        case "setEndCard":
          summary = setEndCard(pp!, op.endCardId as EndCardId, op.button, next);
          break;
        case "editBeat":
          if (op.target === "storyboard") {
            touchesPlan = false;
            const f = nextFrames![op.beatIndex];
            nextFrames![op.beatIndex] = editFrame(f, op.changes);
            const num = Number(f.frameNumber ?? op.beatIndex + 1);
            changed.add(num);
            summary = `storyboard frame ${num}: ${Object.keys(op.changes).join(", ")} edited`;
          } else summary = editPlanBeat(pp!, op);
          break;
        case "retime":
          summary = retimePlatform(pp!, op);
          break;
        case "addPlatform": {
          const added = scaffoldFor(ctx.brief!, op.platform as PlatformId, next);
          next.platforms.push(added);
          summary = `added ${PLATFORM_LABELS[op.platform as PlatformId] ?? op.platform} (${added.durationSec} s, scaffold copy — regenerateCopy to sharpen it)`;
          break;
        }
        case "setPromo":
          summary = setPromo(next, op);
          break;
        case "regenerateCopy": {
          const scaffold = scaffoldFor(ctx.brief!, op.platform as PlatformId, next, pp);
          const fresh = deps.rewrite ? await deps.rewrite(scaffold, ctx.brief!, next) : scaffold;
          const out: PlatformPlan = { ...fresh, scripts: buildScripts(fresh) };
          next.platforms = next.platforms.map((p) => (p.platform === op.platform ? out : p));
          summary = `${op.platform}: copy regenerated (${out.copySource ?? "scaffold"})`;
          break;
        }
        case "setCast": {
          next.cast = op.text;
          summary = `cast: ${clip(op.text, 60)}`;
          if (nextFrames) {
            const people = (f: StoryboardFrameLike) => /cast/.test(String(f.locked?.refs ?? ""));
            const k = nextFrames.findIndex((f) => typeof f.locked?.castLock === "string");
            const at = k >= 0 ? k : nextFrames.findIndex(people);
            if (at >= 0) {
              nextFrames[at] = { ...nextFrames[at], locked: { ...(nextFrames[at].locked ?? {}), castLock: op.text } };
              changed.add(Number(nextFrames[at].frameNumber ?? at + 1));
              summary += ` (storyboard frame ${nextFrames[at].frameNumber ?? at + 1} cast lock)`;
            }
          }
          break;
        }
        case "setSetting": {
          next.setting = op.text;
          summary = `setting: ${clip(op.text, 60)}`;
          if (nextFrames) {
            nextFrames = nextFrames.map((f, k) => {
              if (typeof f.imagePrompt !== "string") return f;
              changed.add(Number(f.frameNumber ?? k + 1));
              return { ...f, imagePrompt: `${f.imagePrompt.replace(SETTING_CLAUSE, "").trimEnd()} Setting: ${op.text.replace(/\.+$/, "")}.` };
            });
            summary += " (every storyboard frame)";
          }
          break;
        }
      }
    } catch (err) {
      rejected.push({ op: raw, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (touchesPlan) {
      plan = next;
      planChanged = true;
    }
    if (nextFrames && JSON.stringify(nextFrames) !== JSON.stringify(frames)) {
      frames = nextFrames;
      framesChanged = true;
    }
    applied.push({ op, summary });
  }
  return { plan, frames, applied, rejected, planChanged, framesChanged, changedFrames: [...changed].sort((a, b) => a - b) };
}

/* ───────────────────────── the one model call ───────────────────────── */

export const agentOutputSchema = z
  .object({ reply: z.string().catch(""), ops: z.array(z.unknown()).catch([]) })
  .partial()
  .catch({});

const short = (s: string | undefined, n: number) => (s ? clip(s.replace(/\s+/g, " ").trim(), n) : undefined);

export function creativeAgentPrompts(ctx: AgentContext, message: string): { system: string; user: string } {
  const hooks = HOOKS.map((h) => `${h.id} ${h.name}`).join("; ");
  const cards = END_CARDS.map((c) => `${c.id} ${c.name}${c.requires.length ? ` [needs ${c.requires.join("+")}]` : ""}`).join("; ");
  const system = `You are CreativeIntel's Creative Agent. The user edits a video-ad campaign plan by chat. Turn the instruction into edit operations. Output JSON only:
{"reply":"one or two sentences telling the user what you changed","ops":[ …operations… ]}
OPERATIONS (closed set — nothing else is applied):
- {"op":"swapHook","platform":P,"hookId":"H.."} — make a library hook the lead opening of P.
- {"op":"setEndCard","platform":P,"endCardId":"E..","button":"optional CTA text"}
- {"op":"editBeat","target":"plan","platform":P,"scriptHookId":"H.."|"*","beatIndex":i,"changes":{"vo":"…","onScreenText":"≤ 6 words","visual":"shot description"}} — i indexes the script's beats (0 = the hook beat); "*" = every script of P.
- {"op":"editBeat","target":"storyboard","beatIndex":i,"changes":{"imagePrompt":"first keyframe still","videoPrompt":"motion","onScreenText":"…","vo":"…"}} — edit storyboard frame i (0-based index; "frame 3" = frameNumber 3 = index 2). Only when a storyboard is given.
- {"op":"retime","platform":P,"beatIndex":i,"t0":s,"t1":s} — move beat i; neighbours shift. The first beat starts at 0, the last ends at the duration, every beat ≥ 0.5 s.
- {"op":"addPlatform","platform":P}
- {"op":"setPromo","pct":number|null,"code":"CODE"|null,"deadline":"ISO date or text"|null}
- {"op":"regenerateCopy","platform":P} — rewrite all copy of P from the brief (keeps hooks, end card, duration).
- {"op":"setCast","text":"lead cast description"} · {"op":"setSetting","text":"shared set / location"}
LIBRARY (use these ids only):
PLATFORMS: ${[...PLATFORM_IDS].join(", ")}
HOOKS: ${hooks}
END CARDS: ${cards}
RULES: use the fewest ops that do what was asked; only platforms in the plan (except addPlatform); keep the product in every visual; sell hard with the facts given. If the request cannot be done with these ops, return "ops": [] and say why in "reply".`;
  const plan = ctx.plan;
  const user = JSON.stringify({
    instruction: message,
    plan: {
      goal: plan.goal,
      promo: plan.promo ?? null,
      cast: plan.cast ?? null,
      setting: plan.setting ?? null,
      platforms: plan.platforms.map((p) => ({
        platform: p.platform,
        durationSec: p.durationSec,
        endCard: { id: p.endCard.id, button: p.endCard.button },
        alternates: p.endCardAlternates.map((e) => e.id),
        scripts: scriptsOf(p).map((s) => ({
          hookId: s.hookId,
          beats: s.beats.map((b, i) => ({ i, t: `${b.t0}-${b.t1}`, purpose: b.purpose, vo: short(b.vo, 120), text: short(b.onScreenText, 60), visual: short(b.visual, 140) })),
        })),
      })),
    },
    ...(ctx.frames?.length
      ? {
          storyboard: ctx.frames.map((f, i) => ({ i, frameNumber: f.frameNumber ?? i + 1, t: `${f.startSec ?? ""}-${f.endSec ?? ""}`, imagePrompt: short(f.imagePrompt, 220), videoPrompt: short(f.videoPrompt, 120), text: short(f.textOverlay, 60), vo: short(f.voiceover, 120) })),
        }
      : {}),
  });
  return { system, user };
}

export interface AgentResult extends ApplyResult {
  reply: string;
  /** Model failure: nothing was applied. */
  error?: string;
}

/** ONE model call → ops → validated, deterministic application. Nothing is stored here. */
export async function runCreativeAgent(ctx: AgentContext, message: string, deps: ApplyDeps & { llm: LlmFn }): Promise<AgentResult> {
  let raw: z.infer<typeof agentOutputSchema>;
  try {
    raw = agentOutputSchema.parse((await deps.llm(creativeAgentPrompts(ctx, message))) ?? {});
  } catch (err) {
    return { plan: ctx.plan, frames: ctx.frames ?? null, applied: [], rejected: [], planChanged: false, framesChanged: false, changedFrames: [], reply: "", error: err instanceof Error ? err.message : String(err) };
  }
  const result = await applyOps(ctx, raw.ops ?? [], deps);
  return { ...result, reply: raw.reply ?? "" };
}

/* ───────────────────────── undo history ───────────────────────── */

export const HISTORY_LIMIT = 10;

export interface EditHistoryEntry {
  at: string;
  message: string;
  summary: string[];
  /** The plan before this edit (only when the edit changed it). */
  plan?: CampaignPlan | null;
  /** The storyboard frames before this edit (only when the edit changed them). */
  storyboard?: { id: string; frames: StoryboardFrameLike[] };
}

const asHistory = (h: unknown): EditHistoryEntry[] => (Array.isArray(h) ? (h as EditHistoryEntry[]).filter((e) => e && typeof e === "object") : []);

export function pushHistory(history: unknown, entry: EditHistoryEntry, limit = HISTORY_LIMIT): EditHistoryEntry[] {
  return [...asHistory(history), entry].slice(-limit);
}

export function popHistory(history: unknown): { entry: EditHistoryEntry; rest: EditHistoryEntry[] } | null {
  const h = asHistory(history);
  if (!h.length) return null;
  return { entry: h[h.length - 1], rest: h.slice(0, -1) };
}
