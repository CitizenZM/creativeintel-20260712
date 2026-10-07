# Ad planning playbook (built-in research, condensed)

Distilled from `out/research/ad-research/01-selling-points.md`, `02-platforms.md`, `03-hooks-endcards.md`
(2026-10-06). The same knowledge ships inside the app: `src/services/creative/{playbooks.ts, hooks.data.ts,
platforms.data.ts, library.ts, campaign-planner.ts}` — every script-writer and director prompt gets a ≤ 400-word
slice of it automatically. Use this file when you plan by hand.

**Direction (Barron, 2026-10-06): sell hard.** Write the boldest, most persuasive wording the product's real facts
support: real numbers, superlatives the facts carry, urgency from the real sale event or deadline, direct
comparisons. The only hard data rule: never invent a number, rating, review, test or offer.

## 1. How to plan one ad (the order the planner uses)

1. **One big idea** (≤ 12 words) on the #1 selling point; one idea per ad, the 3 hook variants test openings, not ideas.
2. **Selling points ranked** = .30 buyer importance + .25 evidence + .20 differentiation + .15 filmability + .10 emotion.
   Each = claim → benefit → **proof shot** (a concrete thing the camera sees in ≤ 8 s).
3. **Beat map** (times sum to the platform length):
   `hook (0 → hook second)` → `sale pitch inside 0–3 s (promo)` → `one proof beat per selling point (its proof shot,
   zoom lands on the product)` → `benefit / lifestyle (long cuts)` → `objection buster` → `offer / end card` →
   `last 1 s: logo + bouncing CTA button`. Product on screen at least twice. Frame 1 bright with product or subject.
4. **3 hook variants** from 3 families — one reveal, one claim/text, one native/demo (TikTok: a native one first).
   The body is shared; only the hook segment changes, so variants are cheap.
5. **End card** from the live facts: % → E02, code → E03, compare-at → E04, deadline → E05, rating → E06,
   gifting window → E08, CTV → E11, app → E10, else E01 (TikTok DR: E12 / E09).

## 2. Script formulas

**First-3-s sale pitch (every promo ad):** occasion / need question → offer, one line per hook frame.
`"Want a New Year gift?"` → `"20% OFF this Black Friday"` (VO says the short form, captions never repeat the headline).

| Hook formula | Pattern | Example |
|---|---|---|
| Sale pitch | [occasion question]? → [EVENT]: [N]% OFF | Want a New Year gift? → 20% OFF this Black Friday |
| Deal slam | [was] → [now] + % badge on the product, frame 1 | $499 → $349. 30% OFF today |
| Gift reveal | the gift they'll actually use + bow pull → product | The gift they'll actually use |
| Pain question | Still [pain from 1–2★ reviews]? → fix on the cut | Still squinting at glare on your tablet? |
| Bold number | [real spec number + unit]. [what it means]. | 3,000 nits. Noon-proof. |
| POV | POV: you finally found a [product] that [benefit] | POV: your air fryer cleans in 10 seconds |
| Comment reply | the #1 doubt as a comment → answer clip | "Does it fit my 2018 Civic?" |
| 3 reasons | 3 reasons [audience] switched to [product] | 3 reasons cyclists switched to this light |
| Contrarian | Stop [habit]. [product] does it better. | Stop paying for a new head unit. |
| Search bar | types "best [product] for [situation]" → product | best tablet for reading in bed |
| Identity | [who you are / the moment] + product in scene | Sunday movie night, upgraded |

**VO / on-screen text**
- VO ≈ 2.5 words/s, one selling point per line: real number → buyer payoff ("3,000 nits — bright even at noon").
- On-screen ≤ 6 words, the claim's keyword in caps ("TRUE BLACK"); never the VO word for word; TikTok reads 5–10 words/s.
- Proof beat = show it → say the number → say the payoff. Objection beat = the doubt in buyer words → the busting shot.
- Superlatives and urgency whenever a fact carries them ("lowest price of the year", "ends Sunday").
- CTA spoken + shown together: offer + action ("Use code SAVE20 — tap Shop Now"). Last second: logo + bouncing button.

