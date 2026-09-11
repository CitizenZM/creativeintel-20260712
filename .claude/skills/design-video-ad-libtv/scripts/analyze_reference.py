#!/usr/bin/env python3
"""Turn a reference ad video into a compact, Claude-readable evidence pack.

Pipeline (all local, zero LibTV calls):
  1. download (yt-dlp) or copy the source video
  2. detect shot cuts (ffmpeg scene score)
  3. pick frames: first/mid/last per shot + dense sampling of the hook window
  4. render labelled contact sheets (one image = many frames, timestamps burned in)
  5. transcribe voice-over with whisper.cpp (timestamps aligned to shots)
  6. write manifest.json with shots, frame times, transcript and token estimate

Usage:
  analyze_reference.py <url-or-file> --out <dir> [--hook 3] [--scene 0.3]
                       [--width 360] [--max-frames 60] [--dense 5.5-8] [--no-transcribe]
"""

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WHISPER_MODEL = Path.home() / ".cache/whisper/ggml-small.bin"
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]
SHEET_COLS, SHEET_ROWS = 4, 3


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def fetch_source(src: str, out: Path) -> Path:
    if Path(src).expanduser().exists():
        dest = out / ("source" + Path(src).suffix)
        if Path(src).expanduser().resolve() != dest.resolve():
            shutil.copy(Path(src).expanduser(), dest)
        return dest
    run([
        "yt-dlp", "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4", "--no-playlist",
        "--write-info-json", "-o", str(out / "source.%(ext)s"), src,
    ])
    return out / "source.mp4"


def probe(video: Path) -> dict:
    info = json.loads(run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(video),
    ]).stdout)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    num, den = (int(x) for x in v.get("avg_frame_rate", "0/1").split("/"))
    return {
        "duration": float(info["format"]["duration"]),
        "width": int(v["width"]),
        "height": int(v["height"]),
        "fps": round(num / den, 2) if den else None,
        "has_audio": any(s["codec_type"] == "audio" for s in info["streams"]),
    }


def detect_cuts(video: Path, threshold: float) -> list[float]:
    proc = subprocess.run([
        "ffmpeg", "-hide_banner", "-i", str(video),
        "-vf", f"select='gt(scene,{threshold})',showinfo", "-an", "-f", "null", "-",
    ], capture_output=True, text=True)
    return [float(m) for m in re.findall(r"pts_time:([\d.]+)", proc.stderr)]


def build_shots(cuts: list[float], duration: float, min_len: float = 0.25) -> list[dict]:
    bounds = [0.0]
    for c in cuts:
        if c - bounds[-1] >= min_len and duration - c >= min_len:
            bounds.append(c)
    bounds.append(duration)
    return [
        {"id": i + 1, "start": round(a, 2), "end": round(b, 2), "dur": round(b - a, 2)}
        for i, (a, b) in enumerate(zip(bounds, bounds[1:]))
    ]


def pick_frames(shots: list[dict], duration: float, hook: float, max_frames: int,
                dense: list[tuple[float, float]] = ()) -> list[dict]:
    picks = []
    for s in shots:
        a, b, d = s["start"], s["end"], s["dur"]
        if d < 0.8:
            times = [(a + b) / 2]
        elif d < 2.0:
            times = [a + 0.15, b - 0.15]
        else:
            times = [a + 0.15, (a + b) / 2, b - 0.15]
        picks += [{"t": t, "shot": s["id"], "why": "shot"} for t in times]
    # Hook window: every 0.5s, the first seconds decide thumb-stop rate.
    t = 0.0
    while t < min(hook, duration):
        picks.append({"t": t + 0.05, "shot": None, "why": "hook"})
        t += 0.5
    # Dense windows (clone mode): 4 fps to catch whip pans, speed ramps, texture pulls.
    for a, b in dense:
        t = a
        while t < min(b, duration):
            picks.append({"t": t, "shot": None, "why": "dense"})
            t += 0.25
    picks.sort(key=lambda p: p["t"])
    for p in picks:
        if p["shot"] is None:
            p["shot"] = next(s["id"] for s in shots if s["start"] <= p["t"] < s["end"] + 1e-6)
    kept = []
    for p in picks:
        # Near-duplicates are only collapsed inside one shot; a cut always keeps both sides.
        gap = 0.2 if p["why"] == "dense" else 0.3
        if kept and kept[-1]["shot"] == p["shot"] and p["t"] - kept[-1]["t"] < gap:
            if p["why"] == "shot":
                kept[-1] = p
            continue
        kept.append(p)
    if len(kept) > max_frames:
        step = len(kept) / max_frames
        kept = [kept[math.floor(i * step)] for i in range(max_frames)]
    for p in kept:
        p["t"] = round(min(p["t"], duration - 0.05), 2)
    return kept


def extract_frames(video: Path, frames: list[dict], width: int, out: Path) -> None:
    fdir = out / "frames"
    fdir.mkdir(exist_ok=True)
    for i, f in enumerate(frames):
        path = fdir / f"f{i:03d}_t{f['t']:06.2f}.jpg"
        run([
            "ffmpeg", "-v", "error", "-y", "-ss", str(f["t"]), "-i", str(video),
            "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", str(path),
        ])
        f["file"] = str(path.relative_to(out))


def drop_near_duplicates(frames: list[dict], out: Path, threshold: float) -> list[dict]:
    """Drop frames that barely differ from the last kept frame of the same shot.

    Static talking-head shots otherwise pay for three identical stills.
    The first frame of every shot is always kept.
    """
    if threshold <= 0:
        return frames
    kept, last = [], {}
    for f in frames:
        px = list(Image.open(out / f["file"]).convert("L").resize((32, 32)).getdata())
        prev = last.get(f["shot"])
        if prev is not None and sum(abs(a - b) for a, b in zip(px, prev)) / len(px) < threshold:
            (out / f["file"]).unlink()
            continue
        last[f["shot"]] = px
        kept.append(f)
    return kept


