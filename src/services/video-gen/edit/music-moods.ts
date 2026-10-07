/**
 * Music moods for the synthesised bed (music-synth.ts): ids, tempo ranges, mix levels, and how a
 * mood is chosen from the plan's musicMood string, the product category and the platform. Pure (no
 * ffmpeg, no sharp), so the planner and the batch matrix can import it.
 *
 *   pop              the original four-on-the-floor EDM-pop bed (vi–IV–I–V, pumping saws)
 *   holiday          celesta "Jingle Bells", sleigh bells, soft piano (seasonal copy)
 *   upbeat-pop       bright I–V–vi–IV, off-beat piano, claps, shaker, plucked hook
 *   chill-lofi       swung boom-bap, dusty 7th/9th e-piano chords (ii–V–I–vi), vinyl crackle
 *   cinematic-build  i–VI–III–VII strings that swell, toms, an 8th-note ostinato, braam on the drop
 *   energetic-edm    128-ish house: four on the floor, off-beat bass, supersaw stabs, hard pump
 *   warm-acoustic    strummed I–vi–IV–V, cajón, shaker, glockenspiel melody
 *   luxury-minimal   descending maj7 chords, deep sine bass, finger snaps, sparse bell line
 */
export const MOOD_IDS = ["pop", "holiday", "upbeat-pop", "chill-lofi", "cinematic-build", "energetic-edm", "warm-acoustic", "luxury-minimal"] as const;
export type MoodId = (typeof MOOD_IDS)[number];

export function isMoodId(x: unknown): x is MoodId {
  return typeof x === "string" && (MOOD_IDS as readonly string[]).includes(x);
}

/** Nominal tempo and the range the edit may move it within so cuts land on beats (beat-grid fitTempo). */
export const MOOD_TEMPO: Record<MoodId, { bpm: number; min: number; max: number }> = {
  pop: { bpm: 120, min: 120, max: 120 },
  holiday: { bpm: 120, min: 120, max: 120 },
  "upbeat-pop": { bpm: 118, min: 112, max: 122 },
  "chill-lofi": { bpm: 85, min: 80, max: 92 },
  "cinematic-build": { bpm: 95, min: 86, max: 104 },
  "energetic-edm": { bpm: 126, min: 122, max: 130 },
  "warm-acoustic": { bpm: 100, min: 92, max: 108 },
  "luxury-minimal": { bpm: 88, min: 80, max: 96 },
};

/** Bed level in the mix relative to the default (beds are all −14 LUFS before ducking). */
export const MOOD_MIX_DB: Record<MoodId, number> = {
  pop: 0,
  holiday: 0,
  "upbeat-pop": 0,
  "chill-lofi": -1,
  "cinematic-build": 0,
  "energetic-edm": 0,
  "warm-acoustic": -0.5,
  "luxury-minimal": -1.5,
};

/** Arrangement energy (hat density, pluck rate). */
export const MOOD_ENERGY: Record<MoodId, number> = {
  pop: 0.8,
  holiday: 0.55,
  "upbeat-pop": 0.75,
  "chill-lofi": 0.35,
  "cinematic-build": 0.6,
  "energetic-edm": 0.95,
  "warm-acoustic": 0.5,
  "luxury-minimal": 0.3,
};

/** Words in a musicMood / musicStyle string → mood (first match in the text wins ties). */
const WORDS: [MoodId, RegExp][] = [
  ["holiday", /\b(holiday|christmas|xmas|festive|jingle|santa|seasonal)\b/i],
  ["chill-lofi", /\b(lo-?fi|chill(?:hop|ed)?|relax(?:ed|ing)?|calm|mellow|soft|study|light)\b/i],
  ["cinematic-build", /\b(cinematic|epic|orchestral|trailer|dramatic|build(?:s|ing)?|inspirational|swell)\b/i],
  ["energetic-edm", /\b(edm|house|dance|club|hype|punchy|electronic|energetic|high[- ]energy|workout|drop|techno)\b/i],
  ["warm-acoustic", /\b(acoustic|folk|guitar|warm|organic|cozy|cosy|homey|ukulele)\b/i],
  ["luxury-minimal", /\b(luxury|luxe|minimal(?:ist)?|elegant|premium|sophisticated|sonic logo|sting|ambient|unobtrusive|understated|subtle)\b/i],
  ["upbeat-pop", /\b(pop|upbeat|bright|trend(?:ing|y)?|happy|mainstream|fun|feel[- ]good|catchy)\b/i],
];

