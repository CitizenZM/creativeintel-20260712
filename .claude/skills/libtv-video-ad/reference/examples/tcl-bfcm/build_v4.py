"""v4 composites: straight-front references that show the real ultra-narrow bezels (QM7L_01 / QM8L_01),
Van Gogh's Sunflowers (public domain) as the QM8L art-mode picture, and rebuilt TV end cards."""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build.py')).read().split('os.makedirs(O, exist_ok=True)')[0])  # helpers only; don't rebuild v3 stills

# Screen rectangles measured from the renders' pixel profiles (frame line is 3–7 px wide).
QM7L_SCREEN = (58, 418, 1942, 1488)     # QM7L_01.png, black background
QM8L_SCREEN = (261, 708, 2742, 2104)    # QM8L_01.png, white background

def tv_cutout(img, screen, bg_dark):
    """Alpha = the filled screen+frame rectangle plus the stand (anything off the background colour)."""
    a = np.asarray(img.convert("RGB")).astype(int); lum = a.mean(-1)
    keep = (lum > 14) if bg_dark else (lum < 238)
    x0, y0, x1, y1 = screen; keep[y0 - 8:y1 + 18, x0 - 8:x1 + 8] = True
    m = Image.fromarray(np.where(keep, 255, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
    out = img.convert("RGBA"); out.putalpha(m); return out.crop(out.getbbox())

village = Image.open(f"{S}/SC1_village.jpg"); sun = Image.open(f"{S}/SC9_sunflowers_bleed.jpg")  # art mode is full-screen
q7 = put_screen(Image.open(f"{R}/QM7L/QM7L_01.png"), QM7L_SCREEN, village)
q8 = put_screen(Image.open(f"{R}/QM8L/QM8L_01.png"), QM8L_SCREEN, sun, sheen=False)
# References: TV centred on a neutral wall-grey canvas, whole frame visible, no printed text.
for name, img, scr, dark in [("REF_QM7L_v4", q7, QM7L_SCREEN, True), ("REF_QM8L_v4", q8, QM8L_SCREEN, False)]:
    cut = tv_cutout(img, scr, dark); can = Image.new("RGBA", (2000, 1400), (206, 202, 196, 255))
    s = 1800 / cut.width; cut = cut.resize((1800, round(cut.height * s)), Image.LANCZOS); can.alpha_composite(cut, (100, (1400 - cut.height) // 2))
    can.convert("RGB").save(f"{O}/{name}.jpg", quality=93)
# Sunflowers art-mode close-up reference (top-right corner, for the ZeroBorder shot)
q8b = put_screen(Image.open(f"{R}/QM8L/QM8L_01.png"), QM8L_SCREEN, Image.open(f"{S}/SC9_sunflowers_bleed.jpg"), sheen=False)
c = q8b.crop((QM8L_SCREEN[2] - 1100, QM8L_SCREEN[1] - 160, QM8L_SCREEN[2] + 120, QM8L_SCREEN[1] + 700)); c.save(f"{O}/REF_QM8L_corner.jpg", quality=93)
# End-card fronts
for name, img, scr, dark in [("END_QM7L_front", q7, QM7L_SCREEN, True), ("END_QM8L_front", q8, QM8L_SCREEN, False)]:
    can, _ = place(holiday_bg(), tv_cutout(img, scr, dark), 1000, 760); can.convert("RGB").save(f"{O}/{name}.jpg", quality=92)
print("ok", sorted(f for f in os.listdir(O) if "v4" in f or "corner" in f or f.startswith("END_QM")))

# Per-shot references: the same front render with that shot's picture already on screen (refImageUrl).
def ref_canvas(img, scr, dark):
    cut = tv_cutout(img, scr, dark); can = Image.new("RGBA", (2000, 1400), (206, 202, 196, 255))
    cut = cut.resize((1800, round(cut.height * 1800 / cut.width)), Image.LANCZOS); can.alpha_composite(cut, (100, (1400 - cut.height) // 2)); return can.convert("RGB")
for tag, sc in [("village", "SC1_village.jpg"), ("kart", "SC2_kart.jpg"), ("football", "SC3_football.jpg"), ("fireworks", "SC4_fireworks.jpg")]:
    ref_canvas(put_screen(Image.open(f"{R}/QM7L/QM7L_01.png"), QM7L_SCREEN, Image.open(f"{S}/{sc}")), QM7L_SCREEN, True).save(f"{O}/REF_QM7L_{tag}.jpg", quality=92)
for tag, sc, sheen in [("sun", "SC9_sunflowers_bleed.jpg", False), ("football", "SC3_football.jpg", True), ("fireplace", "SC7_fireplace.jpg", True), ("moon", "SC6_moon.jpg", True)]:
    ref_canvas(put_screen(Image.open(f"{R}/QM8L/QM8L_01.png"), QM8L_SCREEN, Image.open(f"{S}/{sc}"), sheen=sheen), QM8L_SCREEN, False).save(f"{O}/REF_QM8L_{tag}.jpg", quality=92)
from PIL import ImageDraw
X0, Y0, X1, Y1, RAD = 236, 408, 1268, 1097, 22   # pixel-verified screen edges of NXTPAPER14_04 (landscape)
def nxt_portrait(sheet, fill=(250, 246, 236)):
    base = Image.open(f"{R}/NXTPAPER14/NXTPAPER14_04.png").convert("RGB"); w, h = X1 - X0, Y1 - Y0
    scr = Image.new("RGB", (w, h), fill)
    if sheet is not None:
        pg = sheet.convert("RGB").rotate(90, expand=True); s = min(w / pg.width, h / pg.height)
        pg = pg.resize((round(pg.width * s), round(pg.height * s)), Image.LANCZOS); scr.paste(pg, ((w - pg.width) // 2, (h - pg.height) // 2))
    m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], RAD, fill=255)
    out = base.copy(); out.paste(scr, (X0, Y0), m); return out.rotate(-90, expand=True, fillcolor=(255, 255, 255))
nxt_portrait(Image.open(f"{S}/SC10_sketch.jpg"), fill=(246, 244, 238)).save(f"{O}/REF_NXT_sketch.jpg", quality=92)
nxt_portrait(None, fill=(30, 32, 36)).save(f"{O}/REF_NXT_dark.jpg", quality=92)
print("refs ok")
