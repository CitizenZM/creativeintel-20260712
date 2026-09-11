#!/usr/bin/env python3
"""Local assembly for a LibTV run — adapted from the design-video-ad-libtv skill.

The edit is local because video models garble type and cannot hit a beat:
generated clips supply motion only, while CTA cards, the logo end card and every
frame where the label must be legible are composited here from the official
packshot.

In economy mode one generated clip covers several storyboard windows, so the
timeline is driven by the clip mapping the compiler wrote onto each V job
(`coversFrames` / `frameOffsetsSec`): every 2 s window is cut out of its clip at
the recorded offset. That is what turns 8-12 clips into ~14 visible cuts.

Inputs (written by worker.mjs into the run directory):
  run.json        the claimed run payload — frames[], jobs[], clips[], aspect
  manifest.json   one entry per executed node with its downloaded localPath
  refs/PROD-*.*   official packshots
  refs/LOGO.*     brand logo

Outputs:
  final/master.mp4          1080x1920 @30fps
  final/preview-720p.mp4
  final/contact-sheet.jpg

Usage:
  python3 assemble.py --run-dir <dir> [--music track.m4a] [--brand-color "#FF4FA3"] [--dry-run]
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
except ImportError:  # pragma: no cover - surfaced to the worker as a clear error
    print("assemble.py requires Pillow: python3 -m pip install --user Pillow", file=sys.stderr)
    raise

FPS = 30
CREAM = (255, 246, 238)
INK = (24, 24, 27)
ACCENT = (255, 79, 163)
SRC_OFFSET_SEC = 0.25  # skip the settle at the head of every generated clip
BEAT_SNAP_SEC = 0.25

# Platform chrome covers the top 14% and bottom 20% of a 9:16 feed; nothing
# legible may be drawn there (reference/shot-design.md).
SAFE_TOP = 0.14
SAFE_BOTTOM = 0.80

DIMENSIONS = {
    "9:16": (1080, 1920),
    "4:5": (1080, 1350),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}


def run(cmd, dry_run=False, check=True):
    printable = " ".join(str(c) for c in cmd)
    if dry_run:
        print(f"[dry-run] {printable}")
        return subprocess.CompletedProcess(cmd, 0, "", "")
    print(f"$ {printable}")
    return subprocess.run([str(c) for c in cmd], check=check, capture_output=True, text=True)


def load_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        if default is None:
            raise
        return default


def find_ref(run_dir: Path, stem: str):
    for candidate in sorted((run_dir / "refs").glob(f"{stem}.*")):
        return candidate
    return None


def load_font(size: int):
    for name in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Futura.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/DejaVuSans-Bold.ttf",
        "DejaVuSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def parse_color(value, fallback=ACCENT):
    text = str(value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    if len(text) != 6:
        return fallback
    try:
        return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


def mix(color, other, amount):
    return tuple(int(c + (o - c) * amount) for c, o in zip(color, other))


# ─── Beat grid ───────────────────────────────────────────────────────────────


def beat_grid(music: Path):
    """aubio gives a measured grid; a guessed BPM drifts within two bars."""
    if not music or not Path(music).exists() or not shutil.which("aubio"):
        return []
    try:
        proc = subprocess.run(
            ["aubio", "beat", str(music)], check=True, capture_output=True, text=True
        )
    except (subprocess.CalledProcessError, OSError):
        return []
    beats = []
    for line in proc.stdout.splitlines():
        try:
            beats.append(float(line.strip()))
        except ValueError:
            continue
    return beats


def snap(t: float, beats):
    if not beats:
        return t
    nearest = min(beats, key=lambda b: abs(b - t))
    return nearest if abs(nearest - t) <= BEAT_SNAP_SEC else t


# ─── Clip frames ─────────────────────────────────────────────────────────────


def extract(clip: Path, out_dir: Path, width: int, height: int, dry_run=False):
    out_dir.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", clip,
            "-vf",
            f"fps={FPS},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}",
            "-q:v", "3", out_dir / "f%04d.jpg",
        ],
        dry_run=dry_run,
    )
    return sorted(out_dir.glob("f*.jpg"))


# ─── Local composites ────────────────────────────────────────────────────────


class Compositor:
    def __init__(self, width, height, packshot: Path, logo: Path, brand_color=ACCENT):
        self.W, self.H = width, height
        self.brand = brand_color
        self.packshot = Image.open(packshot).convert("RGBA") if packshot else None
        self.logo = Image.open(logo).convert("RGBA") if logo else None
        if self.logo:
            self.logo.thumbnail((int(self.W * 0.62), int(self.H * 0.2)))
        self.headline = load_font(int(self.W * 0.095))
        self.caption = load_font(int(self.W * 0.042))
        self.plate = self._plate()

    def _plate(self):
        """High-key brand-colour ground — the first frame must never be dark."""
        tint = mix(self.brand, (255, 255, 255), 0.88)
        bg = Image.new("RGB", (self.W, self.H))
        draw = ImageDraw.Draw(bg)
        for y in range(self.H):
            u = y / self.H
            draw.line((0, y, self.W, y), fill=mix((255, 252, 252), tint, u))
        glow = Image.new("RGB", (self.W, self.H), (0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse(
            (-self.W * 0.2, self.H * 0.08, self.W * 0.6, self.H * 0.5),
            fill=mix(self.brand, (255, 255, 255), 0.55),
        )
        gd.ellipse((self.W * 0.5, self.H * 0.14, self.W * 1.25, self.H * 0.55), fill=(176, 226, 255))
        return ImageChops.screen(bg, glow.filter(ImageFilter.GaussianBlur(int(self.W * 0.17))))

    def product_card(self, headline: str, caption: str = ""):
        """CTA card: the packshot cutout on the brand plate, CTA line, offer line."""
        frame = self.plate.copy()
        if self.packshot:
            product = self.packshot.copy()
            target_h = int(self.H * 0.38)
            product = product.resize(
                (max(1, int(product.width * target_h / product.height)), target_h), Image.LANCZOS
            )
            x = (self.W - product.width) // 2
            top = int(self.H * 0.27)

            shadow = Image.new("L", (self.W, self.H), 0)
            ImageDraw.Draw(shadow).ellipse(
                (x - 60, top + target_h - 34, x + product.width + 60, top + target_h + 62), fill=95
            )
            frame = Image.composite(
                Image.new("RGB", (self.W, self.H), mix(self.brand, (140, 140, 150), 0.6)),
                frame,
                shadow.filter(ImageFilter.GaussianBlur(28)),
            )

            reflection = product.transpose(Image.FLIP_TOP_BOTTOM).resize(
                (product.width, int(target_h * 0.32))
            )
            alpha = reflection.split()[3].point(lambda v: int(v * 0.18))
            reflection.putalpha(alpha)
            frame.paste(reflection, (x, top + target_h + 6), reflection)
            frame.paste(product, (x, top), product)

        if headline:
            self._centered(frame, headline, self.headline, self.H * 0.16, stroke=True)
        if caption:
            self._centered(frame, caption, self.caption, self.H * 0.70)
        return frame

    def end_card(self, headline: str):
        frame = Image.new("RGB", (self.W, self.H), CREAM)
        if self.logo:
            frame.paste(
                self.logo,
                ((self.W - self.logo.width) // 2, (self.H - self.logo.height) // 2),
                self.logo,
            )
        else:
            draw = ImageDraw.Draw(frame)
            r = int(self.W * 0.14)
            draw.ellipse(
                (self.W // 2 - r, self.H // 2 - r, self.W // 2 + r, self.H // 2 + r), fill=self.brand
            )
        if headline:
            self._centered(frame, headline, self.caption, self.H * 0.62)
        return frame

    def overlay(self, frame, text: str):
        """Caption burned over a generated window, inside the safe zones."""
        if not text:
            return frame
        self._centered(frame, text, self.caption, self.H * 0.70, stroke=True)
        return frame

    def _centered(self, frame, text, font, y, stroke=False):
        draw = ImageDraw.Draw(frame)
        lines = wrap(draw, text, font, int(self.W * 0.86))[:3]
        line_h = int(font.size * 1.22)
        top = self._clamp_to_safe(y, line_h * len(lines))
        for i, line in enumerate(lines):
            box = draw.textbbox((0, 0), line, font=font)
            x = (self.W - (box[2] - box[0])) // 2 - box[0]
            if stroke:
                draw.text(
                    (x, top + i * line_h - box[1]), line, font=font, fill=CREAM,
                    stroke_width=max(4, font.size // 14), stroke_fill=self.brand,
                )
            else:
                draw.text((x, top + i * line_h - box[1]), line, font=font, fill=INK)

    def _clamp_to_safe(self, y, block_height):
        lo = int(self.H * SAFE_TOP)
        hi = int(self.H * SAFE_BOTTOM) - block_height
        return max(lo, min(int(y), max(lo, hi)))


def wrap(draw, text, font, max_width):
    words = str(text or "").split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        box = draw.textbbox((0, 0), trial, font=font)
        if box[2] - box[0] <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


# ─── Timeline ────────────────────────────────────────────────────────────────


def collect_clips(payload, manifest, nodes_by_name):
    """frameNumber -> {path, offset} using the compiler's clip mapping.

    Economy runs carry `frameOffsetsSec` (where in the clip each window starts);
    full-mode and legacy runs fall back to one V<n> per frame read from the head
    of the clip.
    """
    sources = list(manifest.get("clips") or payload.get("clips") or [])
    if not sources:
        for job in payload.get("jobs", []):
            if job.get("kind") != "video":
                continue
            settings = job.get("settings") or {}
            sources.append(
                {
                    "nodeName": job.get("nodeName"),
                    "coversFrames": settings.get("coversFrames"),
                    "frameOffsetsSec": settings.get("frameOffsetsSec"),
                    "localPath": job.get("localPath"),
                }
            )

    clips = {}
    for source in sources:
        node = nodes_by_name.get(source.get("nodeName") or "", {})
        local = source.get("localPath") or node.get("localPath")
        if not local:
            continue
        offsets = source.get("frameOffsetsSec") or node.get("frameOffsetsSec") or []
        if offsets:
            for offset in offsets:
                clips[int(offset["frameNumber"])] = {
                    "path": local,
                    "offset": float(offset.get("clipStartSec", 0.0)),
                }
            continue
        for i, frame_number in enumerate(source.get("coversFrames") or []):
            clips[int(frame_number)] = {"path": local, "offset": SRC_OFFSET_SEC}

    for name, node in nodes_by_name.items():
        if not name.startswith("V") or not node.get("localPath"):
            continue
        try:
            frame_number = int(name[1:])
        except ValueError:
            continue
        clips.setdefault(frame_number, {"path": node["localPath"], "offset": SRC_OFFSET_SEC})

    return clips


def build_timeline(frames, clips, nodes_by_name, beats, frame_seconds):
    timeline = []
    for i, frame in enumerate(frames):
        n = int(frame.get("frameNumber", i + 1))
        start = float(frame.get("startSec", i * frame_seconds))
        end = float(frame.get("endSec", start + frame_seconds))
        segment = str(frame.get("segment") or "BODY").upper()
        clip = clips.get(n) if segment != "CTA" else None
        timeline.append(
            {
                "frameNumber": n,
                "start": snap(start, beats) if i else 0.0,
                "end": end,
                "segment": segment,
                "clip": (clip or {}).get("path"),
                "clipOffset": float((clip or {}).get("offset", 0.0)),
                "keyframe": (nodes_by_name.get(f"K{n}") or {}).get("localPath"),
                "headline": frame.get("textOverlay") or "",
                "caption": frame.get("voiceover") or "",
                "endCard": False,
                "soleCta": False,
            }
        )
    for i in range(len(timeline) - 1):
        timeline[i]["end"] = timeline[i + 1]["start"]

    timeline = [w for w in timeline if w["end"] > w["start"]]

    cta = [w for w in timeline if w["segment"] == "CTA"]
    if cta:
        cta[-1]["endCard"] = True
        cta[-1]["soleCta"] = len(cta) == 1
    return timeline


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--aspect", default="9:16")
    ap.add_argument("--frame-seconds", type=float, default=2.0)
    ap.add_argument("--music", default=None)
    ap.add_argument("--brand-color", default=None)
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    run_dir = Path(args.run_dir)
    width, height = DIMENSIONS.get(args.aspect, DIMENSIONS["9:16"])
    final_dir = run_dir / "final"
    final_dir.mkdir(parents=True, exist_ok=True)

    payload = load_json(run_dir / "run.json", {})
    manifest = load_json(run_dir / "manifest.json", {"nodes": []})
    frames = manifest.get("frames") or payload.get("frames") or []
    nodes_by_name = {n["nodeName"]: n for n in manifest.get("nodes", [])}

    if not frames:
        print("no storyboard frames in run.json/manifest.json — nothing to assemble", file=sys.stderr)
        return 1

    beats = beat_grid(Path(args.music)) if args.music else []
    if beats:
        print(f"beat grid: {len(beats)} beats from {args.music}")

    clips = collect_clips(payload, manifest, nodes_by_name)
    timeline = build_timeline(frames, clips, nodes_by_name, beats, args.frame_seconds)
    if not timeline:
        print("every storyboard window is empty — nothing to assemble", file=sys.stderr)
        return 1
    duration = max(w["end"] for w in timeline)
    distinct = len({w["clip"] for w in timeline if w["clip"]})
    print(
        f"assembling {len(timeline)} windows / {duration:.2f}s at {width}x{height}@{FPS} "
        f"from {distinct} clip(s)"
    )

    if args.dry_run:
        for w in timeline:
            if w["clip"]:
                source = f"{Path(w['clip']).name} @ {w['clipOffset']:.2f}s"
            elif w["segment"] == "CTA":
                source = "logo end card" if w["endCard"] else "local CTA card"
            else:
                source = "MISSING CLIP"
            print(f"[dry-run] {w['start']:.2f}-{w['end']:.2f}s  F{w['frameNumber']}  {w['segment']:5s}  {source}")
        run(["ffmpeg", "-framerate", FPS, "-i", "seq/f%04d.jpg", final_dir / "master.mp4"], dry_run=True)
        run(["ffmpeg", "-i", final_dir / "master.mp4", "-vf", "scale=720:1280", final_dir / "preview-720p.mp4"], dry_run=True)
        print(f"[dry-run] contact sheet -> {final_dir / 'contact-sheet.jpg'}")
        return 0

    compositor = Compositor(
        width,
        height,
        find_ref(run_dir, "PROD-1"),
        find_ref(run_dir, "LOGO"),
        parse_color(args.brand_color),
    )
    work = Path(tempfile.mkdtemp(prefix="libtv-assemble-"))

    try:
        extracted = {}
        for window in timeline:
            clip = window["clip"]
            if not clip or not Path(clip).exists():
                continue
            key = str(clip)
            if key not in extracted:
                extracted[key] = extract(Path(clip), work / f"c{len(extracted)}", width, height)

        seq = work / "seq"
        seq.mkdir()
        contact_tiles = []
        total_frames = int(round(duration * FPS))

        for i in range(total_frames):
            t = i / FPS
            window = next((w for w in timeline if w["start"] <= t < w["end"]), timeline[-1])
            frame = render_window(
                window, t, extracted, compositor, width, height, captions=not args.no_captions
            )
            frame.save(seq / f"f{i:04d}.jpg", quality=92)
            if abs(t - window["start"]) < 1 / FPS:
                contact_tiles.append((window["frameNumber"], frame.copy()))

        has_music = bool(args.music and Path(args.music).exists())
        master = final_dir / "master.mp4"
        cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", FPS, "-i", seq / "f%04d.jpg"]
        if has_music:
            cmd += ["-i", args.music, "-c:a", "aac", "-b:a", "192k", "-shortest"]
        else:
            cmd += ["-an"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-t", f"{duration:.3f}", master]
        run(cmd)

        preview = final_dir / "preview-720p.mp4"
        preview_cmd = [
            "ffmpeg", "-v", "error", "-y", "-i", master, "-vf", "scale=720:1280",
            "-c:v", "libx264", "-crf", "28", "-preset", "slow",
        ]
        preview_cmd += ["-c:a", "aac", "-b:a", "96k"] if has_music else ["-an"]
        run(preview_cmd + [preview])

        write_contact_sheet(contact_tiles, final_dir / "contact-sheet.jpg", width, height)
        print(master)
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


def render_window(window, t, extracted, compositor, width, height, captions=True):
    clip = window["clip"]
    frames = extracted.get(str(clip)) if clip else None

    if frames:
        offset = window["clipOffset"] + (t - window["start"])
        index = min(max(int(round(offset * FPS)), 0), len(frames) - 1)
        image = Image.open(frames[index]).convert("RGB")
        return compositor.overlay(image, window["headline"]) if captions else image

    if window["segment"] == "CTA":
        span = window["end"] - window["start"]
        if window["endCard"] and not (window["soleCta"] and span > 1.4 and t < window["end"] - 1.0):
            return compositor.end_card(window["caption"])
        return compositor.product_card(window["headline"], window["caption"])

    keyframe = window.get("keyframe")
    if keyframe and Path(keyframe).exists():
        still = Image.open(keyframe).convert("RGB").resize((width, height), Image.LANCZOS)
        return compositor.overlay(still, window["headline"]) if captions else still

    return compositor.product_card(window["headline"], window["caption"])


def write_contact_sheet(tiles, out_path, width, height):
    if not tiles:
        return
    cols = min(5, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    tile_w = 320
    tile_h = int(tile_w * height / width)
    sheet = Image.new("RGB", (cols * tile_w, rows * (tile_h + 28)), (250, 250, 250))
    draw = ImageDraw.Draw(sheet)
    label_font = load_font(20)
    for i, (frame_number, image) in enumerate(tiles):
        x = (i % cols) * tile_w
        y = (i // cols) * (tile_h + 28)
        sheet.paste(image.resize((tile_w, tile_h), Image.LANCZOS), (x, y))
        draw.text((x + 8, y + tile_h + 4), f"F{frame_number}", font=label_font, fill=(40, 40, 40))
    sheet.save(out_path, quality=88)
    print(out_path)


if __name__ == "__main__":
    sys.exit(main())
