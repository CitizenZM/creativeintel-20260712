/**
 * Built-in creative playbooks — the ad research (out/research/ad-research/01–03*.md, 2026-10-06)
 * distilled into compact, prompt-ready slices so every in-product agent (script writer, shot
 * director, campaign planner) carries it permanently:
 *   (a) per category: what buyers decide on, the proof shots that sell it, keyword patterns and
 *       objection busters;
 *   (b) per platform: audience, tone and edit grammar;
 *   (c) hook-writing formulas and VO / on-screen text formulas (incl. the first-3-s sale pitch);
 *   (d) end-card / CTA copy patterns by goal.
 * `playbookSlice` picks only the slices one ad needs and caps them (default ≤ 400 words). Pure.
 */
import type { CampaignGoal, CategoryId, PlatformId } from "./types";
import type { SpCategory } from "./product-brief";

export interface CategoryPlaybook {
  label: string;
  /** What buyers actually decide on, in order. */
  buyers: string;
  /** Proof shots that convert (selling point → what the camera shows). */
  proofShots: string[];
  /** Search / hashtag patterns for hook text, captions and VO. */
  keywords: string;
  /** Buyer doubt → the shot that busts it. */
  objections: string[];
}

export const CATEGORY_PLAYBOOKS: Record<SpCategory, CategoryPlaybook> = {
  tv: {
    label: "TVs",
    buyers: "picture quality, screen size (value per inch), brand trust, smart platform; then brightness/contrast tech, gaming (native Hz, VRR), sound",
    proofShots: [
      "brightness → sun-glare split: sunlit living room, blinds open, picture still punches vs a dim generic set",
      "contrast → dark-room star field / moon beside true black, no blooming halo",
      "size → person-for-scale walk-in, family in front, inch count on screen",
      "gaming → fast-pan side-by-side + controller-in-hand POV",
      "thin / wall-mount → side profile against a coin edge; 1-s install",
      "smart → 5-s voice search, content starts",
    ],
    keywords: "85 inch tv · mini led tv · best tv for bright room · gaming tv ps5 · tv black friday · #tvsetup #hometheater #movienight",
    objections: ["washes out in my bright room? → sun-glare split", "too big for the wall? → scale walk-in + tape measure", "hard to mount? → installed in 1 s (time-remap)", "clunky smart TV? → voice search plays in 5 s"],
  },
  tablet_laptop: {
    label: "Tablets / laptops",
    buyers: "price, screen comfort (matte / paper-like), battery, performance for the job (reading, study, kids, light work), weight, pen + keyboard",
    proofShots: [
      "eye comfort → glare test under a desk lamp / window sun beside a glossy tablet: reflection on one, none on ours",
      "battery → day-in-the-life time-lapse with a battery % counter",
      "light → one-hand hold, slides into a tote, gram scale overlay",
      "pen → handwriting close-up, zero lag",
      "modes → 360° turntable turn, then whip from sheet music to sketching on the same device",
    ],
    keywords: "tablet for reading · eye care tablet · e ink alternative · tablet with pen · best budget tablet · #studytok #booktok #notetaking",
    objections: ["matte = washed out? → vivid video side-by-side", "too heavy for bed? → one-hand reading lying down", "battery dies? → day time-lapse ending above 30%"],
  },
  kitchen_appliance: {
    label: "Small kitchen appliances",
    buyers: "capacity, results (crispy, even), speed, easy cleaning, counter footprint, presets/app, price",
    proofShots: [
      "crispy → ASMR crunch close-up, cut-open wing, 1 tsp oil vs a deep-fryer pot",
      "fast → stopwatch vs oven preheat, 'dinner in 12 min' timer",
      "capacity → whole chicken drops in, family plate count",
      "easy clean → basket wiped in 10 s / straight into the dishwasher",
      "compact → footprint beside a coffee maker with a ruler",
      "smart → 'food's ready' notification on the couch",
    ],
    keywords: "air fryer recipes · dual basket air fryer · crispy wings air fryer · easy clean air fryer · #airfryer #easydinner #kitchengadgets",
    objections: ["pain to clean? → 10-s wipe / dishwasher", "fits my counter? → footprint ruler shot", "big enough for the family? → whole chicken / 4 plates"],
  },
  home_air_cleaning: {
    label: "Air purifiers / humidifiers / vacuums",
    buyers: "room coverage (CADR, sq ft), True HEPA filtration, sleep-mode noise, filter cost, auto mode, design; vacuums: pickup, pet hair, battery",
    proofShots: [
      "clears the room → PM2.5 counter time-lapse, smoke gone, AQI ring red → blue",
      "quiet → dB meter beside a sleeping person",
      "allergy / pet relief → grey furry pre-filter reveal after 30 days",
      "auto mode → sensor reacts to a spray in 3 s",
      "coverage → floor-plan overlay with sq ft",
      "vacuum → cereal / pet-hair / sand on carpet, anti-tangle brush close-up",
    ],
    keywords: "air purifier for bedroom · for allergies · for pets · wildfire smoke · quiet air purifier · #allergyseason #cleantok #petowner (CEPs: allergy season, smoke days, new baby, new pet, cooking smells)",
    objections: ["loud at night? → dB meter at the bedside", "filters cost a fortune? → cost-per-month card", "big enough? → floor-plan overlay"],
  },
  beauty_skincare: {
    label: "Beauty / skincare / hair tools",
    buyers: "visible result and how fast, skin-type fit, ingredients, texture, price per use, creator trust, shade match",
    proofShots: [
      "instant effect → one-swipe / half-face demo, real time",
      "texture → macro finger-swipe, absorption timer",
      "long wear → time-stamped check-ins 8 am → 6 pm, splash test",
      "hair tools → half-head straightened, frizz test in humidity",
      "ingredients → ingredient pour shot with the % on screen",
    ],
    keywords: "glass skin · skincare routine · for sensitive skin · frizz free · drugstore dupe · #skintok #grwm #tiktokmademebuyit",
    objections: ["will it suit my skin? → swatches on three skin tones", "does it last? → time-stamped check-ins", "worth the price? → price-per-use card"],
  },
  fashion_jewelry: {
    label: "Jewelry / fashion",
    buyers: "style fit, won't tarnish / won't turn green, sensitive ears, price-to-look, giftability (box, occasion), personalization",
    proofShots: [
      "tarnish-proof → shower / pool / sweat test with a day counter (day 1 → day 60), tissue rub, no residue",
      "sparkle → ring-light macro, slow rotation, slow-mo glint",
      "styling → '3 ways to wear' quick cuts",
      "gift → unboxing reaction, gift box, occasion line",
      "fit → on-ear / on-neck scale with a ruler",
    ],
    keywords: "waterproof jewelry · tarnish free jewelry · hypoallergenic earrings · gold huggie earrings · gift for her · #jewelrytok #giftideas #everydayjewelry",
    objections: ["turns green? → day-60 shower test", "looks cheap? → macro sparkle beside fine jewelry", "sensitive ears? → all-day wear check-in"],
  },
  sports_outdoor_cycling: {
    label: "Cycling / sports / outdoor",
    buyers: "visibility (lumens, beam), durability + weather (IPX), fit / weight, battery + USB-C, mount ease, price vs premium brands",
    proofShots: [
      "bright → night-road POV light on vs off; car-driver POV of the rear light at 100 m",
      "battery → ride time-lapse with battery overlay; USB-C charge stopwatch",
      "weatherproof → rain ride / hose spray",
      "quick mount → tool-free install in 10 s, stopwatch",
      "eyewear → photochromic shift shade → sun time-lapse",
    ],
    keywords: "bike light usb c · brightest bike light · cycling sunglasses photochromic · bike bag waterproof · #cycling #gravelbike #bikecommute",
    objections: ["survives rain? → hose spray", "fits my bars? → clicks onto three bar sizes", "dies mid-ride? → battery time-lapse"],
  },
  auto_accessories: {
    label: "Car tech (CarPlay / Android Auto adapters, AI boxes, dash cams)",
    buyers: "fits my car and phone (#1 anxiety), connection stability / lag, plug-and-play install, wireless CarPlay / AA, streaming, price vs a new head unit",
    proofShots: [
      "wireless in seconds → get in, phone stays in the pocket, CarPlay appears — one take with an on-screen timer",
      "plug-and-play → unbox → USB port → working in 30 s",
      "compatibility → fit-check carousel of car models + 'check your car' CTA",
      "no lag → split screen: phone tap vs car screen response",
      "streaming → passenger watches while parked",
    ],
    keywords: "wireless carplay adapter · carplay ai box · android auto wireless adapter · carplay netflix · #carplay #cartok #cargadgets",
    objections: ["fits my car? → model carousel + checker", "laggy? → split-screen tap sync", "hard to install? → 30-s plug-in"],
  },
  camera_creator: {
    label: "Cameras / creator gear",
    buyers: "image quality in real conditions, stabilization, easy (AI) editing, waterproof / durable, battery, size / mounts, price vs GoPro / DJI",
    proofShots: [
      "stabilization → bumpy MTB POV split: phone vs camera; spin the camera, horizon stays flat",
      "360 → one clip reframed into three angles; invisible-selfie-stick third-person shot",
      "waterproof → pool jump / snorkel",
      "AI edit → raw footage → auto-edit in 10 s (screen recording)",
      "tiny → thumb-size scale shot, magnetic clip on a cap",
    ],
    keywords: "360 camera · best action camera · invisible selfie stick · vlogging camera · motorcycle camera · #pov #360camera #motovlog",
    objections: ["editing takes forever? → AI auto-edit in 10 s", "shaky footage? → horizon-lock spin", "breaks on impact? → drop + pool test"],
  },
  food_beverage: {
    label: "Food & beverage",
    buyers: "taste / craveability, nutrition (protein, sugar), convenience, value per serving, dietary fit",
    proofShots: ["taste → slow-mo pour / crunch / steam / cheese pull + first-bite reaction", "nutrition → label zoom with the comparison number", "convenience → 'ready in 60 s' timer, one hand on the go", "ingredients → flat-lay line-up"],
    keywords: "high protein snack · low sugar · healthy snacks · easy breakfast · #foodtok #mealprep",
    objections: ["tastes like cardboard? → first-bite reaction", "too much effort? → 60-s timer"],
  },
  home_furniture: {
    label: "Home / furniture / bedding",
    buyers: "comfort, fits my space, durability, assembly ease, delivery and returns, style",
    proofShots: ["fits → tape-measure room overlay, door-width check", "assembly → 'assembled in 12 min, no tools' time-lapse", "comfort → sink-in / bounce-back slow-mo, hand print in foam", "durable → people stand on it with a weight overlay; spill wiped off", "mattress → unroll and expand time-lapse"],
    keywords: "small space furniture · easy assembly · pet friendly couch · cooling mattress · #homedecor #apartmentmakeover",
    objections: ["assembly nightmare? → no-tools time-lapse", "fits my door / room? → width check", "stains? → spill-wipe test"],
  },
  pet: {
    label: "Pet",
    buyers: "pet health / ingredients, pet acceptance, vet trust, less mess, durability, price",
    proofShots: ["loves it → bowl licked clean, tail wag, multi-pet test", "mess-free → lint roller before / after", "durable → power-chewer time-lapse", "automatic → app notification + time-lapse"],
    keywords: "picky eater dog food · toy for aggressive chewers · pet hair remover · self cleaning litter box · #dogsoftiktok #catsoftiktok",
    objections: ["my picky eater won't touch it → real reaction", "destroyed in a day? → chew time-lapse"],
  },
  other: {
    label: "General products",
    buyers: "the result it delivers, how easy it is, value for money, giftability",
    proofShots: ["result → the product working on frame 1 (hands-only demo)", "ease → unbox → working in N seconds", "value → scale or comparison card", "gift → gift reveal + reaction"],
    keywords: "best [product] for [use] · [product] gift · #tiktokmademebuyit #giftideas",
    objections: ["does it really work? → one-take demo", "hard to use? → setup in seconds"],
  },
};