**CTA copy by goal (button ≤ 4 words)**

| Goal | Headlines | Buttons | VO |
|---|---|---|---|
| Purchase (cold) | Yours from $___ · The ___ upgrade you'll feel · Ships free today | Shop now · Get yours · Tap Shop Now ↓ | Tap Shop Now to get yours. |
| Promo / coupon | Extra ___% off: code ___ · Your code expires ___ · Black Friday price unlocked | Claim coupon · Use code ___ · Get the deal | Use code ___ at checkout. |
| Retarget | Still thinking about it? · Back in stock | Complete order · Grab it now | It's still in your cart — grab it now. |
| Awareness | See how it works · Built for ___ | Learn more · Explore | Tap to see what it can do. |
| App install | Free on iOS & Android · Try it tonight | Install now · Get the app | Install free and try it tonight. |
| Lead | Get a free quote · Book a demo | Get quote · Book now | Tap to book now. |

## 3. Platform table

| Platform | Length (ideal / range) | Hook by | Cuts/s early → body | Sound | Audience | Edit grammar |
|---|---|---|---|---|---|---|
| tiktok | 21 s / 15–34 | 3 s | 0.8 → 0.5 | on | 18–34, entertainment-led discovery, impulse buys via TikTok… | hook = creator POV / pattern interrupt / 'wait for it', product or key message by 3 s; casual creator talking to camera; native white captions 2–5 words; >120 BPM track + VO, beat-synced cuts every 1–1.5 s early; close … |
| instagram_reels | 15 s / 9–30 | 2 s | 0.7 → 0.5 | on | 18–34, aesthetic lifestyle discovery | hook = aesthetic reveal + text sticker in 0–2 s; styled creator in a real home; product shown more than once; sticker text + light VO; cut every 1.5–2 s; close 'Shop the look' above the bottom 35% |
| instagram_stories | 10 s / 6–15 | 1.5 s | 0.6 → 0.4 | mixed | 18–44, quick tap-through | one idea per 5-s card, brand + product by 1.5 s, ≤ 6 words per card, must survive mute; 'Tap to shop ↑' sticker above the bottom 20% |
| meta_feed | 15 s / 6–30 | 3 s | 0.5 → 0.35 | off | 30–64, value and deal seekers, mostly sound-off | 4:5; headline bar with the offer or price from frame 1; three benefit callouts with burned-in captions (≥ 64 px); real hands demo; social proof; slower cuts (2–3 s); close 'Get the deal' + price frame |
| facebook_reels | 15 s / 9–30 | 2 s | 0.6 → 0.45 | on | 25–54, entertainment + deals | same build as IG Reels but lead with the offer and show the price plainly; friendly reviewer voice; close offer + 'Shop now' |
| youtube_instream_skippable | 20 s / 15–60 | 5 s | 0.4 → 0.3 | on | 18–64, research intent, often on a TV | ABCD: attract + speak the brand inside 5 s, problem → demo → proof story, confident narrator, lower-third benefit titles, cut every 2.5–4 s, CTA in VO + graphics, end screen with offer (QR for CTV) |
| youtube_instream_nonskippable_15s | 15 s / 7–15 | 2 s | 0.5 → 0.4 | on | 18–64, lean-back, captive | mini-arc: hook 0–2 s → benefit 2–8 s → proof 8–12 s → brand + CTA 12–15 s; brand at start and end; one message |
| youtube_bumper_6s | 6 s / 5–6 | 1 s | 0.7 → 0.7 | on | 18–64, reach and recall | one message built for 6 s: hero shot + product + logo by 1 s, one benefit line ≤ 5 words, brand lock-up last second |
| youtube_shorts | 20 s / 10–35 | 1.5 s | 0.8 → 0.5 | on | 13–34, swipe-fast | hook in 0–1.5 s; everyday creator to camera 'you need this'; sound on (music + VO); bold captions upper-middle; on-screen CTA from 3 s matching the Shorts button |
| google_demand_gen | 15 s / 10–30 | 3 s | 0.5 → 0.4 | mixed | 18–64 across YouTube, Shorts, Discover, Gmail | works in every ratio and muted: clear product + offer early, captions + VO, CTA repeated in VO and overlay, end card with the offer, ≥ 10 s |
| pinterest | 10 s / 6–15 | 2.5 s | 0.4 → 0.3 | off | 18–44, mostly women, planners with search intent | 'idea' framing ('3 ways to…', 'gift for…'), text-led and silent-first, styled flat-lay / room, cover-worthy last frame, soft CTA 'Shop the idea' |
| snapchat | 6 s / 3–10 | 1.5 s | 1 → 0.8 | on | 13–24, camera-first | 3–6 s single idea, brand by 1.5 s, bold motion selfie, few words, punchy track, 'Swipe up' style close |

