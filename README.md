# CreativeIntel

Competitor-ad intelligence → script → storyboard → AI video production for DTC brands.
Next.js 16 (App Router) · Prisma 7 / PostgreSQL · OpenAI-backed analysis · LibTV for rendering.

## Pipeline

| Stage | What happens | Where |
|---|---|---|
| Setup | Brand kit (logo, packshots, SKU dimensions, colours, CTA pool, offer, landing URL, claims) + product URL adapters (Shopify / Amazon / generic) | `/projects/[id]/overview` |
| Research | Platform-driven ad-candidate adapters (Meta Ad Library, TikTok Creative Center / Ad Library, YouTube Shorts, Google Ads Transparency, Instagram Reels), UGC filtering, ranking, Top-N per competitor | `/projects/[id]/content` |
| Insights | Per-ad multimodal teardown (hook / beats / proof / CTA / offer), per-competitor rollup, cross-competitor gaps | `/projects/[id]/insights`, `/competitors/[id]` |
| Creative | 20 script archetypes × 3 video types → structured scripts → 2-second storyboards tagged HOOK / BODY / CTA | `/projects/[id]/creative` |
| Studio | Compile a storyboard into a LibTV run (credit estimate → approval → local worker renders keyframes + clips → local assembly) | `/projects/[id]/studio` |
| Deliver | Masters, previews, contact sheets, export zip | `/projects/[id]/deliver` |

Stage completion is computed server-side (`src/services/project-stages.ts`) and drives the sidebar rail and the "Next" button.

## Local development

```bash
pnpm install
createdb creativeintel_dev                      # brew postgresql@16
cp .env.example .env.local                      # fill keys; DATABASE_URL → local
pnpm exec prisma db push && pnpm exec prisma generate
pnpm dev
```

Rules that keep production safe:
- `.env` / `.env.local` point at the **local** database. Pulled Vercel env lives in `.env.production.local`; never `source` it in a shell (it exports `PGHOST`/`PGDATABASE`).
- Schema changes are additive; the production build runs `prisma db push` **without** `--accept-data-loss`.
- `pnpm typecheck` must pass before commit.

## Local workers (operator Mac)

Both workers speak HTTPS to the deployed app only (no DB credentials on the laptop), authenticate with `x-worker-token: $WORKER_TOKEN`, and — because the Vercel project has Deployment Protection enabled — must also send `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET`.

| Worker | Purpose | Run |
|---|---|---|
| `workers/research-worker` | Browser-only ad-library fetches (Meta / TikTok / Google) via ego-browser, queued as `WorkerTask` | `node workers/research-worker/worker.mjs` |
| `workers/libtv-worker` | Executes approved `LibtvRun`s with the `libtv` CLI (upload → image nodes → video nodes → download), assembles locally, uploads the master | `pnpm worker:libtv` (`--dry-run` prints commands only) |

See `docs/studio-libtv.md` for the LibTV runbook and `.claude/skills/design-video-ad-libtv/` for the production playbook the worker follows.

## Environment

See `.env.example`. Analysis needs `OPENAI_API_KEY`; research quality improves with `YOUTUBE_API_KEY` and `META_ACCESS_TOKEN`; brand assets and rendered masters need object storage (`CLOUDINARY_URL` or `BLOB_READ_WRITE_TOKEN`); workers need `WORKER_TOKEN`.

## Audit

The 2026-09 multi-model audit (Claude Opus / Sonnet + Codex) and the rebuild plan are in `docs/audit/`.
