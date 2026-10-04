"""Local composites for the locked TCL BF scripts: product references, end-card stills, NXT screen stills."""
import os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S, O = f"{R}/screens", f"{R}/composites"
FONT = "/Users/barrom/Projects/creativeintel-20260712/assets/fonts/Montserrat-Bold.ttf"
W, H = 1080, 1920

def cover(img, w, h):
    s = max(w / img.width, h / img.height); im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2; return im.crop((l, t, l + w, t + h))

def put_screen(base, box, content, sheen=True):
    x0, y0, x1, y1 = box; im = base.convert("RGB").copy()
    sc = cover(content.convert("RGB"), x1 - x0, y1 - y0)
    if sheen:  # faint diagonal glass sheen so the screen reads as glass, not a flat paste
        g = Image.linear_gradient("L").rotate(35, expand=True).resize(sc.size).point(lambda v: int(v * 0.10))
        sc = Image.composite(Image.new("RGB", sc.size, (255, 255, 255)), sc, g)
    im.paste(sc, (x0, y0)); return im

def cutout(img, white=True, thr=245):
    a = np.asarray(img.convert("RGB")).astype(int); lum = a.mean(-1)
    alpha = np.where(lum > thr, 0, 255).astype(np.uint8) if white else np.where(lum < 14, 0, 255).astype(np.uint8)
    m = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.2)); out = img.convert("RGBA"); out.putalpha(m); return out

def holiday_bg(seed=3):
    random.seed(seed); bg = Image.new("RGB", (W, H), (14, 16, 20)); d = ImageDraw.Draw(bg)
    for y in range(H):  # vertical warm-to-charcoal gradient
        t = y / H; d.line([(0, y), (W, y)], fill=(int(30 - 14 * t), int(24 - 10 * t), int(22 - 6 * t)))
    bok = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(bok)
    for _ in range(70):
        r = random.randint(14, 60); x, y = random.randint(-40, W + 40), random.randint(0, H)
        c = random.choice([(255, 196, 92), (255, 150, 70), (210, 60, 50), (255, 230, 170)])
        bd.ellipse([x - r, y - r, x + r, y + r], fill=c + (random.randint(28, 70),))
    bok = bok.filter(ImageFilter.GaussianBlur(10)); bg = Image.alpha_composite(bg.convert("RGBA"), bok); return bg

def place(canvas, prod, width, cy):
    s = width / prod.width; p = prod.resize((round(prod.width * s), round(prod.height * s)), Image.LANCZOS)
    x, y = (W - p.width) // 2, round(cy - p.height / 2)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0)); ImageDraw.Draw(shadow).ellipse([x + p.width * 0.1, y + p.height * 0.94, x + p.width * 0.9, y + p.height * 1.02], fill=(0, 0, 0, 120))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.alpha_composite(p, (x, y)); return canvas, (x, y, p.width, p.height, s)

def measure(canvas, x_left, x_right, y, label):
    d = ImageDraw.Draw(canvas); gold = (255, 205, 110, 255)
    for x in (x_left, x_right): d.line([(x, y - 34), (x, y + 34)], fill=gold, width=5)
    d.line([(x_left - 70, y), (x_left, y)], fill=gold, width=4); d.line([(x_right, y), (x_right + 70, y)], fill=gold, width=4)
    for x, s in ((x_left, -1), (x_right, 1)): d.polygon([(x, y), (x + s * 22, y - 12), (x + s * 22, y + 12)], fill=gold)
    f = ImageFont.truetype(FONT, 76); d.text((x_right + 100, y), label, font=f, fill=(255, 255, 255, 255), anchor="lm", stroke_width=2, stroke_fill=(0, 0, 0, 160))
    return canvas

def side_still(src, panel, label, white, width_px=110):
    prod = Image.open(src).convert("RGB"); cut = cutout(prod, white=white)
    bbox = cut.getbbox(); cut = cut.crop(bbox)
    can = holiday_bg(7); can, (x, y, pw, ph, s) = place(can, cut, width_px * cut.width / max(1, panel[1] - panel[0]) if False else cut.width * (1150 / cut.height), 900)
    left = x + (panel[0] - bbox[0]) * s; right = x + (panel[1] - bbox[0]) * s
    return measure(can, round(left), round(right), round(y + ph * 0.28), label).convert("RGB")

