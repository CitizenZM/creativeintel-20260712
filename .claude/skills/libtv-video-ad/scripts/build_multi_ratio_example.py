#!/usr/bin/env python3
"""TCL US — vertical ads with one hero product each and real screen content.

  game    hero: QM8L TV      · support: S55H sound bar, 60 XE phone   · sports night
  race    hero: QM7L TV      · support: 60 XE phone                   · racing game night
  tablet  hero: NXTPAPER 14  · support: 60 XE phone, QM7L TV          · movie night anywhere

Screens never stay blank: original content made for this campaign (a racing-game look, a
fictional stadium broadcast, a 3D animated short, a kid's drawing) is composited into the TV,
tablet and phone panels. Product bodies are always the official photos.

Every cut sits on the measured beat grid of the ad's track. Generated clips are 9:16; they get
their screen content at 9:16 and are then centre-cropped, while plates and end cards are laid out
natively for each aspect ratio so no text is ever cropped.

Usage:
  python3 build_tcl15.py --ad game|race|tablet [--dur 15|10] [--ratio 9x16|4x5|1x1] [--still]
"""

import argparse
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

import screens

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
FONTS = HERE.parent / "mixik/assets/fonts"
CLIPS = HERE / "clips"
KEYS = HERE / "keyframes"
SRC_W, SRC_H = 1080, 1920          # generated clips and screen ROIs live in this frame
W, H, FPS = 1080, 1920, 30         # output frame; H changes with --ratio
RATIOS = {"9x16": 1920, "4x5": 1350, "1x1": 1080}

PROMO_RED = (191, 0, 8)
INK = (10, 10, 10)
PAPER = (255, 255, 255)

TRACK = {"game": "black-friday-techno-fest-vibes",
         "race": "halloween-dark-shadows",
         "tablet": "launch-your-breath"}

PANEL = {                                  # screen rect / quad inside the official product photo
    "qm8l": ("rect", (12, 12, 1650, 918)),
    "qm7l": ("rect", (10, 10, 1376, 762)),
    "tab14": ("quad", [(228, 140), (1118, 104), (1148, 846), (252, 884)]),
}


def font(size, weight=700):
    f = ImageFont.truetype(str(FONTS / "Archivo[wdth,wght].ttf"), size)
    try:
        f.set_variation_by_axes([100, weight])
    except Exception:
        pass
    return f


def ease_out_back(t):
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def fit(im, bw, bh):
    s = min(bw / im.width, bh / im.height)
    return im.resize((max(int(im.width * s), 1), max(int(im.height * s), 1)), Image.LANCZOS)


def extract(clip: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(clip), "-vf",
                    f"fps={FPS},scale={SRC_W}:{SRC_H}:force_original_aspect_ratio=increase,"
                    f"crop={SRC_W}:{SRC_H}", "-q:v", "3", str(out_dir / "f%04d.jpg")], check=True)
    return sorted(out_dir.glob("f*.jpg"))


def beats_of(track, dur):
    if dur == 15:
        return [float(x) for x in (ASSETS / f"music/{track}_15s.beats.txt").read_text().split()]
    ten = {  # 10s windows measured with aubio (same starts as the 10s cuts)
        "halloween-dark-shadows": [0.00, 0.49, 0.98, 1.47, 1.97, 2.46, 2.95, 3.44, 3.93, 4.42,
                                   4.91, 5.40, 5.90, 6.39, 6.88, 7.37, 7.86, 8.35, 8.84, 9.33, 9.83],
        "black-friday-techno-fest-vibes": [0.00, 0.48, 0.95, 1.43, 1.91, 2.38, 2.86, 3.34, 3.82,
                                           4.29, 4.77, 5.25, 5.72, 6.20, 6.68, 7.15, 7.63, 8.11,
                                           8.58, 9.06, 9.54],
        "launch-your-breath": [0.00, 0.49, 0.99, 1.48, 1.97, 2.46, 2.96, 3.45, 3.94, 4.43, 4.93,
                               5.42, 5.91, 6.41, 6.90, 7.39, 7.88, 8.38, 8.87, 9.36, 9.85],
    }
    return ten[track]