/** Creative-library category → the closest category playbook. */
const FROM_CREATIVE: Record<CategoryId, SpCategory> = {
  electronics: "tv",
  camera: "camera_creator",
  auto: "auto_accessories",
  kitchen: "kitchen_appliance",
  home_air: "home_air_cleaning",
  beauty: "beauty_skincare",
  jewelry: "fashion_jewelry",
  sports: "sports_outdoor_cycling",
  home: "home_furniture",
  food: "food_beverage",
  health: "other",
  gifts: "other",
  apps: "other",
};

export interface PlatformPlaybook {
  audience: string;
  tone: string;
  /** Edit grammar: hook form, talent, text, audio, pacing, close. */
  grammar: string;
}

export const PLATFORM_PLAYBOOKS: Record<PlatformId, PlatformPlaybook> = {
  tiktok: { audience: "18–34, entertainment-led discovery, impulse buys via TikTok Shop", tone: "native, lo-fi, creator-led, playful", grammar: "hook = creator POV / pattern interrupt / 'wait for it', product or key message by 3 s; casual creator talking to camera; native white captions 2–5 words; >120 BPM track + VO, beat-synced cuts every 1–1.5 s early; close on a CTA card 'Grab yours, link below'" },
  instagram_reels: { audience: "18–34, aesthetic lifestyle discovery", tone: "aspirational, polished-native", grammar: "hook = aesthetic reveal + text sticker in 0–2 s; styled creator in a real home; product shown more than once; sticker text + light VO; cut every 1.5–2 s; close 'Shop the look' above the bottom 35%" },
  instagram_stories: { audience: "18–44, quick tap-through", tone: "casual, intimate", grammar: "one idea per 5-s card, brand + product by 1.5 s, ≤ 6 words per card, must survive mute; 'Tap to shop ↑' sticker above the bottom 20%" },
  meta_feed: { audience: "30–64, value and deal seekers, mostly sound-off", tone: "clear, trustworthy, value-forward", grammar: "4:5; headline bar with the offer or price from frame 1; three benefit callouts with burned-in captions (≥ 64 px); real hands demo; social proof; slower cuts (2–3 s); close 'Get the deal' + price frame" },
  facebook_reels: { audience: "25–54, entertainment + deals", tone: "native, value-forward", grammar: "same build as IG Reels but lead with the offer and show the price plainly; friendly reviewer voice; close offer + 'Shop now'" },
  youtube_instream_skippable: { audience: "18–64, research intent, often on a TV", tone: "informative, credible, review-style", grammar: "ABCD: attract + speak the brand inside 5 s, problem → demo → proof story, confident narrator, lower-third benefit titles, cut every 2.5–4 s, CTA in VO + graphics, end screen with offer (QR for CTV)" },
  youtube_instream_nonskippable_15s: { audience: "18–64, lean-back, captive", tone: "polished, single-message", grammar: "mini-arc: hook 0–2 s → benefit 2–8 s → proof 8–12 s → brand + CTA 12–15 s; brand at start and end; one message" },
  youtube_bumper_6s: { audience: "18–64, reach and recall", tone: "punchy", grammar: "one message built for 6 s: hero shot + product + logo by 1 s, one benefit line ≤ 5 words, brand lock-up last second" },
  youtube_shorts: { audience: "13–34, swipe-fast", tone: "authentic, upbeat, creator-like", grammar: "hook in 0–1.5 s; everyday creator to camera 'you need this'; sound on (music + VO); bold captions upper-middle; on-screen CTA from 3 s matching the Shorts button" },
  google_demand_gen: { audience: "18–64 across YouTube, Shorts, Discover, Gmail", tone: "product-centric, clear", grammar: "works in every ratio and muted: clear product + offer early, captions + VO, CTA repeated in VO and overlay, end card with the offer, ≥ 10 s" },
  pinterest: { audience: "18–44, mostly women, planners with search intent", tone: "inspirational, calm, useful — not hard-sell", grammar: "'idea' framing ('3 ways to…', 'gift for…'), text-led and silent-first, styled flat-lay / room, cover-worthy last frame, soft CTA 'Shop the idea'" },
  snapchat: { audience: "13–24, camera-first", tone: "raw, playful, selfie", grammar: "3–6 s single idea, brand by 1.5 s, bold motion selfie, few words, punchy track, 'Swipe up' style close" },
};

