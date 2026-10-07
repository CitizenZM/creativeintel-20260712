/**
 * Creative library: platform profiles, the 35-hook opening library, the 12 end-card templates and
 * the matching engine (category × platform × goal → 3 diverse hooks + an end card). Creative-fit
 * filters always apply; the research's legal filters (03-hooks-endcards.md Part C.4) only with
 * `strictCompliance`. Pure — no I/O.
 */
import { HOOK_DATA } from "./hooks.data";
import { PLATFORM_PROFILES } from "./platforms.data";
import type { CampaignGoal, CategoryId, CreativeChoice, CreativeInputs, EndCardDef, EndCardId, HookDef, HookFamily, PlatformId, PlatformProfile } from "./types";

/**
 * Strict-union safe box on 1080×1920 (TikTok 34–37% bottom + right rail, Meta Reels 35% bottom /
 * 14% top, Shorts 15% top, Feed 4:5 crop). Readable text, logos, prices and CTAs stay inside it.
 */
export const SAFE_BOX = {
  top: 288,
  bottom: 1220,
  headerBand: { x0: 120, x1: 960, y0: 288, y1: 560 },
  bodyBand: { x0: 240, x1: 840, y0: 560, y1: 1220 },
  ctaZone: { x0: 290, x1: 790, y0: 1100, y1: 1220 },
} as const;

const FAMILY: Record<HookFamily, string[]> = {
  reveal: ["H01", "H02", "H03", "H04", "H05", "H06", "H34"],
  claim: ["H13", "H14", "H15", "H16", "H25", "H30", "H32"],
  native: ["H08", "H17", "H18", "H21", "H26", "H27", "H33"],
  demo: [],
};
const FRAME_ONE_PRODUCT = new Set(["H01", "H02", "H03", "H04", "H16", "H19", "H31"]);
const FACE_HEAVY = new Set(["H07", "H17", "H18", "H21", "H33"]);
const SURPRISE = new Set(["H03", "H06", "H23", "H24", "H34"]);
const USP_BY_3S = new Set(["H01", "H04", "H13", "H15", "H16", "H20", "H22", "H29", "H31"]);

const familyOf = (id: string): HookFamily => (Object.entries(FAMILY).find(([, ids]) => ids.includes(id))?.[0] as HookFamily) ?? "demo";

// Some recipes describe the move inside the keyframe line (H12, H19, H32–H35): fall back to it.
export const HOOKS: HookDef[] = HOOK_DATA.map((h) => ({ ...h, motion: h.motion || h.keyframe, family: familyOf(h.id), frameOneProduct: FRAME_ONE_PRODUCT.has(h.id) }));
export const hookById = (id: string) => HOOKS.find((h) => h.id === id);

