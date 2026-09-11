# Audit 03 — Script + Storyboard generation (Claude Opus)

## 1. Current script schema and prompt

**Fields.** `prisma/schema.prisma:362-383` — `Script` has `title, angle, format, duration, platform?, totalDurationSec?, hookVariants(Json), body(String), ctaVariants(Json), narrativeType, targetEmotion, predictedScore, scenes(Json?), platformTechniques(Json?)`. No `videoType`, no `template`, no structured `body`. `body` is a free-text blob with `[SCENE X: Xs-Xs]` markers (`script-writing.ts:68`). Hook and CTA exist only as flat `string[]` variants; the chosen hook/CTA is never bound to the body.

**Counts.** Angles: fixed 10 (`angle-generation.ts:26,45`). Scripts: `scripts-batch/route.ts:89` hard-slices `angles.slice(0, 3)` — the owner's "only ~3 script types". Formats: free-text `short_form|long_form|ugc|testimonial|tvc` (`script-writing.ts:63`), unvalidated on save (`scripts/route.ts:146`). `NarrativeType` (10 values) is narrative tone, not an ad archetype.

**Duration.** `totalDurationSec` default 30, enforced only by prompt text (`script-writing.ts:56-57,150`). Batch path never passes it — `scripts-batch/route.ts:91-99` omits `totalDurationSec`, `selectedEnvironment`, `selectedActorRole`, `videoTimeline`, `hookFormulas`, `cameraAngles`, `audienceSummary`, `productDescription`; omits `scenes` from Zod (`:10-22`) and from `create` (`:112-127`). **The primary pipeline ("Generate full pipeline", `creative/page.tsx:255-256`) produces scripts with null scenes, null duration, null platform.**

**Video type.** `grep -rn "videoType|PRODUCT_INTRO|PROMO_OFFER|AWARENESS"` → zero hits.

**Inputs reaching the prompt.** brand/product, angle, top-5 selling points, campaign goal, platform playbook + hook formulas, campaign selection, `DeepAnalysis.hookFormulas`(3), `.cameraAngles`(5), `.platformInsights`. **Not reaching it:** `sellingPointVisuals`, `ctaAnalysis`, `competitiveGaps`, `videoStructure`, `vibeAnalysis`, `environmentAnalysis` — display-only. No competitor transcript corpus reaches the writer.

## 2. Storyboard

`storyboard-generator.ts:59-108`: fixed grid → ask for N frames → `repairFrames` stamps the grid (`storyboard-grid.ts:141-179`).

- Cadence **3 s** (`FRAME_SECONDS = 3`, `storyboard-grid.ts:8`), hard cap `MAX_FRAMES = 10` (`:9`). A 60 s TVC yields 10 frames covering 0–30 s only.
- No HOOK/BODY/CTA tag on `GridFrame` (`:122-133`); `segmentLabel` used only as fallback for `scene` (`:161-165`). UI has no segment badge.
- No `shotType`, `cameraMove`, `productAction`, `sfx`, `videoPrompt` on a frame.
- Script-scene tie-back lossy (`sceneForWindow` `:60-86`) and nonexistent on the batch path (scenes null → `"(no matching script scene — infer from narrative)"` `:93` for every frame).
- Only `hooks[0]`/`ctas[0]` reach the storyboard prompt (`storyboard-generator.ts:80-81`).

## 3. Gaps

| # | Gap | Evidence |
|---|---|---|
| G1 | No videoType | zero hits |
| G2 | No script-template taxonomy | `schema.prisma:37-48` |
| G3 | Only 3 scripts per run | `scripts-batch/route.ts:89` |
| G4 | Batch path drops duration/platform/scenes/env/actor/timeline | `scripts-batch/route.ts:10-22,91-99,112-127` |
| G5 | Body unlabeled prose; hook/CTA not bound | `script-writing.ts:68`; `creative/page.tsx:509-514` |
| G6 | No per-selling-point "how expressed / which shot" | `script-writing.ts:138-139` |
| G7 | Six DeepAnalysis fields never injected | only `insights/page.tsx` reads them |
| G8 | Cadence 3 s not 2 s | `storyboard-grid.ts:8` |
| G9 | 10-frame cap truncates 45/60 s | `storyboard-grid.ts:9,24` |
| G10 | No HOOK/BODY/CTA segment on frames | `storyboard-grid.ts:122-133` |
| G11 | No shotType/cameraMove/productAction/sfx/videoPrompt | same |
| G12 | Duration sum never validated in code | `script-writing.ts:56` |
| G13 | `format` unvalidated | `scripts/route.ts:146` |
| G14 | Test-matrix formats hardcoded to 4 | `test-matrix/route.ts:55` |
| G15 | Only variant `[0]` reaches storyboard | `storyboard-generator.ts:80-81` |
| G16 | `cinematic-prompt-builder.ts` routes by brand-name substring; `@deprecated` yet only source of category cinematography | `:232-238,302-308,390-396` |

