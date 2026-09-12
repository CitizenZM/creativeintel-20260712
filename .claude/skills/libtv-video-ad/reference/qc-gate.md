# QC gate — nothing ships unmeasured

`scripts/qc_gate.py` runs ten checks on a rendered file and exits non-zero on any failure.
**Run it on every render before sending anything to Barron.** It is free and takes ~10 s.

```bash
python3 scripts/qc_gate.py out/AD-15s-9x16.mp4 --beats assets/music/track_15s.beats.txt
python3 scripts/qc_gate.py out/*.mp4 --beats ... --json > qc.json     # gate a batch
```

## Thresholds and where they come from

Benchmarks measured 2026-09-11 with `diagnose_cut.py` on official brand ads:

| Reference ad | cuts/15s | static_share | motion_mean |
|---|---|---|---|
| TCL EU Black Friday | 26 | 0.25 | 4.70 |
| TCL USA 98" | 21 | 0.28 | 3.10 |
| Hisense Black Friday | 34 | 0.34 | 2.69 |
| Walmart TV promo | 9 | 0.42 | 2.02 |

Walmart is the floor (a slower retail read), the TCL ads are the target.

| Check | Rule | What fails it |
|---|---|---|
| `cuts_per_15s` | ≥ 9 | too few segments; add cuts inside long clips |
| `static_share` | ≤ 0.42 | still plates — apply the motion floor (motion-and-rhythm §1) |
| `motion_mean` | ≥ 2.0 | everything moves too slowly |
| `longest_static_s` | ≤ 1.2 | one frozen section, usually an end card |
| `avg_shot_s` | ≤ 1.7 | pacing drag |
| `beat_bias_ms` | ≤ ±20 | rounding direction — use `snap()` |
| `beat_max_ms` | ≤ 50 | one outlier boundary, usually a transition whose half-window differs from the others |
| `beat_accent_pct` | ≥ 25 % of beats carry a cut | too few section changes |
| `true_peak_dbfs` | ≤ −1.0 | missing `loudnorm` → clipping on phones |
| `loudness_lufs` | −17 … −12 | wrong platform loudness |

## Measured record (same 15 s ad, `game`)

| Metric | v1 | v2 | Verdict |
|---|---|---|---|
| cuts | 6 | 11 | pass |
| static_share | 0.609 | 0.314 | pass |
| motion_mean | 1.48 | 2.91 | pass |
| longest_static_s | 2.70 | 0.90 | pass |
| beat_bias_ms | +21 | −11 | pass |
| beat_max_ms | 27 | 80 | **still failing** — one boundary outlier to chase |
| true_peak | +1.53 | −2.77 | pass |
| loudness | −10.0 | −14.2 | pass |

v1 failed 9 of 10 checks; v2 fails 1. Report the failing check rather than hiding it.

## Other gates that are not in the script (check by eye, once per campaign)

- **Product scale**: `swift scripts/face_box.swift shot.png` → bottle-height ÷ face-box ≤ 0.28
  for a 4–5 cm product.
- **Blank screens**: every visible device panel carries original content (`screens.py`).
- **Clip reuse**: no generated clip appears more than twice in 15 s.
- **Per-ratio layout**: 4:5 and 1:1 plates/end cards are re-laid-out, not centre-cropped; only
  people footage is cropped.
- **Safe zones**: text inside top 14 % / bottom 20 % / right 12 %.
- **Delivery**: always also export a 720p CRF-28 preview (≤3 MB) — full masters fail phone upload.
