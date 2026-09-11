# Audit 05 — Brand / Product intake & uploads (Claude Sonnet)

## 1. Current intake flow

**Step 1 — Project form** (`src/components/projects/project-form.tsx`): `brandName`(29), `brandUrl`(30), `productUrl`(31), `productName`(32), `category`(33), `campaignGoal`(34), `briefingText`(35), `briefingFile`(36), `competitors[]`(38-40). `_productImages` state (37) is dead — never wired. Submit (60-115): POST `/api/projects` → optional briefing upload (fire-and-forget, errors swallowed) → redirect to `/research`. **No logo, CTA, offer, landing URL, claims, colors, fonts anywhere.**

**Step 2 — `/api/projects`** (`route.ts`): `createProjectSchema` (`validations.ts:8-17`) — `productUrl` is generic `z.string().url()`. `scrapeProductPage()` (53-62) failure is `console.warn`'d and swallowed (60-61); project created with nulls, no UI signal.

**Step 3 — Overview editing**
- `ProductDefinition` (`product-definition.tsx`): re-paste URL (167-218), edit name (220-245), **upload images as base64 data URIs** (85-110) → PATCH `/product` → `Project.userProductImages`. Only writer of that field; images live inline in Postgres JSON.
- `ProductIntelligence`: POST `/brand/understand` assembles `Brand.productImages` from user uploads (263-272) > product-page images proxied to base64 (274-293) > brand-site scrape (295-308) > AI environment scenes only (310-346; UI line 215: "Never show AI product images").
- `EditableField` on Overview (`overview/page.tsx:192-213`) edits promise/value/audience/tone/pricing via PATCH `/brand`. `ctaLanguage` accepted by that handler (`brand/route.ts:16-19`) but **no UI ever sends it**.
- `CampaignSelection` — env/actor/selling points/timeline/platform; no logo, no CTA copy.

## 2. Root causes

**Logo / CTA — missing, not buggy.** No `logo` field in any Prisma model. No upload endpoint, no storage wiring, no UI control. "logo" only appears as scraper noise-filter (`product-page-scraper.ts:80`), "no logo" in AI prompts (`campaign-selection.tsx:86`), and playbook prose. Cloudinary (`cloudinary@2.10.0`) is used only for final video render (`cloudinary-render.ts`, `video-gen/assemble.ts`), never in intake. CTA copy has no capture field; `ctaLanguage` is AI-scraped from website buttons (`website-crawler.ts:70-79` → `brand-analysis.ts:34,96`), never rendered, never editable, never consumed. `Script.ctaVariants` / `CreativeVariant.ctaVariant` are independently AI-generated with no tie to an approved brand CTA/offer.

**Product upload / URL unreliability**
1. No adapter chain — one Cheerio function with hardcoded Amazon selectors (123-129) and Shopify class guesses (151-164). Never calls Shopify `/products/<handle>.json`. Cannot execute JS → SPA storefronts return near-empty silently.
2. Inconsistent failure handling — swallowed at creation (`api/projects/route.ts:59-61`), surfaced as 500 at `/product` (`product-definition.tsx:158-164`).
3. No confirm step — scraped title/description written directly as canonical (`api/projects/route.ts:74-78`, `product/route.ts:50-54`). `productVerified` only gates AI environment images (`product-intelligence.tsx:178-190`).
4. Generic URL validation — homepage/category URLs pass.

## 3. Brand Kit spec

```prisma
model BrandKit {
  id, brandProfileId @unique
  colorsHex Json?      // [{name, hex, usage}]
  ctaOptions Json?     // [{text, priority}]
  offerText String?
  landingUrl String?
  claimsAllowed Json?; claimsForbidden Json?
  toneGuidelines String? @db.Text
  targetAudienceRef String?
  competitorUrls Json?
  skuDimensionsCm Json? // {length,width,height,weightKg}
  completenessScore Int @default(0)
  assets BrandAsset[]
}
model BrandAsset {
  id, brandKitId
  kind String    // LOGO | PACKSHOT | LIFESTYLE | FONT | OTHER
  variant String? // light|dark|front|side|in-hand|transparent-png
  cloudinaryPublicId String; url String; width Int?; height Int?; format String?
  verified Boolean @default(false); createdAt
}
```
Upload: browser-signed Cloudinary upload (server mints signature) → `BrandAsset` row. Replace base64-in-Postgres.

Completeness gate before Script/Studio: ≥1 LOGO (light+dark), ≥2 PACKSHOT, ≥3 hex colors, ≥1 CTA option, `landingUrl`, ≥1 claim (or explicit "none"), tone set. Checklist banner on Overview.

## 4. Product URL adapter chain

1. Shopify — detect `/products/` or shopify meta; fetch `{origin}/products/{handle}.json`.
2. Amazon — detect `/dp/` or `/gp/product/`; isolate current selectors; extract ASIN.
3. Generic — OpenGraph + JSON-LD Product schema first; heuristics last.
Confirm card after scrape ("We found: title, N images, description — Confirm / Edit") before committing. Surface which adapter tried and why it failed.

## 5. Top 10 changes

1. `schema.prisma` — `BrandKit` + `BrandAsset`.
2. New `api/brand-kit/[id]/assets/sign/route.ts` — Cloudinary signed upload.
3. New `components/dashboard/brand-kit-panel.tsx`.
4. Split `product-page-scraper.ts` into `adapters/{shopify,amazon,generic}.ts` + dispatcher.
5. `api/projects/route.ts:53-62` — return `scrapeError`.
6. `validations.ts:11` — `productUrlSchema` refinement flagging non-PDP.
7. `product/route.ts` — confirm/diff response.
8. `product-definition.tsx:85-110` — signed upload instead of base64.
9. `brand/route.ts` — wire `ctaLanguage` to BrandKit CTA options UI or remove.
10. `overview/page.tsx` — completeness banner + gate.
