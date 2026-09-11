# Reading a reference video locally

Claude can't watch video; it reads images. The question is which frames, and how many.

## Method (hybrid — the one to use)
1. Detect shot cuts (`ffmpeg select='gt(scene,T)'`, T≈0.3; drop to 0.12 for handheld/soft cuts).
2. Per shot take first / middle / last frame — three frames reveal camera movement, one doesn't.
3. Dense-sample the hook (first 3s, every 0.5s) — the opening decides the scroll.
4. Optional `--dense a-b` at 4fps on a specific window (whip pans, speed ramps, orbits).
5. Transcribe locally with whisper.cpp using **word-level timestamps** (`-ml 1 -sow`) so voice-over
   splits exactly at cuts. Pass brand/ingredient names via `--vocab` or they come back wrong
   ("MIXIK" → "Mexico").
6. Tile frames into labelled contact sheets (shot id + timestamp burned in).

`scripts/analyze_reference.py` does all of the above and writes `manifest.json` (shots, frame
times, per-shot VO, token estimate) plus `sheets/*.jpg`.

## Cost comparison (measured on a 65s 9:16 ad)
| Method | Image tokens | What you learn |
|---|---|---|
| 1 fps at source resolution | ~78k | rough content; misses sub-second cuts |
| stage summary only (5 frames) | ~2k | narrative only — cannot rebuild the edit |
| **hybrid** | **~15k** | full shot table: framing, camera move, on-screen text, VO, transitions |

Tiling frames into a sheet does **not** save tokens (cost is by area) — it preserves order and cuts
the number of reads. Token cost of an image = ⌈w/28⌉ × ⌈h/28⌉ patches (high-res tier caps at 4784).
360px-wide frames ≈ 300 tokens each; a 4×3 sheet ≈ 3.7k.

## Depth by purpose
| Mode | Read | ~Tokens |
|---|---|---|
| inspire | first sheet + transcript | 5k |
| structure | all sheets + shot table | 10–15k |
| clone | + `--dense` on key windows, `--width 540` for legible text | 15–25k |

## Long videos
A 5-minute review at `--max-frames 60` averages 13s per sampled frame — useless. Either analyse
only the hook and the demo window, or raise the cap deliberately.

## What to extract (template)
Stage level: duration, ratio, shot count, average shot length, narrative stages with timestamps,
hook mechanism (first 1s visual + first line + on-screen text), persuasion devices, pacing curve,
CTA, compliance flags.
Shot level: in/out, duration, shot size, angle, camera move, subject action, product visibility,
on-screen text, VO, SFX, transition, funnel role.
Then: what to borrow, what is artist/brand-identifiable and must not be copied, and an
AI-feasibility note per shot.
