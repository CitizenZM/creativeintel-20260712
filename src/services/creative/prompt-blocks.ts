/**
 * Prompt blocks that carry the research into planning: the sp-1 product brief, the platform profile,
 * the selected opening hooks + end card, the built-in playbook slice (category proof shots, platform
 * grammar, hook / VO / CTA formulas) and — when one is stored — the campaign plan's beat map for the
 * chosen hook variant. Used by the script writer (creative/_script-context) and the shot director
 * (libtv-compile → directAd). Pure.
 *
 * Default mode sells hard: the boldest wording the brief's real facts support. `strictCompliance`
 * restores the legal layer (safe wording, disclosures, compliance notes).
 */
import type { PlatformPlan } from "./campaign-plan.types";
import { platformBrief, selectCreative } from "./library";
import { playbookSlice } from "./playbooks";
import { TO_CREATIVE_CATEGORY, type ProductBrief, type SpCategory } from "./product-brief";
import type { CampaignGoal, CreativeChoice, CreativeInputs, PlatformId } from "./types";

/** Campaign platform ids (CAMPAIGN_PLATFORMS: tiktok|instagram|youtube|tvc|amazon + free text) → profile id. */
export function campaignToPlatform(id?: string | null): PlatformId {
  const s = (id ?? "").toLowerCase();
  if (/tiktok/.test(s)) return "tiktok";
  if (/story|stories/.test(s)) return "instagram_stories";
  if (/insta|reel/.test(s)) return "instagram_reels";
  if (/facebook|meta|feed/.test(s)) return "meta_feed";
  if (/bumper/.test(s)) return "youtube_bumper_6s";
  if (/short/.test(s)) return "youtube_shorts";
  if (/youtube|tvc|ctv|instream/.test(s)) return "youtube_instream_skippable";
  if (/google|demand|pmax/.test(s)) return "google_demand_gen";
  if (/pinterest/.test(s)) return "pinterest";
  if (/snap/.test(s)) return "snapchat";
  if (/amazon/.test(s)) return "meta_feed";
  return "tiktok";
}

export function goalFromText(text?: string | null): CampaignGoal {
  const s = (text ?? "").toLowerCase();
  if (/app|install/.test(s)) return "app_install";
  if (/lead|quote|book|demo/.test(s)) return "lead";
  if (/retarget|remarket|cart|re-?engage/.test(s)) return "retarget";
  if (/sale|promo|deal|coupon|discount|black friday|cyber|% off|offer/.test(s)) return "promo";
  if (/aware|brand|launch|reach/.test(s)) return "awareness";
  return "cold";
}

