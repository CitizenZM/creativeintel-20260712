/**
 * Presenter personas — the cast for AI talking-head / UGC segments (the Creatify "AI Avatar"
 * equivalent). A persona is a look (age, ethnicity, styling, wardrobe), a setting, an energy and a
 * voice: an Edge TTS voice for the voiceover around the talk frames, and a Veo voice description for
 * the clip's native, lip-synced dialogue. The talk frames' keyframes are all edited from one casting
 * reference built from `personaCast`, so the same presenter appears in every talk frame.
 *
 * Casting default: white or Latino people (the owner's preference from the TCL ads). It is data, not
 * logic — resolveCasting() takes a per-call override, the project's stored preference, a per-brand
 * table and the PRESENTER_CASTING env var, in that order. Pure — no I/O.
 */
import type { CategoryId, PlatformId } from "./types";

export type Ethnicity = "white" | "latino" | "black" | "east_asian" | "south_asian" | "middle_eastern";
export const ETHNICITIES: Ethnicity[] = ["white", "latino", "black", "east_asian", "south_asian", "middle_eastern"];

export interface Persona {
  id: string;
  label: string;
  look: { ageRange: [number, number]; gender: "woman" | "man"; ethnicity: Ethnicity; styling: string; wardrobe: string };
  setting: string;
  /** Baseline delivery; a beat's own delivery is layered on top. */
  energy: string;
  voice: { edge: string; veo: string };
  platforms: PlatformId[];
  categories: CategoryId[];
  /** Audience tags matched against the plan's audience text. */
  audience: AudienceTag[];
}

type AudienceTag = "genz" | "millennial" | "parents" | "40plus" | "senior" | "tech" | "beauty" | "fitness" | "home" | "auto" | "outdoor" | "professional" | "gamer";

const SHORT: PlatformId[] = ["tiktok", "instagram_reels", "youtube_shorts", "snapchat"];
const META: PlatformId[] = ["meta_feed", "facebook_reels", "instagram_reels", "instagram_stories"];
const YT: PlatformId[] = ["youtube_shorts", "youtube_instream_skippable", "youtube_instream_nonskippable_15s", "google_demand_gen"];

