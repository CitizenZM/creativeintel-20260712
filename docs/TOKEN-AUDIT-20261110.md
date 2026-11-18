# Token & cost audit — Research → Creative → Ad Studio (2026-11-10)

Scope: where tokens and money are wasted from first research, through script writing, to the finished video made from a
benchmark (reference) ad; and whether the two ways of working both run in parallel and reach an output.
Evidence level is marked on every row: **M** = measured from real job logs, **C** = read from code, **?** = not measured here.

## 1. What was measured (Ad Studio worker, 37 real jobs, 293 `claude -p` calls)

| Number | Value | Meaning |
|---|---|---|
| Calls per job | median 8 (min 1, max 21) | script, hook doctor, brand scrub, frame QA, storyboard A/B, review, auto-fix |
| Cache write + read per job | ~102K tokens (write 1.74M, read 2.02M in total) | cache read share only 54%: a call in a fresh `claude -p` session re-writes the same prefix |
| Output per job | ~19.6K tokens | small next to the input side |
| Turns per call | average 3.67 | the structured-output step and every `Read` of an image are extra turns; each re-reads the whole context |
| Biggest call groups | review after render (66 calls), frame QA during generation (31), storyboard A/B after key frames (19), script writing after assets (26) | the rest is blueprint, hook doctor, brand scrub (small) |
| Real money in the lab DB | video $1.75 (Veo 3.1 Lite ×5), key frames $1.08 | tokens run on the Claude subscription; **generation, not tokens, is the money** |

The Xark side (Research, Insights, Planning, Creative) could not be measured: the lab DB's `AiUsage` table is empty (it is a
copy). Run the query in section 5 against production to fill the Research/Creative rows.

## 2. Waste found, ranked

| # | Where | Waste | Evidence | Fix | Status |
|---|---|---|---|---|---|
| 1 | Mac worker | **Runs were handled one at a time**: a 6-run batch, or a Mode 1 and a Mode 2 batch from two projects, queued behind each other | C: `main()` awaited `handle(run)` | `runLoop` with a pool of 3 (`ADSTUDIO_CONCURRENCY`); renders stay capped at 2 by Ad Studio | **Done**, unit-tested (peak = cap, failing run does not stop others) |
| 2 | `generate` engine | Two full scripts (`mk(0)`, `mk(1)`) + key frames for both + a storyboard A/B review for **every plan** | C: run.mjs; M: 19 A/B review calls, key frames $0.54 each set | A/B only the first time a reference meets a hook; the pick is remembered (`refcache/<ref>/ab_<hook>.json`) and a repeat run writes one script, one key-frame set, no review. `job.scripts = 2` forces A/B, `1` forces one | **Done** (worker a4c161f), wiring test |
| 3 | Image calls | Each image went through the `Read` tool = an extra turn that re-sends the whole prompt | M: 3.77 turns/call; same image, same question: Read path 4 turns / 7.5K tokens / 967 out vs inline 2 turns / 4.2K / 427 out | Images now go inline in one stream-json message to `claude -p` (no Read tool) | **Done** (worker a4c161f), live call checked, unit test |
| 4 | Small calls | Proposed merging the small mechanical calls into one | M: all Haiku calls = 52 of 293, ~6.1K tokens each vs 14.3K for Sonnet calls: about 8% of tokens | Not worth a merged prompt (quality risk for ~8%) | **No change** (measured) |
| 5 | Review + auto-fix | One auto-fix round = LLM + voice + render + review again | M: 22 past rounds, 13 gained nothing; no score threshold separates useful rounds (avg gain 0.2–0.6 at every lowest score) | Trigger unchanged; the round now stops before voice/render/review when the fix changes no shot, offer, CTA or on-screen text | **Done** (worker a4c161f), test |
| 6 | Reference analysis | Cached per reference (`data/refcache`) — **no waste when the same ad is reused** | C: refcache | — | OK |
| 7 | Mode 2 → Studio | Analysis is taken from the storyboard; blueprint is skipped ("not needed") — **no re-analysis** | M: log lines "analysis: taken from the Xark storyboard" | — | OK |
| 8 | Hook × engine batch | Engines of the same hook copy the leader's plan (`copy_plan`) instead of re-planning | C: claimNext, clone.mjs | — | OK |
| 9 | Xark Research / Creative | No prompt-cache markers in `services/ai` | C: provider order OpenAI → Gemini → Anthropic (OpenAI-compatible endpoint) → OpenRouter → GLM; OpenAI and Gemini cache prefixes automatically; markers do nothing through the compat endpoint | No change | **No change**; usage not measurable, see section 5 |
| 10 | Mode 1 | Thought the reference was analysed again | C: `analyze` makes no LLM call (ffmpeg cut detection); the one blueprint call is cached per reference | — | **No waste** (re-checked) |

