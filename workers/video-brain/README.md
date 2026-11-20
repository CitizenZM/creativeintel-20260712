# Video Brain (Mac daemon)

Supervisor loop above Xark Studio (creative.xark.io) and Ad Studio. Design: `~/Projects/ad-studio-20261104/docs/VIDEO-BRAIN-ARCHITECTURE-20261117.md`.
Dashboard: **creative.xark.io/brain** (admin only). Every 5 minutes (launchd `co.celldigital.video-brain`):

| Step | What it does | Code |
|---|---|---|
| Observe | one read-only DB gather over `POST /api/worker/brain {action:"observe"}` (projects + stage checks, Ad Studio runs, spend, performance, heartbeats, ops health, learnings, policy) | `src/services/brain/observe.ts` |
| Local jobs | Ad Studio's own jobs (`ad-studio-20261104/data/jobs`) join as projects/runs: own jobs at the gate are approved via the local API (same caps), Xark-managed `xk-*` jobs are left to Xark Studio, finished `final.mp4` files get the second check | `lib/local.mjs` |
| Think | per project: step (setup→…→studio→produce→deliver→measure), loop stage (strategy/project/gate/execute/verify/recover/learn), owner agent, next action, next checkpoint + how it is verified, legal wait (client / ad-data / budget) or **idle-defect** | `lib/think.mjs` |
| Strategist | once a day per project that is stalled without a legal wait (idle-defect) or has performance data (measure): `claude -p` (Sonnet, subscription, no tools, JSON schema) → hypothesis, next action, how to verify, checkpoint; ≤ 8 calls/day; `VIDEO_BRAIN_STRATEGIST=0` turns it off | `lib/strategist.mjs` |
| Gate | auto-approves runs waiting at the spend gate when the reservation (estimate × 1.3) ≤ $3 and today's brain approvals ≤ $20 and the estimate is < 24 h old; the server re-checks (`src/services/brain/policy.ts`) and logs `OpsEvent brain-auto-approve`; others wait on Barron (`waitingOn: budget`) | `lib/policy.mjs` |
| Push | a server project whose storyboard is ready (Studio step) with no Ad Studio run ever gets ONE variant started by the brain (keep hook, Seedance 2.0 Fast, ≤ 1 per tick, 24 h cooldown per project): `POST /api/worker/brain {action:"batch"}`; nothing is spent until the gate | `lib/think.mjs` batchCandidates, `src/services/brain/batch.ts` |
| Recover | retries transient failures once a day per run (max 2 brain retries; Ad Studio resumes from the failed step) | `lib/incidents.mjs` classify |
| Verify (二次复查) | re-reads each finished video: HTTP 200 mp4, ffprobe duration 5–24.5 s, 9:16, h264, audio, −14 LUFS ±1.5, cost ≤ reservation, runtime = worker metrics | `lib/verify.mjs` |
| Critic (second family) | ≤ 10/day: a 3x2 frame sheet of each probed finished video scored by `google/gemini-3.8-flash` via OpenRouter (first frame, product clarity, consistency, garbled text, sells + issues; ≈ $0.003); added as a check field; `VIDEO_BRAIN_CRITIC=0` off | `lib/critic.mjs` |
| Batch productions | `acw-bf-videos/all-videos-by-product/INDEX.csv` rows join as finished runs (second check + critic) | `lib/batch.mjs` |
| Incidents | failures grouped by normalised cause signature; runbook per kind; resolved after 72 h quiet, reopened on return | `lib/incidents.mjs` |
| Probes (30 min) | OpenRouter balance (< $5 = fail: video calls 402), ffmpeg/ffprobe, faster-whisper, edge-tts, Ad Studio worker launchd + heartbeat, ego lite, OpenRouter `/videos/models` vs every routed model, disk, Ad Studio web | `lib/probes.mjs` |
| Fix patterns (6 h) | searches Ad Studio, acw videos, motion repos, video-shotcraft and the video skills for patterns already fixed once (retired model routes, whisper initial_prompt, −16 LUFS masters, music fade-in at 0 s, `tee | head`) | `lib/patterns.mjs` |
| Learn | seed (production rules) + harvested (recurring incidents, repeated check failures) + server edits → `LEARNINGS.md` marker block in each video skill (+ pointer in SKILL.md), `ad-studio/docs/LEARNINGS.md`, `ad-studio/data/brain-learnings.json` (confirmed rules go into the script prompt) | `lib/learn.mjs` |
| Digest | once a day after 07:30 PT: Feishu DM to Barron's open_id only (Affiliate OS notifier: blocklist guard + read-back second check): what waits on him, failing probes, stalled projects the brain is pushing, actions of the last 24 h; `VIDEO_BRAIN_DIGEST=0` off | `lib/digest.mjs` |
| Live board | `GET /api/brain` overlays the active AdStudioRun rows on every request, so /brain shows run state within one 10 s poll (snapshot itself is ≤ 5 min old) | `src/services/brain/live.ts` |
| Rules PR | hourly: confirmed script-side learnings vs Ad Studio `origin/main:pipeline/brain-rules.json` (the only rules the script prompt reads); a difference → throw-away worktree, rule tests, one PR per content hash on CitizenZM/ad-studio-20261104; Barron merges (live) or closes (veto); listed in the digest; `VIDEO_BRAIN_RULES_PR=0` off | `lib/rules-pr.mjs` |
| Publish | `AppSetting brain:snapshot` (+ `brain:events`, `brain:learnings`), then re-read and compare (second check of its own write) | `src/services/brain/store.ts` |