export const PERSONAS: Persona[] = [
  {
    id: "tt-genz-bedroom",
    label: "TikTok Gen-Z creator, bedroom",
    look: { ageRange: [19, 24], gender: "woman", ethnicity: "white", styling: "messy high bun, light freckles, minimal dewy makeup, small gold hoops", wardrobe: "an oversized pastel hoodie" },
    setting: "her bedroom with a warm LED strip on the wall, an unmade bed and fairy lights softly out of focus",
    energy: "fast, animated, a little breathless, like telling a best friend a secret",
    voice: { edge: "en-US-AvaMultilingualNeural", veo: "a bright, fast-talking young American woman's voice with a playful lilt" },
    platforms: [...SHORT, "instagram_stories"],
    categories: ["beauty", "electronics", "gifts", "apps", "home", "food", "jewelry"],
    audience: ["genz", "beauty", "gamer"],
  },
  {
    id: "tt-genz-dorm-guy",
    label: "TikTok Gen-Z guy, dorm / gaming setup",
    look: { ageRange: [19, 24], gender: "man", ethnicity: "latino", styling: "short curly dark hair, clean fade, light stubble", wardrobe: "a black graphic tee and a silver chain" },
    setting: "a dorm room with a gaming desk, RGB keyboard glow and a poster wall softly out of focus",
    energy: "hyped, quick, genuinely impressed",
    voice: { edge: "en-US-BrianMultilingualNeural", veo: "an energetic young American man's voice, casual and upbeat" },
    platforms: [...SHORT],
    categories: ["electronics", "camera", "apps", "sports", "gifts", "auto"],
    audience: ["genz", "tech", "gamer"],
  },
  {
    id: "reels-kitchen-mom",
    label: "Reels lifestyle mom, kitchen",
    look: { ageRange: [31, 38], gender: "woman", ethnicity: "white", styling: "shoulder-length honey-blonde hair, natural makeup", wardrobe: "a cream knit sweater with the sleeves pushed up" },
    setting: "a bright family kitchen with white cabinets, a wooden counter, a fruit bowl and morning window light",
    energy: "warm, relatable, a busy mom sharing a real find",
    voice: { edge: "en-US-EmmaMultilingualNeural", veo: "a warm, friendly American woman's voice in her thirties, conversational" },
    platforms: [...META, "pinterest", "tiktok"],
    categories: ["kitchen", "home", "home_air", "food", "health", "gifts"],
    audience: ["parents", "millennial", "home"],
  },
  {
    id: "reels-latina-family-mom",
    label: "Latina family mom, living room",
    look: { ageRange: [32, 42], gender: "woman", ethnicity: "latino", styling: "long dark wavy hair, warm smile, light makeup", wardrobe: "a rust-coloured cardigan over a white tee" },
    setting: "a cozy family living room with a sofa, throw pillows and kids' toys softly out of focus",
    energy: "enthusiastic, warm, genuinely delighted",
    voice: { edge: "en-US-JennyNeural", veo: "a warm, expressive American woman's voice, friendly and upbeat" },
    platforms: [...META, "tiktok"],
    categories: ["electronics", "home", "kitchen", "home_air", "gifts", "food"],
    audience: ["parents", "millennial", "home"],
  },
  {
    id: "yt-desk-reviewer",
    label: "YouTube reviewer, desk",
    look: { ageRange: [28, 38], gender: "man", ethnicity: "white", styling: "short brown hair, neat beard, rectangular glasses", wardrobe: "a charcoal crewneck sweater" },
    setting: "a tidy desk setup with a monitor, a microphone arm and a soft key light, a bookshelf out of focus",
    energy: "knowledgeable, calm, straight-talking, like a trusted reviewer",
    voice: { edge: "en-US-AndrewMultilingualNeural", veo: "a clear, confident American man's voice, measured like a tech reviewer" },
    platforms: [...YT, "meta_feed"],
    categories: ["electronics", "camera", "apps", "auto", "home"],
    audience: ["tech", "millennial", "gamer"],
  },
  {
    id: "yt-tech-reviewer-latino",
    label: "Tech reviewer, studio desk",
    look: { ageRange: [26, 34], gender: "man", ethnicity: "latino", styling: "short black hair, trimmed beard", wardrobe: "a navy overshirt over a grey tee" },
    setting: "a creator studio desk with soft RGB backlight, a camera on a tripod and acoustic panels out of focus",
    energy: "confident, punchy, excited about specs",
    voice: { edge: "en-US-ChristopherNeural", veo: "a confident young American man's voice, punchy and articulate" },
    platforms: [...YT, "tiktok"],
    categories: ["electronics", "camera", "apps", "sports"],
    audience: ["tech", "gamer", "millennial"],
  },
  {
    id: "meta-garage-dad",
    label: "Meta 40+ dad, garage",
    look: { ageRange: [42, 55], gender: "man", ethnicity: "white", styling: "short greying hair, light stubble, weathered hands", wardrobe: "a faded flannel shirt over a grey tee" },
    setting: "a home garage with a pegboard of tools, a workbench and a car half out of frame",
    energy: "dry, no-nonsense, trustworthy, a guy who has tried everything",
    voice: { edge: "en-US-RogerNeural", veo: "a deep, relaxed American man's voice in his late forties, matter-of-fact" },
    platforms: ["meta_feed", "facebook_reels", "youtube_instream_skippable", "youtube_shorts"],
    categories: ["auto", "electronics", "home", "sports", "camera"],
    audience: ["40plus", "parents", "auto"],
  },
  {
    id: "meta-backyard-dad",
    label: "Latino dad, backyard patio",
    look: { ageRange: [38, 50], gender: "man", ethnicity: "latino", styling: "short dark hair with grey at the temples, friendly eyes", wardrobe: "a navy polo shirt" },
    setting: "a sunny backyard patio with a grill, string lights and green plants",
    energy: "friendly, easygoing, proud dad energy",
    voice: { edge: "en-US-EricNeural", veo: "a friendly, easygoing American man's voice in his forties" },
    platforms: ["meta_feed", "facebook_reels", "instagram_reels", "youtube_shorts"],
    categories: ["food", "kitchen", "auto", "home", "sports", "electronics"],
    audience: ["40plus", "parents", "outdoor", "home"],
  },
  {
    id: "fitness-home-gym",
    label: "Fitness coach, home gym",
    look: { ageRange: [25, 33], gender: "woman", ethnicity: "latino", styling: "high ponytail, glowing skin, athletic build", wardrobe: "a black sports bra under an open zip training jacket" },
    setting: "a bright home gym with a rack of dumbbells, a yoga mat and a plant in the corner",
    energy: "high energy, motivating, direct",
    voice: { edge: "en-US-MichelleNeural", veo: "an energetic, motivating American woman's voice, crisp and upbeat" },
    platforms: [...SHORT, "instagram_stories"],
    categories: ["sports", "health", "food", "electronics"],
    audience: ["fitness", "millennial", "genz"],
  },
  {
    id: "beauty-vanity-grwm",
    label: "Beauty creator, vanity (GRWM)",
    look: { ageRange: [22, 30], gender: "woman", ethnicity: "white", styling: "glossy brunette waves, soft glam makeup", wardrobe: "a white ribbed tank and a satin robe" },
    setting: "a vanity table with a lit mirror, skincare bottles and a makeup brush cup",
    energy: "chatty, intimate, get-ready-with-me",
    voice: { edge: "en-US-AriaNeural", veo: "a chatty, intimate young American woman's voice, soft and expressive" },
    platforms: [...SHORT, "pinterest", "instagram_stories"],
    categories: ["beauty", "jewelry", "health", "gifts"],
    audience: ["beauty", "genz", "millennial"],
  },
  {
    id: "car-seat-commuter",
    label: "Commuter, parked car selfie",
    look: { ageRange: [30, 40], gender: "man", ethnicity: "white", styling: "short sandy hair, clean-shaven, sunglasses pushed up on his head", wardrobe: "a light blue button-down with rolled sleeves" },
    setting: "the driver's seat of a parked car, daylight through the windshield, seatbelt off",
    energy: "candid, spontaneous, a car-rant that turns into a recommendation",
    voice: { edge: "en-US-SteffanNeural", veo: "a casual, candid American man's voice in his thirties" },
    platforms: ["tiktok", "instagram_reels", "facebook_reels", "meta_feed"],
    categories: ["auto", "electronics", "apps", "food"],
    audience: ["auto", "millennial", "professional"],
  },
  {
    id: "outdoor-trail-creator",
    label: "Outdoor creator, trailhead",
    look: { ageRange: [26, 35], gender: "woman", ethnicity: "white", styling: "sun-kissed skin, braided dirty-blonde hair", wardrobe: "a teal fleece and a cap" },
    setting: "a trailhead at golden hour with pine trees and a parked SUV out of focus",
    energy: "adventurous, upbeat, breezy",
    voice: { edge: "en-US-AvaNeural", veo: "a breezy, upbeat American woman's voice, a little out of breath from hiking" },
    platforms: ["instagram_reels", "youtube_shorts", "tiktok", "pinterest"],
    categories: ["sports", "camera", "auto", "food"],
    audience: ["outdoor", "fitness", "millennial"],
  },
  {
    id: "meta-60plus-grandma",
    label: "60+ grandmother, armchair",
    look: { ageRange: [58, 68], gender: "woman", ethnicity: "white", styling: "silver bob haircut, reading glasses on a chain", wardrobe: "a soft lavender cardigan" },
    setting: "a cozy living room armchair with a knitted throw, family photos and a lamp",
    energy: "gentle, sincere, delighted grandmother",
    voice: { edge: "en-US-JennyNeural", veo: "a gentle, warm older American woman's voice, sincere and unhurried" },
    platforms: ["meta_feed", "facebook_reels", "youtube_instream_skippable"],
    categories: ["health", "home", "home_air", "kitchen", "gifts", "electronics"],
    audience: ["senior", "40plus", "home"],
  },
  {
    id: "wfh-professional",
    label: "Work-from-home professional",
    look: { ageRange: [30, 40], gender: "woman", ethnicity: "black", styling: "natural curls in a low puff, minimal makeup, small studs", wardrobe: "a camel blazer over a black tee" },
    setting: "a calm home office with a laptop, a desk lamp and a plant",
    energy: "crisp, efficient, credible",
    voice: { edge: "en-US-EmmaNeural", veo: "a crisp, articulate American woman's voice, confident and warm" },
    platforms: ["meta_feed", "youtube_instream_skippable", "google_demand_gen", "instagram_reels"],
    categories: ["apps", "electronics", "home_air", "health"],
    audience: ["professional", "millennial", "tech"],
  },
  {
    id: "minimal-apartment-creator",
    label: "Minimalist apartment creator",
    look: { ageRange: [24, 32], gender: "woman", ethnicity: "east_asian", styling: "sleek straight black hair, dewy skin, thin gold necklace", wardrobe: "a beige oversized shirt" },
    setting: "a minimalist apartment with a light oak desk, a monstera plant and soft daylight",
    energy: "calm, aesthetic, quietly impressed",
    voice: { edge: "en-US-AvaMultilingualNeural", veo: "a calm, soft-spoken young American woman's voice" },
    platforms: ["tiktok", "instagram_reels", "pinterest", "youtube_shorts"],
    categories: ["electronics", "beauty", "home", "kitchen", "apps"],
    audience: ["genz", "millennial", "home", "tech"],
  },
  {
    id: "couch-family-dad",
    label: "Family dad, living-room couch",
    look: { ageRange: [35, 46], gender: "man", ethnicity: "south_asian", styling: "short black hair, neat beard, kind eyes", wardrobe: "a heather-grey henley" },
    setting: "a family living room couch with a big TV and board games on the shelf",
    energy: "warm, funny, a dad who did the research",
    voice: { edge: "en-US-AndrewNeural", veo: "a warm, good-humoured American man's voice in his forties" },
    platforms: ["meta_feed", "facebook_reels", "youtube_instream_skippable", "youtube_shorts"],
    categories: ["electronics", "home", "home_air", "apps", "gifts"],
    audience: ["parents", "40plus", "tech", "home"],
  },
];