export const END_CARDS: EndCardDef[] = [
  { id: "E01", name: "Brand lockup + pill button", useFor: "learn more, awareness, evergreen purchase (default close)", layout: "logo 480×100 y300–400 · product 540×540 y430–970 · headline 56px y990–1095 · pill 500×110 x290–790 y1110–1220", animation: "product 0.85→1.0 back-out · logo fade+slide · headline pop · button damped bounce at 0.55 s then 1.6 Hz ±5% pulse · soft pop", copy: ["Shop now", "Learn more", "Explore the range"], platformFit: "all (small logo on TikTok)", requires: [], policy: "pill is a label, not an imitation of the native button; nothing below y 1220" },
  { id: "E02", name: "Offer badge slam (% off)", useFor: "promo purchase, sale events", layout: "starburst 420×420 at (540,600) −8° with '−30%' 150px · product y760–1080 · deadline 34px y1090–1130 · pill y1140–1220", animation: "badge slam 2.2→1.0 with overshoot 0.18 s + decaying shake · wobble ±2° · button bounce then pulse", copy: ["Shop the sale", "Get {pct}% off", "Unlock deal"], platformFit: "TikTok, Meta DR", requires: ["promoPct"], policy: "% must equal the live landing-page discount; 'up to' when sizes differ" },
  { id: "E03", name: "Coupon ticket (code reveal)", useFor: "coupon claim, creator/affiliate codes", layout: "logo y300–380 · 'Your code:' 52px y440–520 · ticket 600×280 y580–860 (offer stub + mono code 96px) · product y880–1100 · button y1110–1220", animation: "ticket slides in 0.3 s · code typewriter 0.05 s/char · perforation draws · button bounce", copy: ["Claim coupon", "Use code {code}", "Copy code & shop"], platformFit: "Meta DR, YouTube (TikTok: native Gift Code sticker)", requires: ["couponCode"], policy: "code live on the serve date; expiry in the legal line" },
  { id: "E04", name: "Price + strike-through", useFor: "promo purchase, retargeting", layout: "product 600×540 y300–840 · old price 72px grey y880–960 + red strike · new price 150px y960–1110 · 'Save $X' chip · validity 26px y1120–1150 · slim button y1156–1220", animation: "old price fades · strike draws L→R 0.2 s · new price springs up · save chip pops · button pulse", copy: ["Shop now", "Get it for {price}", "Grab the deal"], platformFit: "all — strongest promo close", requires: ["comparePrice"], policy: "FTC 16 CFR 233: compare-at must be the bona-fide former price, read live (< 24 h) at render; refuse if compare ≤ price" },
  { id: "E05", name: "Urgency / deadline bar", useFor: "sale ending, limited drop, final day", layout: "red bar 840×130 y300–430 'ENDS SUNDAY 11:59 PM' · product y460–980 · offer 64px y1000–1090 · button y1110–1220", animation: "bar wipes in · clock ticks · day-count flip · glow · button bounce", copy: ["Shop before {day}", "Last chance", "Get it today"], platformFit: "TikTok (native Countdown sticker preferred), Meta", requires: ["deadline"], policy: "real calendar deadline only, never a baked HH:MM:SS timer; auto-expire the creative" },
  { id: "E06", name: "Rating + testimonial", useFor: "cold purchase, consideration, high ticket", layout: "5 stars 464px y320–400 · '4.6 · 12,480 reviews' y415–470 · quote card 600×300 y560–860 (≤14 words + 'Verified buyer') · product y880–1100 · button y1110–1220", animation: "stars fill one by one · rating fades · quote slides up word by word · button pulse", copy: ["See why", "Shop the bestseller", "Read reviews"], platformFit: "Meta (strong), Shorts, TikTok (native-styled quote)", requires: ["rating"], policy: "real, attributable, current rating and quote; never rounded up to 5.0; no AI testimonials" },
  { id: "E07", name: "Product carousel (multi-SKU)", useFor: "catalog, collections, 'which one is yours?'", layout: "centre tile 360×460 y520–980 + side tiles 60% · title 60px y330–420 · price row y1000–1080 · button y1110–1220", animation: "tiles shift every 0.6 s, centre 1.0 / sides 0.8, price cross-fade; hold hero SKU", copy: ["Shop all sizes", "Find yours", "Compare models"], platformFit: "Meta (Advantage+ catalog), TikTok", requires: ["multiSku"], policy: "every tile's price live" },
  { id: "E08", name: "Bundle / gift tag", useFor: "gifting seasons, bundles, gift-with-purchase", layout: "2–3 products y440–980 · ribbon across · kraft gift tag 260×200 at x580–840 y380–580 · benefit 34px y1000–1080 · button y1110–1220", animation: "ribbon wipe · products pop staggered · tag drops and swings (damped pendulum) · sparkle · button bounce · sleigh-bell chime in Q4", copy: ["Shop gift sets", "Give the bundle", "Claim free gift"], platformFit: "TikTok, Reels, Meta in Q4 / Valentine's / Mother's Day", requires: [], policy: "'arrives by' dates match the shipping cut-off; bundle savings as E04" },
  { id: "E09", name: "Tap-below pointer", useFor: "drive taps on the platform's own CTA / Shop anchor", layout: "product 600×600 y300–900 · headline 64px y930–1050 'Tap Shop Now ↓' · arrow 120×140 y1080–1220 (no baked button)", animation: "headline pop · arrow bobs 2 Hz 18 px · ring ripple every 0.5 s", copy: ["Tap Shop Now below", "Tap the cart"], platformFit: "TikTok (Shop/in-feed), Reels, Shorts", requires: [], policy: "never draw a fake native button; 'link in bio' only for Spark/organic" },
  { id: "E10", name: "App-install card", useFor: "app install", layout: "icon 240 y320–560 · name · rating · benefit 2 lines · official store badges y1110–1200", animation: "icon spring + shine · rating counts up · badges slide up staggered (badges never pulse)", copy: ["Install now", "Get the app", "Try free"], platformFit: "all, app objectives", requires: ["appInstall"], policy: "official badge art only, store clear-space rules; current store rating only" },
  { id: "E11", name: "QR code card", useFor: "CTV, desktop, in-store screens", layout: "'Scan to shop' 64px y320–420 · white tile 440×440 y470–910 (QR 360, quiet zone ≥4) · product y940–1140 · short URL y1150–1200", animation: "tile scales in · scanner brackets pulse 1.5 Hz · hold ≥ 3 s and say 'scan' in VO", copy: ["Scan to shop", "Scan for {pct}% off"], platformFit: "YouTube CTV, desktop Meta, in-store", requires: ["ctvPlacement"], policy: "not for phone-feed placements" },
  { id: "E12", name: "Creator-native close (lo-fi caption)", useFor: "TikTok-first DR, creator/UGC/Spark", layout: "no card — last clip keeps playing · native white sticker x240–840 y860–1060 · optional mini logo y300–350 at 70%", animation: "sticker pops 0→1.08→1 · emoji wiggle · no button", copy: ["link's right there 👇", "trust me on this one"], platformFit: "TikTok, Reels", requires: [], policy: "keeps tonal continuity; still label AIGC" },
];
export const endCardById = (id: EndCardId) => END_CARDS.find((e) => e.id === id)!;