```bash
zsh workers/video-brain/install.sh                 # install / reload launchd (uses ~/.config/adstudio-worker/prod.env)
set -a; . ~/.config/adstudio-worker/prod.env; set +a
node workers/video-brain/brain.mjs --once --dry-run # what it would do now, no writes
node workers/video-brain/brain.mjs --learn "Hands holding the pack: say which hand and label direction" --scope pipeline:prompts --evidence <runId>
node --test workers/video-brain/test/*.test.mjs
tail -f ~/Library/Logs/video-brain.log | grep __VIDEO_BRAIN__
```

Policy lives in `AppSetting brain:policy` (`{autoApprove, maxRunUsd, maxDayUsd, maxRunAgeH}`); `autoApprove:false` turns the brain into advice only.
Storage uses AppSetting rows on purpose: new tables would be a production migration (`pnpm build` runs `prisma db push`), which needs Barron's OK.

## Workstreams, session jobs and directives (P1/P2, 2026-11-19)
- `workstreams.json` — every line of work is brand × purpose (`bdsmpub-social`, `allcomfywear-bf-promo`) with mode, compliance tier, $/video, platforms, tone and Barron's standing directives.
- `bin/xark-job.mjs` — videos made in Claude sessions/scripts register here so the Brain second-checks and learns from them:
  `xark-job start --workstream bdsmpub-social --dir <folder>` … `xark-job finish <jobId>`; `xark-job list`; `xark-job backfill` (done once for acw + bdsmpub).
  Jobs live in `~/.config/xark-studio/jobs/*.json`; each shows on `/brain` as `[workstream] name`.
- Directives: once a day the Brain harvests sentences Barron typed (transcript entries with `origin.kind = human`) that give a video instruction, as **candidates** in `~/.config/xark-studio/directives.json`. Only `xark-job directive confirm <id>` makes one a rule. Confirmed + config directives sync to `~/.claude/skills/_shared/VIDEO-KNOWLEDGE.md`, every video skill's `LEARNINGS.md`, and `ad-studio/data/brain-learnings.json` (`workstreams` key). Off switch: `VIDEO_BRAIN_HARVEST=0`.
- Neon tables (`Lesson/Directive/CraftItem/Outcome`) wait for PR #180; until then these files are the store.