## 3. The two ways of working

**Mode 1 — benchmark video straight to Studio.** Setup only (brand, product, logo, offer), then in Studio pick *Imitate* or
*Imitate + replace* and paste the reference link (or pick a Research find). Skips Research, Insights, Planning and Creative.
Costs: reference download + analysis (cached by URL), then the same plan → approval → generate path.

**Mode 2 — Research → Creative → Studio.** Full chain; the storyboard or script reaches Ad Studio as frames, with the
Research context, so Ad Studio does not analyse again.

**Parallel:** both modes create `AdStudioRun` rows in the same queue. `claimNext` is atomic (conditional `updateMany`), first
in first out across projects, so any number of workers or pool slots can take runs without double claims. With the new pool a
Mode 1 batch and a Mode 2 batch now advance together; only the final Remotion render is limited (2 at once, lock files), so
they never overload the Mac.
Verified: unit test with fake runs (peak concurrency = cap, all runs handled, an error is isolated).
**Not verified:** a live pair of paid runs (planning spends key-frame money). Both modes were each run live earlier in this
project; running them together live needs your OK for the spend.

## 4. Quality additions made in the same pass (not token savings)

- Reference-tempo music: the track whose tempo matches the reference's own soundtrack (`ref_tempo.py`, within 8%, x2 or /2 counts), cuts already snap to its half-beat grid.
- Enthusiastic delivery: hook question and call to action get a higher pitch, faster rate and stronger ElevenLabs style per line; profile tones no longer forbid excitement.
- Typed logo, product photo, link and coupon reach the closing card and the end-card previews.

## 5. Query to finish the audit on production

```sql
select capability, model, count(*) calls, sum("inputTokens") in_tok, sum("outputTokens") out_tok, round(sum(coalesce("costUsd",0))::numeric,2) usd
from "AiUsage" where "createdAt" > now() - interval '30 days' group by 1,2 order by usd desc;
```
Run 2026-11-10, read-only (`BEGIN READ ONLY`):
- The Neon database in the local env files: `public."AiUsage"` has **0 rows** (28 projects, newest 2026-09-25); `creativeintel_preview` has 48 rows from one project on 10-18 (DeepSeek v4 Pro text: 24 calls, 68K in / 50K out, ~2.8K in per call; images $0.03).
- Production uses `APP_DATABASE_URL`, a Sensitive Vercel variable: `vercel env pull` returns it empty, so production itself could not be queried from here.
- Read 2026-11-11 from production `/settings/ai` (signed in, "Usage this month", since 2026-11-01 UTC):

| Engine | Calls | Tokens in / out | Images | Cost |
|---|---|---|---|---|
| glm cogview-3-flash | 34 | 0 / 0 | 34 | free |
| fal flux/schnell | 14 | 0 / 0 | 14 | unknown (env key, no price) |
| openrouter deepseek-v4-pro / v4-flash | 6 | 17,020 / 15,706 | 0 | unknown |
| **Total** | 54 | 17,020 / 15,706 | 48 | est. $0.000 (20 paid calls unpriced) |

  Conclusion: Xark Research/Creative token use this month is tiny (~2.8K in per text call, 6 calls); the Ad Studio
  worker's ~102K tokens per job dwarfs it. Row 9 stays "no change". The only gap: 20 paid calls (fal + OpenRouter via env
  keys) have no price, so the page shows $0.000 — worth a price table if the spend estimate is relied on.