export const personaById = (id: string): Persona | undefined => PERSONAS.find((p) => p.id === id);

const ETHNIC_WORD: Record<Ethnicity, [string, string]> = {
  white: ["white", "white"],
  latino: ["Latina", "Latino"],
  black: ["Black", "Black"],
  east_asian: ["East Asian", "East Asian"],
  south_asian: ["South Asian", "South Asian"],
  middle_eastern: ["Middle Eastern", "Middle Eastern"],
};

/** The casting-sheet description: one sentence a keyframe model can hold the presenter to. */
export function personaCast(p: Persona): string {
  const [a, b] = p.look.ageRange;
  const who = `${ETHNIC_WORD[p.look.ethnicity][p.look.gender === "woman" ? 0 : 1]} ${p.look.gender}`;
  return `A ${who} aged about ${Math.round((a + b) / 2)}, ${p.look.styling}, wearing ${p.look.wardrobe}.`;
}

export interface CastingPrefs {
  /** Who the presenter may be; undefined = anyone. */
  ethnicities?: Ethnicity[];
}

/** The owner's preference for the TCL ads (white or Latino families / people), the default for every brand. */
export const DEFAULT_CASTING: CastingPrefs = { ethnicities: ["white", "latino"] };

/** Per-brand casting defaults (lower-case brand name). Add a brand here instead of branching in code. */
export const CASTING_BY_BRAND: Record<string, CastingPrefs> = {
  tcl: { ethnicities: ["white", "latino"] },
};