Adaptation rule: keep product truth, proof point, offer and brand assets fixed per concept; regenerate hook,
talent, pacing, aspect, audio strategy, CTA wording and safe-zone layout per platform. Meta and TikTok variants
must be different concepts, not resizes. Safe box on 9:16: every readable layer inside y 288–1220, x 120–960.

## 4. Category selling-point patterns

### TVs (`tv`)
- **Buyers decide on:** picture quality, screen size (value per inch), brand trust, smart platform; then brightness/contrast tech, gaming (native Hz, VRR), sound
- **Proof shots:** brightness → sun-glare split: sunlit living room, blinds open, picture still punches vs a dim generic set; contrast → dark-room star field / moon beside true black, no blooming halo; size → person-for-scale walk-in, family in front, inch count on screen; gaming → fast-pan side-by-side + controller-in-hand POV; thin / wall-mount → side profile against a coin edge; 1-s install; smart → 5-s voice search, content starts
- **Keywords:** 85 inch tv · mini led tv · best tv for bright room · gaming tv ps5 · tv black friday · #tvsetup #hometheater #movienight
- **Objection busters:** washes out in my bright room? → sun-glare split; too big for the wall? → scale walk-in + tape measure; hard to mount? → installed in 1 s (time-remap); clunky smart TV? → voice search plays in 5 s

### Tablets / laptops (`tablet_laptop`)
- **Buyers decide on:** price, screen comfort (matte / paper-like), battery, performance for the job (reading, study, kids, light work), weight, pen + keyboard
- **Proof shots:** eye comfort → glare test under a desk lamp / window sun beside a glossy tablet: reflection on one, none on ours; battery → day-in-the-life time-lapse with a battery % counter; light → one-hand hold, slides into a tote, gram scale overlay; pen → handwriting close-up, zero lag; modes → 360° turntable turn, then whip from sheet music to sketching on the same device
- **Keywords:** tablet for reading · eye care tablet · e ink alternative · tablet with pen · best budget tablet · #studytok #booktok #notetaking
- **Objection busters:** matte = washed out? → vivid video side-by-side; too heavy for bed? → one-hand reading lying down; battery dies? → day time-lapse ending above 30%

### Small kitchen appliances (`kitchen_appliance`)
- **Buyers decide on:** capacity, results (crispy, even), speed, easy cleaning, counter footprint, presets/app, price
- **Proof shots:** crispy → ASMR crunch close-up, cut-open wing, 1 tsp oil vs a deep-fryer pot; fast → stopwatch vs oven preheat, 'dinner in 12 min' timer; capacity → whole chicken drops in, family plate count; easy clean → basket wiped in 10 s / straight into the dishwasher; compact → footprint beside a coffee maker with a ruler; smart → 'food's ready' notification on the couch
- **Keywords:** air fryer recipes · dual basket air fryer · crispy wings air fryer · easy clean air fryer · #airfryer #easydinner #kitchengadgets
- **Objection busters:** pain to clean? → 10-s wipe / dishwasher; fits my counter? → footprint ruler shot; big enough for the family? → whole chicken / 4 plates

