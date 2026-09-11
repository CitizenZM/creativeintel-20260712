# Acceptance round 1 — City Beauty · InvisiCrepe Body Balm

Date: 2026-09-11 · Project `cmtwm1y6x003tt52gblztpz8m` (local DB) · Operator: Fable (orchestration), Opus/Sonnet (fixes), browser simulation via the Claude Browser pane on http://localhost:3100.

## Walk-through

| Step | How | Result |
|---|---|---|
| New project | `/projects/new` form filled in the browser (brand, brand URL, InvisiCrepe product URL, category, goal, briefing, 5 competitors) | Shopify adapter scraped the PDP; redirected to `/research`; research auto-started |
| Research | runner: crawl → brand understanding → ad discovery (YouTube scrape 53, TikTok organic 4, IG 0, TikTok CC 0) → rank & save → AI analysis (Gemini) | 4 assets saved; 2 Olay `#olaypartner` TikToks (93 M / 48 K views, 9:16) ranked as paid; **0 WorkerTask rows** (bug → fixed by agent) |
| Brand kit | logo + 2 packshots + lifestyle via API multipart; fields via PUT | 100 % complete; 2 input errors on my side surfaced real defects (MIME sniffing → fixed) |
| Insights | `POST /insights/continue` ×2 | 4 teardowns (vision, no transcript), Olay rollup, 5 gap insights, 5 selling points |
| Creative | template picker in the browser: BEFORE_AFTER + PROBLEM_AGITATE_SOLVE, "Write 2 scripts" | 2 structured 10 s scripts with brand-kit CTA "Shop Now" + offer |
| Storyboards | "Select all" → "Generate storyboards (2)" | 2 boards × 5 frames on the 2 s grid (HOOK / BODY×3 / CTA) |
| Studio | "Compile run" (economy, Seedream 4.0 + Hailuo 768P) → "Approve 26 credits" | run `cmtwmdwwm0068t52gv87y4r4d`: LOGO, PROD-1/2, K1, V1, K4, V4, K5(local) = 26 credits |
| Render | `node workers/libtv-worker/worker.mjs --once` | attempt 1 failed at `project create` (pretty-printed JSON not parsed — fixed, no credits spent); attempt 2 in progress |

## Defects found and fixed in this round

1. Brand-asset upload trusted the client MIME (`logo.webp` that was really PNG → 415) → magic-byte sniffing.
2. Browser ad-library adapters never enqueued `WorkerTask`s → research worker idle (fix in progress).
3. LibTV worker parsed CLI output line-by-line; the CLI pretty-prints → canvas uuid unreadable → block scanner.
4. LibTV price probe via CLI is **not** free (72 credits charged) → skill docs corrected; balance 61 → budget re-planned to 26 credits per ad.
5. Production LLM keys dead → Gemini provider added; `AI_PROVIDER=gemini`.

## Open findings (queued for the improvement loop)

- Script prompt must hard-enforce `claimsForbidden` / absolute words ("erased").
- Research status `steps[]` leaves early steps as pending/running after completion.
- Studio storyboard selector is not a button (default selection used); make it keyboard/agent-selectable.
- YouTube scrape returned 53 candidates but only 1 survived the gates — with no `YOUTUBE_API_KEY` durations are unknown and most get filtered; key needed for Shorts.
- Teardowns are frames-only (no transcripts: no Groq/OpenAI Whisper key).

## Round-1 result (2026-09-11 00:31 local)

| Version | Template | Run | Credits | Output |
|---|---|---|---|---|
| v1 | BEFORE_AFTER "7-Day Transformation" | `cmtwmj8pz006jt52gf55bspa1` | 2 (K) + 24 (V) | `runs/…/final/master.mp4` 1080×1920 · 10.00 s · h264 |
| v2 | PROBLEM_AGITATE_SOLVE | `cmtwmtfng0071t52gztg3tdjx` | 26 | `runs/…/final/master.mp4` 1080×1920 · 10.00 s · h264 |

LibTV balance: 61 → ~9 credits. Both play in the dashboard (Deliver / Studio) via `/api/local-files`.

Additional defects found and fixed during the render loop: CLI pretty-JSON parsing; `--left "FF K1"` was never a node name; brand-truth URLs (1 MB data URLs) blew argv (E2BIG); worker assembled with zero clips and reported success; runs could not resume; canvas node-name collisions across runs; keyframe prompts carried offer/URL/CTA copy → text baked into the image (v1 hook frame); Meta Ad Library rendered in Chinese for this egress → 0 results (now 27 ads).

Quality verdict: v2 is clean end-to-end; v1's hook clip carries the baked-in text block (mitigated by a bottom crop in re-assembly) and both need the caption/CTA typography pass (in progress, local re-cut, no credits).
