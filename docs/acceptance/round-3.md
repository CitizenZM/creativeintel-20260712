# Acceptance round 3 — re-verification after the improvement loop

Date: 2026-09-11 · Projects `cmtwm1y6x003tt52gblztpz8m` (InvisiCrepe) and `cmtwngv2q009wt52gmg2sbiea` (City Lips) on the local DB.

| Check | Result |
|---|---|
| `pnpm build` (production) | passes — all routes emitted |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm exec eslint .` | **0 errors** (32 warnings) — the two pre-existing `set-state-in-effect` errors are gone |
| Gemini reliability | deep-analysis stage completes (was truncated at the 8192 cap); script generation 3/3 with the jsonrepair fallback; a 4th and 5th trial clean with no compliance warnings |
| Claims/statistics guard | STAT_SHOCK now yields a qualitative hook ("Most women over forty notice lip lines first.") with `hookFormula` noting no sourced stat; a competitor "$178 / $59.95" offer copied from teardowns was caught; structural numbers no longer false-positive |
| Research sources | Meta Ad Library 22–27 ads per project; Google Ads Transparency 43 creatives (after the click-to-select fix); TikTok Creative Center/organic; TikTok Ad Library 0 (egress region) |
| Insights | teardowns with real frames for Meta/Google ads, competitor rollups and gap insights for both projects |
| Dashboard walk-through (Overview / Research / Insights / Competitor / Creative / Studio / Deliver) | renders; Deliver shows **2 ready videos**, both `<video>` elements load (readyState 4, 10.0 s) |
| Studio | radio storyboard picker + URL preselect; compile 26 credits; approve; worker dry-run rehearsal reported honestly |
| Deliverables | `~/Projects/libtv-ad-studio/brands/citybeauty/deliverables/` — v1 Before/After, v2 Problem→Agitate→Solve (1080×1920, 10 s, h264) + previews + contact sheets |

## Verdict

**PASS.** Two different finished ad versions were produced through the dashboard for the simulated client citybeauty.com, and every module was re-tested after its fixes across three rounds. Remaining items need resources outside the codebase: LibTV credits (balance 9) for further renders, a US egress for TikTok Ad Library, a valid OpenAI key or OpenRouter balance if Gemini is not the intended production provider, and object storage credentials for hosted masters.