os.makedirs(O, exist_ok=True)
sc = {n: Image.open(f"{S}/{n}") for n in ["SC1_village.jpg", "SC5_colorfield.jpg", "SC8_sheet_color.png", "SC8_sheet_ink.png"]}
# 1. product references (keyframe edits use these as PROD-1)
qm7l = put_screen(Image.open(f"{R}/QM7L/QM7L_09.png"), (0, 0, 1500, 986), sc["SC1_village.jpg"]); qm7l.save(f"{O}/REF_QM7L.jpg", quality=92)
qm8l = put_screen(Image.open(f"{R}/QM8L/QM8L_13.png"), (0, 0, 2000, 1284), sc["SC5_colorfield.jpg"]); qm8l.save(f"{O}/REF_QM8L.jpg", quality=92)
nxt = put_screen(Image.open(f"{R}/NXTPAPER14/NXTPAPER14_04.png"), (267, 287, 1235, 1214), sc["SC8_sheet_color.png"], sheen=False); nxt.save(f"{O}/REF_NXT.jpg", quality=92)
nxt_ink = put_screen(Image.open(f"{R}/NXTPAPER14/NXTPAPER14_04.png"), (267, 287, 1235, 1214), sc["SC8_sheet_ink.png"], sheen=False)
# 2. end-card fronts (product on a holiday background; text/price come from the edit)
bow = cutout(Image.open(f"{S}/bow.jpg"), white=True, thr=238); bow = bow.crop(bow.getbbox())
for name, img, white, wpx, cy in [("END_QM7L_front", qm7l, True, 1000, 760), ("END_QM8L_front", qm8l, False, 1000, 760), ("END_NXT_front", nxt, True, 860, 780)]:
    cut = cutout(img, white=white); cut = cut.crop(cut.getbbox()); can, (x, y, pw, ph, s) = place(holiday_bg(), cut, wpx, cy)
    if name != "END_QM8L_front":
        b = bow.resize((300, round(300 * bow.height / bow.width)), Image.LANCZOS); can.alpha_composite(b, (x + pw - 230, y - 120))
    can.convert("RGB").save(f"{O}/{name}.jpg", quality=92)
# 3. end-card sides with the store's own thickness numbers
side_still(f"{R}/QM7L/QM7L_04.png", (728, 783), '2.2" SLIM', True).save(f"{O}/END_QM7L_side.jpg", quality=92)
side_still(f"{R}/QM8L/QM8L_10.png", (989, 1026), '2.0" SLIM', False).save(f"{O}/END_QM8L_side.jpg", quality=92)
side_still(f"{R}/NXTPAPER14/NXTPAPER14_10.png", (734, 766), "6.95 mm", True).save(f"{O}/END_NXT_side.jpg", quality=92)
# 4. NXT body stills (9:16): sheet music close-up, A4 outline, ink mode
def nxt_still(img, a4=False, sweep=False):
    can = Image.new("RGBA", (W, H), (236, 230, 220, 255)); cut = cutout(img, white=True); cut = cut.crop(cut.getbbox())
    can, (x, y, pw, ph, s) = place(can, cut, 1040, 900)
    if a4:  # A4 outline drawn on the screen area
        sx0, sy0, sx1, sy1 = [round(v) for v in (x + (267 - 202) * s, y + (287 - 374) * s, x + (1235 - 202) * s, y + (1214 - 374) * s)]
        d = ImageDraw.Draw(can); 
        for i in range(sx0, sx1, 26): d.line([(i, sy0 + 10), (min(i + 14, sx1), sy0 + 10)], fill=(255, 170, 40, 255), width=6); d.line([(i, sy1 - 10), (min(i + 14, sx1), sy1 - 10)], fill=(255, 170, 40, 255), width=6)
        for j in range(sy0, sy1, 26): d.line([(sx0 + 10, j), (sx0 + 10, min(j + 14, sy1))], fill=(255, 170, 40, 255), width=6); d.line([(sx1 - 10, j), (sx1 - 10, min(j + 14, sy1))], fill=(255, 170, 40, 255), width=6)
    if sweep:  # a warm window-light band crossing the matte screen with no hotspot
        band = Image.new("L", (W, H), 0); ImageDraw.Draw(band).polygon([(0, 700), (W, 420), (W, 560), (0, 840)], fill=60)
        can = Image.composite(Image.new("RGBA", (W, H), (255, 236, 200, 255)), can, band.filter(ImageFilter.GaussianBlur(40)))
    return can.convert("RGB")
nxt_still(nxt, sweep=True).save(f"{O}/NXT_S3_matte.jpg", quality=92)
nxt_still(nxt, a4=True).save(f"{O}/NXT_S4_a4.jpg", quality=92)
nxt_still(nxt_ink).save(f"{O}/NXT_S7_ink.jpg", quality=92)
print(sorted(os.listdir(O)))