## 4. Design proposal

### 4a. ScriptTemplate taxonomy (20)

videoType: PI = PRODUCT_INTRO, PO = PROMO_OFFER, AI = AWARENESS_INTEREST. Beats = hook/body/cta %.

| Template | Type | Beats | Platforms | When |
|---|---|---|---|---|
| PROBLEM_AGITATE_SOLVE | PI | 20/60/20 | TikTok, IG, YT | Pain instantly visual |
| BEFORE_AFTER | PI | 15/65/20 | TikTok, IG, Amazon | Transformation filmable |
| DEMO_HOW_IT_WORKS | PI | 15/70/15 | Amazon, YT | Mechanism is differentiator |
| THREE_REASONS_WHY | PI | 15/70/15 | TikTok, YT | 3 discrete benefits |
| UNBOXING_ASMR | PI | 20/65/15 | TikTok, IG | Packaging/tactility sells |
| TUTORIAL_HOWTO | PI | 15/70/15 | YT, IG | Product needs teaching |
| FOUNDER_STORY | AI | 20/65/15 | IG, YT, TVC | Trust / premium |
| DAY_IN_THE_LIFE | AI | 15/70/15 | TikTok, IG | Routine fit |
| TREND_POV | AI | 25/60/15 | TikTok | Live trend |
| GREENSCREEN_COMMENTARY | AI | 25/60/15 | TikTok | Reacting to post/stat |
| MYTH_BUST | AI | 25/60/15 | TikTok, YT | Category misconception |
| STAT_SHOCK | AI | 25/60/15 | TikTok, YT | One hard number |
| US_VS_THEM | PI | 15/65/20 | Amazon, YT | Incumbent displacement |
| COMPARISON_SPEC | PI | 15/70/15 | Amazon | Listing comparison |
| TESTIMONIAL_MASHUP | PI | 15/65/20 | TikTok, IG, YT | Review volume |
| SOCIAL_PROOF_STACK | PO | 20/55/25 | TikTok, IG | Press + ratings + UGC |
| OBJECTION_HANDLING | PO | 20/55/25 | YT, IG | Known blocker |
| QA_FAQ | PO | 20/55/25 | YT, Amazon | Pre-purchase questions |
| OFFER_LED_PROMO | PO | 15/50/35 | TikTok, IG, YT | Discount/bundle |
| SCARCITY_LAUNCH | PO | 20/50/30 | TikTok, IG | Drop/deadline |

(OFFER_LED_PROMO / SCARCITY_LAUNCH excluded on Amazon per no-external-CTA rule.)

### 4b. New Script JSON

```ts
{
  videoType, template, platform, totalDurationSec,
  hook:  { text, visual, shot, durationSec, hookFormula },
  body:  [ { beat, sellingPoint, howExpressed, shot, startSec, endSec, voiceover, textOverlay, proof } ],
  cta:   { text, offer, urgency, visual, shot, durationSec },
  hookVariants, ctaVariants, narrativeType, targetEmotion, predictedScore, platformTechniques
}
```
Duration sum validated in code.

### 4c. Storyboard — 2 s cadence

```ts
frame = { index, tStart, tEnd, segment:"HOOK"|"BODY"|"CTA", shotType, cameraMove, subject, productAction, textOverlay, voiceover, sfx, imagePrompt, videoPrompt }
```
```
FRAME_SECONDS = 2; frameCount = ceil(dur/2)
hookEnd = snapEven(dur*hookPct); ctaStart = dur - snapEven(dur*ctaPct)
segment = tStart < hookEnd ? HOOK : tStart >= ctaStart ? CTA : BODY
```
15 s → 8 frames; 30 s → 15; 45 s → 23; 60 s → 30. Each BODY frame inherits `sellingPoint`/`howExpressed` from the overlapping body beat.

## 5. Top 10 changes

1. New `src/services/ai/prompts/script-templates.ts` — 20-template registry.
2. `schema.prisma` Script — add `videoType`, `template`, `hook Json`, `bodyBeats Json`, `cta Json`; enums.
3. `script-writing.ts` — require template + videoType; emit labeled hook{}/body[]/cta{}.
4. `scripts-batch/route.ts` — remove `slice(0,3)`; pass full input set; persist new fields.
5. `storyboard-grid.ts` — `FRAME_SECONDS = 2`, drop cap, add segment + shot fields, derive segment from template.
6. `storyboard.ts` prompt — 2 s grid, per-window beat context, `videoPrompt`, all variants.
7. `scripts/route.ts` — inject six orphaned DeepAnalysis fields; duration validator.
8. `angle-generation.ts` — each angle declares videoType + candidate templates.
9. `storyboard-frame-card.tsx` + `creative/page.tsx` — HOOK/BODY/CTA badges; three labeled sections.
10. `test-matrix/route.ts` — drive from template registry.

Unverified: `studio/generate-shots/route.ts`, `video-gen/prompt-compiler.ts` overlap with `videoPrompt`.
