/**
 * Attention blueprint — how a 15/20/30 s feed ad holds a viewer, second by
 * second, and a deterministic score for how closely a script follows it.
 *
 * The rules are the measured ones from the libtv-video-ad skill (hook grammar,
 * shot design, QC benchmarks on official TCL / Hisense / Walmart ads) plus the
 * platform playbooks: the decision to stay is made in the first 1–3 s, the
 * hook must pose something the ad pays off before 5 s, a new visual reason to
 * keep watching ("re-hook") arrives at least every ~6 s, and the CTA is short
 * and lands at the end. Competitor timing measured from this project's own
 * teardowns is quoted alongside, so the script is written against evidence.
 */

export interface BlueprintSection {
  key: "HOOK" | "PAYOFF" | "PROOF" | "REHOOK" | "OFFER" | "CTA";
  startSec: number;
  endSec: number;
  job: string;
  devices: string[];
}

export const HOOK_MAX_SEC = 3;
export const CTA_MAX_SEC = 4;
export const PAYOFF_BY_SEC = 5;
export const REHOOK_EVERY_SEC = 6;
/** Comfortable spoken pace for ad voiceover (words per second). */
export const VO_WPS = { min: 1.5, max: 3.2 };

/** The section plan for a duration. Hook 2 s (3 s for 30 s+), CTA 3–4 s, re-hooks spaced ≤ 6 s. */
export function attentionBlueprint(totalSec: number): BlueprintSection[] {
  const total = Math.max(10, Math.round(totalSec));
  const hookEnd = total >= 30 ? 3 : 2;
  const ctaLen = total <= 15 ? 3 : CTA_MAX_SEC;
  const ctaStart = total - ctaLen;
  const offerStart = Math.max(hookEnd + 4, ctaStart - (total >= 30 ? 4 : 2));
  const payoffEnd = Math.min(PAYOFF_BY_SEC, offerStart);
  const sections: BlueprintSection[] = [
    {
      key: "HOOK",
      startSec: 0,
      endSec: hookEnd,
      job: "Stop the scroll: pose a question, a contrast or a product blast the rest of the ad answers.",
      devices: [
        "frame 1 is bright and already shows the product or the person with the problem — no build-up",
        "on-screen hook line of at most 7 words, readable with the sound off",
        "a cut or punch-in every ~1 s; movement in frame from the first frame",
      ],
    },
    {
      key: "PAYOFF",
      startSec: hookEnd,
      endSec: payoffEnd,
      job: "Turn: name the product and start answering the hook before 5 s.",
      devices: ["product and brand on screen", "the music drop / flash cut lands here"],
    },
  ];
  // Proof beats with a re-hook at least every REHOOK_EVERY_SEC seconds.
  let t = payoffEnd;
  let i = 0;
  while (t < offerStart - 0.5) {
    const end = Math.min(offerStart, t + Math.min(REHOOK_EVERY_SEC, Math.max(2, offerStart - t)));
    sections.push({
      key: i === 0 ? "PROOF" : "REHOOK",
      startSec: t,
      endSec: end,
      job:
        i === 0
          ? "Prove the strongest claim visually — demo, spec → benefit, side-by-side."
          : "Re-hook: a new visual reason to keep watching (new angle, close-up, stat, social proof, surprising use).",
      devices: ["one selling point per beat, shown not told", "a short claim chip only if the voiceover doesn't already say it"],
    });
    t = end;
    i++;
  }
  sections.push(
    {
      key: "OFFER",
      startSec: offerStart,
      endSec: ctaStart,
      job: "State the offer or the reason to act now.",
      devices: ["price / saving / deadline as a big on-screen number", "music breakdown builds into the CTA"],
    },
    {
      key: "CTA",
      startSec: ctaStart,
      endSec: total,
      job: "One clear action, product on screen, button lands on a beat.",
      devices: [`at most ${CTA_MAX_SEC} s`, "imperative verb (Shop / Get / Try)", "brand + product visible to the last frame"],
    }
  );
  return sections;
}

// ─── Competitor timing evidence ─────────────────────────────────────────────

export interface TeardownTiming {
  hookType?: string | null;
  beats?: { startSec?: number; endSec?: number; role?: string }[] | null;
  durationSec?: number | null;
}

export interface TimingEvidence {
  ads: number;
  medianHookSec: number | null;
  medianBeatSec: number | null;
  medianCtaShare: number | null;
  topHookTypes: { type: string; count: number }[];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
}

