# Acceptance round 2 — City Beauty · City Lips (second SKU)

Date: 2026-09-11 · Project `cmtwngv2q009wt52gmg2sbiea` (local DB) · Browser simulation on http://localhost:3100. LibTV balance ≈ 9 credits, so this round rehearses the render (dry-run) instead of paying for a third video; the two paid deliverables from round 1 stand.

## Walk-through (all round-1 fixes exercised)

| Step | Result |
|---|---|
| New project form (City Lips PDP, 3 competitors) | Shopify adapter OK → research auto-started |
| Research | brand + competitor crawl; **browser ad-library tasks now enqueue without a saved campaign** (fix verified): Meta 3 tasks → **22 real video ads** (Olay 17, Crepe Erase, Grande); Google ATC 3 tasks → 0 (playbook locale issue, fix in progress); TikTok AL 0 (egress region) |
| Brand kit | logo (PNG named .webp now accepted via magic-byte sniff) + 2 packshots + lifestyle; fields → 100 % |
| Insights | 11 teardowns (frames), 3 competitor rollups, 6 selling points |
| Creative (UI template picker) | DEMO_HOW_IT_WORKS + STAT_SHOCK, 10 s; claims audit passed (CTA "Shop Now", no invented urgency). New finding: STAT_SHOCK fabricated "84 %" → statistics guard added |
| Storyboards (UI) | 2 boards × 5 frames, CTA frames carry approved CTA + offer + disclaimer |
| Studio (UI) | `?storyboardId=` preselects the board via the new radio picker; compile = 26 credits; approve OK |
| Worker dry-run | claimed the run, per-run node names (`K1-7jp33`, edges `--left K1-7jp33`), prompts: no-text clause present, no URL/offer/CTA leakage; assembly command emitted; run marked as rehearsal |

## Fixes landed this round
- Research: browser adapters dispatch without a CampaignSelection; worker completions re-rank per owner instead of evicting Top-N; ego-browser results read from stderr; Meta forced to `en_US` with bilingual labels; Meta titles fall back to body text; job steps finalized + nested.
- Studio/worker: pretty-JSON CLI parsing; `K<n>` edges; resume without re-paying; per-run node suffixes; prompt hygiene (product facts + no-text); failed nodes fail the run; dry-run reports as rehearsal; brand kit in the claim payload; branded caption/CTA typography with per-clip crop.
- Creative: brand-claims compliance block + deterministic audit + repair pass; statistics guard (in progress).
- UI: Studio radio picker with URL state and test ids; content cards no longer nest anchors; theme bootstrap as a static script.

## Open
- Google Ads Transparency playbook returns 0 (agent investigating locale/selectors).
- TikTok Ad Library is region-gated from this Mac's egress — needs a US egress or a proxy.
- A third paid render (and a clean re-render of v1's hook clip, 13 credits) needs a LibTV top-up.