/** Every mood a text names, in the order they appear in it. */
export function moodsInText(text: string | null | undefined): MoodId[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  if (isMoodId(t.toLowerCase())) return [t.toLowerCase() as MoodId];
  return WORDS.map(([id, re]) => ({ id, at: re.exec(t)?.index ?? -1 }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.id);
}

/** The first mood a text names, or null. */
export function moodFromText(text: string | null | undefined): MoodId | null {
  return moodsInText(text)[0] ?? null;
}

/** Default bed per product category (sp-1 categories and creative-library categories). */
export const CATEGORY_MOOD: Record<string, MoodId> = {
  tv: "upbeat-pop",
  tablet_laptop: "upbeat-pop",
  electronics: "upbeat-pop",
  kitchen_appliance: "warm-acoustic",
  kitchen: "warm-acoustic",
  home_air_cleaning: "chill-lofi",
  home_air: "chill-lofi",
  beauty_skincare: "luxury-minimal",
  beauty: "luxury-minimal",
  fashion_jewelry: "luxury-minimal",
  jewelry: "luxury-minimal",
  sports_outdoor_cycling: "energetic-edm",
  sports: "energetic-edm",
  auto_accessories: "energetic-edm",
  auto: "energetic-edm",
  camera_creator: "cinematic-build",
  camera: "cinematic-build",
  food_beverage: "warm-acoustic",
  food: "warm-acoustic",
  home_furniture: "chill-lofi",
  home: "chill-lofi",
  pet: "warm-acoustic",
  gifts: "upbeat-pop",
  other: "upbeat-pop",
};

/** Default bed per platform (its profile's musicStyle, platforms.data.ts). */
export const PLATFORM_MOOD: Record<string, MoodId> = {
  tiktok: "upbeat-pop",
  instagram_reels: "upbeat-pop",
  instagram_stories: "chill-lofi",
  meta_feed: "chill-lofi",
  facebook_reels: "upbeat-pop",
  youtube_instream_skippable: "cinematic-build",
  youtube_instream_nonskippable_15s: "upbeat-pop",
  youtube_bumper_6s: "luxury-minimal",
  youtube_shorts: "upbeat-pop",
  google_demand_gen: "upbeat-pop",
  pinterest: "chill-lofi",
  snapchat: "energetic-edm",
};

/** Seasonal / gift copy (the bed the holiday ads have used since the first runs). */
export const SEASONAL_COPY = /christmas|holiday|new year|black friday|cyber monday|gift|santa|xmas|winter/i;

/**
 * The bed for an ad:
 *   1. the plan's musicMood when it is a mood id ("chill-lofi")
 *   2. seasonal copy (or a seasonal musicMood) → holiday
 *   3. the moods the musicMood text names (a platform musicStyle by default) — the category's own
 *      mood when it is among them, else the first named
 *   4. the category's mood, then the platform's, then upbeat-pop
 */
export function pickMusicMood(input: { planMood?: string | null; category?: string | null; platform?: string | null; copy?: string | null }): MoodId {
  const plan = (input.planMood ?? "").trim().toLowerCase();
  if (isMoodId(plan)) return plan;
  const named = moodsInText(plan);
  if (named.includes("holiday") || SEASONAL_COPY.test(input.copy ?? "")) return "holiday";
  const cat = input.category ? CATEGORY_MOOD[input.category] : undefined;
  if (named.length) return cat && named.includes(cat) ? cat : named[0];
  return cat ?? (input.platform ? PLATFORM_MOOD[input.platform] : undefined) ?? "upbeat-pop";
}
