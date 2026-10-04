# Product research (phase 1) — measured method

1. **Best sellers**: Shopify stores sort by sales — `/collections/<tvs>?sort_by=best-selling`; many have
   `/pages/best-seller`. TCL US (2026-10-04): QM7L #1, QM8L #2. Never pick "best sellers" from memory.
2. **Specs + prices**: `/products/<handle>.json` (variants: size, price, compare_at_price = the live
   discount; body copy; images). The product page HTML has the spec table (label/value lines).
3. **Promos and services**: only claim what the page says, with its limits. TCL "FREE Professional TV
   Installation": eligible QM7L, QM8L, X11L, RM9L, X11K, 115" QM7K; delivery + placement + install + standard
   wall mounting; mount hardware / non-standard work extra; third-party partner; varies by location.
   → never say "wall mount included". Unannounced event prices are `[占位]`.
4. **Service doesn't fit a product** (installation for a tablet): translate the promise ("ready out of the box",
   "no monitor to install") and flag it for approval — never invent a service.
5. **Scenes**: the store page + 2–3 reviews give the real use cases (NXTPAPER 14: full A4 sheet music, all-day
   student battery, ink-paper reading, Extend Mode second screen).
6. **Official images**: download all; tag each (vision at 512 px). Rights: league marks (NFL…), film posters
   (e.g. "Wicked") and app UI on screens are **not usable** — 12 of TCL's 39 images. Use clean packshots as
   references and composite our own screen content.

Script: `python3 scripts/shopify_research.py <store> --bestsellers <collection> --products a,b --out <dir> --tag-images`
