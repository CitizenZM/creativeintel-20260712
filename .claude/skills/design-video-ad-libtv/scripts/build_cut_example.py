#!/usr/bin/env python3
"""A1 Hydra Cream (30 ml) — bright K-pop dance cut.

Fixes on the stage version: the first frame is already bright and the product is
pushed at the lens inside the first half second; every clip is real choreography
(hip pops, body roll, lunges, turns, hair flips) on a high-key white stage.

Timeline locked to "Take This Higher" (125.83 BPM, 15s window from 25.029s):
groove 0–1.95 · breakdown 1.95–3.87 · DROP 3.87→.

Usage: python3 build_bright.py --version led|prism|clean
"""

import argparse
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
BRAND = HERE.parents[1]
ASSETS = BRAND / "assets"
CAMP = HERE.parent
W, H, FPS, DUR = 1080, 1920, 30, 15.0
CREAM = (255, 246, 238)
NEON = (255, 79, 163)
CYAN = (120, 230, 255)
INK = (29, 48, 13)

BEATS = [0.00, 0.50, 0.97, 1.45, 1.95, 2.43, 2.91, 3.39, 3.87, 4.34, 4.74, 5.21, 5.69, 6.19,
         6.66, 7.14, 7.62, 8.37, 8.85, 9.33, 9.81, 10.29, 10.78, 11.26, 11.74, 12.23, 12.71,
         13.18, 13.69, 14.16, 14.64]
SECTION_CHANGES = (1.95, 3.87)

CLIPS = {
    "d1": CAMP / "clips-bright/D1 product push dance.mp4",   # bottle at the lens, then hip pops
    "d2": CAMP / "clips-bright/D2 full body dance.mp4",      # full-body choreography
    "d3": CAMP / "clips-bright/D3 duo formation dance.mp4",  # duo + backup dancers
    "d4": CAMP / "clips-bright/D4 bright spray.mp4",
    "d5": CAMP / "clips-bright/D5 bright hero.mp4",
}

# (start, end, clip, source-start, rate) — every boundary is a beat
EDIT = [
    (0.00, 0.97, "d1", 0.00, 1.0),    # product pushed at the lens from frame one
    (0.97, 1.95, "d1", 1.10, 1.0),    # pull back into hip pops
    (1.95, 2.91, "d5", 0.40, 0.8),    # breakdown: hero, slight slow-mo
    (2.91, 3.87, "d2", 0.30, 0.9),    # build: full-body move
    (3.87, 4.74, "d3", 1.10, 1.15),   # DROP: group formation
    (4.74, 5.21, "d2", 2.60, 1.2),    # turn
    (5.21, 5.69, "insert", 0.0, 1.0), # real bottle insert
    (5.69, 6.66, "d3", 2.60, 1.0),
    (6.66, 7.62, "d4", 0.60, 1.0),    # spray
    (7.62, 8.37, "d2", 4.10, 1.0),    # body roll / hair flip
    (8.37, 9.33, "d5", 2.20, 1.0),
    (9.33, 10.29, "d3", 4.20, 1.0),
    (10.29, 11.26, "d1", 3.40, 1.0),
    (11.26, 11.74, "insert2", 0.0, 1.0),
]
WHIP_AT = (1.95, 3.87, 5.69, 9.33, 11.26)
STROBE_AT = (3.87, 4.74)


def extract(clip: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-i", str(clip),
        "-vf", f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
        "-q:v", "3", str(out_dir / "f%04d.jpg"),
    ], check=True)
    return sorted(out_dir.glob("f*.jpg"))


def ease_out_back(t):
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def zoom(im, scale, cx=0.5, cy=0.5):
    if scale <= 1.001:
        return im
    w, h = W / scale, H / scale
    x = min(max(cx * W - w / 2, 0), W - w)
    y = min(max(cy * H - h / 2, 0), H - h)
    return im.crop((x, y, x + w, y + h)).resize((W, H), Image.BILINEAR)


