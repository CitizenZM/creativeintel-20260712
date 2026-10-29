# OUFER Body Jewelry — project walkthrough and five-video evaluation

Date: 17 October 2026 (Pacific). Environment: isolated Vercel preview. The production database was not changed.

## Deliverables

The CreativeIntel project is `cmvd4x7je000207jswqy26726`. Five 15-second, 9:16 scripts and five corresponding eight-frame storyboards are saved in the project. Five product-faithful 720×1280 H.264/AAC review masters, made from OUFER's official product photographs, are in `videos/01-celestial-pov-final.mp4` through `videos/05-structure-demo-final.mp4`. The videos contain an original synthesized music bed and local English narration. They are review masters, not generated live-action footage.

The subject is the **OUFER Titanium CZ Star Cartilage Stud**, SKU `O-LAB-052-WG1606`: silver-tone eight-point star, one clear CZ at its center, one smaller star dangling below, ASTM F-136 titanium, internally threaded flat back, 16G / 1.2 mm, selectable 6 or 8 mm post length, one piece per order. Product detail claims are based on OUFER's own listing: https://www.ouferbodyjewelry.com/products/titanium-cz-star-internally-threaded-cartilage-stud . No dimensions beyond the listed gauge and post lengths were inferred.

| # | Creative | 0–3 s hook | 3–12 s proof / story | 12–15 s close |
|---|---|---|---|---|
| 1 | Celestial POV | A little star. A lot of presence. | Eight-point silhouette, one clear CZ, dangling star, titanium flat back | Shop the Star |
| 2 | Ear Stack Styling | One detail. New energy. | Worn-ear view, precise star, small dangle, silver-tone styling | Find Your Star |
| 3 | Day to Night | Morning | Midday macro, evening glint, same exact piece | Your Star, Your Day |
| 4 | Celestial Macro | Look closer | Eight points, one clear CZ, one dangling star | Every Detail Counts |
| 5 | Structure Demo | Front / Side / Back | Official front and exploded back photographs, internal thread, 16G | Choose 6 or 8 mm; sold singly |

## Final video scripts

Each piece has five three-second scenes. The lines below are the recorded English voiceovers; the visual sequence and on-screen copy are visible in the contact sheet `videos/qa-contact.jpg` and the five MP4s.

1. **Celestial POV:** “A little star. A lot of presence. Meet OUFER's titanium star stud. One clear crystal, one small dangling star. Shop the star.” Visuals: hero silhouette → front detail → worn-ear view → flat-back construction → product close.
2. **Ear Stack Styling:** “One small detail can change the whole look. OUFER's eight-point star has a clear center stone and a tiny dangling star. Style your ear stack your way.” Visuals: worn-ear hook → front view → small dangle → worn-ear styling → product close.
3. **Day to Night:** “Morning light, midday close-up, evening sparkle. The same OUFER star in every frame. A clear center crystal and a small star below. Find your detail.” Visuals: morning worn-ear → midday front → evening side → one exact piece → worn-ear close.
4. **Celestial Macro:** “Look closer. Eight sculpted points. One clear cubic zirconia. One tiny dangling star. An internally threaded flat back completes OUFER's titanium cartilage stud.” Visuals: hero → eight-point front → center CZ → dangling star and back → hero close.
5. **Structure Demo:** “Front, side, back. This is OUFER's titanium CZ star cartilage stud. See the eight-point star, dangling detail, and internally threaded flat back. Choose a six or eight millimeter post.” Visuals: exploded view → front → dangle → internally threaded back → post-length options and single-piece disclosure.

## Measured user journey

