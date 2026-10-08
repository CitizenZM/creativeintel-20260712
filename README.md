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

## Authentication (Clerk)

The proxy (`src/proxy.ts`) picks one gate per deployment (`src/lib/auth/mode.ts`):

| Mode | When | What it does |
| --- | --- | --- |
| `clerk` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` **and** `CLERK_SECRET_KEY` set | Every page and `/api` route needs a signed-in user. Pages redirect to `/sign-in?redirect_url=…`, API calls get `401 {"error":"Unauthorized"}`. Cloudflare Access is not checked. |
| `cf-access` | Clerk keys absent, `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` set | The previous Cloudflare Access JWT check. |
| `none` | nothing configured (local dev) | No gate. |

`AUTH_PROVIDER=clerk|cf-access|none` overrides the default. Forcing a provider that isn't configured (or an unknown value) locks every non-machine route with a 503 rather than serving the app ungated.

Always open in every mode: `/api/worker`, `/api/cron`, `/api/local-files` (each checks its own token). Open in Clerk mode: `/sign-in/*`, `/sign-up/*`, `/api/health`, the root-level files in `public/`.

### Vercel environment variables

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` (Production) / `pk_test_…` (Preview) |
| `CLERK_SECRET_KEY` | `sk_live_…` / `sk_test_…` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `OWNER_EMAILS` | `barronzuo@gmail.com` (comma-separated; these accounts get role `owner`) |
| `AUTH_CANONICAL_HOST` | `creative.xark.io` — Production only. Page requests on any other host (the `*.vercel.app` aliases) are redirected here, and only sessions issued for it are accepted. Leave unset on Preview. |
| `AUTH_PROVIDER` | optional override, see above |

Turn off the Cloudflare Access application for creative.xark.io once Clerk is live, or new users can't reach `/sign-up`. `CF_ACCESS_*` can stay set — Clerk mode ignores them.

### Clerk dashboard settings

1. **Configure → User & authentication → Email**: *Sign-up with email* on, *Require email address* on, *Verify at sign-up* on, verification method **Email verification code** (not link). *Sign-in with email* on.
2. **Configure → User & authentication → Password**: *Sign-up with password* on (keep the breached-password check on). Leave phone, username, passkeys and social connections off unless wanted.
3. **Configure → Restrictions** (optional): *Allowlist* — only listed emails / domains (e.g. `xark.io`) can sign up; or **Sign-up mode → Restricted** — sign-up by invitation only (invite from **Users → Invite**). *Blocklist* for specific addresses.
4. **Configure → Paths** (or rely on the env vars): sign-in `/sign-in`, sign-up `/sign-up`, after sign-out `/sign-in`.
5. **Production instance → Domains**: set the domain to `creative.xark.io` and add the DNS records Clerk lists (CNAMEs for the Frontend API `clerk.creative.xark.io`, `accounts.creative.xark.io`, and the email sending records `clkmail`, `clk._domainkey`, `clk2._domainkey`) in the xark.io DNS zone (or the same names under `xark.io` if the Clerk domain is set to the root). On Cloudflare they must be **DNS only** (grey cloud), not proxied. Wait for Clerk to show them verified and the certificates issued before switching the production keys in.

### Users

`AppUser` (Prisma) is upserted on a person's first signed-in page load (`currentAppUser()` in `src/services/app-user.ts`, called from the root layout; no webhook). New projects record `createdById`. Owners see **Manage users** in the account menu → `/settings/users`.

## Environment

See `.env.example`. Analysis needs `OPENAI_API_KEY`; research quality improves with `YOUTUBE_API_KEY` and `META_ACCESS_TOKEN`; brand assets and rendered masters need object storage (`CLOUDINARY_URL` or `BLOB_READ_WRITE_TOKEN`); workers need `WORKER_TOKEN`.

## Audit

The 2026-09 multi-model audit (Claude Opus / Sonnet + Codex) and the rebuild plan are in `docs/audit/`.
