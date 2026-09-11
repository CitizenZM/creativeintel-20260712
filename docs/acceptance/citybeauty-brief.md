# Acceptance client — City Beauty (citybeauty.com)

Recon 2026-09-11 (Sonnet agent, facts only). Shopify + Cloudflare, `products.json` fetchable, no bot challenge.

## Brand
- Category: DTC anti-aging skincare + lip plumpers; direct-response tone, benefit language ("helps reduce the appearance of…"), never "clinically proven"; disclaimer `*Individual results can and will vary.`
- Audience: women 40+, visible aging (crepey/sagging skin, lip lines), non-invasive at-home alternatives, subscription-receptive.

## Hero SKUs
| Product | URL | Price | Claim |
|---|---|---|---|
| InvisiCrepe® Body Balm (SKU CBICBB, 238 g) — **primary ad SKU** | https://citybeauty.com/products/invisicrepe-body-balm | $67 | Reduces the appearance of thin, wrinkled, crepey skin; smoother, firmer look |
| City Lips® (lip plumper) — **second version** | https://citybeauty.com/products/city-lips | $35 | Instant plumping, smooths lip lines |
| Concentrated Youth Serum | https://citybeauty.com/products/concentrated-youth-serum | $90 | Face/eye wrinkle-targeting serum |

## Brand kit inputs
- Logo: https://citybeauty.com/cdn/shop/files/logo2023.webp?v=1748535827 (downloaded to `~/Projects/libtv-ad-studio/brands/citybeauty/assets/brand/`)
- Colours: navy `#0C233F` (primary), green `#469B49` (accent), red `#B30808` (urgency), sand `#f7f4f0` (background), white
- Fonts: Unna (headline serif), Inter / Work Sans (body)
- CTAs on site: "Add to Cart", "Shop Now", "Subscribe & Save"
- Offer: "Insider Favorites — 30% Off"; bundles up to 20 % off
- Allowed claims: "helps reduce the appearance of crepey skin", "supports the skin's barrier", "instant plumping"; forbidden: "clinically proven", medical cure language
- Packshots downloaded to `~/Projects/libtv-ad-studio/brands/citybeauty/assets/packshots/`

## Competitors
1. Crepe Erase — https://crepeerase.com (body crepe)
2. Grande Cosmetics / GrandeLIPS — https://grandecosmetics.com (lip plumper)
3. Plexaderm — https://plexaderm.com (DR anti-aging)
4. Meaningful Beauty — https://meaningfulbeauty.com
5. Olay (Regenerist) — https://olay.com

Meta Ad Library page names not verified (JS surface) — the research worker resolves them.

## Acceptance target
Two finished, different ads (e.g. InvisiCrepe BEFORE_AFTER 10 s and City Lips STAT_SHOCK/DEMO 10 s), produced through the dashboard by browser simulation, rendered on LibTV in economy mode within the 231-credit balance.