1. Login required both Vercel deployment protection and Clerk. Opening a later immutable preview URL required another Clerk sign-in; the signed-in session from the earlier preview URL did not carry over.
2. New project creation auto-scraped OUFER's site. Product Definition displayed four images; Product Intelligence displayed six. Product Intelligence reported “Category not identified” although Jewelry & Accessories was selected in the project form.
3. Brand Kit AI filled official logo, product photos, palette and copy. I removed an unsupported “suitable for initial piercings / long-term wear” claim. Completeness stayed at 95% because physical dimensions in cm were not on the vendor page; the interface simultaneously said the kit was ready for creative.
4. Competitor discovery found Body Candy, Junipurr Jewelry and BVLA. After the ad-research run, the project still showed zero collected ads and asked to re-run research. The estimated remaining time jumped from roughly 5 to 16 minutes at 49% progress.
5. Ten angles took 43 seconds. Seven contained unsupported or unverified claims (such as thousands of reviews, detachable charm, included post lengths, healing/irritation outcomes or absolute durability). I archived those seven. The scoring system still ranked some unsupported angles highly.
6. Five draft scripts took 1 minute 27 seconds. They contained spelling errors, VO too long for 15 seconds and overclaiming. I rewrote all five bodies with exact product facts and distinct treatments. The original UI continued to show stale structured hook/body/CTA fields after the text edits. This was a real data-flow bug: storyboard generation consumed both the new body and the stale fields. It has been fixed in commit `7a0c855` and verified by route tests, TypeScript, lint, PR CI and Vercel preview deployment. Existing scripts require resaving through the new deployment to clear their old fields.
7. Five storyboards took 2 minutes 21 seconds. Because this particular batch was generated through the still-signed-in old deployment, several frames repeated old unsupported copy (“stays put all day and all night”, “you don't feel it”) and misspellings. The frame UI offered Approve, Reject and Note, but no direct edit for scene/VO/on-screen copy. I rejected a false-claim frame and did not approve contaminated storyboards for platform rendering. Direct frame editing was added in commit `a01f7cd` and deployed to the current preview; the contaminated boards still need to be corrected or replaced.
8. The product-photo review masters were rendered locally from four official photographs. A fifth official image displayed two studs together, so I excluded it to avoid suggesting a two-piece order. Each final video decodes fully, has a 15.000-second H.264 720×1280 video track and a 15.000-second AAC audio track. Contact-sheet QA covered the middle of all 25 three-second scenes. Audio peaks are between -5.0 and -4.1 dBFS.

## Overall assessment

| Area | Assessment | Evidence |
|---|---|---|
| Product identity in delivered videos | Strong | All five use OUFER's official photographs; the eight-point star, center CZ, dangling star and flat back match the product page. The two-stud photograph was excluded because the listing sells one piece. |
| Creative diversity | Moderate | Five distinct hooks and narratives, but only four safe reference photographs. The five edits share a photo-led typography format; model footage or new approved photography would materially improve visual variety. |
| Claim safety in the platform's AI drafts | Poor | Seven of ten generated angles required archival; the first storyboard batch still repeated unsupported claims after script text was corrected. |
| End-to-end self-service usability | Needs work | Two login layers, mobile CTA clipping, conflicting Brand Kit readiness, zero-result research loop and unstable ETA slowed the journey. |
| Delivery readiness | Review-ready locally | Five final MP4s pass decode, dimensions, duration and audio QA. Platform storyboard approval and Studio import/render remain pending the authenticated preview workflow. |

Recommendation: use the five local product-photo masters for creative review now. Treat the platform's existing storyboards as drafts until the edited scripts are re-saved on the fixed preview and their frames are regenerated or corrected. Do not use the current storyboard batch for paid rendering.

## Actionable product findings

1. **P0 — Claims and source-of-truth:** Fact-check generated angles, script structures and storyboard frames against the approved product facts before scoring or render. The highest-scored ideas must not contain fabricated reviews, features or medical outcomes.
2. **P0 — Edited script propagation:** The shipped fix clears generated hook, beat, CTA and scene fields when a user changes body text. Resave existing edited scripts under the new deployment, then regenerate their storyboards. Add a visual warning for older storyboards generated before an edit.
3. **P1 — Frame editing:** The new frame editor lets users edit scene, VO, caption, visual direction and prompts directly, clears approval after content changes, and invalidates an old image when its prompt changes. “Fix” and “Note” alone did not repair the frame. This UI fix is deployed; a signed-in browser pass is still required.
4. **P1 — Research recovery:** If ad libraries return no verifiable ads, show a precise source/result status and allow creative work without an endless “collect at least 10” loop. Distinguish “research completed with zero results” from “not run”.
5. **P1 — Product-reference rendering:** Offer a packshot-preserving animatic mode. The current free animatic sends non-CTA frames to a text-to-image service, which can alter jewelry geometry; use the approved official photos for product shots and reserve generation for backgrounds/models.
6. **P1 — Brand Kit readiness:** Do not block production on unknown cm dimensions when the seller only supplies gauge and post length. Mark unknown data as unknown, and separate optional completeness from a render gate.
7. **P2 — Timing and navigation:** The project asked for 10–15 seconds but the Research video mode defaulted to 30 seconds. On the observed 577-pixel viewport, the Next Step button and horizontal stepper clipped. Progress ETA was unstable.
8. **P2 — Source hygiene:** Deduplicate scraped product features before inserting them into Product Intelligence and AI prompts. Resolve inconsistent image counts and category status.

## Release and scope

Draft PR: https://github.com/CitizenZM/creativeintel-20260712/pull/160 . The stable branch preview is `https://creativeintel-git-codex-audit-0ff517-barrons-projects-b6dc5d36.vercel.app`, currently pointing to deployment `https://creativeintel-839ebu0w2-barrons-projects-b6dc5d36.vercel.app` at commit `a01f7cd`. The previous immutable preview was `https://creativeintel-g3hg3mmfu-barrons-projects-b6dc5d36.vercel.app`. Local TypeScript, targeted lint and whitespace checks passed on the new frame editor; CI is being checked separately. This work did not merge the PR, promote to production, delete project data or submit paid provider generation.

The stable preview host needs a separate Clerk sign-in in the in-app browser before the five edited scripts can be resaved and their contaminated storyboards replaced. The user has been shown that login page. Once signed in, the next workflow is: resave five scripts → regenerate or repair five storyboards → approve truthful frames → Studio compile and render. The five locally made videos remain immediately reviewable regardless of that login.