const clip = (s: string | undefined | null, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export interface BlockOptions {
  strictCompliance?: boolean;
}

/** The brief's top selling points with their proof shots and the facts behind them (≈ 250 words). */
export function briefBlock(brief: ProductBrief, maxPoints = 3, opts: BlockOptions = {}): string {
  const strict = !!opts.strictCompliance;
  const pts = brief.sellingPoints.slice(0, maxPoints);
  const point = (p: (typeof pts)[number], i: number) => {
    const base = `${i + 1}. ${clip(p.claim, 90)} → ${clip(p.benefit, 90)} | proof shot: ${clip(p.proofVisual.shot, 140)}${p.proofVisual.overlayText ? ` | overlay "${clip(p.proofVisual.overlayText, 40)}"` : ""}`;
    if (strict) return `${base}${p.compliance?.safeWording ? ` | safe wording: ${clip(p.compliance.safeWording, 100)}` : ""}${p.compliance?.requiredDisclosure ? ` | disclosure: ${clip(p.compliance.requiredDisclosure, 100)}` : ""}`;
    const fact = p.sourceEvidence?.[0]?.quote;
    return `${base}${fact ? ` | fact: "${clip(fact, 90)}"` : ""}`;
  };
  const lines = [
    `BIG IDEA: ${clip(brief.bigIdea.proposition, 120)}${brief.bigIdea.alternates.length ? ` (alternates: ${brief.bigIdea.alternates.slice(0, 3).map((a) => clip(a, 80)).join(" | ")})` : ""}`,
    `AUDIENCE: ${clip(brief.audience.primary, 140)} — stage ${brief.audience.awarenessStage}. JOB: ${clip(brief.primaryJob.statement, 160)}`,
    strict
      ? "SELLING POINTS (rank order; each must be SHOWN, using its proof shot; say it in the safe wording):"
      : "SELLING POINTS (rank order; each must be SHOWN with its proof shot and SOLD in the boldest, most concrete wording its fact supports — real numbers, superlatives, urgency):",
    ...pts.map(point),
  ];
  const obj = brief.objections[0];
  if (obj) lines.push(`TOP OBJECTION: ${clip(obj.objection, 100)} → bust it with: ${clip(obj.bustingVisual, 120)}`);
  const kw = brief.keywords
    .filter((k) => k.placement.some((p) => p === "hook_text" || p === "voiceover" || p === "caption"))
    .slice(0, 6)
    .map((k) => k.term);
  if (kw.length) lines.push(`KEYWORDS for hook text / VO / captions: ${kw.join(", ")}`);
  if (strict) {
    const blocked = brief.complianceNotes.slice(0, 3).map((n) => clip(`${n.issue} → ${n.action}`, 120));
    if (blocked.length) lines.push(`COMPLIANCE: ${blocked.join("; ")}`);
  }
  return lines.join("\n");
}

/** The selected hooks (with executable recipes) and end card (≈ 200 words). */
export function choiceBlock(choice: CreativeChoice): string {
  return [
    "OPENING HOOKS (first 1–3 s). Use #1 for the master and #2/#3 as the hook variants:",
    ...choice.hooks.map((h, i) => `${i + 1}. ${h.hook.id} ${h.hook.name} — frame 1: ${clip(h.hook.keyframe, 150)} · move: ${clip(h.hook.motion, 120)} · ${h.hook.durationSec[0]}–${h.hook.durationSec[1]} s · text ${clip(h.hook.text, 70)} · risk: ${clip(h.hook.risk, 90)}`),
    `END CARD: ${choice.endCard.id} ${choice.endCard.name} — ${clip(choice.endCard.layout, 160)}; button copy: ${choice.endCard.copy.slice(0, 2).join(" / ")}. Brand logo + this CTA in the last second.`,
    choice.labels.length ? `LABELS: ${choice.labels.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The stored campaign plan for this platform, as the script's spine: the chosen hook variant's
 * opening + the shared timed body + end card. Times are rescaled to `targetSec` (CTA stays the last
 * 1 s) when the script runs at another length. ≈ 250 words.
 */
export function planBlock(plan: PlatformPlan, hookIndex = 0, opts: { brief?: ProductBrief | null; targetSec?: number } = {}): string {
  const variants = plan.hookVariants.length ? plan.hookVariants : [];
  const v = variants[((hookIndex % Math.max(1, variants.length)) + variants.length) % Math.max(1, variants.length)];
  const D = plan.durationSec;
  const T = opts.targetSec && opts.targetSec > 0 ? opts.targetSec : D;
  const k = (T - 1) / Math.max(0.1, D - 1);
  const at = (t: number) => (t >= D - 1 ? Math.round((T - (D - t)) * 10) / 10 : Math.round(t * k * 10) / 10);
  const spText = (id?: string) => {
    const p = id ? opts.brief?.sellingPoints.find((x) => x.id === id) : undefined;
    return p ? ` [selling point: "${clip(p.claim, 70)} → ${clip(p.benefit, 70)}"]` : "";
  };
  const hookEnd = v ? at(v.durationSec) : 0;
  const lines = [
    `CAMPAIGN PLAN — ${plan.label}, ${T} s${T !== D ? ` (plan was ${D} s; times rescaled)` : ""}. FOLLOW THIS BEAT MAP: hook, body beats and CTA in this order and at these times; write the script's hook from the chosen variant and the body beats from the plan beats.`,
    v ? `HOOK (0–${hookEnd} s) = ${v.hookId} ${v.name}: frame 1 ${clip(v.openingVisual, 200)} | text "${clip(v.openingText, 50)}" | VO "${clip(v.openingVO, 90)}"` : "",
    ...plan.beats.map((b) => `${at(b.t0)}–${at(b.t1)} s ${b.purpose.toUpperCase()}${spText(b.sellingPointId)}: ${clip(b.visual, 150)}${b.vo ? ` | VO "${clip(b.vo, 90)}"` : ""}${b.onScreenText ? ` | text "${clip(b.onScreenText, 40)}"` : ""}`),
    `END CARD: ${plan.endCard.id} ${plan.endCard.name}${plan.endCard.headline ? ` — "${plan.endCard.headline}"` : ""}; button "${plan.endCard.button}". Last second: logo + bouncing button. Voice: ${clip(plan.voice, 80)}. Captions: ${clip(plan.captionStyle, 80)}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

export interface CreativeBlockInput {
  brief?: ProductBrief | null;
  platform?: string | null;
  goalText?: string | null;
  /** Explicit goal (wins over goalText), e.g. the stored plan's goal. */
  goal?: CampaignGoal;
  promo?: CreativeInputs["promo"];
  runDate?: string;
  strictCompliance?: boolean;
  /** The stored campaign plan for this platform: replaces the hook/end-card choice with its beat map. */
  plan?: PlatformPlan | null;
  hookIndex?: number;
  /** Script length, to rescale the plan's beat times. */
  targetSec?: number;
}

/**
 * Everything the script writer needs from the research for one ad. Returns the prompt text plus the
 * choice (so callers can store the picked hooks / end card on the storyboard).
 */
export function creativeBlock(input: CreativeBlockInput): { text: string; choice: CreativeChoice | null; platform: PlatformId } {
  const strict = !!input.strictCompliance;
  const platform = input.plan?.platform ?? campaignToPlatform(input.platform);
  const goal = input.goal ?? goalFromText(input.goalText);
  const parts = [platformBrief(platform)];
  let choice: CreativeChoice | null = null;
  if (input.brief) {
    parts.push(briefBlock(input.brief, 3, { strictCompliance: strict }));
    if (input.plan) parts.push(planBlock(input.plan, input.hookIndex ?? 0, { brief: input.brief, targetSec: input.targetSec }));
    else {
      choice = selectCreative({ category: TO_CREATIVE_CATEGORY[input.brief.category as SpCategory] ?? "gifts", platform, goal, promo: input.promo, runDate: input.runDate ?? new Date().toISOString(), strictCompliance: strict });
      parts.push(choiceBlock(choice));
    }
  } else if (input.plan) parts.push(planBlock(input.plan, input.hookIndex ?? 0, { targetSec: input.targetSec }));
  parts.push(playbookSlice({ category: input.brief?.category, platform, goal, maxWords: 400 }));
  parts.push(
    `RULES: frame 1 bright with the product or subject; hero proof and key message by ${goal === "promo" ? "3 s — and the sale pitch (offer + reason to buy now) in the first 3 s" : "the platform hook second"}; product shown at least twice; every zoom lands on the product; one idea per ad; last second = logo + CTA button; every readable text inside the safe box (y 288–1220 on 9:16); no invented numbers, ratings or testimonials.`
  );
  const head = strict
    ? "CREATIVE BRIEF FROM RESEARCH (follow it; brand truth and compliance still win)"
    : "CREATIVE BRIEF FROM RESEARCH (follow it; sell hard — the boldest, most persuasive wording the brief's real facts support)";
  return { text: `\n${head}:\n${parts.join("\n")}`, choice, platform };
}