/** C.1 — category × goal → hooks (primary first) and end cards. */
const MATRIX: Record<CategoryId, Record<"cold" | "retarget" | "promo" | "awareness", { hooks: string[]; ends: EndCardId[] }>> = {
  electronics: { cold: { hooks: ["H10", "H20", "H15"], ends: ["E06"] }, retarget: { hooks: ["H04", "H16"], ends: ["E04"] }, promo: { hooks: ["H16", "H06"], ends: ["E04", "E02", "E05"] }, awareness: { hooks: ["H34", "H03"], ends: ["E01"] } },
  camera: { cold: { hooks: ["H22", "H31", "H20"], ends: ["E06"] }, retarget: { hooks: ["H29", "H04"], ends: ["E04"] }, promo: { hooks: ["H16", "H06"], ends: ["E02", "E03"] }, awareness: { hooks: ["H34", "H12"], ends: ["E01"] } },
  auto: { cold: { hooks: ["H31", "H09", "H08"], ends: ["E06", "E09"] }, retarget: { hooks: ["H26", "H04"], ends: ["E04"] }, promo: { hooks: ["H16", "H24"], ends: ["E04", "E03"] }, awareness: { hooks: ["H23", "H34"], ends: ["E01"] } },
  kitchen: { cold: { hooks: ["H11", "H09", "H35"], ends: ["E06"] }, retarget: { hooks: ["H13", "H26"], ends: ["E04"] }, promo: { hooks: ["H16", "H06"], ends: ["E02", "E04"] }, awareness: { hooks: ["H12", "H23"], ends: ["E01"] } },
  home_air: { cold: { hooks: ["H09", "H10", "H15"], ends: ["E06"] }, retarget: { hooks: ["H29", "H13"], ends: ["E04"] }, promo: { hooks: ["H16", "H05"], ends: ["E02", "E03"] }, awareness: { hooks: ["H23", "H03"], ends: ["E01"] } },
  beauty: { cold: { hooks: ["H11", "H17", "H02"], ends: ["E06", "E12"] }, retarget: { hooks: ["H18", "H26"], ends: ["E04", "E03"] }, promo: { hooks: ["H16", "H06"], ends: ["E08", "E03"] }, awareness: { hooks: ["H35", "H02"], ends: ["E01"] } },
  jewelry: { cold: { hooks: ["H02", "H27", "H23"], ends: ["E06"] }, retarget: { hooks: ["H32", "H04"], ends: ["E04"] }, promo: { hooks: ["H06", "H24"], ends: ["E08", "E03"] }, awareness: { hooks: ["H03", "H23"], ends: ["E01"] } },
  sports: { cold: { hooks: ["H22", "H08", "H31"], ends: ["E06", "E12"] }, retarget: { hooks: ["H13", "H29"], ends: ["E04"] }, promo: { hooks: ["H16", "H24"], ends: ["E02", "E03"] }, awareness: { hooks: ["H34", "H12"], ends: ["E01"] } },
  home: { cold: { hooks: ["H12", "H10", "H19"], ends: ["E06"] }, retarget: { hooks: ["H26", "H13"], ends: ["E04"] }, promo: { hooks: ["H16"], ends: ["E02", "E05"] }, awareness: { hooks: ["H23"], ends: ["E01"] } },
  food: { cold: { hooks: ["H35", "H11"], ends: ["E12", "E06"] }, retarget: { hooks: ["H32", "H13"], ends: ["E04"] }, promo: { hooks: ["H16", "H24"], ends: ["E03"] }, awareness: { hooks: ["H23", "H35"], ends: ["E01"] } },
  health: { cold: { hooks: ["H17", "H14"], ends: ["E06"] }, retarget: { hooks: ["H26"], ends: ["E03"] }, promo: { hooks: ["H16"], ends: ["E03"] }, awareness: { hooks: ["H23"], ends: ["E01"] } },
  gifts: { cold: { hooks: ["H06", "H05", "H19"], ends: ["E08"] }, retarget: { hooks: ["H32"], ends: ["E07"] }, promo: { hooks: ["H16", "H24"], ends: ["E08", "E02"] }, awareness: { hooks: ["H24", "H23"], ends: ["E01"] } },
  apps: { cold: { hooks: ["H25", "H09", "H17"], ends: ["E10"] }, retarget: { hooks: ["H26"], ends: ["E10"] }, promo: { hooks: ["H16"], ends: ["E10"] }, awareness: { hooks: ["H14", "H15"], ends: ["E10", "E01"] } },
};

