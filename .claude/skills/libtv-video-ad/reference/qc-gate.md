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
| TCL EU Black Friday | 12.1 | 0.25 | 4.70 |
| TCL USA 98" | 12.0 | 0.28 | 3.10 |
| Hisense Black Friday | 7.9 | 0.34 | 2.69 |
| Walmart TV promo | 8.9 | 0.42 | 2.02 |

Hisense/Walmart are the floor (a slower retail read), the TCL ads are the target.

> These numbers were re-measured after `diagnose_cut.py` learned to merge the two spikes a single
> transition produces (an earlier pass double-counted them and reported 21–34 cuts/15 s). If you
> see an old table quoting 13–19 or 26–34 cuts per 15 s, it is the pre-fix measurement.

| Check | Rule | What fails it |
|---|---|---|
| `cuts_per_15s` | ≥ 8 | too few segments; add cuts inside long clips |
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

| Metric | v1 | v2 | v3 | Verdict |
|---|---|---|---|---|
| cuts | 6 | 11 | 13 | pass |
| static_share | 0.609 | 0.314 | 0.240 | pass |
| motion_mean | 1.48 | 2.91 | 3.30 | pass |
| longest_static_s | 2.70 | 0.90 | 0.37 | pass |
| avg_shot_s | 2.14 | 1.25 | 1.07 | pass |
| beat_bias_ms | +21 | +13 | **+1.9** | pass |
| beat_max_ms | 27 | 50 | **23** | pass |
| beat_accent_pct | 18.8 | 34.4 | 40.6 | pass |
| true_peak | +1.53 | −2.77 | −2.76 | pass |
| loudness | −10.0 | −14.2 | −14.3 | pass |

v1 failed 9 of 10 checks; v3 passes all 10. Report a failing check rather than hiding it.

**Full delivery, 2026-09-12**: 18 files (3 ads x 2 durations x 3 ratios) all pass. Ranges across
the set — cuts/15s 10.5–14, static 0.11–0.42, motion 3.07–3.77, beat bias within ±2.2 ms, worst
single boundary 40 ms, true peak ≤ −2.51 dBFS, loudness −14.7…−13.9 LUFS.

Getting there took three gate rounds (8/18 → 12/18 → 18/18), each exposing a defect that a single
sample file had hidden. **Gate every file.**

Two code defects were found only because the gate kept failing after the obvious fixes:

* **zoom punch swapped content twice** — the transition blended back to the outgoing segment on
  the last frames of its window, adding a second change ~100 ms after the beat.
* **symmetric whip blur hid the cut** — the blur peaked on the beat frame, so the largest visible
  change happened 2 frames later. The envelope now builds before the beat and clears fast after.

## Other gates that are not in the script (check by eye, once per campaign)

- **Product scale**: `swift scripts/face_box.swift shot.png` → bottle-height ÷ face-box ≤ 0.28
  for a 4–5 cm product.
- **Blank screens**: every visible device panel carries original content (`screens.py`).
- **Clip reuse**: no generated clip appears more than twice in 15 s.
- **Per-ratio layout**: 4:5 and 1:1 plates/end cards are re-laid-out, not centre-cropped; only
  people footage is cropped.
- **Safe zones**: text inside top 14 % / bottom 20 % / right 12 %.
- **Delivery**: always also export a 720p CRF-28 preview (≤3 MB) — full masters fail phone upload.
