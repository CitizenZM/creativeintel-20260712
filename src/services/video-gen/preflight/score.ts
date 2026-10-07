/**
 * Pre-flight score — pure. Each check gives 0–1 partial credit against the platform profile
 * (creative/platforms.data.ts: safe zone, ideal length, pacing), weighted per platform: TikTok and
 * Reels live or die on the first second (motion, text, sound), YouTube on the brand by 5 s, feeds on
 * the thumbnail and sound-off captions. Unknowns are left out rather than guessed.
 */
import { platformProfile } from "@/services/creative/library";
import type { PlatformId } from "@/services/creative/types";
import type { PreflightCheck, PreflightMeasures, PreflightPlan, PreflightReport } from "./types";

type Key =
  | "first_frame_brightness"
  | "first_frame_contrast"
  | "first_frame_saturation"
  | "motion_1s"
  | "text_first_s"
  | "product_frame1"
  | "product_repeats"
  | "brand_by_5s"
  | "cut_rate"
  | "captions"
  | "loudness_lufs"
  | "true_peak"
  | "silent_start"
  | "sale_pitch_3s"
  | "cta_end"
  | "safe_zone"
  | "duration";

const BASE: Record<Key, number> = {
  first_frame_brightness: 5,
  first_frame_contrast: 4,
  first_frame_saturation: 3,
  motion_1s: 8,
  text_first_s: 8,
  product_frame1: 7,
  product_repeats: 5,
  brand_by_5s: 5,
  cut_rate: 6,
  captions: 6,
  loudness_lufs: 5,
  true_peak: 3,
  silent_start: 5,
  sale_pitch_3s: 7,
  cta_end: 7,
  safe_zone: 6,
  duration: 5,
};

const FIRST_FRAME: Key[] = ["first_frame_brightness", "first_frame_contrast", "first_frame_saturation"];
const VERTICAL_FEEDS: PlatformId[] = ["instagram_reels", "facebook_reels", "instagram_stories", "snapchat", "youtube_shorts"];
const YOUTUBE: PlatformId[] = ["youtube_instream_skippable", "youtube_instream_nonskippable_15s", "youtube_bumper_6s"];

/** Per-platform multipliers on the base weights. */
export function platformWeights(platform: PlatformId): Record<Key, number> {
  const m: Partial<Record<Key, number>> = {};
  const set = (keys: Key[], k: number) => keys.forEach((key) => (m[key] = (m[key] ?? 1) * k));
  if (platform === "tiktok") {
    set(["motion_1s"], 2);
    set(["text_first_s"], 1.6);
    set(["silent_start"], 1.4);
    set(["cut_rate", "safe_zone"], 1.3);
    set(["loudness_lufs"], 1.2);
    set(["brand_by_5s"], 0.6);
  } else if (VERTICAL_FEEDS.includes(platform)) {
    set(["motion_1s"], 1.5);
    set(["text_first_s", "safe_zone"], 1.3);
    if (platform === "youtube_shorts") set(["brand_by_5s"], 1.2);
  } else if (platform === "meta_feed") {
    set(["captions"], 1.5);
    set(FIRST_FRAME, 1.3);
    set(["silent_start", "loudness_lufs"], 0.7);
  } else if (YOUTUBE.includes(platform)) {
    set(["brand_by_5s"], 2.4);
    set(["product_frame1", "loudness_lufs"], 1.25);
    set(["motion_1s", "text_first_s"], 0.6);
  } else if (platform === "pinterest") {
    set(FIRST_FRAME, 1.5);
    set(["captions"], 1.3);
    set(["motion_1s"], 0.7);
    set(["silent_start"], 0.5);
  } else if (platform === "google_demand_gen") {
    set(["brand_by_5s"], 1.5);
    set(FIRST_FRAME, 1.2);
  }
  return Object.fromEntries((Object.keys(BASE) as Key[]).map((k) => [k, BASE[k] * (m[k] ?? 1)])) as Record<Key, number>;
}