/** What the top competitor ads in this project actually do, measured from their teardowns. */
export function timingEvidence(teardowns: TeardownTiming[]): TimingEvidence {
  const hooks: number[] = [];
  const beatLens: number[] = [];
  const ctaShares: number[] = [];
  const types = new Map<string, number>();
  for (const t of teardowns) {
    if (t.hookType) types.set(t.hookType, (types.get(t.hookType) ?? 0) + 1);
    const beats = (t.beats ?? []).filter((b) => Number.isFinite(b.startSec) && Number.isFinite(b.endSec) && (b.endSec as number) > (b.startSec as number));
    if (!beats.length) continue;
    const first = beats[0];
    if ((first.endSec as number) <= 10) hooks.push(first.endSec as number);
    for (const b of beats) beatLens.push((b.endSec as number) - (b.startSec as number));
    const end = Math.max(...beats.map((b) => b.endSec as number), t.durationSec ?? 0);
    const cta = beats.find((b) => /cta|call|offer|end/i.test(b.role ?? ""));
    if (cta && end > 0) ctaShares.push((cta.startSec as number) / end);
  }
  return {
    ads: teardowns.length,
    medianHookSec: median(hooks),
    medianBeatSec: median(beatLens),
    medianCtaShare: median(ctaShares),
    topHookTypes: [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => ({ type, count })),
  };
}

