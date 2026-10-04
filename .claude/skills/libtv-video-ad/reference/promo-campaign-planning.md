# Promo campaign planning (BF/CM-style, 15 s)

Deliverable before any spend: a plan the user approves — per product 3 creatives, each with event, audience,
insight, hook type (q / c / p), an 8-shot table (time · picture · camera move · on-screen keyword · engine),
the VO (24–28 words ≈ 10 s), "why it works", the disclaimer, plus research, asset rights and budget.
Example: `reference/examples/tcl-bfcm/plan.py` (data, reused by the render step) → `make_doc.py` (.docx).

15 s skeleton: 0–1.5 hook (2 shots) → payoff/service shown by 5 s → 5–10 proofs, one selling point per shot,
≤ 2 s each → 10–15 end card (official packshot composited, price `[占位]` until announced, CTA, disclaimer).

Making a service the core message: show it as action in the first 5 s (installers at the door, level on the
wall, TV clicks on); say it in the VO once ("we install it free"); keyword "FREE PRO INSTALL*"; the asterisk
points to the page's own limits. Angles that worked in planning: Doorbell→Done (process), Glare Wars
(problem/contrast on the event day), Size Up / Zero Lifting (big sizes), We Mount. You Play (gamers),
Gallery Wall (design), Brightest Room (day→night one-take).

Event timing 2026: Black Friday 11/27, Cyber Monday 11/30. Thanksgiving-day viewing is a real BF scene; use
generic sport, never league marks.

## Review lessons (Barron, 2026-10-04 — v2 scripts in `reference/examples/tcl-bfcm/scripts_v2.py`)
- **The first 3 s must be the surprise, not the logistics.** "Installers ring the doorbell" bored; "a TV-sized gift
  with a gold bow → installed in 1 s → a kid tears the paper and the screen lights up" hooks. Holiday = gift reveal.
- **1-second install** = a natural-speed 5 s Kling clip, time-remapped 4–5× with motion blur, the last frames landing
  on the click at 2.0 s. Fine print: "Installation sped up for dramatization."
- **Every proof gets a zoom-in highlight**: a loupe (~32 % of width, 1.6–1.8×, thin white ring + soft shadow) popping on
  the beat with a 1–4 word spec label; one per shot, clear of faces and safe zones.
- **One split-screen comparison per ad** (top: generic old/glossy product, bottom: ours; same framing and light;
  labels + "Simulated"). Never name a competitor.
- **Measurement callouts use the store's own numbers** (QM8L 65" body 2.0", QM7L 65" 2.2", NXTPAPER 14 6.95 mm).
- **Life scenes sell the season**: Christmas morning with kids, game day with friends, date night by candlelight,
  New Year's Eve fireworks (true black). No league marks, landmarks or licensed characters.
- **WAS price** must be the live compare-at price when the ad ships (FTC former-price rule).

## Keyframe-review lessons (Barron, 2026-10-04 — v4 scripts in `reference/examples/tcl-bfcm/locked_v4.py`)
- **Casting follows the brief's audience.** Write ethnicity, age, hair, skin and wardrobe for *every* person in every
  prompt (leads, kids, friends, installers) — the image model fills unspecified people at random.
- **One casting sheet per ad, of the whole family or couple.** `castLock` describes everyone who recurs; each cast
  shot says who from image 1 is in it ("only the father, not the children"). Group shots: lead sharp in the
  foreground, extras soft behind — multi-face shots are where identity drifts.
- **The product reference must show the real frame on all four sides.** An angled or cropped packshot let the model
  invent thick bezels. Use the straight-front render, measure its screen rectangle from pixel profiles (never trust a
  vision model's box), paste the shot's own picture on screen, and pass it per shot as `locked.refImageUrl`.
- **Screen content is composited, not prompted**: village, game, fireworks, art each go on the front render as that
  shot's reference, so the screen is exact and logo-free. Art-mode TVs: a public-domain masterpiece (Van Gogh's
  *Sunflowers*) in a cream mat reads instantly as "a TV that hangs like art"; use a full-bleed crop for border shots.
- **Gift unboxing is shot top-down** (overhead, looking straight down): tear the wrap, lift the lid, lift the product out.
- **Tablets: show the modes, not just the screen** — a 360° turntable turn (Kling, 5 s remapped ~3×), then a whip from
  sheet music to hand sketching on the same device.
- **No thrown food** (popcorn, snacks) — celebrate with props that read festive: red and gold Christmas balloons.
- **People talk to each other**: every cast shot has a look, a line or a touch between them (whisper, laugh, turn to a
  friend), relaxed natural body language — never everyone staring at the TV.
- **A family dog on the floor** (one breed per ad, same dog every shot) makes home scenes feel lived-in.
- **Art-mode pictures are full-screen** — edge to edge, no mat or inner border, in every shot and on the end card.

## Edit rules (Barron, 2026-10-04 — v7 masters)
- **First 3 s = the sale pitch**, every promo ad: a question + the offer, one line per hook frame, e.g.
  "WANT A NEW YEAR GIFT?" → "BLACK FRIDAY: UP TO 40% OFF*" (→ the product's own hook, e.g. free installation).
  The % comes from the **live** store price vs compare-at (Shopify `/products/<handle>.js`), "UP TO" when sizes
  differ, with fine print "*Up to N% off vs. compare-at price on <store> as of <date>; Black Friday pricing may vary."
  VO says the short form ("New Year gift? Black Friday, up to 40% off —"); captions never repeat the headline.
- **Zoom-ins always land on the product**: locate the device in the actual clip frame at the zoom moment
  (Gemini box_2d + a claim point: slim → edge, border → corner, nits/zones → bright screen detail), target =
  0.6·point + 0.4·box centre, clamped inside the box; split-screen shots keep y in 0.3–0.7.
- **Audio**: **transitions are silent** — no whoosh, thump or shaker on any cut (they read as "cha-cha");
  the only effect is a soft pop when the CTA button lands. Holiday copy gets the Christmas/New Year bed
  (Jingle Bells chorus, public domain, on celesta + soft piano, clean bell tones), mixed under the voice.
- **Last 1 s**: brand logo + a bouncing CTA button ("CLAIM COUPON" via the brand kit CTA) on the end card.
