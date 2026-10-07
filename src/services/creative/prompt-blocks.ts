/**
 * Prompt blocks that carry the research into planning: the sp-1 product brief, the platform profile
 * and the selected opening hooks + end card. Used by the script writer (creative/_script-context) and
 * the shot director (libtv-compile → directAd). Pure.
 */
import { platformBrief, selectCreative } from "./library";
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

/** The brief's top selling points with their proof shots and safe wording (≈ 250 words). */
export function briefBlock(brief: ProductBrief, maxPoints = 3): string {
  const pts = brief.sellingPoints.slice(0, maxPoints);
  const lines = [
    `BIG IDEA: ${clip(brief.bigIdea.proposition, 120)}${brief.bigIdea.alternates.length ? ` (alternates: ${brief.bigIdea.alternates.slice(0, 3).map((a) => clip(a, 80)).join(" | ")})` : ""}`,
    `AUDIENCE: ${clip(brief.audience.primary, 140)} — stage ${brief.audience.awarenessStage}. JOB: ${clip(brief.primaryJob.statement, 160)}`,
    "SELLING POINTS (rank order; each must be SHOWN, using its proof shot; say it in the safe wording):",
    ...pts.map((p, i) => `${i + 1}. ${clip(p.claim, 90)} → ${clip(p.benefit, 90)} | proof shot: ${clip(p.proofVisual.shot, 140)}${p.proofVisual.overlayText ? ` | overlay "${clip(p.proofVisual.overlayText, 40)}"` : ""}${p.compliance.safeWording ? ` | safe wording: ${clip(p.compliance.safeWording, 100)}` : ""}${p.compliance.requiredDisclosure ? ` | disclosure: ${clip(p.compliance.requiredDisclosure, 100)}` : ""}`),
  ];
  const obj = brief.objections[0];
  if (obj) lines.push(`TOP OBJECTION: ${clip(obj.objection, 100)} → bust it with: ${clip(obj.bustingVisual, 120)}`);
  const kw = brief.keywords
    .filter((k) => k.placement.some((p) => p === "hook_text" || p === "voiceover" || p === "caption"))
    .slice(0, 6)
    .map((k) => k.term);
  if (kw.length) lines.push(`KEYWORDS for hook text / VO / captions: ${kw.join(", ")}`);
  const blocked = brief.complianceNotes.slice(0, 3).map((n) => clip(`${n.issue} → ${n.action}`, 120));
  if (blocked.length) lines.push(`COMPLIANCE: ${blocked.join("; ")}`);
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

export interface CreativeBlockInput {
  brief?: ProductBrief | null;
  platform?: string | null;
  goalText?: string | null;
  promo?: CreativeInputs["promo"];
  runDate?: string;
}

/**
 * Everything the script writer needs from the research for one ad. Returns the prompt text plus the
 * choice (so callers can store the picked hooks / end card on the storyboard).
 */
export function creativeBlock(input: CreativeBlockInput): { text: string; choice: CreativeChoice | null; platform: PlatformId } {
  const platform = campaignToPlatform(input.platform);
  const goal = goalFromText(input.goalText);
  const parts = [platformBrief(platform)];
  let choice: CreativeChoice | null = null;
  if (input.brief) {
    parts.push(briefBlock(input.brief));
    choice = selectCreative({ category: TO_CREATIVE_CATEGORY[input.brief.category as SpCategory] ?? "gifts", platform, goal, promo: input.promo, runDate: input.runDate ?? new Date().toISOString() });
    parts.push(choiceBlock(choice));
  }
  parts.push(
    `RULES: frame 1 bright with the product or subject; hero proof and key message by ${goal === "promo" ? "3 s — and the sale pitch (offer + reason to buy now) in the first 3 s" : "the platform hook second"}; product shown at least twice; one idea per ad; every readable text inside the safe box (y 288–1220 on 9:16); no invented numbers, ratings or testimonials.`
  );
  return { text: `\nCREATIVE BRIEF FROM RESEARCH (follow it; brand truth and compliance still win):\n${parts.join("\n")}`, choice, platform };
}