/** C.2 — platform hook / end-card bias. */
const PLATFORM_BIAS: Record<PlatformId, { hooks: string[]; ends: EndCardId[] }> = {
  tiktok: { hooks: ["H08", "H17", "H18", "H21", "H26", "H33"], ends: ["E12", "E09", "E03", "E05"] },
  instagram_reels: { hooks: ["H01", "H04", "H13"], ends: ["E06", "E04", "E02", "E01"] },
  instagram_stories: { hooks: ["H04", "H13", "H14"], ends: ["E09", "E02", "E01"] },
  meta_feed: { hooks: ["H01", "H04", "H13", "H16"], ends: ["E06", "E04", "E02", "E01"] },
  facebook_reels: { hooks: ["H01", "H04", "H13", "H16"], ends: ["E06", "E04", "E02", "E01"] },
  youtube_shorts: { hooks: ["H15", "H31", "H22", "H34"], ends: ["E01", "E04", "E10"] },
  youtube_instream_skippable: { hooks: ["H34", "H03", "H15", "H31"], ends: ["E01", "E04", "E11"] },
  youtube_instream_nonskippable_15s: { hooks: ["H34", "H03", "H04"], ends: ["E01", "E04"] },
  youtube_bumper_6s: { hooks: ["H04", "H03", "H15"], ends: ["E01"] },
  google_demand_gen: { hooks: ["H01", "H15", "H31", "H16"], ends: ["E04", "E01"] },
  pinterest: { hooks: ["H23", "H02", "H13"], ends: ["E01", "E08"] },
  snapchat: { hooks: ["H04", "H28", "H17"], ends: ["E12", "E09"] },
};