/** The blueprint as a prompt block for script and storyboard writing. */
export function renderAttentionBlock(totalSec: number, evidence?: TimingEvidence | null): string {
  const lines = attentionBlueprint(totalSec).map(
    (s) => `- ${s.startSec}–${s.endSec}s ${s.key}: ${s.job} (${s.devices.join("; ")})`
  );
  const ev =
    evidence && evidence.ads
      ? `\nMEASURED ON THIS CATEGORY'S TOP ${evidence.ads} COMPETITOR ADS: ${[
          evidence.medianHookSec !== null ? `hook resolves at ~${evidence.medianHookSec}s` : null,
          evidence.medianBeatSec !== null ? `a new beat every ~${evidence.medianBeatSec}s` : null,
          evidence.medianCtaShare !== null ? `CTA starts at ~${Math.round(evidence.medianCtaShare * 100)}% of the ad` : null,
          evidence.topHookTypes.length ? `most-used hooks: ${evidence.topHookTypes.map((h) => `${h.type} (${h.count})`).join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; ")}. Match their pace or beat it; differentiate on the hook.`
      : "";
  return `ATTENTION BLUEPRINT for a ${Math.round(totalSec)}s ad (overrides the template's hook/CTA percentages where they conflict):
${lines.join("\n")}
Hard rules: hook ≤ ${HOOK_MAX_SEC}s and its on-screen line ≤ 7 words; the payoff starts before ${PAYOFF_BY_SEC}s; no body beat longer than ${REHOOK_EVERY_SEC}s; CTA ≤ ${CTA_MAX_SEC}s with an imperative verb; voiceover ${VO_WPS.min}–${VO_WPS.max} words per second (never wall-to-wall); every textOverlay ≤ 7 words and adds something the voiceover doesn't say.${ev}`;
}

// ─── Script attention score ─────────────────────────────────────────────────

export interface ScriptForScoring {
  totalDurationSec?: number | null;
  hook?: { text?: string | null; durationSec?: number | null; visual?: string | null } | null;
  body?: { startSec?: number; endSec?: number; voiceover?: string | null; textOverlay?: string | null; proof?: string | null }[] | null;
  cta?: { text?: string | null; offer?: string | null; durationSec?: number | null } | null;
  productName?: string | null;
  brandName?: string | null;
}

export interface AttentionCheck {
  key: string;
  label: string;
  pass: boolean;
  weight: number;
  fix: string;
}

const wc = (t?: string | null) => (t ?? "").trim().split(/\s+/).filter(Boolean).length;

/** 0–100: how closely a script follows the blueprint, with the fix for each miss. Pure. */
export function scoreScriptAttention(s: ScriptForScoring): { score: number; checks: AttentionCheck[] } {
  const total = s.totalDurationSec || 30;
  const body = s.body ?? [];
  const hookSec = s.hook?.durationSec ?? 0;
  const firstBody = body[0]?.startSec ?? hookSec;
  const longestBeat = body.reduce((m, b) => Math.max(m, (b.endSec ?? 0) - (b.startSec ?? 0)), 0);
  const voWords = wc(s.hook?.text) + body.reduce((n, b) => n + wc(b.voiceover), 0) + wc(s.cta?.text);
  const wps = voWords / Math.max(1, total);
  const overlays = body.map((b) => b.textOverlay ?? "").filter((t) => t.trim() && !/^none$/i.test(t.trim()));
  const proofBeats = body.filter((b) => /\d|%|review|rated|vs\.?|compared|before|after|tested|award|★|stars?/i.test(`${b.proof ?? ""} ${b.voiceover ?? ""} ${b.textOverlay ?? ""}`)).length;
  const brandEarly = [s.hook?.text, s.hook?.visual, body[0]?.voiceover, body[0]?.textOverlay]
    .join(" ")
    .toLowerCase()
    .includes((s.brandName || s.productName || "\u0000").toLowerCase());
  const checks: AttentionCheck[] = [
    { key: "hook_len", label: `Hook ≤ ${HOOK_MAX_SEC} s`, pass: hookSec > 0 && hookSec <= HOOK_MAX_SEC, weight: 15, fix: `Cut the hook to ${HOOK_MAX_SEC} s or less — move the setup into the body.` },
    { key: "hook_words", label: "Hook line ≤ 12 words", pass: wc(s.hook?.text) > 0 && wc(s.hook?.text) <= 12, weight: 10, fix: "Shorten the hook line to one punchy question or claim (≤ 12 words)." },
    { key: "payoff", label: `Payoff starts before ${PAYOFF_BY_SEC} s`, pass: firstBody <= PAYOFF_BY_SEC, weight: 15, fix: `Start answering the hook by ${PAYOFF_BY_SEC} s.` },
    { key: "brand_early", label: "Brand or product named in the hook / first beat", pass: brandEarly, weight: 10, fix: "Say or show the brand/product in the first beat." },
    { key: "rehook", label: `No body beat longer than ${REHOOK_EVERY_SEC} s`, pass: longestBeat <= REHOOK_EVERY_SEC, weight: 10, fix: `Split long beats so a new visual reason arrives every ${REHOOK_EVERY_SEC} s.` },
    { key: "proof", label: "At least 2 beats carry concrete proof", pass: proofBeats >= Math.min(2, body.length), weight: 10, fix: "Add a number, demo result, review or side-by-side to at least two beats." },
    { key: "vo_pace", label: `Voiceover ${VO_WPS.min}–${VO_WPS.max} words/s`, pass: wps >= VO_WPS.min && wps <= VO_WPS.max, weight: 10, fix: wps > VO_WPS.max ? "Cut voiceover words — it can't be spoken in time." : "Add voiceover — long silent stretches lose viewers with sound on." },
    { key: "overlay_len", label: "On-screen text ≤ 7 words each", pass: overlays.every((t) => wc(t) <= 7), weight: 5, fix: "Shorten on-screen text to ≤ 7 words; the captions carry the rest." },
    { key: "cta_len", label: `CTA ≤ ${CTA_MAX_SEC} s`, pass: (s.cta?.durationSec ?? 0) > 0 && (s.cta?.durationSec ?? 0) <= CTA_MAX_SEC, weight: 10, fix: `Keep the CTA to ${CTA_MAX_SEC} s or less.` },
    { key: "cta_verb", label: "CTA uses an imperative verb", pass: /\b(shop|buy|get|try|order|grab|claim|start|book|sign up|download|discover|see|save)\b/i.test(s.cta?.text ?? ""), weight: 5, fix: "Open the CTA with Shop / Get / Try / Save." },
  ];
  const max = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  return { score: Math.round((got / max) * 100), checks };
}

// ─── Reference ad (structure transfer) ──────────────────────────────────────

export interface ReferenceAd {
  title: string;
  owner?: string | null;
  viewCount?: number | null;
  hookType?: string | null;
  hookText?: string | null;
  whyItWorks?: string | null;
  beats: { startSec: number; endSec: number; role?: string; visual?: string; onScreenText?: string }[];
}

/**
 * The best-performing torn-down ad in the category, as a beat timeline the
 * script copies the STRUCTURE and PACE of — never its words, footage or brand.
 */
export function renderReferenceBlock(ref: ReferenceAd | null | undefined): string {
  if (!ref || !ref.beats.length) return "";
  const views = ref.viewCount ? `${ref.viewCount >= 1e6 ? `${(ref.viewCount / 1e6).toFixed(1)}M` : ref.viewCount >= 1e3 ? `${Math.round(ref.viewCount / 1e3)}K` : ref.viewCount} views` : "top-ranked";
  const timeline = ref.beats
    .slice(0, 10)
    .map((b) => {
      const what = [b.visual?.slice(0, 90), b.onScreenText ? `on-screen "${b.onScreenText.slice(0, 40)}"` : ""].filter(Boolean).join("; ");
      return `  ${Math.round(b.startSec * 10) / 10}–${Math.round(b.endSec * 10) / 10}s ${(b.role || "beat").toUpperCase()}${what ? `: ${what}` : ""}`;
    })
    .join("\n");
  return `REFERENCE AD TO EMULATE — the best performer we tore down in this category: "${ref.title.slice(0, 80)}"${ref.owner ? ` by ${ref.owner}` : ""} (${views}${ref.hookType ? `, ${ref.hookType} hook` : ""}).
Its beat timeline:
${timeline}${ref.whyItWorks ? `\nWhy it works: ${ref.whyItWorks.slice(0, 300)}` : ""}
Mirror its STRUCTURE and PACE — beat roles, order, timing, where the proof and the offer land — scaled to our duration and the attention blueprint. Use only our brand, product and approved claims; never copy its words, footage or branding.`;
}