/** (c) Hook-writing formulas. `goals` = the goals where the formula leads. */
export const HOOK_FORMULAS: { name: string; formula: string; example: string; goals: CampaignGoal[] }[] = [
  { name: "Sale pitch (first 3 s)", formula: "[occasion / need question]? → [EVENT]: [N]% OFF (one line per hook frame; VO says the short form)", example: "Want a New Year gift? → 20% OFF this Black Friday", goals: ["promo", "retarget"] },
  { name: "Deal slam", formula: "[was] → [now] + [N]% badge on the product, frame 1", example: "$499 → $349. 30% OFF today", goals: ["promo", "retarget"] },
  { name: "Gift reveal", formula: "[the gift they'll actually use] + bow pull / wrap tear → product", example: "The gift they'll actually use", goals: ["promo", "cold", "awareness"] },
  { name: "Pain question", formula: "Still [pain from 1–2★ reviews]? → fix on the cut", example: "Still squinting at glare on your tablet?", goals: ["cold", "lead"] },
  { name: "Bold number", formula: "[real spec number + unit]. [what it means].", example: "3,000 nits. Noon-proof.", goals: ["cold", "retarget"] },
  { name: "POV", formula: "POV: you finally found a [product] that [top benefit]", example: "POV: your air fryer cleans in 10 seconds", goals: ["cold", "awareness"] },
  { name: "Comment reply", formula: "comment bubble with the #1 doubt → answer clip", example: "\"Does it fit my 2018 Civic?\"", goals: ["retarget", "cold"] },
  { name: "3 reasons", formula: "3 reasons [audience] switched to [product] — one proof shot each", example: "3 reasons cyclists switched to this light", goals: ["retarget", "cold"] },
  { name: "Contrarian", formula: "Stop [common habit]. [product] does it [better way].", example: "Stop paying for a new head unit.", goals: ["awareness", "cold"] },
  { name: "Search bar", formula: "types 'best [product] for [buying situation]' → product appears as the answer", example: "best tablet for reading in bed", goals: ["cold", "app_install", "lead"] },
  { name: "Identity / lifestyle", formula: "[who you are / the moment] + product in the scene", example: "Sunday movie night, upgraded", goals: ["awareness"] },
];

