# Gap assessment: hook library & endings, video workflows, reference remake / replace

2026-11-08 · review copy `xark-adstudio-lab-20261107` · live Xark untouched

## 1. What exists today (both systems)

| Capability | Ad Studio (Mac pipeline + its own web form) | Xark (creativeintel) | Reaches the new panel? |
|---|---|---|---|
| Hook type (what line 1 does) | 10 types `pipeline/hooks.mjs HOOK_TYPES` | — | ✅ the only hook choice |
| Opening style (how shot 1 enters) | 15 styles `HOOK_STYLES`: text slab, punch, flash, whip, 3 caption styles, Q-card, interview, product lock, single scene, testimonial, product hero, b-roll open, AI talking head | 35-hook library H01–H35 `services/creative/hooks.data.ts` (keyframe, motion, text, SFX, risk, evidence), used by Planning and Batch Mode | ❌ |
| Ending | one built-in close card (offer + logo + CTA) `renderer/src/Imitate.tsx` | 12 end cards E01–E12 `services/creative/library.ts`, rendered as PNG layers `edit/endcard-render.ts` (4 themes) | ❌ |
| Workflows | engine `generate` (AI footage) / `remix` (free stock + product photos); 5 imitation formats (product lock, street interview, documentary, single scene, montage) | Studio compile: LibTV and server engines (GLM, ComfyUI, animatic); Batch Mode re-edits; Ad Cloner (structure → campaign plan text) | ❌ worker hard-codes `engine: generate, format: auto` |
| Imitate a reference video | core mode: TikTok/IG link or upload → download, cuts, transcript, blueprint → remake for the product | Ad Cloner copies a teardown's structure into the plan as text, no video | ❌ Xark jobs skip ingest; the reference is only used for pace (P2) |
| Imitate + replace | same pipeline, high fidelity, product / keywords / selling point swapped (template DB `moneta_adaptation`: replace_product, keywords, selling_point, script) | — | ❌ |

## 2. Why they are missing

One root cause: the integration was built as **"Xark storyboard → Ad Studio second pass"**, and every other input of Ad Studio's job form was fixed to a default in `workers/adstudio-worker/worker.mjs jobOf()` (`engine: 'generate'`, `format: 'auto'`, no `hookStyle`, no `refUrl`). In the pipeline, `job.source === 'xark'` skips ingest/analyze, so a reference video can never be the input. The panel catalog (`adstudio-catalog.ts`) only lists hook types and video models. Xark's own H/E libraries live on the LibTV/Batch Mode path and were never mapped to Ad Studio.

## 3. How to merge (proposal)

**A. One "Workflow" choice at the top of the Ad Studio panel**

| Workflow | Input | Ad Studio path | New work |
|---|---|---|---|
| 1. Optimise storyboard / script (now) | storyboard or script | `source: xark`, generate | — |
| 2. Imitate a reference | competitor ad from Research (the carried video list), or a TikTok/IG link, or an upload | normal remake (ingest → analyze → blueprint → script) **plus** the Xark context pack for product, brand, insights, cast and setting | worker passes `refUrl`/file; new `source: 'xark-ref'` = context yes, storyboard no |
| 3. Imitate + replace | same reference | remake with fidelity locked (same shots, timing, camera, beat), only product / keywords / selling point / offer swapped; a "replace list" is shown with the plan before any spend | replace-list step in the script prompt + panel table; fidelity weight in review |
| 4. Stock remix (free) | any of the above | engine `remix` | expose engine + the 5 imitation formats |

LibTV / server compile stays the panel above; later both panels can sit under one "Choose workflow" step.

**B. Hook opening library and endings**

- **Opening**: a picker over Xark's H01–H35 (the house library, with its evidence and risk notes), grouped like Planning does. Each H is passed to Ad Studio as a brief (keyframe, motion, text, duration, SFX); where an H maps to one of Ad Studio's 15 enforceable styles (product hero, text slab, punch/flash/whip, Q-card, talking head, b-roll open) `applyHook` enforces it on shot 1, and the plan reports what was or wasn't met. Default = the hook the campaign plan already picked.
- **Hook type**: unchanged (10 types, research + performance suggestions).
- **Ending**: a picker over E01–E12 with theme (brand / dark / light / festive); default = the campaign plan's end card. Xark renders the card with its existing `endcard-render.ts` and hands Ad Studio the PNG layers, so both systems share one end-card library instead of keeping two.
- **Batch matrix**: opening × hook type × ending × engine, same 6-video cap and per-video approval.

**C. Order and effort (in the copy first, tested on Mixik)**

1. Workflow 2 — imitate a reference (largest gap, uses the existing remake pipeline): ~1.5 days
2. Workflow 3 — imitate + replace (replace list, fidelity): ~1 day
3. Opening library H01–H35 + endings E01–E12: ~1.5 days
4. Stock remix + imitation formats: ~0.5 day

Planning stays free and stops at approval; video only after approval.

## 4. Done (2026-11-08) — in the review copy

| # | What | Where | Hosted test (Mixik) |
|---|---|---|---|
| 1 | Imitate a reference: research videos (best score first), pasted link, or upload (Blob, ≤200 MB) | panel "Reference video"; `adstudio-queue.ts` `ref:<url>` source; worker `source: 'xark-ref'`; Ad Studio normal remake + Xark context | Test C / D: "That Feeling When Skincare Finally Makes Sense" → 8-shot remake, free remix render, completed |
| 2 | Imitate + replace: same shots/order/timing, product / keywords / selling point / offer swapped; replace list shown before spend | Ad Studio `replaceLines`, `withReplace`, `lockTiming`; panel replace table | Test A: replace list Curology → MIXIK, 4 keywords, timing locked to the reference's 22 shots, waiting for approval ($1.90) |
| 3 | Opening from H01–H35 (✓ = enforced style on shot 1, others as brief); ending E01–E12 × 4 looks, rendered by Xark's end-card code, animated by Ad Studio | panel "Opening" / "Ending" / "End-card look"; `adstudio-endcard.ts` + worker `endcard`; renderer `XarkEnd` | Test B: H14 question card + E02 −21% badge; Test D: H28 + E01 light (headline from the top selling point) |
| 4 | Stock remix (free, no approval stop) + 5 imitation styles | engine "Stock remix · free"; panel "Imitation style" | Test B: interview style, 21.6 s, $0 |

Fixes found while testing: end-card layers were stretched to 1080 px (now natural size); a template without data (E01 headline, E04 price) now gets a headline fallback (brand promise → selling point → product) and logs why it was skipped; reference workflows read "Keep reference hook".
Known: MDNA Rose Mist (top research score) is one continuous take — fine to imitate, but replace mode can only lock one shot; E04/E05 need a price, which Mixik lacks until Setup has a product page URL.
