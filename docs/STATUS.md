# Status - creativeintel-20260712 (updated 2026-11-18)

## Purpose
AI-driven creative operations: research competitor ads → extract insights → generate campaign briefs → write scripts → render storyboards → produce platform-ready video and image ads with automated cost control and multi-LLM routing.

## Current state
- **2026-11-18:** Video Brain — supervisor loop over Xark Studio + Ad Studio. Mac daemon `workers/video-brain` (launchd `co.celldigital.video-brain`, every 5 min): observe → think (per-project step/stage/next checkpoint/legal wait) → auto-approve within $3/run $20/day → retry transient failures → second check of finished videos (ffprobe/LUFS/URL/cost) → incidents → probes → fix-pattern scan → learnings synced to the video skills + Ad Studio script prompt → publish. Admin page `/brain`. Storage: AppSetting `brain:*` (no schema change). Design: ad-studio-20261104/docs/VIDEO-BRAIN-ARCHITECTURE-20261117.md.
- **2026-10-12:** Full bilingual README (EN + 简体中文), architecture diagram, stack, config, accounts/sharing, cost control, ops, security.
- **2026-10-12:** Conflict-safe writes for storyboard frames, field status, brand kit, image-ad sets, research steps (lost-update fix).
- **2026-10-12:** Spend guard on every text/vision model call; paid fallback off by default; cost estimation for image engines.
- **2026-10-10:** Security headers (CSP, X-Frame-Options, Referrer-Policy, COOP, HSTS, nosniff); Vercel pdx1 for latency.
- **2026-10-09:** Project sharing (view/download/edit roles), admin user invitations via Clerk.
- **2026-10-08:** Monthly per-member AI allowance; open sign-up with per-account isolation; content history archive (versioned ProjectArtact).
- **2026-10-07:** Veo 3.1 Lite pricing calibration (4.95¢/s), drift sampling, autopilot copy polish (durationSec, CTA alignment, talking-head clips).

## Next steps
- (inferred) Unified memory system for multi-agent coordination (branch name: `chore/unified-agent-memory`).
- (inferred) Improve agent API ergonomics or add new adapter sources (TikTok, Google Ads Transparency, YouTube Shorts).
- (inferred) Expand storyboard-to-video rendering quality checks and multi-ratio export packs (15 s / 10 s cuts).
- (inferred) Continue ops health dashboard and performance-agent learning loop (weekly digest, budget tracking).
- (inferred) Scale autopilot state machine: per-platform variants, A/B testing framework, results import and analysis.
