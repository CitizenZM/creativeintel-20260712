# Failures from the MIXIK run and what fixed them

Chronological, because the order matters — each fix came from a specific piece of feedback.

| # | What went wrong | Root cause | Fix |
|---|---|---|---|
| 1 | Planned around a natural-language API with no parameter control | Read the agent-skill docs first, not the CLI | The `libtv` CLI exposes model/ratio/duration/mode explicitly — always check the CLI before assuming an API's limits |
| 2 | First storyboard had 6 shots in 15s | Guessed the pacing | Benchmarks run 13–19 cuts/15s; measure real ads before设计节奏 |
| 3 | Background blended with the product (pink bottle on pink) | Colour chosen for brand consistency, not contrast | Pick the背景 by complement: lilac→sky for a pink pack, peach for green, mint for red |
| 4 | AI bottles had garbled labels and wrong silhouettes | Models can't render small type | Composite the official cutout; see product-consistency.md |
| 5 | Vision person-segmentation couldn't isolate fingers from the bottle | Held objects are classified as "person" | Skin-hue mask inside the new silhouette |
| 6 | Ad read as a slideshow | Half the segments were stills with Ken Burns moves; each clip used only 1s | Only end cards are static; every other cut is a real clip with a complete action |
| 7 | The 360° orbit fell apart mid-way | Single 5s generation drifts | Two 180° halves with first/last frames, whip-blur on the seam; or use the usable head and tail of one orbit |
| 8 | Product 3–6× too large | Used the brand's own macro packshot as the scale reference | Ask for cm, convert to face-height ratio, put it in every prompt, audit with face detection |
| 9 | Dancers weren't dancing | Keyframes were static standing poses | Generate keyframes mid-movement and write two-beat motion phrases |
| 10 | Opening was dark and moody for 2–3s | Borrowed a K-pop MV silhouette opening | First frame bright, product pushed at the lens, high-key set |
| 11 | Slogan clipped at the frame edges | One long line at 96px on a 1080 frame | Two short lines, measure with `textbbox` before rendering |
| 12 | CTA text overlapped the bottle | Text and product both centred | Product low and small on CTA plates, words stacked above |
| 13 | 8.6MB masters failed to upload to the phone client | Delivery limit | Always also export a 720p CRF-28 preview (~2MB) |
| 14 | Music couldn't be re-cut per section | Mixkit licence forbids remixing | Choose a window that already contains a build→drop, or get a library that allows editing |
| 15 | Subagents couldn't write their report files | Environment blocks file writes from subagents | Have them return findings in the final message; the main session writes the files |
| 16 | CLI started failing mid-session with `用户未授权` | Token expiry | Re-login flow via ego-browser callback |

## Working habits that paid off
- **Probe prices without generating.** A node created but not run shows its credit estimate in the
  UI; comparing 12 model/spec combinations cost nothing and cut the video bill by 6×.
- **Verify claims with measurement, not eyeballs.** Scene detection for beat accuracy, face
  detection for product scale, `ffprobe` for duration — every claim in a status report is backed.
- **Delegate research to subagents, keep production in the main session.** Reference hunting,
  music sourcing and dance-style research ran in parallel while the main session generated and
  assembled.
- **Report credits every round** (spent / remaining) and flag when a request will exceed the cap.
- **Show, don't describe**: send a contact sheet, a before/after swap, a scale card, a 720p preview.