function cleanPrefs(raw: unknown): CastingPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const e = (raw as { ethnicities?: unknown }).ethnicities;
  if (e === null || e === "any") return { ethnicities: undefined };
  if (!Array.isArray(e)) return null;
  const ok = e.map((x) => String(x).trim().toLowerCase().replace(/[\s-]+/g, "_")).filter((x): x is Ethnicity => (ETHNICITIES as string[]).includes(x));
  return ok.length ? { ethnicities: ok } : null;
}

/**
 * The casting to use: a per-call override, then the project's stored preference
 * (productBrief.casting), then the brand table, then PRESENTER_CASTING ("white,latino" | "any"), then the default.
 */
export function resolveCasting(input: { override?: unknown; project?: unknown; brandName?: string | null; env?: string | null }): CastingPrefs {
  const env = input.env?.trim()
    ? input.env.trim().toLowerCase() === "any"
      ? { ethnicities: undefined }
      : cleanPrefs({ ethnicities: input.env.split(",") })
    : null;
  return cleanPrefs(input.override) ?? cleanPrefs(input.project) ?? CASTING_BY_BRAND[(input.brandName ?? "").trim().toLowerCase()] ?? env ?? DEFAULT_CASTING;
}

const AUDIENCE_CUES: [AudienceTag, RegExp][] = [
  ["genz", /\b(gen[- ]?z|teens?|18[-–]24|college|students?|young adults?)\b/i],
  ["millennial", /\b(millennials?|25[-–]3\d|young professionals?|30s)\b/i],
  ["parents", /\b(moms?|mothers?|dads?|fathers?|parents?|famil(y|ies)|kids)\b/i],
  ["40plus", /\b(40\+|4\d[-–]\d\d|45\+|50\+|middle[- ]aged|dads? 40|over 40|homeowners?)\b/i],
  ["senior", /\b(60\+|65\+|seniors?|retirees?|grand(parents|mothers?|fathers?)|boomers?)\b/i],
  ["tech", /\b(tech|gadgets?|specs|early adopters?|reviewers?|comparing|enthusiasts?)\b/i],
  ["gamer", /\b(gam(ers?|ing)|esports|streamers?)\b/i],
  ["beauty", /\b(beauty|skin ?care|makeup|grwm|glam)\b/i],
  ["fitness", /\b(fitness|gym|workouts?|athletes?|runners?|training)\b/i],
  ["home", /\b(home|kitchen|cooking|cleaning|decor|household)\b/i],
  ["auto", /\b(cars?|drivers?|commut\w*|auto|garage|road ?trips?)\b/i],
  ["outdoor", /\b(outdoors?|hik\w+|camping|travel\w*|adventure)\b/i],
  ["professional", /\b(professionals?|office|work from home|wfh|business)\b/i],
];