/** (c) VO and on-screen text formulas. */
export const VO_TEXT_FORMULAS: string[] = [
  "VO ≈ 2.5 words/s, one selling point per line: real number → buyer payoff ('3,000 nits — bright even at noon').",
  "On-screen ≤ 6 words, the claim's keyword in caps ('TRUE BLACK'); never the VO word for word.",
  "Proof = show it → say the number → say the payoff; every zoom lands on the product.",
  "Objection = the doubt in buyer words, then the busting shot.",
  "Superlatives and urgency whenever a fact carries them ('lowest price of the year', 'ends Sunday').",
  "CTA spoken + shown: offer + action ('Use code SAVE20 — tap Shop Now'); last second logo + bouncing button.",
];

/** (d) End-card / CTA copy by goal (research B.2). */
export const CTA_COPY: Record<CampaignGoal, { headlines: string[]; buttons: string[]; vo: string }> = {
  cold: { headlines: ["Yours from $___", "The ___ upgrade you'll feel", "Ships free today"], buttons: ["Shop now", "Get yours", "Tap Shop Now ↓"], vo: "Tap Shop Now to get yours." },
  promo: { headlines: ["Extra ___% off: code ___", "Your code expires ___", "Black Friday price unlocked"], buttons: ["Claim coupon", "Use code ___", "Get the deal"], vo: "Use code ___ at checkout." },
  retarget: { headlines: ["Still thinking about it?", "Back in stock", "Your cart misses you"], buttons: ["Complete order", "Grab it now", "Back to cart"], vo: "It's still in your cart — grab it now." },
  awareness: { headlines: ["See how it works", "Built for ___", "Meet the new ___"], buttons: ["Learn more", "Explore", "Watch more"], vo: "Tap to see what it can do." },
  app_install: { headlines: ["Free on iOS & Android", "Try it tonight"], buttons: ["Install now", "Get the app", "Try free"], vo: "Install free and try it tonight." },
  lead: { headlines: ["Get a free quote", "Book a demo"], buttons: ["Get quote", "Book now", "Sign up"], vo: "Tap to book now." },
};

