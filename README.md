<div align="center">

# CreativeIntel

**Competitor-ad intelligence → campaign plan → script → storyboard → AI video & image ads**
for direct-to-consumer brands and the teams that market them.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e?logo=supabase&logoColor=white)
![Auth](https://img.shields.io/badge/Auth-Clerk-6c47ff?logo=clerk&logoColor=white)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)

**English** · [简体中文](README.zh-CN.md) · Live app: <https://creative.xark.io> (sign-in required)

</div>

---

## Contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Tech stack](#tech-stack)
4. [Repository layout](#repository-layout)
5. [Quick start](#quick-start)
6. [Configuration](#configuration)
7. [Accounts, access and sharing](#accounts-access-and-sharing)
8. [Cost control](#cost-control)
9. [AI providers and models](#ai-providers-and-models)
10. [Data layer and concurrency](#data-layer-and-concurrency)
11. [Background jobs and local workers](#background-jobs-and-local-workers)
12. [Security](#security)
13. [Testing and quality gates](#testing-and-quality-gates)
14. [Deployment](#deployment)
15. [Contributing conventions](#contributing-conventions)
16. [Documentation index](#documentation-index)
17. [License](#license)

---

## What it does

CreativeIntel turns "what are my competitors running?" into finished, platform-ready ads. Each project walks
through a pipeline; every stage is reachable in the UI **and** over HTTP so an agent can drive it headlessly
(see [`docs/agent-api.md`](docs/agent-api.md)).

| Stage | What happens | Route |
|---|---|---|
| **Setup** | Brand kit (logo, packshots, SKU dimensions, colours, CTA pool, offer, landing URL, allowed / forbidden claims) and product-page intake (Shopify / Amazon / generic adapters). | `/projects/[id]/overview` |
| **Research** | Ad-candidate adapters (Meta Ad Library, TikTok Creative Center, YouTube Shorts, Google Ads Transparency, Instagram Reels), UGC filtering, ranking, Top-N per competitor. | `/projects/[id]/content` |
| **Insights** | Per-ad multimodal teardown (hook, beats, proof, CTA, offer), per-competitor rollups, cross-competitor gaps, audience profile. | `/projects/[id]/insights` |
| **Planning** | Structured product brief, platform profiles, hook library, end-card gallery and a campaign plan with per-platform hook variants. | `/projects/[id]/planning` |
| **Creative** | Script archetypes × video types → structured scripts → 2-second storyboards tagged HOOK / BODY / CTA, with keyframe images. | `/projects/[id]/creative` |
| **Studio** | Compile a storyboard into a render run: cost estimate → owner approval → keyframes and clips (OpenRouter, Matrix, GLM, ComfyUI, or the local LibTV worker) → ffmpeg assembly with captions, voice-over, music and end card → QC and drift checks. | `/projects/[id]/studio` |
| **Deliver** | Masters, format exports (4:5, 1:1, 16:9, 15 s / 10 s cut-downs), covers, export packs and a client campaign report (HTML / DOCX). | `/projects/[id]/deliver` |
| **History** | Every brief, plan, storyboard, script, keyframe, clip, master, export and report is archived as a versioned, downloadable artifact stored in the database. | `/projects/[id]/history` |

Also included: **Autopilot** (a state machine that runs scrape → plan → render → report under an owner-approved
budget), **image ads** and **catalog ads** from a product feed, a **performance agent** that answers questions
from imported ad results, a cross-platform **media plan**, a **weekly digest**, and an **ops health** dashboard.

Stage completion is computed server-side (`src/services/project-stages.ts`) and drives the sidebar rail and the
"Next" button.

## Architecture

```mermaid
flowchart LR
  U[Browser] --> CF[Cloudflare DNS / TLS]
  CF --> P

  subgraph V["Vercel · Fluid Compute · pdx1"]
    P["proxy.ts<br/>Clerk session + tenancy gate"] --> R["Route handlers<br/>withAccess(): 2nd auth layer + spend scope"]
    R --> S["Services<br/>creative · research · video-gen · ops · reports"]
  end

  S --> DB[("PostgreSQL<br/>Supabase pooler · us-west-2")]
  S --> BL[("Vercel Blob<br/>media files")]
  S --> AI["AI providers<br/>OpenRouter · Google · OpenAI · fal · Zhipu · Matrix"]
  CR["Vercel Cron ×5"] --> R
  W["Local workers<br/>research · LibTV · browser"] -- "HTTPS + x-worker-token" --> R
  CL[Clerk] <--> P
```

Key ideas:

- **Two auth layers.** `src/proxy.ts` decides access for every request; every user-facing API route is
  additionally wrapped in `withAccess()` (`src/lib/auth/route-guard.ts`) which repeats the decision inside the
  handler. A test fails if a route is added without it.
- **Spend scope.** `withAccess()` opens an `AsyncLocalStorage` scope naming the project and the acting user, so
  any paid model call deep in shared code is reserved in the spend ledger against the right budget.
- **No DB credentials on laptops.** Local workers only talk to the deployed app over HTTPS.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, `proxy.ts`), React 19, TypeScript (strict) |
| UI | Tailwind CSS 4, shadcn/ui (Base UI), lucide-react, Recharts |
| Data | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`, explicit `pg.Pool`), Supabase pooler (transaction mode) |
| Auth | Clerk (email + password + email code), invitations, per-account workspaces |
| Storage | Vercel Blob; small files (≤ 2 MB) are also kept in the database for history downloads |
| AI | OpenRouter (DeepSeek text, Seedream images, Veo / Kling / Wan video), Google Gemini / Veo, OpenAI, fal.ai, Zhipu GLM, Matrix, ComfyUI |
| Media | ffmpeg (`ffmpeg-static`), sharp 0.35, msedge-tts |
| Quality | Vitest, ESLint, `tsc --noEmit`, GitHub Actions smoke workflow, Vercel preview builds |
| Hosting | Vercel (functions pinned to `pdx1` next to the database), Cloudflare DNS |

## Repository layout

```text
src/
  app/                  Next.js routes: pages and /api (projects, settings, worker, cron, health…)
  components/           UI by area: dashboard, creative, studio, research, planning, settings, legal…
  lib/                  Pure helpers: auth gate & access rules, validations, optimistic-json, security
  services/
    ai/                 Model clients, routing, usage logging, analysis pipeline
    research/           Ad-library adapters, relevance, signals, hook trends
    creative/           Brief, campaign planner, scripts, storyboards, plan-to-storyboard, cloner
    video-gen/          Render engines, executors, edit/assembly (ffmpeg), QC, drift, exports, variants
    ops/                Spend ledger & guard, cost model, allowance, health, heartbeat
    autopilot/          State machine + operator actions
    reports/            Campaign report (HTML / DOCX), weekly digest
    artifacts/          History archive (ProjectArtifact + ArtifactBlob)
    …                   brand-kit, image-ads, catalog, performance, strategy, settings, storage
  proxy.ts              The access gate in front of every route
prisma/schema.prisma    Data model (additive changes only)
workers/                Local operator workers (research, LibTV, browser)
scripts/                Smoke test, backfills, preview tools
docs/                   Runbooks, agent API, audits, acceptance rounds
```

## Quick start

Requirements: Node 20.9+ (developed on Node 24), pnpm, PostgreSQL 16.

```bash
pnpm install
docker compose up -d postgres            # or: createdb creativeintel_dev
cp .env.example .env.local               # fill in keys; DATABASE_URL → your local database
                                         # (compose default: postgresql://postgres:postgres@localhost:5432/brand_intelligence)
pnpm exec prisma db push && pnpm exec prisma generate
pnpm dev                                 # http://localhost:3000
```

With no Clerk keys set the app runs **ungated** (auth mode `none`) — fine for local work, never for a shared host.
`MOCK_AI` / `MOCK_CRAWL` exist for tests and partial offline work; real analysis and generation need provider keys.

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm start` | Dev server / production server |
| `pnpm test` | Vitest (unit and route tests) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | `prisma generate && prisma db push && next build` (the production build) |
| `pnpm build:check` | `prisma generate && next build` — build without touching the database |
| `pnpm smoke` | End-to-end smoke test against a running instance (`scripts/smoke.ts`) |
| `pnpm worker:libtv` | Local LibTV render worker (`--dry-run` prints commands only) |

Safety rules: keep `.env.local` pointed at a **local** database; never `source` a pulled production env file in a
shell; schema changes must be additive because production builds run `prisma db push` **without**
`--accept-data-loss`.

## Configuration

Values live in `.env.local` (local) and Vercel project settings (deployed). `.env.example` lists every variable;
**no secret is ever committed.**

| Area | Variables |
|---|---|
| Database | `DATABASE_URL` (or `APP_DATABASE_URL` + `APP_DATABASE_DIRECT_URL` for pooled app / direct CLI), `DB_POOL_MAX` (default 5), `DB_POOL_ACQUIRE_TIMEOUT_MS` (5000), `DB_POOL_IDLE_TIMEOUT_MS` (5000) |
| Auth | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `OWNER_EMAILS` (comma-separated admins), `AUTH_CANONICAL_HOST`, `AUTH_PROVIDER` |
| Models | `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY` / `GEMINI_API_KEY`, `FAL_KEY`, `ZHIPU_API_KEY`, `MATRIX_API_KEY`, `GROQ_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AI_COST_MODE` |
| Research | `YOUTUBE_API_KEY`, `META_ACCESS_TOKEN`, `TOP_N_PER_COMPETITOR`, `TOP_N_DEEP` |
| Storage | `BLOB_READ_WRITE_TOKEN` (or `CLOUDINARY_*`) |
| Spend | `MEMBER_MONTHLY_ALLOWANCE_USD` (default 1), `SPEND_GUARD` (`off` = emergency bypass), `CI_PRICE_OVERRIDES`, `LIBTV_MAX_RUN_CREDITS` |
| Workers & cron | `WORKER_TOKEN`, `BROWSER_WORKER_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `CRON_SECRET`, `LIBTV_BIN` |
| Reports | `REPORT_DELIVERY_SEND` (digests are dry-run unless `on`) |
| Legal | `LEGAL_CONTACT_EMAIL` (shown on `/terms` and `/privacy`) |
| Misc | `NEXT_PUBLIC_APP_NAME`, `LOCAL_FILES_ROOT` (enables `/api/local-files` outside dev), `MOCK_AI`, `MOCK_CRAWL` |

## Accounts, access and sharing

Authentication is **Clerk** (`src/lib/auth/mode.ts` picks the gate per deployment): `clerk` when its keys are set,
`cf-access` for the legacy Cloudflare Access setup, `none` for local development. Misconfiguration locks routes
(503) instead of serving them ungated.

- **Open sign-up with isolation.** Anyone can register (email + password + email code, with a consent checkbox for
  the [Terms](src/app/terms/page.tsx) and [Privacy Policy](src/app/privacy/page.tsx)). Each new account gets its
  **own empty workspace** and sees nothing else.
- **Roles.** `OWNER_EMAILS` (verified addresses) become **admins** who see every workspace plus *AI engines*,
  *System status* and *Users*. Everyone else is a **member**. Admins can block / unblock accounts and promote or
  demote admins at `/settings/users`.
- **Project sharing.** An admin invites a coworker by email and ticks which projects to share, at one of three
  levels: **view** (read and play media) → **download** (+ exports, archives, report files) → **edit** (+ changes
  and generation, billed to the coworker's own allowance). Deleting a project, setting its budget, approving
  LibTV runs and managing sharing stay owner-only. See `src/lib/auth/gate.ts` (`projectAction`).
- **Isolation of shared memory.** The structure library, trend data and research ETAs are scoped per account
  (`src/services/tenancy.ts`).
- **Blocked accounts** are sent to `/blocked` (pages) or receive `403` (API).

## Cost control

Paid generation is metered; nothing paid runs without budget to cover it.

- **Spend ledger** (`src/services/ops/`): every paid call *reserves* its estimate (under a Postgres advisory lock),
  runs, then *reconciles* to the cost the provider reported. Refusals happen before the provider is called.
- **Budgets.** Per run (`approvedBudgetUsd`, set when an owner approves a render) and per project (`budgetUsd`).
  No budget set means no cap, but spend is still recorded.
- **Member allowance.** Each member account has a monthly allowance (default **$1**, adjustable per user) across all
  its projects. Admins are uncapped. When a coworker works on a shared project, the **coworker's** allowance pays.
- **All model calls are covered.** Every text and vision call goes through `analyzeWithClaude`, which reserves
  inside the request's spend scope; a refusal answers HTTP **402** `{ "code": "BUDGET_EXCEEDED" }`.
- **Strict free mode** limits models to free tiers; paid fallback is **off** by default.
- **Autopilot** requires an owner-approved budget at least as large as its high forecast and never raises it.

## AI providers and models

| Capability | Providers (selected in *Settings → AI engines*, with automatic fallback order) |
|---|---|
| Text / vision | OpenAI (GPT-4o family), Google Gemini, Anthropic, OpenRouter (DeepSeek, GPT-4o), Zhipu GLM (free tier) |
| Images | OpenRouter (Seedream 5 Flash, Qwen Image), Matrix, fal.ai (FLUX), OpenAI `gpt-image-1`, Zhipu CogView, Pollinations, ComfyUI |
| Video | OpenRouter (Veo 3.1 Lite, Kling, Wan, Seedance), Matrix, fal.ai, Google Veo, Zhipu CogVideoX, ComfyUI (Wan), LibTV |
| Audio | Groq / OpenAI Whisper (transcription), Edge TTS (voice-over) |

Unit prices live in `src/services/ops/cost-model.ts` (overridable with `CI_PRICE_OVERRIDES`). Request timeouts,
retries and concurrency limits are defined next to each client in `src/services/ai/` and `src/services/video-gen/`.

## Data layer and concurrency

- **One pooled client per instance** (`src/lib/db.ts`): `pg.Pool` with `max` 5, a 5 s acquire timeout and idle
  release, closed before an instance is suspended (`attachDatabasePool`).
- **Functions run in `pdx1`** (`vercel.json`), in the same region as the database — keep them together.
- **No lost updates.** JSON documents (storyboard frames, field status, brand kit, image-ad sets, research steps)
  are updated with an optimistic `updatedAt` retry loop (`src/lib/optimistic-json.ts`), so parallel writers merge
  instead of overwriting each other.
- **Auth lookups are cached** briefly in memory and fall back to the last confirmed answer if the database blips.

## Background jobs and local workers

**Vercel Cron** (`vercel.json`) — all require `CRON_SECRET`:

| Job | Schedule | Purpose |
|---|---|---|
| `poll-video-jobs` | every 5 min | Advance render runs and video jobs |
| `hook-variants` | every 5 min | Render queued hook A/B variants and director reviews |
| `autopilot` | every 5 min | Advance approved autopilot runs |
| `ops-health` | every 10 min | Health scan and safe auto-recovery |
| `report-digest` | Mondays 14:00 UTC | Weekly campaign digest (dry-run unless enabled) |

**Local workers** (operator machine; HTTPS to the deployed app only, `x-worker-token`):

| Worker | Purpose |
|---|---|
| `workers/research-worker` | Browser-only ad-library fetches queued as `WorkerTask` |
| `workers/libtv-worker` | Executes approved LibTV runs (upload → image nodes → video nodes → download → local assembly) |
| `workers/browser-worker` | Browser generation jobs |

## Security

- Session gate in `src/proxy.ts` **and** an in-handler check on every user route; admin-only areas are listed in
  `src/lib/auth/gate.ts`. Machine routes (`/api/worker`, `/api/cron`, `/api/local-files`) validate their own tokens.
- Headers on every response: CSP (`frame-ancestors 'none'`, `base-uri`, `object-src`), `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS (`next.config.ts`).
- Provider API keys can be stored encrypted in the database (`src/lib/settings-crypto.ts`); nothing sensitive is committed.
- The `*.vercel.app` aliases redirect to the canonical host; preview deployments sit behind Vercel SSO.

Found a vulnerability? Please open a **private security advisory** on this repository rather than a public issue.

## Testing and quality gates

```bash
pnpm typecheck && pnpm lint && pnpm test
```

- Route and service tests use in-memory fakes — **a unit test must never reach a real database or provider**.
- `src/lib/auth/route-guard.test.ts` fails if any user-facing API route is not wrapped in `withAccess()`.
- On a busy machine the 5 s default timeout can flake; use `pnpm test -- --testTimeout=60000`.
- Every pull request gets a Vercel preview build (which also applies the additive schema change). After each
  production deploy, the `smoke` workflow (`.github/workflows/smoke.yml`) runs the free, read-only checks in
  `scripts/smoke.ts`.

## Deployment

1. **Vercel** project with the environment variables above; `pnpm build` runs `prisma db push` (additive only).
2. **Clerk** production instance on the app's domain: add the DNS records Clerk lists (frontend API, accounts and
   mail records) as *DNS only* in Cloudflare; email + password sign-up, email-code verification, legal-consent
   checkbox pointing at `/terms` and `/privacy`.
3. **Crons and region** come from `vercel.json`; set `CRON_SECRET`.
4. Optional: run the local workers on the operator machine with `WORKER_TOKEN`.

## Contributing conventions

- Branch → pull request → squash merge into `main`; commit style `type: description` (`feat`, `fix`, `perf`, `test`…).
- **New API route?** Export handlers as `export const GET = withAccess(unguardedGET)`.
- **New paid model call?** Route it through the spend guard (`analyzeWithClaude`, `guardJobCall`, `withSpendGuard`).
- **Schema change?** Additive and defaulted only.
- **Multi-writer JSON field?** Use `patchRow` / `patchJsonField` instead of read-then-write.
- Keep tests free of network and database access.

## Documentation index

| Doc | Content |
|---|---|
| [`docs/agent-api.md`](docs/agent-api.md) | Drive every stage over HTTP; operator actions |
| [`docs/studio-libtv.md`](docs/studio-libtv.md) | LibTV render runbook |
| [`docs/comfyui-node.md`](docs/comfyui-node.md) | Self-hosted ComfyUI engine |
| [`docs/audit/`](docs/audit) | Multi-model architecture audit and rebuild plan |
| [`docs/acceptance/`](docs/acceptance) | Acceptance rounds and findings |
| `workers/*/README.md` | Per-worker setup |

## License

Proprietary — © Cell Digital Technology Inc. All rights reserved. This repository is publicly visible but no
license to use, copy, modify or distribute the code is granted.