export function platformProfile(id: PlatformId): PlatformProfile {
  const p = PLATFORM_PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown platform ${id}`);
  return p;
}

/** Nov 15–Dec 22, Feb 1–14, and the 3 weeks before Mother's Day (2nd Sunday of May). */
export function inGiftingWindow(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if ((m === 11 && day >= 15) || (m === 12 && day <= 22)) return true;
  if (m === 2 && day <= 14) return true;
  const may1 = new Date(Date.UTC(d.getUTCFullYear(), 4, 1));
  const mothersDay = new Date(Date.UTC(d.getUTCFullYear(), 4, 1 + ((7 - may1.getUTCDay()) % 7) + 7));
  const diff = (mothersDay.getTime() - d.getTime()) / 86_400_000;
  return diff >= 0 && diff <= 21;
}

const DAY = 86_400_000;

function promoState(i: CreativeInputs): { pct: boolean; compare: boolean; code: boolean; deadline: boolean } {
  const p = i.promo ?? {};
  // Strict mode only: the compare-at price must have been checked in the last 24 h. Otherwise the
  // numbers being there is enough to render the card.
  const fresh = !i.strictCompliance || (p.priceCheckedAt ? Date.now() - Date.parse(p.priceCheckedAt) < DAY : false);
  const compare = !!(p.comparePrice && p.price && p.comparePrice > p.price && fresh);
  const deadline = !!(p.deadline && Date.parse(p.deadline) > Date.parse(i.runDate ?? new Date().toISOString()));
  return { pct: !!(p.pct && p.pct > 0) || compare, compare, code: !!p.code?.trim(), deadline };
}

function endCardAllowed(e: EndCardDef, i: CreativeInputs, s: ReturnType<typeof promoState>): boolean {
  return e.requires.every((r) =>
    r === "promoPct" ? s.pct
    : r === "comparePrice" ? s.compare
    : r === "couponCode" ? s.code
    : r === "deadline" ? s.deadline
    : r === "rating" ? !!i.assets?.rating && i.assets.rating.value > 0 && i.assets.rating.count > 0
    : r === "multiSku" ? !!i.assets?.multiSku
    : r === "appInstall" ? i.goal === "app_install"
    : r === "ctvPlacement" ? !!i.ctv
    : true
  );
}

function hookAllowed(h: HookDef, i: CreativeInputs, s: ReturnType<typeof promoState>): string | null {
  // Creative fit (always): generated faces morph, a price slam needs a number, awareness/lead isn't a deal.
  if (h.aiFit === "low" && h.id !== "H22" && !i.assets?.creatorFootage) return "needs real creator footage (AI faces morph)";
  if (h.id === "H16" && !s.pct) return i.strictCompliance ? "deal slam needs a verified live discount" : "deal slam needs a discount (% or compare-at price)";
  if (h.id === "H16" && (i.goal === "awareness" || i.goal === "lead")) return "a price slam doesn't fit an awareness/lead goal";
  // Legal gating (strict mode only).
  if (i.strictCompliance) {
    if (h.id === "H22" && !i.assets?.realTestFootage) return "torture-test claims need real footage";
    if (["H10", "H22", "H15"].includes(h.id) && i.category === "health") return "result claims restricted for health";
  }
  return null;
}

/**
 * Pick 3 opening hooks (one reveal, one claim/text, one native/demo — forced diversity) and an end
 * card, applying the creative-fit filters (+ the legal ones when strictCompliance) and scoring. Deterministic.
 */
export function selectCreative(i: CreativeInputs): CreativeChoice {
  const s = promoState(i);
  const gifting = i.runDate ? inGiftingWindow(i.runDate) : false;
  const goalKey = (i.goal === "app_install" || i.goal === "lead" ? "cold" : i.goal) as "cold" | "retarget" | "promo" | "awareness";
  const cell = MATRIX[i.category][goalKey];
  const bias = PLATFORM_BIAS[i.platform];
  const notes: string[] = [];

  const candidates = new Map<string, { score: number; why: string[] }>();
  const add = (id: string, pts: number, why: string) => {
    const c = candidates.get(id) ?? { score: 0, why: [] };
    c.score += pts;
    c.why.push(why);
    candidates.set(id, c);
  };
  cell.hooks.forEach((id, k) => add(id, k === 0 ? 4 : 3, k === 0 ? "category × goal primary" : "category × goal alternate"));
  bias.hooks.forEach((id) => add(id, 1, `${i.platform} bias`));
  if (gifting) ["H06", "H24"].forEach((id) => add(id, 3, "gifting window"));
  if (i.goal === "promo" && s.pct) add("H16", 2, "live discount");
  // Keep the whole library in play at low weight so every family can be filled.
  HOOKS.forEach((h) => add(h.id, 0, "library"));

  const scored: { hook: HookDef; score: number; why: string[] }[] = [];
  for (const [id, c] of candidates) {
    const hook = hookById(id);
    if (!hook) continue;
    const blocked = hookAllowed(hook, i, s);
    if (blocked) {
      if (c.score > 0) notes.push(`${id} ${hook.name} dropped: ${blocked}`);
      continue;
    }
    let score = c.score;
    const why = c.why.filter((w) => w !== "library");
    if (hook.frameOneProduct) (score += 3), why.push("frame 1 shows the product");
    if (hook.sfx) (score += 2), why.push("visual + sound cue");
    if (USP_BY_3S.has(id)) (score += 2), why.push("USP by 3 s");
    if (i.goal === "awareness" && SURPRISE.has(id)) (score += 1), why.push("surprise opener");
    if (i.platform === "tiktok" && hook.family === "native") (score += 1), why.push("native on TikTok");
    if (FACE_HEAVY.has(id)) (score -= 2), why.push("generated faces on screen");
    const pb = i.bias?.[id];
    if (pb) (score += pb), why.push(`performance ${pb > 0 ? "+" : ""}${pb}`);
    scored.push({ hook, score, why });
  }
  scored.sort((a, b) => b.score - a.score || a.hook.id.localeCompare(b.hook.id));

  // Diversity: best reveal, best claim, best native (or demo when no native survives).
  const pick: typeof scored = [];
  for (const fam of ["reveal", "claim", "native"] as HookFamily[]) {
    const best = scored.find((x) => (x.hook.family === fam || (fam === "native" && x.hook.family === "demo")) && !pick.includes(x));
    if (best) pick.push(best);
  }
  for (const x of scored) if (pick.length < 3 && !pick.includes(x)) pick.push(x);
  pick.sort((a, b) => b.score - a.score);

  // End card: goal × promo state (B.3), category order, platform bias, gifting, CTV — then hard filters.
  const order: EndCardId[] = [];
  const push = (...ids: EndCardId[]) => ids.forEach((id) => !order.includes(id) && order.push(id));
  if (i.ctv) push("E11");
  if (i.goal === "app_install") push("E10");
  if (gifting) push(...(s.code ? (["E03"] as EndCardId[]) : []), "E08");
  if (s.code && (i.goal === "promo" || i.goal === "retarget" || i.goal === "cold")) push("E03");
  if (s.deadline && (i.goal === "promo" || i.goal === "retarget")) push("E05");
  if (s.compare) push("E04");
  if (s.pct) push("E02");
  if (i.assets?.multiSku) push("E07");
  push(...cell.ends, ...bias.ends, "E01");
  const allowed = order.map(endCardById).filter((e) => endCardAllowed(e, i, s));
  // Performance bias: rank = −position + bias (stable; no bias keeps the rule order).
  if (i.bias) allowed.sort((a, b) => order.indexOf(a.id) - (i.bias?.[a.id] ?? 0) - (order.indexOf(b.id) - (i.bias?.[b.id] ?? 0)));
  for (const id of order) if (!allowed.find((e) => e.id === id)) notes.push(`${id} ${endCardById(id).name} skipped: missing ${endCardById(id).requires.join("/")}`);

  const labels: string[] = [];
  if (i.strictCompliance && ["tiktok", "instagram_reels", "instagram_stories", "meta_feed", "facebook_reels", "youtube_shorts", "youtube_instream_skippable", "youtube_instream_nonskippable_15s", "youtube_bumper_6s", "google_demand_gen"].includes(i.platform))
    labels.push("AI-generated content label (realistic synthetic people/voice)");

  return { hooks: pick.slice(0, 3), endCard: allowed[0] ?? endCardById("E01"), alternates: allowed.slice(1, 4), labels, notes };
}

/** One-paragraph brief of a platform's rules for an LLM prompt (≈ 90 words). */
export function platformBrief(id: PlatformId): string {
  const p = platformProfile(id);
  return [
    `PLATFORM ${id}: audience ${p.audience.ageCore}, ${p.audience.genderSkew}; mindset ${p.audience.mindset}; tone ${p.audience.tone}.`,
    `Length ideal ${p.durationSec.ideal}s (${p.durationSec.range[0]}–${p.durationSec.range[1]}s); hook + key message by ${p.hookSec}s; cuts ~${p.cutsPerSec.first6s}/s early, ${p.cutsPerSec.body}/s after; sound ${p.soundMode}.`,
    `Style: ${p.styleTags.slice(0, 5).join(", ")}. Captions: ${p.captionStyle}. Voice: ${p.voiceTone}. Music: ${p.musicStyle}. CTA: ${p.ctaStyle}. Branding: ${p.branding}.`,
    `Never: ${p.doNots.slice(0, 5).join("; ")}.`,
  ].join(" ");
}

export type { CampaignGoal, CategoryId };