/**
 * The best presenter for platform × category × audience inside the casting preference. Scores: platform
 * fit 3, category fit 2, each audience cue 2, gender cue 1. Deterministic (ties keep library order).
 */
export function pickPersona(platform: PlatformId | string, category: CategoryId | string | null | undefined, audience: string | null | undefined, opts: { casting?: CastingPrefs; exclude?: string[] } = {}): Persona {
  const casting = opts.casting ?? DEFAULT_CASTING;
  const text = audience ?? "";
  const tags = AUDIENCE_CUES.filter(([, re]) => re.test(text)).map(([t]) => t);
  const wantsWoman = /\b(women|woman|female|moms?|mothers?|girls?|her)\b/i.test(text);
  const wantsMan = /\b(men|man|male|dads?|fathers?|guys?|him)\b/i.test(text);
  const pool = PERSONAS.filter((p) => !opts.exclude?.includes(p.id));
  const cast = casting.ethnicities?.length ? pool.filter((p) => casting.ethnicities!.includes(p.look.ethnicity)) : pool;
  const candidates = cast.length ? cast : pool.length ? pool : PERSONAS;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const p of candidates) {
    let s = 0;
    if (p.platforms.includes(platform as PlatformId)) s += 3;
    if (category && p.categories.includes(category as CategoryId)) s += 2;
    s += 2 * tags.filter((t) => p.audience.includes(t)).length;
    if (wantsWoman !== wantsMan) s += (wantsWoman ? p.look.gender === "woman" : p.look.gender === "man") ? 1 : -1;
    if (s > bestScore) (best = p), (bestScore = s);
  }
  return best;
}