### Air purifiers / humidifiers / vacuums (`home_air_cleaning`)
- **Buyers decide on:** room coverage (CADR, sq ft), True HEPA filtration, sleep-mode noise, filter cost, auto mode, design; vacuums: pickup, pet hair, battery
- **Proof shots:** clears the room → PM2.5 counter time-lapse, smoke gone, AQI ring red → blue; quiet → dB meter beside a sleeping person; allergy / pet relief → grey furry pre-filter reveal after 30 days; auto mode → sensor reacts to a spray in 3 s; coverage → floor-plan overlay with sq ft; vacuum → cereal / pet-hair / sand on carpet, anti-tangle brush close-up
- **Keywords:** air purifier for bedroom · for allergies · for pets · wildfire smoke · quiet air purifier · #allergyseason #cleantok #petowner (CEPs: allergy season, smoke days, new baby, new pet, cooking smells)
- **Objection busters:** loud at night? → dB meter at the bedside; filters cost a fortune? → cost-per-month card; big enough? → floor-plan overlay

### Beauty / skincare / hair tools (`beauty_skincare`)
- **Buyers decide on:** visible result and how fast, skin-type fit, ingredients, texture, price per use, creator trust, shade match
- **Proof shots:** instant effect → one-swipe / half-face demo, real time; texture → macro finger-swipe, absorption timer; long wear → time-stamped check-ins 8 am → 6 pm, splash test; hair tools → half-head straightened, frizz test in humidity; ingredients → ingredient pour shot with the % on screen
- **Keywords:** glass skin · skincare routine · for sensitive skin · frizz free · drugstore dupe · #skintok #grwm #tiktokmademebuyit
- **Objection busters:** will it suit my skin? → swatches on three skin tones; does it last? → time-stamped check-ins; worth the price? → price-per-use card

### Jewelry / fashion (`fashion_jewelry`)
- **Buyers decide on:** style fit, won't tarnish / won't turn green, sensitive ears, price-to-look, giftability (box, occasion), personalization
- **Proof shots:** tarnish-proof → shower / pool / sweat test with a day counter (day 1 → day 60), tissue rub, no residue; sparkle → ring-light macro, slow rotation, slow-mo glint; styling → '3 ways to wear' quick cuts; gift → unboxing reaction, gift box, occasion line; fit → on-ear / on-neck scale with a ruler
- **Keywords:** waterproof jewelry · tarnish free jewelry · hypoallergenic earrings · gold huggie earrings · gift for her · #jewelrytok #giftideas #everydayjewelry
- **Objection busters:** turns green? → day-60 shower test; looks cheap? → macro sparkle beside fine jewelry; sensitive ears? → all-day wear check-in

### Cycling / sports / outdoor (`sports_outdoor_cycling`)
- **Buyers decide on:** visibility (lumens, beam), durability + weather (IPX), fit / weight, battery + USB-C, mount ease, price vs premium brands
- **Proof shots:** bright → night-road POV light on vs off; car-driver POV of the rear light at 100 m; battery → ride time-lapse with battery overlay; USB-C charge stopwatch; weatherproof → rain ride / hose spray; quick mount → tool-free install in 10 s, stopwatch; eyewear → photochromic shift shade → sun time-lapse
- **Keywords:** bike light usb c · brightest bike light · cycling sunglasses photochromic · bike bag waterproof · #cycling #gravelbike #bikecommute
- **Objection busters:** survives rain? → hose spray; fits my bars? → clicks onto three bar sizes; dies mid-ride? → battery time-lapse