/** The platform's safe zone scaled to the master's canvas (the profile canvas closest in shape). */
export function safeRect(platform: PlatformId, canvas: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const p = platformProfile(platform);
  const list = (Array.isArray(p.canvas[0]) ? p.canvas : [p.canvas]) as [number, number][];
  const ar = canvas.w / canvas.h;
  const [cw, ch] = list.reduce((best, c) => (Math.abs(c[0] / c[1] - ar) < Math.abs(best[0] / best[1] - ar) ? c : best), list[0]);
  const sx = canvas.w / cw;
  const sy = canvas.h / ch;
  const z = p.safeZone;
  const x = Math.round(z.left * sx);
  const y = Math.round(z.top * sy);
  return { x, y, w: Math.round(canvas.w - z.right * sx) - x, h: Math.round(canvas.h - z.bottom * sy) - y };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const OFFER = /\d+\s?%|[$€£]\s?\d|\b(off|save|savings|deals?|sale|discount|coupon|code|free|lowest price|price drop|bogo)\b/i;
const EVENT = /\b(black friday|cyber monday|prime day|boxing day|singles day|holiday sale|labor day|memorial day|back to school)\b/i;
const CTA_WORDS = /\b(shop|buy|order|get yours|get it|tap|learn more|download|install|sign up|claim)\b/i;
const PROMO_GOALS = new Set(["promo", "retarget", "sale", "offer"]);

function merge(shots: { startSec: number; endSec: number }[]): { startSec: number; endSec: number }[] {
  const out: { startSec: number; endSec: number }[] = [];
  for (const s of [...shots].sort((a, b) => a.startSec - b.startSec)) {
    const last = out[out.length - 1];
    if (last && s.startSec - last.endSec <= 0.3) last.endSec = Math.max(last.endSec, s.endSec);
    else out.push({ ...s });
  }
  return out;
}

export function scorePreflight(m: PreflightMeasures, plan: PreflightPlan | null, opts: { platform: PlatformId; goal?: string | null }): PreflightReport {
  const profile = platformProfile(opts.platform);
  const w = platformWeights(opts.platform);
  const d = Math.max(0.1, m.durationSec);
  const goal = (opts.goal ?? plan?.goal ?? "").toLowerCase();
  const sources = new Set<string>();
  if (plan) sources.add("plan");
  const checks: PreflightCheck[] = [];
  const add = (key: Key, label: string, value: number | string | null, target: string, score: number | null, fix: string) => {
    const s = score === null ? null : r2(clamp01(score));
    checks.push({ key, label, value, target, score: s, weight: r2(w[key]), pass: s === null ? null : s >= 0.7, ...(s !== null && s < 0.7 ? { fix } : {}) });
  };

  // Thumbnail / first frame.
  const ff = m.firstFrame;
  add("first_frame_brightness", "First frame brightness", r2(ff.brightness), "0.30–0.75", ff.brightness < 0.3 ? (ff.brightness - 0.08) / 0.22 : (0.95 - ff.brightness) / 0.2,
    ff.brightness < 0.3 ? `First frame is dark (luma ${r2(ff.brightness)} vs ≥ 0.30): open on a lit product shot and drop any fade-up from black — frame 1 is the thumbnail.` : `First frame is blown out (luma ${r2(ff.brightness)} vs ≤ 0.75): pull the exposure down 1/3–2/3 stop.`);
  add("first_frame_contrast", "First frame contrast", r2(ff.contrast), "≥ 0.18 (luma σ)", (ff.contrast - 0.06) / 0.12, `First frame is flat (contrast ${r2(ff.contrast)} vs ≥ 0.18): put a bright subject against a darker ground, or add a bold text block.`);
  add("first_frame_saturation", "First frame colour", r2(ff.saturation), "≥ 0.30", (ff.saturation - 0.08) / 0.22, `First frame is washed out (saturation ${r2(ff.saturation)} vs ≥ 0.30): open on the most colourful shot (screen on, brand colour in frame).`);

  // First second.
  const motionTarget = opts.platform === "tiktok" ? 0.04 : YOUTUBE.includes(opts.platform) ? 0.02 : 0.03;
  add("motion_1s", "Motion in 0–1 s", Math.round(m.motion1s * 1000) / 1000, `≥ ${motionTarget}`, m.motion1s / motionTarget,
    `Only ${r2(m.motion1s)} motion energy in 0–1 s (target ≥ ${motionTarget}): start mid-action — a whip or push-in, or a cut at ~0.5 s.`);

  let textAt: number | null;
  if (plan && plan.texts.length) textAt = Math.min(...plan.texts.map((t) => t.startSec));
  else {
    textAt = m.textOnsetSec;
    sources.add("heuristic");
  }
  const textTarget = Math.min(1, profile.hookSec);
  add("text_first_s", "First on-screen text", textAt === null ? "none" : r2(textAt), `≤ ${textTarget} s`, textAt === null ? 0 : 1 - (textAt - textTarget) / 2,
    textAt === null ? `No on-screen text in the first 3 s: put a ≤ 6-word hook headline on frame 1 (most feeds play muted).` : `First text lands at ${r2(textAt)} s (target ≤ ${textTarget} s): put the hook headline on frame 1.`);

  // Product and brand.
  const shots = plan?.productShots ? merge(plan.productShots) : null;
  const firstProduct = shots?.length ? shots[0].startSec : null;
  add("product_frame1", "Product in frame 1", shots === null ? null : firstProduct === null ? "never" : r2(firstProduct), "0 s", shots === null ? null : firstProduct === null ? 0 : firstProduct <= 0.1 ? 1 : firstProduct <= 1.5 ? 0.5 : 0,
    firstProduct === null ? `The product never gets a clear shot: add a packshot or a zoom hit on it in the first 1 s and the end card.` : `Product first appears at ${r2(firstProduct)} s: open on it (a product-first hook frame) — 0 s, not later.`);
  add("product_repeats", "Product appearances", shots === null ? null : shots.length, "≥ 2", shots === null ? null : shots.length >= 2 ? 1 : shots.length === 1 ? 0.5 : 0,
    `Product is on screen ${shots?.length ?? 0} time(s) (target ≥ 2): bring it back mid-ad (a proof shot) and on the end card.`);

  const brand = (plan?.brandName ?? "").trim().toLowerCase();
  const brandText = brand ? [...(plan?.texts ?? []), ...(plan?.voiceover ?? [])].filter((t) => t.text.toLowerCase().includes(brand)).map((t) => t.startSec) : [];
  const brandAt = plan ? [...brandText, ...(firstProduct === null ? [] : [firstProduct])].reduce<number | null>((a, b) => (a === null ? b : Math.min(a, b)), null) : null;
  add("brand_by_5s", "Brand / product by 5 s", plan ? (brandAt === null ? "never" : r2(brandAt)) : null, "≤ 5 s", plan ? (brandAt === null ? 0 : 1 - (brandAt - 5) / 5) : null,
    `Brand first shows at ${brandAt === null ? "—" : `${r2(brandAt)} s`} (target ≤ 5 s): show the product with its logo or say the brand by second 5.`);

  // Pacing.
  const early = Math.min(6, d);
  const rateEarly = m.cutsSec.filter((t) => t < early).length / early;
  const bodyLen = Math.max(0, d - 6);
  const rateBody = bodyLen > 1 ? m.cutsSec.filter((t) => t >= 6).length / bodyLen : null;
  const fitRate = (r: number, target: number) => {
    const k = r / Math.max(0.05, target);
    return k < 0.8 ? k / 0.8 : k <= 2.2 ? 1 : 1 - (k - 2.2) / 2;
  };
  const cutScore = 0.6 * fitRate(rateEarly, profile.cutsPerSec.first6s) + 0.4 * (rateBody === null ? 1 : fitRate(rateBody, profile.cutsPerSec.body));
  add("cut_rate", "Cuts per second (0–6 s / body)", `${r2(rateEarly)} / ${rateBody === null ? "—" : r2(rateBody)}`, `≈ ${profile.cutsPerSec.first6s} / ${profile.cutsPerSec.body}`, cutScore,
    rateEarly < profile.cutsPerSec.first6s * 0.8
      ? `${r2(rateEarly)} cuts/s in the first 6 s (platform pace ${profile.cutsPerSec.first6s}): cut every ${r2(1 / profile.cutsPerSec.first6s)} s early.`
      : `Cutting faster than the platform pace (${r2(rateEarly)} vs ${profile.cutsPerSec.first6s} cuts/s early, ${rateBody === null ? "—" : r2(rateBody)} vs ${profile.cutsPerSec.body} body): hold proof shots ≥ ${r2(1 / profile.cutsPerSec.body)} s.`);

  const voSec = (plan?.voiceover ?? []).reduce((n, v) => n + Math.max(0, v.endSec - v.startSec), 0);
  const cc = plan?.captionCoverage ?? null;
  add("captions", "Captions over the voiceover", cc === null ? null : r2(cc * 100), "≥ 90 %", cc === null ? null : (cc - 0.5) / 0.4,
    `Captions cover ${cc === null ? "—" : Math.round(cc * 100)} % of the ${r2(voSec)} s voiceover (target ≥ 90 %): caption every spoken line — most feeds play muted.`);

  // Sound.
  const L = m.loudnessLufs;
  add("loudness_lufs", "Integrated loudness", L === null ? "no audio" : r2(L), "-14 LUFS ± 1", L === null ? (profile.soundMode === "off" ? null : 0) : 1 - (Math.abs(L + 14) - 1) / 5,
    L === null ? `No audio track: add music + voiceover normalised to -14 LUFS (${opts.platform} plays sound-on).` : `Loudness ${r2(L)} LUFS (target -14 LUFS for social): ${L < -14 ? "raise" : "lower"} the mix by ${r2(Math.abs(L + 14))} dB with loudnorm I=-14.`);
  const tp = m.truePeakDb;
  add("true_peak", "True peak", tp === null ? null : r2(tp), "≤ -1.0 dBTP", tp === null ? null : 1 - (tp + 1) / 1.5, `True peak ${tp === null ? "—" : r2(tp)} dBTP (target ≤ -1.0): add a true-peak limiter at -1.5 dBTP so platform transcodes don't clip.`);
  add("silent_start", "Sound from the first frame", r2(m.leadingSilenceSec), "≤ 0.2 s silence", m.hasAudio ? 1 - (m.leadingSilenceSec - 0.2) / 0.8 : profile.soundMode === "off" ? null : 0,
    m.hasAudio ? `${r2(m.leadingSilenceSec)} s of silence before the first sound (target ≤ 0.2 s): start the music/SFX hit on frame 1.` : `Silent video (0 s of sound): add a music hit on frame 1.`);

  // Offer and close.
  const isPromo = PROMO_GOALS.has(goal);
  const early3 = plan ? [...plan.texts, ...plan.voiceover].filter((t) => t.startSec < 3).map((t) => t.text) : [];
  const pitched = early3.some((t) => OFFER.test(t));
  const eventOnly = !pitched && early3.some((t) => EVENT.test(t));
  const pitchedLater = plan ? [...plan.texts, ...plan.voiceover].some((t) => t.startSec < 6 && OFFER.test(t.text)) : false;
  add("sale_pitch_3s", "Offer in the first 3 s (promo)", !isPromo || !plan ? null : pitched ? "yes" : eventOnly ? "event only" : "no", "yes", !isPromo || !plan ? null : pitched ? 1 : eventOnly ? 0.5 : pitchedLater ? 0.4 : 0,
    eventOnly
      ? `0–3 s names the sale event but not the offer: add the number (e.g. "26% OFF" or "$349.97") to the hook headline within 3 s.`
      : `No offer in 0–3 s on a promo ad: put the discount (e.g. "40% OFF" or the price) in the hook headline within 3 s.`);

  let ctaScore: number;
  let ctaValue: string;
  const planCta = plan ? (plan.ctaSec !== null && plan.ctaSec <= d - 0.95) || plan.texts.some((t) => t.endSec >= d - 1 && (t.role === "cta" || t.role === "offer" || CTA_WORDS.test(t.text))) : false;
  if (planCta) {
    ctaScore = 1;
    ctaValue = "planned";
  } else {
    const still = m.end.motion < 0.02 && m.end.edgeDensity > 0.06;
    ctaScore = still ? 0.7 : 0;
    ctaValue = still ? "likely (held, text-dense)" : "none";
    sources.add("heuristic");
  }
  add("cta_end", "CTA / end card in the last 1 s", ctaValue, "present", ctaScore, `No CTA in the last second: hold an end card (logo, offer, "Shop now" button) for the final 1.5–3 s.`);

  let szScore: number | null = null;
  let szValue: string | null = null;
  let szFix = "";
  if (plan?.layers?.length) {
    const r = safeRect(opts.platform, { w: m.width, h: m.height });
    const bad = plan.layers.filter((l) => l.x < r.x - 4 || l.y < r.y - 4 || l.x + l.w > r.x + r.w + 4 || l.y + l.h > r.y + r.h + 4);
    szScore = 1 - bad.length / plan.layers.length;
    szValue = `${bad.length}/${plan.layers.length} outside`;
    szFix = `${bad.length} text layer(s) leave the ${opts.platform} safe zone (x ${r.x}–${r.x + r.w}, y ${r.y}–${r.y + r.h}): move ${[...new Set(bad.map((b) => b.role))].join(", ")} inside it.`;
    if (bad.length) szScore = Math.min(szScore, 0.5);
  }
  add("safe_zone", "Text inside the platform safe zone", szValue, "0 outside", szScore, szFix);

  const { ideal, range } = profile.durationSec;
  const durScore = d >= range[0] && d <= range[1] ? 1 - (0.3 * Math.abs(d - ideal)) / Math.max(ideal - range[0], range[1] - ideal, 1) : 0.6 - (d < range[0] ? range[0] - d : d - range[1]) / ideal;
  add("duration", "Length vs platform", r2(d), `${range[0]}–${range[1]} s (ideal ${ideal} s)`, durScore, `${r2(d)} s is outside ${opts.platform}'s ${range[0]}–${range[1]} s window: cut to ~${ideal} s.`);

  const scored = checks.filter((c) => c.score !== null);
  const total = scored.reduce((n, c) => n + c.weight, 0);
  const score = total ? Math.round((100 * scored.reduce((n, c) => n + c.weight * (c.score ?? 0), 0)) / total) : 0;
  const topFixes = scored
    .filter((c) => c.fix)
    .sort((a, b) => b.weight * (1 - (b.score ?? 0)) - a.weight * (1 - (a.score ?? 0)))
    .map((c) => c.fix!)
    .slice(0, 5);
  return {
    version: 1,
    platform: opts.platform,
    score,
    verdict: score >= 80 ? "ready" : score >= 60 ? "fix first" : "rework",
    checks,
    topFixes,
    durationSec: r2(d),
    measuredAt: new Date().toISOString(),
    sources: [...sources],
  };
}