export function categoryPlaybook(category?: string | null): CategoryPlaybook {
  const c = (category ?? "other") as string;
  if (c in CATEGORY_PLAYBOOKS) return CATEGORY_PLAYBOOKS[c as SpCategory];
  if (c in FROM_CREATIVE) return CATEGORY_PLAYBOOKS[FROM_CREATIVE[c as CategoryId]];
  return CATEGORY_PLAYBOOKS.other;
}

export interface PlaybookSliceInput {
  /** sp-1 category (tv, tablet_laptop…) or creative-library category (electronics, kitchen…). */
  category?: string | null;
  platform?: PlatformId | null;
  goal?: CampaignGoal | null;
  /** Word cap for the whole slice (default 400). */
  maxWords?: number;
  /** The shot director needs the category + platform grammar, not copy formulas. */
  forDirector?: boolean;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The research slices one ad needs, capped at `maxWords` (default 400). */
export function playbookSlice(input: PlaybookSliceInput): string {
  const max = input.maxWords ?? 400;
  const cat = categoryPlaybook(input.category);
  const goal: CampaignGoal = input.goal ?? "cold";
  // Priority order: what to show (category), how this platform cuts it, then copy formulas.
  const lines: string[] = [
    `CATEGORY PLAYBOOK — ${cat.label}. Buyers decide on: ${cat.buyers}.`,
    `Proof shots that sell: ${cat.proofShots.slice(0, input.forDirector ? 5 : 4).join("; ")}.`,
    `Objection busters: ${cat.objections.slice(0, 3).join("; ")}.`,
  ];
  if (input.platform) {
    const p = PLATFORM_PLAYBOOKS[input.platform];
    lines.push(`PLATFORM GRAMMAR — ${input.platform} (${p.audience}; tone ${p.tone}): ${p.grammar}.`);
  }
  if (!input.forDirector) {
    const hooks = [...HOOK_FORMULAS.filter((h) => h.goals.includes(goal)), ...HOOK_FORMULAS.filter((h) => !h.goals.includes(goal))].slice(0, 3);
    lines.push(`HOOK FORMULAS: ${hooks.map((h) => `${h.name}: ${h.formula} (e.g. "${h.example}")`).join(" | ")}.`);
    const cta = CTA_COPY[goal];
    lines.push(`CTA COPY (${goal}): headlines ${cta.headlines.map((h) => `"${h}"`).join(", ")}; buttons ${cta.buttons.join(" / ")}; VO "${cta.vo}"`);
    lines.push(`VO / TEXT: ${VO_TEXT_FORMULAS.join(" ")}`);
    lines.push(`Keyword patterns: ${cat.keywords}.`);
  } else {
    lines.push(`Every zoom lands on the product; the product is on screen at least twice; the last second is logo + CTA.`);
  }

  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const n = words(line);
    if (used + n <= max) {
      out.push(line);
      used += n;
      continue;
    }
    const room = max - used;
    if (room > 8) out.push(`${line.split(/\s+/).slice(0, room - 1).join(" ")}…`);
    break;
  }
  return out.join("\n");
}