def load_font(size: int):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def patch_tokens(w: int, h: int) -> int:
    # Claude high-res tier: ceil(w/28) * ceil(h/28), capped at 4784.
    return min(math.ceil(w / 28) * math.ceil(h / 28), 4784)


def contact_sheets(frames: list[dict], out: Path) -> list[dict]:
    sdir = out / "sheets"
    sdir.mkdir(exist_ok=True)
    font = load_font(20)
    per = SHEET_COLS * SHEET_ROWS
    sheets = []
    for n in range(math.ceil(len(frames) / per)):
        batch = frames[n * per:(n + 1) * per]
        tiles = [Image.open(out / f["file"]) for f in batch]
        tw, th = tiles[0].size
        label_h = 28
        cols = min(SHEET_COLS, len(tiles))
        rows = math.ceil(len(tiles) / SHEET_COLS)
        sheet = Image.new("RGB", (cols * tw, rows * (th + label_h)), "black")
        draw = ImageDraw.Draw(sheet)
        for i, (f, img) in enumerate(zip(batch, tiles)):
            x, y = (i % SHEET_COLS) * tw, (i // SHEET_COLS) * (th + label_h)
            sheet.paste(img, (x, y + label_h))
            tag = f"S{f['shot']}  {f['t']:.2f}s" + {"hook": "  HOOK", "dense": "  4fps"}.get(f["why"], "")
            draw.text((x + 6, y + 3), tag, fill="yellow", font=font)
        path = sdir / f"sheet_{n + 1:02d}.jpg"
        sheet.save(path, quality=85)
        sheets.append({
            "file": str(path.relative_to(out)),
            "frames": [f["t"] for f in batch],
            "est_tokens": patch_tokens(*sheet.size),
        })
    return sheets


def transcribe(video: Path, out: Path, vocab: str = "") -> list[dict]:
    wav = out / "audio16k.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-ac", "1", "-ar", "16000", str(wav)])
    if not WHISPER_MODEL.exists():
        print(f"[warn] whisper model missing: {WHISPER_MODEL}", file=sys.stderr)
        return []
    # -ml 1 -sow: one segment per word, so voice-over can be split exactly at shot cuts.
    # --prompt biases spelling of brand / ingredient names (otherwise "MIXIK" -> "Mexico").
    run([
        "whisper-cli", "-m", str(WHISPER_MODEL), "-l", "auto", "-ml", "1", "-sow",
        *(["--prompt", vocab] if vocab else []),
        "-oj", "-of", str(out / "transcript"), str(wav),
    ])
    data = json.loads((out / "transcript.json").read_text())
    words = []
    for s in data.get("transcription", []):
        text = s["text"].strip()
        if text and not re.fullmatch(r"[\[\(].*[\]\)]", text):  # drop [Music] style tags
            words.append({
                "start": s["offsets"]["from"] / 1000,
                "end": s["offsets"]["to"] / 1000,
                "text": text,
            })
    wav.unlink()
    return words


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("--out", required=True)
    ap.add_argument("--hook", type=float, default=3.0, help="seconds of dense hook sampling")
    ap.add_argument("--scene", type=float, default=0.3, help="ffmpeg scene-cut threshold")
    ap.add_argument("--width", type=int, default=360, help="frame width in px")
    ap.add_argument("--max-frames", type=int, default=60)
    ap.add_argument("--dense", action="append", default=[], metavar="START-END",
                    help="extra 4fps window in seconds, e.g. 5.5-8; repeatable")
    ap.add_argument("--dedup", type=float, default=4.0,
                    help="drop same-shot frames whose 32x32 grey mean diff is below this (0 = off)")
    ap.add_argument("--vocab", default="", help="brand/ingredient words to bias transcription")
    ap.add_argument("--no-transcribe", action="store_true")
    args = ap.parse_args()
    dense = [tuple(float(x) for x in w.split("-")) for w in args.dense]

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    video = fetch_source(args.source, out)
    meta = probe(video)
    shots = build_shots(detect_cuts(video, args.scene), meta["duration"])
    frames = pick_frames(shots, meta["duration"], args.hook, args.max_frames, dense)
    extract_frames(video, frames, args.width, out)
    picked = len(frames)
    frames = drop_near_duplicates(frames, out, args.dedup)
    sheets = contact_sheets(frames, out)
    transcript = [] if args.no_transcribe or not meta["has_audio"] else transcribe(video, out, args.vocab)
    for s in shots:
        s["vo"] = " ".join(
            w["text"] for w in transcript if s["start"] <= (w["start"] + w["end"]) / 2 < s["end"]
        )

    manifest = {
        "source": args.source,
        "meta": meta,
        "shot_count": len(shots),
        "avg_shot_len": round(meta["duration"] / len(shots), 2),
        "shots": shots,
        "frames": frames,
        "sheets": sheets,
        "transcript_text": " ".join(w["text"] for w in transcript),
        "transcript_words": transcript,
        "est_image_tokens": sum(s["est_tokens"] for s in sheets),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(json.dumps({
        "out": str(out), "duration": meta["duration"], "size": f"{meta['width']}x{meta['height']}",
        "shots": len(shots), "frames": len(frames), "dropped_duplicates": picked - len(frames),
        "sheets": len(sheets),
        "est_image_tokens": manifest["est_image_tokens"], "transcript_segments": len(transcript),
    }))


if __name__ == "__main__":
    main()