### Car tech (CarPlay / Android Auto adapters, AI boxes, dash cams) (`auto_accessories`)
- **Buyers decide on:** fits my car and phone (#1 anxiety), connection stability / lag, plug-and-play install, wireless CarPlay / AA, streaming, price vs a new head unit
- **Proof shots:** wireless in seconds → get in, phone stays in the pocket, CarPlay appears — one take with an on-screen timer; plug-and-play → unbox → USB port → working in 30 s; compatibility → fit-check carousel of car models + 'check your car' CTA; no lag → split screen: phone tap vs car screen response; streaming → passenger watches while parked
- **Keywords:** wireless carplay adapter · carplay ai box · android auto wireless adapter · carplay netflix · #carplay #cartok #cargadgets
- **Objection busters:** fits my car? → model carousel + checker; laggy? → split-screen tap sync; hard to install? → 30-s plug-in

### Cameras / creator gear (`camera_creator`)
- **Buyers decide on:** image quality in real conditions, stabilization, easy (AI) editing, waterproof / durable, battery, size / mounts, price vs GoPro / DJI
- **Proof shots:** stabilization → bumpy MTB POV split: phone vs camera; spin the camera, horizon stays flat; 360 → one clip reframed into three angles; invisible-selfie-stick third-person shot; waterproof → pool jump / snorkel; AI edit → raw footage → auto-edit in 10 s (screen recording); tiny → thumb-size scale shot, magnetic clip on a cap
- **Keywords:** 360 camera · best action camera · invisible selfie stick · vlogging camera · motorcycle camera · #pov #360camera #motovlog
- **Objection busters:** editing takes forever? → AI auto-edit in 10 s; shaky footage? → horizon-lock spin; breaks on impact? → drop + pool test

### Food & beverage (`food_beverage`)
- **Buyers decide on:** taste / craveability, nutrition (protein, sugar), convenience, value per serving, dietary fit
- **Proof shots:** taste → slow-mo pour / crunch / steam / cheese pull + first-bite reaction; nutrition → label zoom with the comparison number; convenience → 'ready in 60 s' timer, one hand on the go; ingredients → flat-lay line-up
- **Keywords:** high protein snack · low sugar · healthy snacks · easy breakfast · #foodtok #mealprep
- **Objection busters:** tastes like cardboard? → first-bite reaction; too much effort? → 60-s timer

### Home / furniture / bedding (`home_furniture`)
- **Buyers decide on:** comfort, fits my space, durability, assembly ease, delivery and returns, style
- **Proof shots:** fits → tape-measure room overlay, door-width check; assembly → 'assembled in 12 min, no tools' time-lapse; comfort → sink-in / bounce-back slow-mo, hand print in foam; durable → people stand on it with a weight overlay; spill wiped off; mattress → unroll and expand time-lapse
- **Keywords:** small space furniture · easy assembly · pet friendly couch · cooling mattress · #homedecor #apartmentmakeover
- **Objection busters:** assembly nightmare? → no-tools time-lapse; fits my door / room? → width check; stains? → spill-wipe test

### Pet (`pet`)
- **Buyers decide on:** pet health / ingredients, pet acceptance, vet trust, less mess, durability, price
- **Proof shots:** loves it → bowl licked clean, tail wag, multi-pet test; mess-free → lint roller before / after; durable → power-chewer time-lapse; automatic → app notification + time-lapse
- **Keywords:** picky eater dog food · toy for aggressive chewers · pet hair remover · self cleaning litter box · #dogsoftiktok #catsoftiktok
- **Objection busters:** my picky eater won't touch it → real reaction; destroyed in a day? → chew time-lapse

### General products (`other`)
- **Buyers decide on:** the result it delivers, how easy it is, value for money, giftability
- **Proof shots:** result → the product working on frame 1 (hands-only demo); ease → unbox → working in N seconds; value → scale or comparison card; gift → gift reveal + reaction
- **Keywords:** best [product] for [use] · [product] gift · #tiktokmademebuyit #giftideas
- **Objection busters:** does it really work? → one-take demo; hard to use? → setup in seconds

## 5. Hook library index (H01–H35)

Full recipes (keyframe, motion, text pattern, SFX, risk) in `src/services/creative/hooks.data.ts`. AI-fit low =
needs real creator footage (generated faces morph). Matrix category × goal → primary hooks lives in `library.ts`.

| ID | Family | Hook | Frame 1 → move (recipe) | Dur s | AI-fit |
|---|---|---|---|---|---|
| H01 | reveal | Hero Turntable Reveal (360° spin) | the product turns on a seamless sweep or podium, already lit, and a spec lands on beat 2. | 1.5–2 | high |
| H02 | reveal | Macro Detail Pull-Back | open on an extreme macro of a texture, stitch, nozzle or screen pixel, then pull back to reveal the whole pro… | 1.2–1.8 | high |
| H03 | reveal | Light-Sweep / Specular Glint Reveal | a light bar sweeps across the product and makes a glint, as in a premium launch film. | 1–1.5 | high |
| H04 | reveal | Product Blast (push to lens) | on frame 1 the product rushes at the camera, bright, and spec lines stack in. This is the existing `--hook p`. | 0.8–1.5 | high |
| H05 | reveal | Unboxing / Lid-Lift | hands open a box, lift the lid or peel the film, and the product is revealed in its packaging. | 1.5–2.5 | med |
| H06 | reveal | Gift Reveal (wrap tear / bow pull) | a wrapped gift is torn or a bow is pulled, and the product appears. | 1.5–2 | med |
| H07 | demo | Extreme Reaction Close-Up | a tight face shot of a jaw-drop, wide eyes or a hand over the mouth, before the cause is shown. | 0.8–1.2 | low |
| H08 | native | POV Hook | a first-person shot with "POV: you finally found a ___ that ___" as text. | 1.5–2.5 | med |
| H09 | demo | Problem → Instant Fix | 0.8 s of the pain (a mess, failure or frustration), then the product fixes it on the cut. | 1.5–2.5 | high |
| H10 | demo | Before / After Split | a split screen or wipe shows the dull or old state against the vivid new state. This is the existing `--hook … | 1.2–2 | high |
| H11 | demo | Satisfying / ASMR Texture | close, tactile action with crisp foley: a click, pour, sizzle, peel or crunch. | 1.5–3 | med |
| H12 | demo | Speed-Ramp Transformation | real speed, a ramp to 4–8× through a transformation (assembly, cooking, room clean-up), then a snap back to r… | 1.5–2.5 | med |
| H13 | claim | "3 Reasons" Listicle | "3 reasons I switched to ___" with a numbered badge, each reason shown as a 1–2 s proof shot. | 1–2 | high |
| H14 | claim | Question Text Hook | an on-screen question over live footage, with line 2 landing on beat 2. This is the existing `--hook q`. | 1–2 | high |
| H15 | claim | Shock Stat / Bold Number | a huge number fills the frame ("98 inches", "10× brighter", "1,000,000 sold") over the product. | 1–1.5 | high |
| H16 | claim | Price Drop / Deal Slam | the strikethrough price, the new price and a % badge slam onto the product on frame 1. | 1–1.5 | high |
| H17 | native | Creator Talking Head (UGC opener) | a creator looks into the lens and delivers one line ("Okay, I need to talk about this ___") with the product … | 1.5–3 | low |
| H18 | native | Green-Screen Reaction | a creator is keyed over a product page, review, headline or comment and points at it. | 1.5–2.5 | med |
| H19 | demo | Stop-Motion Assembly | components jump into place frame by frame (12 fps) and build the product, a meal or a set. | 1.2–2 | high |
| H20 | demo | Scale Contrast | the product next to an unexpected reference object ("this projector is smaller than a soda can"), or tiny-to-… | 1.2–2 | high |
| H21 | native | "Things TikTok Made Me Buy" / Haul | trend-native text over a quick 3–4 product montage. Your product is the hero, or it is the "#1". | 1.5–2.5 | med |
| H22 | demo | Torture Test (drop, water, sun-glare, weight) | the product survives an extreme test on frame 1: dropped, submerged, set on fire, stood on, or set against a … | 1.5–2.5 | low |
| H23 | demo | Lifestyle Moment | an aspirational slice of life (a morning-coffee window seat, a mountain-bike ridge, a cosy movie night) with … | 1.5–2.5 | high |
| H24 | demo | Seasonal / Holiday Surprise | a seasonal icon (snow globe, pumpkin, fireworks, heart box) cracks open or transforms into the product. | 1.5–2 | med |
| H25 | claim | Search-Bar / Typing Hook | a search field types "best ___ for ___", then the product appears as the "result". | 1.2–2 | high |
| H26 | native | Comment-Reply Hook | a comment bubble ("Does it actually fit a 65" TV?") floats on screen, then the answer clip plays. | 1–1.5 | high |
| H27 | native | Chat / Text-Message Hook | a message thread ("babe what do you want for xmas" "THIS 👇") reveals the product. | 1.5–2.5 | high |
| H28 | demo | Pattern Interrupt ("Stop scrolling") | a sudden visual break: the product slaps into frame, a colour flash, a hand blocks the lens, or a freeze fram… | 0.5–1 | high |
| H29 | demo | Side-by-Side Comparison (us vs. generic) | two products in a split screen face the same test, and ours wins. | 1.5–2.5 | med |
| H30 | claim | Myth-Bust / Contrarian Claim | "Stop buying ___ (common practice)" or "You've been using ___ wrong", then the product is the right way. | 1.2–2 | high |
| H31 | demo | Hands-Only Demo (first-frame action) | the product is already working on frame 1: a button pressed, a mount clicking in, a lid snapping. No intro. | 1–2 | med |
| H32 | claim | Ranking / Countdown Reveal ("#1 will surprise you") | a ranked list counts down to our product as #1. | 1.5–2.5 | high |
| H33 | native | Split-Screen Duet / Stitch Reaction | the top half is a "viral" clip or problem, and the bottom half is the creator or product response. | 1.5–2.5 | med |
| H34 | reveal | Cinematic Wide → Hero Drop | an epic establishing shot (city at dusk, mountain road, living-room wall), then a hard push to the product. | 1–2 | high |
| H35 | demo | Slow-Motion Splash / Pour / Drop-In | the product drops into water, sauce is poured, or powder bursts in high-speed slow motion. | 1.2–2 | med |

## 6. End-card index (E01–E12)

Layouts on 1080×1920 inside the safe box; 1.5–3 s; reveal order product/offer → CTA (+0.35 s) → logo. Renderable in
the app today: E01, E02, E03, E04, E08, E09, E12. "Needs" = the fact must exist to fill the card.

| ID | End card | Use for | Button copy | Needs |
|---|---|---|---|---|
| E01 | Brand lockup + pill button | learn more, awareness, evergreen purchase (default close) | Shop now · Learn more · Explore the range | — |
| E02 | Offer badge slam (% off) | promo purchase, sale events | Shop the sale · Get {pct}% off · Unlock deal | promoPct |
| E03 | Coupon ticket (code reveal) | coupon claim, creator/affiliate codes | Claim coupon · Use code {code} · Copy code & shop | couponCode |
| E04 | Price + strike-through | promo purchase, retargeting | Shop now · Get it for {price} · Grab the deal | comparePrice |
| E05 | Urgency / deadline bar | sale ending, limited drop, final day | Shop before {day} · Last chance · Get it today | deadline |
| E06 | Rating + testimonial | cold purchase, consideration, high ticket | See why · Shop the bestseller · Read reviews | rating |
| E07 | Product carousel (multi-SKU) | catalog, collections, 'which one is yours?' | Shop all sizes · Find yours · Compare models | multiSku |
| E08 | Bundle / gift tag | gifting seasons, bundles, gift-with-purchase | Shop gift sets · Give the bundle · Claim free gift | — |
| E09 | Tap-below pointer | drive taps on the platform's own CTA / Shop anchor | Tap Shop Now below · Tap the cart | — |
| E10 | App-install card | app install | Install now · Get the app · Try free | appInstall |
| E11 | QR code card | CTV, desktop, in-store screens | Scan to shop · Scan for {pct}% off | ctvPlacement |
| E12 | Creator-native close (lo-fi caption) | TikTok-first DR, creator/UGC/Spark | link's right there 👇 · trust me on this one | — |

## 7. Using it

- **In the app (operator / Studio):** `product-brief` → `plan-campaign` (or `POST /api/projects/<id>/campaign-plan`
  with `{platforms, goal, promo, overrides?}`) → generate scripts (they follow the stored plan's beat map and rotate
  its hook variants) → storyboard → render. `GET …/campaign-plan` returns the plan + a summary.
- `overrides`: `{"tiktok": {"hookIds": ["H08","H26"], "endCardId": "E12"}}` — pinned hooks lead the auto picks
  (≤ 3); the chosen end card replaces the pick, which moves to the alternates.
- `strictCompliance: true` (or env `CREATIVE_STRICT_COMPLIANCE=true`) restores the old legal layer
  (safe wording, disclosures, AI labels, verified-fresh compare-at, health-category hook drops). Default off.