class Build:
    def __init__(self, ad, frames):
        self.ad = ad
        self.frames = frames
        self.quads = {}
        self.logo = Image.open(ASSETS / "brand/logo-1200.png").convert("RGBA")
        self.prod = {k: Image.open(ASSETS / p).convert("RGBA") for k, p in {
            "qm8l": "products/QM8L/hero.png", "qm7l": "products/QM7L/hero.png",
            "tab14": "products/NXTPAPER14-9491G/hero.png", "s55h": "products/S55H/cut.png",
            "p60xe": "products/60XE/cut.png"}.items()}
        self.content = {k: Image.open(KEYS / f"SC-{k}.png").convert("RGB")
                        for k in ("race", "sports", "anim", "draw")}
        self.tall = H >= 1600                       # 9:16 keeps full layout; 4:5 and 1:1 compact

    # ---------- content with motion inside the panel ----------
    def content_at(self, key, t, speed=0.035, zoom=1.12):
        c = self.content[key]
        z = zoom + 0.05 * math.sin(t * 0.6)
        cw, ch = int(c.width / z), int(c.height / z)
        x = int((c.width - cw) * min(max(0.5 + speed * (t - 2), 0), 1))
        y = int((c.height - ch) * 0.5)
        return c.crop((x, y, x + cw, y + ch))

    # ---------- plates ----------
    def bg(self, kind):
        im = Image.new("RGB", (W, H), PAPER)
        d = ImageDraw.Draw(im)
        if kind == "dark":
            for y in range(H):
                u = y / H
                d.line((0, y, W, y), fill=(int(10 + 12 * u), int(10 + 10 * u), int(14 + 18 * u)))
            glow = Image.new("RGB", (W, H), (0, 0, 0))
            ImageDraw.Draw(glow).ellipse((-150, int(H * 0.23), 1230, int(H * 0.75)), fill=(60, 25, 40))
            im = ImageChops.screen(im, glow.filter(ImageFilter.GaussianBlur(190)))
        else:
            for y in range(H):
                u = y / H
                d.line((0, y, W, y), fill=(int(255 - 9 * u), int(253 - 11 * u), int(252 - 7 * u)))
        return im

    def _device(self, key, content_key, t):
        prod = self.prod[key].copy()
        kind, geo = PANEL[key]
        cont = self.content_at(content_key, t)
        rgb = (screens.paste_rect(prod.convert("RGB"), cont, geo, glow=0.25) if kind == "rect"
               else screens.paste_quad(prod.convert("RGB"), cont, geo))
        return Image.merge("RGBA", (*rgb.split(), prod.split()[3]))

    def device_plate(self, key, content_key, t, dark=False, headline=None, sub=None, price=None,
                     reg=None, badge=None, zoom=1.0):
        im = self.bg("dark" if dark else "light")
        # layout as fractions of H; compact ratios pull everything closer together
        L = (dict(prod_y=0.40, prod_h=0.42, badge=0.12, head=0.63, sub=0.695, price=0.78, reg=0.835)
             if self.tall else
             dict(prod_y=0.33, prod_h=0.44, badge=0.07, head=0.64, sub=0.72, price=0.83, reg=0.915))
        prod = fit(self._device(key, content_key, t), int(W * 0.92 * zoom), int(H * L["prod_h"] * zoom))
        px, py = (W - prod.width) // 2, int(H * L["prod_y"]) - prod.height // 2
        sh = Image.new("L", (W, H), 0)
        ImageDraw.Draw(sh).ellipse((px + 50, py + prod.height - 26, px + prod.width - 50,
                                    py + prod.height + 54), fill=95)
        im = Image.composite(Image.new("RGB", (W, H), (110, 105, 115)), im,
                             sh.filter(ImageFilter.GaussianBlur(38)))
        im.paste(prod, (px, py), prod)
        fg = PAPER if dark else INK
        s = 1.0 if self.tall else 0.82
        if badge:
            self.badge(im, badge, (W // 2, int(H * L["badge"])), font(int(48 * s), 800))
        if headline:
            self.text(im, headline, (W // 2, int(H * L["head"])), font(int(76 * s), 800), fg)
        if sub:
            self.text(im, sub, (W // 2, int(H * L["sub"])), font(int(38 * s), 500), fg)
        if price:
            self.text(im, price, (W // 2, int(H * L["price"])), font(int(100 * s), 800),
                      PROMO_RED if not dark else (255, 95, 95))
        if reg:
            self.struck(im, reg, (W // 2, int(H * L["reg"])), font(int(40 * s), 500), fg)
        return im

    def full_content(self, key, t, label=None, label_at=None):
        c = self.content_at(key, t, zoom=1.25)
        s = max(W / c.width, H / c.height)
        im = c.resize((int(c.width * s) + 1, int(c.height * s) + 1), Image.LANCZOS)
        im = im.crop(((im.width - W) // 2, (im.height - H) // 2,
                      (im.width - W) // 2 + W, (im.height - H) // 2 + H))
        if label and (label_at is None or t >= label_at):
            k = 1.0 if label_at is None else min((t - label_at) / 0.18, 1.0)
            f = font(96, 800)
            layer = Image.new("RGBA", (W, 220), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            bb = d.textbbox((0, 0), label, font=f)
            while bb[2] - bb[0] > W * 0.9 and f.size > 40:
                f = font(f.size - 4, 800)
                bb = d.textbbox((0, 0), label, font=f)
            d.text((W // 2, 110), label, font=f, fill=PAPER, anchor="mm", stroke_width=6,
                   stroke_fill=(0, 0, 0))
            sc = 0.7 + 0.3 * ease_out_back(k)
            lw, lh = int(W * sc), int(220 * sc)
            lay = layer.resize((lw, lh), Image.LANCZOS)
            im.paste(lay, ((W - lw) // 2, int(H * 0.14)), lay)
        return im

    def clip(self, name, t_src, content_key=None):
        fr = self.frames[name]
        img = Image.open(fr[min(max(int(t_src * FPS), 0), len(fr) - 1)]).convert("RGB")
        if content_key and name in screens.ROI:
            roi, lum, sat = screens.ROI[name]
            img, q = screens.replace_screen(img, self.content_at(content_key, t_src), roi,
                                            self.quads.get(name), lum=lum, sat=sat)
            self.quads[name] = q
        if H != SRC_H:                              # centre-crop the 9:16 clip to the target ratio
            y0 = (SRC_H - H) // 2
            img = img.crop((0, y0, W, y0 + H))
        return img

    def text(self, im, s, xy, f, fill, anchor="mm"):
        ImageDraw.Draw(im).text(xy, s, font=f, fill=fill, anchor=anchor)

    def struck(self, im, s, xy, f, fill):
        d = ImageDraw.Draw(im)
        bb = d.textbbox(xy, s, font=f, anchor="mm")
        d.text(xy, s, font=f, fill=fill, anchor="mm")
        d.line((bb[0] - 6, (bb[1] + bb[3]) // 2, bb[2] + 6, (bb[1] + bb[3]) // 2), fill=fill, width=3)

    def badge(self, im, s, xy, f, bg=PROMO_RED, fg=PAPER, pad=(26, 14)):
        d = ImageDraw.Draw(im)
        bb = d.textbbox((0, 0), s, font=f)
        while bb[2] - bb[0] + pad[0] * 2 > W * 0.88 and f.size > 22:
            f = font(f.size - 4, 800)
            bb = d.textbbox((0, 0), s, font=f)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        x, y = xy
        d.rounded_rectangle((x - w // 2 - pad[0], y - h // 2 - pad[1],
                             x + w // 2 + pad[0], y + h // 2 + pad[1]), radius=10, fill=bg)
        d.text((x, y), s, font=f, fill=fg, anchor="mm")

    def support_card(self, key, headline, price, reg, dark=False):
        im = self.bg("dark" if dark else "light")
        tall = self.tall
        prod = fit(self.prod[key], int(W * 0.7), int(H * (0.26 if tall else 0.34)))
        im.paste(prod, ((W - prod.width) // 2, int(H * (0.34 if tall else 0.30)) - prod.height // 2), prod)
        fg = PAPER if dark else INK
        s = 1.0 if tall else 0.85
        self.text(im, headline, (W // 2, int(H * (0.56 if tall else 0.60))), font(int(64 * s), 800), fg)
        self.text(im, price, (W // 2, int(H * (0.65 if tall else 0.73))), font(int(88 * s), 800),
                  PROMO_RED if not dark else (255, 95, 95))
        self.struck(im, reg, (W // 2, int(H * (0.71 if tall else 0.83))), font(int(38 * s), 500), fg)
        return im

    def end_card(self, key, content_key, t, t0, save_line, cta, dark=False):
        im = self.bg("dark" if dark else "light")
        L = (dict(prod_y=0.29, prod_h=0.28, badge=0.50, cta=0.60, logo=0.685, url=0.80, legal=0.88)
             if self.tall else
             dict(prod_y=0.23, prod_h=0.34, badge=0.46, cta=0.56, logo=0.63, url=0.80, legal=0.93))
        prod = self._device(key, content_key, t) if key in PANEL else self.prod[key]
        prod = fit(prod, int(W * 0.80), int(H * L["prod_h"]))
        im.paste(prod, ((W - prod.width) // 2, int(H * L["prod_y"]) - prod.height // 2), prod)
        fg = PAPER if dark else INK
        s = 1.0 if self.tall else 0.85
        if t >= t0:
            self.badge(im, save_line, (W // 2, int(H * L["badge"])), font(int(56 * s), 800))
        if t >= t0 + 0.2:
            self.text(im, cta, (W // 2, int(H * L["cta"])), font(int(70 * s), 800), fg)
        if t >= t0 + 0.35:
            lg = fit(self.logo, int(W * 0.34), int(H * (0.085 if self.tall else 0.10)))
            if dark:
                white = Image.new("RGBA", lg.size, (255, 255, 255, 255))
                white.putalpha(lg.split()[3])
                lg = white
            im.paste(lg, ((W - lg.width) // 2, int(H * L["logo"])), lg)
            self.text(im, "us.tcl.com", (W // 2, int(H * L["url"])), font(int(58 * s), 700), fg)
        self.text(im, "While supplies last. Features vary by screen size.",
                  (W // 2, int(H * L["legal"])), font(26, 400), (150, 150, 150) if not dark else (170, 170, 170))
        return im


def timeline(ad, B, b, dur):
    """Return frame_at(t) and the set of whip-transition beats."""
    if dur == 15:
        def game(t):
            if t < b[4]:  return B.full_content("sports", t, "GAME NIGHT", b[2])
            if t < b[8]:  return B.device_plate("qm8l", "sports", t, dark=True,
                                                headline="4K SQD-Mini LED", sub="144Hz · Dolby Vision")
            if t < b[12]: return B.clip("V-P1 cheer", 0.4 + (t - b[8]))
            if t < b[14]: return B.full_content("sports", t)
            if t < b[18]: return B.clip("V-P1 cheer", 2.6 + (t - b[14]))
            if t < b[20]: return B.clip("V-B2 photo", 1.2 + (t - b[18]), content_key="sports")
            if t < b[24]: return B.device_plate("qm8l", "sports", t, dark=True, badge="SAVE $1,100",
                                                price="From $1,399.99", reg="Reg. $2,499.99")
            if t < b[26]: return B.support_card("s55h", "Add Dolby Atmos", "$119.99", "Reg. $199.99", dark=True)
            return B.end_card("qm8l", "sports", t, b[26], "SAVE $1,100", "Shop Best Sellers", dark=True)

        def race(t):
            if t < b[4]:  return B.full_content("race", t, "RACE NIGHT", b[2])
            if t < b[8]:  return B.device_plate("qm7l", "race", t, dark=True,
                                                headline="144Hz native", sub="288Hz Game Accelerator*")
            if t < b[12]: return B.clip("V-P2 game", 0.5 + (t - b[8]))
            if t < b[14]: return B.full_content("race", t)
            if t < b[18]: return B.clip("V-P2 game", 2.8 + (t - b[14]))
            if t < b[20]: return B.clip("V-C2 tap", 1.0 + (t - b[18]), content_key="race")
            if t < b[24]: return B.device_plate("qm7l", "race", t, dark=True, badge="SAVE $400",
                                                price="From $799.99", reg="Reg. $1,199.99")
            if t < b[26]: return B.support_card("p60xe", "Second screen", "$229.99", "Reg. $284.99", dark=True)
            return B.end_card("qm7l", "race", t, b[26], "SAVE $400", "Shop Best Sellers", dark=True)

        def tablet(t):
            if t < b[4]:  return B.full_content("anim", t, "MOVIE NIGHT, ANYWHERE", b[2])
            if t < b[8]:  return B.clip("V-P3 watch", 0.6 + (t - b[4]))
            if t < b[12]: return B.clip("V-A3 swipe", 0.8 + (t - b[8]), content_key="anim")
            if t < b[16]: return B.clip("V-C1 write", 1.0 + (t - b[12]), content_key="draw")
            if t < b[20]: return B.device_plate("tab14", "anim", t, headline="14.3\" NXTPAPER display",
                                                sub="Stylus + flip case included", price="$379.99",
                                                reg="Reg. $469.99")
            if t < b[22]: return B.clip("V-C2 tap", 1.4 + (t - b[20]), content_key="anim")
            if t < b[26]: return B.device_plate("qm7l", "anim", t, headline="…or on the big screen",
                                                sub="QM7L 4K SQD-Mini LED", zoom=0.95)
            return B.end_card("tab14", "anim", t, b[26], "SAVE $90", "Shop Best Sellers")
        whips = {b[4], b[8], b[12], b[18], b[24]}
    else:
        # 10s cutdown: hook → hero with content → people → second screen → price → end card
        def game(t):
            if t < b[4]:  return B.full_content("sports", t, "GAME NIGHT", b[2])
            if t < b[6]:  return B.device_plate("qm8l", "sports", t, dark=True,
                                                headline="4K SQD-Mini LED", sub="144Hz · Dolby Vision")
            if t < b[10]: return B.clip("V-P1 cheer", 0.6 + (t - b[6]))
            if t < b[12]: return B.clip("V-B2 photo", 1.2 + (t - b[10]), content_key="sports")
            if t < b[16]: return B.device_plate("qm8l", "sports", t, dark=True, badge="SAVE $1,100",
                                                price="From $1,399.99", reg="Reg. $2,499.99")
            return B.end_card("qm8l", "sports", t, b[16], "SAVE $1,100", "Shop Best Sellers", dark=True)

        def race(t):
            if t < b[4]:  return B.full_content("race", t, "RACE NIGHT", b[2])
            if t < b[6]:  return B.device_plate("qm7l", "race", t, dark=True,
                                                headline="144Hz native", sub="288Hz Game Accelerator*")
            if t < b[10]: return B.clip("V-P2 game", 0.6 + (t - b[6]))
            if t < b[12]: return B.clip("V-C2 tap", 1.0 + (t - b[10]), content_key="race")
            if t < b[16]: return B.device_plate("qm7l", "race", t, dark=True, badge="SAVE $400",
                                                price="From $799.99", reg="Reg. $1,199.99")
            return B.end_card("qm7l", "race", t, b[16], "SAVE $400", "Shop Best Sellers", dark=True)

        def tablet(t):
            if t < b[4]:  return B.full_content("anim", t, "MOVIE NIGHT, ANYWHERE", b[2])
            if t < b[6]:  return B.clip("V-P3 watch", 0.8 + (t - b[4]))
            if t < b[10]: return B.clip("V-A3 swipe", 0.8 + (t - b[6]), content_key="anim")
            if t < b[12]: return B.clip("V-C1 write", 1.2 + (t - b[10]), content_key="draw")
            if t < b[16]: return B.device_plate("tab14", "anim", t, headline="14.3\" NXTPAPER display",
                                                sub="Stylus + flip case included", price="$379.99",
                                                reg="Reg. $469.99")
            return B.end_card("tab14", "anim", t, b[16], "SAVE $90", "Shop Best Sellers")
        whips = {b[4], b[6], b[10], b[12]}
    return {"game": game, "race": race, "tablet": tablet}[ad], whips


def build(ad, dur, ratio, still):
    global H
    H = RATIOS[ratio]
    track = TRACK[ad]
    b = beats_of(track, dur)
    need = {"game": ["V-P1 cheer", "V-B2 photo"],
            "race": ["V-P2 game", "V-C2 tap"],
            "tablet": ["V-P3 watch", "V-A3 swipe", "V-C1 write", "V-C2 tap"]}[ad]
    out_dir = HERE / "deliver" / ad
    out_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp())
    try:
        B = Build(ad, {})
        if still:                                   # static key visual = fully revealed end card
            name = {"game": ("qm8l", "sports", "SAVE $1,100", True),
                    "race": ("qm7l", "race", "SAVE $400", True),
                    "tablet": ("tab14", "anim", "SAVE $90", False)}[ad]
            img = B.end_card(name[0], name[1], 20.0, 0.0, name[2], "Shop Best Sellers", dark=name[3])
            p = out_dir / f"TCL-{ad}-still-{ratio}.png"
            img.save(p)
            print(p)
            return
        B.frames = {n: extract(CLIPS / f"{n}.mp4", work / n.replace(" ", "_")) for n in need}
        frame_at, whips = timeline(ad, B, b, dur)
        seq = work / "seq"
        seq.mkdir()
        for i in range(int(dur * FPS)):
            t = i / FPS
            f = frame_at(t)
            for wt in whips:
                if 0 <= wt - t < 0.10:
                    f = f.filter(ImageFilter.BoxBlur(int(2 + 30 * (1 - (wt - t) / 0.10))))
            f.save(seq / f"f{i:04d}.jpg", quality=92)
        out = out_dir / f"TCL-{ad}-{dur}s-{ratio}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i",
                        str(seq / "f%04d.jpg"), "-i", str(ASSETS / f"music/{track}_{dur}s.m4a"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-c:a", "aac",
                        "-b:a", "192k", "-t", str(dur), "-shortest", str(out)], check=True)
        print(out)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ad", choices=["game", "race", "tablet"], required=True)
    ap.add_argument("--dur", type=int, choices=[15, 10], default=15)
    ap.add_argument("--ratio", choices=list(RATIOS), default="9x16")
    ap.add_argument("--still", action="store_true")
    a = ap.parse_args()
    build(a.ad, a.dur, a.ratio, a.still)