class Build:
    def __init__(self, version, frames):
        self.version = version
        self.frames = frames
        self.slogan_font = ImageFont.truetype(str(ASSETS / "fonts/TitanOne-Regular.ttf"), 96)
        self.cta_font = ImageFont.truetype(str(ASSETS / "fonts/TitanOne-Regular.ttf"), 190)
        self.small_font = ImageFont.truetype(str(ASSETS / "fonts/Manrope[wght].ttf"), 46)
        self.bottle = Image.open(ASSETS / "cutouts/hydra-cream-mini.png").convert("RGBA")
        self.logo = Image.open(ASSETS / "brand/mixik-logo-forestgreen.png").convert("RGBA")
        self.logo.thumbnail((720, 380))
        self.plate = self._bright_plate()

    def _bright_plate(self):
        """High-key studio plate: pastel wall gradient + glossy white floor."""
        bg = Image.new("RGB", (W, H))
        d = ImageDraw.Draw(bg)
        for y in range(H):
            u = y / H
            if u < 0.72:
                k = u / 0.72
                c = (int(255 - 8 * k), int(242 + 6 * k), int(250 - 2 * k))
                if k > 0.5:
                    c = (int(c[0] - 6 * (k - 0.5)), c[1], int(c[2] + 4 * (k - 0.5)))
            else:
                k = (u - 0.72) / 0.28
                c = (int(250 - 14 * k), int(248 - 14 * k), int(252 - 12 * k))
            d.line((0, y, W, y), fill=c)
        glow = Image.new("RGB", (W, H), (0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse((-200, 150, 620, 900), fill=(255, 190, 220))
        gd.ellipse((560, 260, 1360, 1000), fill=(170, 225, 255))
        return ImageChops.screen(bg, glow.filter(ImageFilter.GaussianBlur(180)))

    def clip(self, key, t_src):
        fr = self.frames[key]
        i = min(max(int(t_src * FPS), 0), len(fr) - 1)
        return Image.open(fr[i]).convert("RGB")

    def insert(self, t, t0, small=False, sweep=True):
        f = self.plate.copy()
        b = self.bottle.copy()
        h = 520 if small else 980
        b = b.resize((int(b.width * h / b.height), h), Image.LANCZOS)
        top = 1250 if small else (H - h) // 2 - 60
        x = W // 2 - b.width // 2
        sh = Image.new("L", (W, H), 0)
        ImageDraw.Draw(sh).ellipse((x - 60, top + h - 30, x + b.width + 60, top + h + 60), fill=90)
        f = Image.composite(Image.new("RGB", (W, H), (190, 180, 200)), f, sh.filter(ImageFilter.GaussianBlur(30)))
        refl = b.transpose(Image.FLIP_TOP_BOTTOM).resize((b.width, int(h * 0.35)))
        ra = refl.split()[3].point(lambda v: int(v * 0.18))
        refl.putalpha(ra)
        f.paste(refl, (x, top + h + 6), refl)
        f.paste(b, (x, top), b)
        if sweep:
            k = min(max((t - t0) / 0.48, 0), 1)
            sweep_l = Image.new("L", (W, H), 0)
            sx = int(-300 + 1600 * k)
            ImageDraw.Draw(sweep_l).polygon([(sx, 0), (sx + 150, 0), (sx + 380, H), (sx + 230, H)], fill=120)
            sweep_l = sweep_l.filter(ImageFilter.GaussianBlur(46))
            f = Image.composite(Image.new("RGB", (W, H), (255, 255, 255)), f, sweep_l.point(lambda v: int(v * 0.5)))
        return f

    def slogan(self, frame, t, t_in):
        if t < t_in:
            return
        k = min((t - t_in) / 0.16, 1.0)
        layer = Image.new("RGBA", (W, 300), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for j, line in enumerate(["shine like", "a k-pop star"]):
            bb = d.textbbox((0, 0), line, font=self.slogan_font)
            d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], 20 + j * 130 - bb[1]), line,
                   font=self.slogan_font, fill=CREAM, stroke_width=8, stroke_fill=NEON)
        s = 0.78 + 0.22 * ease_out_back(k)
        lw, lh = int(W * s), int(300 * s)
        layer = layer.resize((lw, lh), Image.LANCZOS)
        frame.paste(layer, ((W - lw) // 2, 250), layer)

    def cta(self, frame, t):
        for word, bt, cy in (("buy", 11.74, 430), ("it", 12.23, 660), ("now", 12.71, 890)):
            if t < bt:
                continue
            k = min((t - bt) / 0.16, 1.0)
            layer = Image.new("RGBA", (W, 300), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            bb = d.textbbox((0, 0), word, font=self.cta_font)
            d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], (300 - (bb[3] - bb[1])) // 2 - bb[1]), word,
                   font=self.cta_font, fill=CREAM, stroke_width=10, stroke_fill=NEON)
            s = 0.5 + 0.5 * ease_out_back(k)
            lw, lh = int(W * s), int(300 * s)
            lay = layer.resize((lw, lh), Image.LANCZOS)
            frame.paste(lay, ((W - lw) // 2, cy - lh // 2), lay)

    def caption(self, frame, text, y=1560):
        d = ImageDraw.Draw(frame)
        bb = d.textbbox((0, 0), text, font=self.small_font)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        x, pad = (W - w) // 2, 22
        d.rounded_rectangle((x - pad, y - pad, x + w + pad, y + h + pad + 6), radius=26, fill=(255, 255, 255))
        d.text((x - bb[0], y - bb[1]), text, font=self.small_font, fill=INK)

    def led_wash(self, frame, t):
        last = max([b for b in BEATS if b <= t] or [0])
        phase = min((t - last) / 0.35, 1.0)
        strength = 0.22 * (1 - phase) + (0.18 if any(abs(t - s) < 0.5 for s in SECTION_CHANGES) else 0)
        if strength < 0.02:
            return frame
        grad = Image.new("RGB", (W, H))
        top, bot = (CYAN, NEON) if int(t * 2) % 2 == 0 else (NEON, CYAN)
        d = ImageDraw.Draw(grad)
        for y in range(H):
            u = y / H
            d.line((0, y, W, y), fill=tuple(int(top[i] + (bot[i] - top[i]) * u) for i in range(3)))
        return Image.blend(frame, ImageChops.multiply(frame, grad.point(lambda v: 128 + v // 2)), min(strength, 0.4))

    def prism(self, frame, strength):
        if strength <= 0.02:
            return frame
        out = frame.copy()
        for i, ang in enumerate((6, -6, 12)):
            rot = frame.rotate(ang * strength, resample=Image.BILINEAR, center=(W / 2, H / 2))
            rot = ImageChops.offset(rot, int(36 * strength * (i + 1)), 0)
            out = ImageChops.blend(out, ImageChops.lighter(out, rot), 0.4 * strength)
        r, g, b = out.split()
        return Image.merge("RGB", (ImageChops.offset(r, int(12 * strength), 0), g,
                                   ImageChops.offset(b, -int(12 * strength), 0)))

    def frame_at(self, t):
        for a, b, key, src, rate in EDIT:
            if t < b:
                if key == "insert":
                    f = self.insert(t, a)
                elif key == "insert2":
                    f = self.insert(t, a, sweep=False)
                    self.caption(f, "30 ml · Ceramide NP + Squalane")
                else:
                    f = self.clip(key, src + (t - a) * rate)
                if 2.43 <= t < 3.87:
                    self.slogan(f, t, 2.43)
                whip = max((t - (b - 0.10)) / 0.10, 0) if b in WHIP_AT else 0
                prism = (1 - (t - a) / 0.22) if (a in STROBE_AT and t - a < 0.22) else 0
                return f, whip, prism
        if t < 13.69:
            f = self.insert(min(t, 12.4), 11.74, small=True, sweep=False)
            self.cta(f, t)
            return f, 0, 0
        f = Image.new("RGB", (W, H), CREAM)
        if t >= 14.16:
            k = min((t - 14.16) / 0.2, 1.0)
            s = 0.35 + 0.65 * ease_out_back(k)
            pulse = 1.0 + (0.05 * (1 - (t - 14.64) / 0.2) if 14.64 <= t < 14.84 else 0)
            lw, lh = max(int(self.logo.width * s * pulse), 1), max(int(self.logo.height * s * pulse), 1)
            lg = self.logo.resize((lw, lh), Image.LANCZOS)
            f.paste(lg, ((W - lw) // 2, (H - lh) // 2), lg)
        return f, 0, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", choices=["led", "prism", "clean"], default="led")
    args = ap.parse_args()
    out = HERE / f"final/A1-bright-15s-{args.version}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp())
    try:
        frames = {k: extract(v, work / k) for k, v in CLIPS.items()}
        b = Build(args.version, frames)
        seq = work / "seq"
        seq.mkdir()
        for i in range(int(DUR * FPS)):
            t = i / FPS
            f, whip, prism = b.frame_at(t)
            if args.version == "led":
                f = b.led_wash(f, t)
            if args.version == "prism":
                f = b.prism(f, prism)
            if whip > 0.02:
                f = f.filter(ImageFilter.BoxBlur(int(2 + 30 * whip)))
            if any(0 <= t - s < 1 / FPS for s in STROBE_AT):
                f = Image.new("RGB", (W, H), (255, 255, 255))
            f.save(seq / f"f{i:04d}.jpg", quality=92)
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(seq / "f%04d.jpg"),
            "-i", str(ASSETS / "music/kpop-take-this-higher_15s.m4a"), "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-crf", "19", "-c:a", "aac", "-b:a", "192k",
            "-t", str(DUR), "-shortest", str(out),
        ], check=True)
        prev = out.with_name("preview-" + out.stem + ".mp4")
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-i", str(out), "-vf", "scale=720:1280",
            "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-c:a", "aac", "-b:a", "96k", str(prev),
        ], check=True)
        print(out)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
