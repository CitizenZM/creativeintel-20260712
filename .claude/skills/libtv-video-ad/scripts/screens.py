#!/usr/bin/env python3
"""Put real content on device screens.

Two mechanisms:
* `paste_rect` / `paste_quad` — for the official product photos, where the panel is a known
  rectangle (TVs) or a fixed quad (the tablet hero shot).
* `replace_screen` — for the generated clips: the device screens were generated as plain light
  grey, so a bright + low-saturation mask inside a region of interest finds the panel, its extreme
  points give the quad, and the content is warped into it and pasted **through the mask**, so
  fingers and styluses stay on top.

Run directly to dump a QC frame per clip: python3 screens.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent


def _coeffs(dst_quad, src_size):
    """Coefficients for PIL PERSPECTIVE: output(dst) -> input(src)."""
    w, h = src_size
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    A, B = [], []
    for (dx, dy), (sx, sy) in zip(dst_quad, src):
        A.append([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy])
        B.append(sx)
        A.append([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy])
        B.append(sy)
    res = np.linalg.solve(np.array(A, dtype=float), np.array(B, dtype=float))
    return res.tolist()


def warp(content: Image.Image, quad, out_size):
    """Warp `content` so its corners land on `quad` (tl, tr, br, bl) in an out_size canvas."""
    return content.convert("RGB").transform(out_size, Image.PERSPECTIVE,
                                            _coeffs(quad, content.size), Image.BICUBIC)


def paste_rect(base: Image.Image, content: Image.Image, rect, glow=0.0):
    """Fill an axis-aligned panel rect (x0, y0, x1, y1) with content."""
    x0, y0, x1, y1 = rect
    c = content.convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS)
    out = base.copy()
    out.paste(c, (x0, y0))
    if glow:
        halo = Image.new("RGB", base.size, (0, 0, 0))
        halo.paste(c, (x0, y0))
        halo = halo.filter(ImageFilter.GaussianBlur(60))
        out = Image.blend(out, Image.blend(out, halo, 0.5), glow)
    return out


def paste_quad(base: Image.Image, content: Image.Image, quad):
    out = base.convert("RGB").copy()
    layer = warp(content, quad, base.size)
    mask = Image.new("L", base.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).polygon(quad, fill=255)
    out.paste(layer, (0, 0), mask.filter(ImageFilter.GaussianBlur(1)))
    return out


def _largest_blob(m: np.ndarray, scale=4):
    """Keep only the biggest connected region (BFS on a downscaled copy)."""
    small = m[::scale, ::scale]
    h, w = small.shape
    seen = np.zeros_like(small, dtype=bool)
    best, best_size = None, 0
    from collections import deque
    for sy in range(h):
        for sx in range(w):
            if not small[sy, sx] or seen[sy, sx]:
                continue
            q, comp = deque([(sy, sx)]), []
            seen[sy, sx] = True
            while q:
                y, x = q.popleft()
                comp.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(comp) > best_size:
                best, best_size = comp, len(comp)
    out = np.zeros_like(small)
    if best:
        ys, xs = zip(*best)
        out[np.array(ys), np.array(xs)] = True
    big = np.repeat(np.repeat(out, scale, 0), scale, 1)
    bh, bw = big.shape
    full = np.zeros_like(m)
    full[:min(bh, m.shape[0]), :min(bw, m.shape[1])] = big[:m.shape[0], :m.shape[1]]
    return m & full


def screen_mask(frame: Image.Image, roi, lum=(0.52, 0.93), sat=0.13):
    """Mask of the plain light-grey panel inside roi=(x0,y0,x1,y1).

    The panel is grey — darker than a sunlit white wall and far less saturated than skin —
    so a luminance band plus a saturation ceiling isolates it; the largest connected region
    then drops stray highlights elsewhere in the frame.
    """
    a = np.asarray(frame.convert("RGB"), dtype=np.float32) / 255.0
    mx, mn = a.max(-1), a.min(-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    m = (mx > lum[0]) & (mx < lum[1]) & (s < sat)
    box = np.zeros_like(m)
    x0, y0, x1, y1 = roi
    box[y0:y1, x0:x1] = True
    m = _largest_blob(m & box)
    img = Image.fromarray((m * 255).astype(np.uint8))
    return img.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))


def quad_from_mask(mask: Image.Image):
    """Extreme points of the mask → (tl, tr, br, bl). None if the mask is too small."""
    m = np.asarray(mask) > 127
    ys, xs = np.nonzero(m)
    if len(xs) < 4000:
        return None
    pts = np.stack([xs, ys], 1).astype(float)
    s, d = pts[:, 0] + pts[:, 1], pts[:, 0] - pts[:, 1]
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmax(d)]
    bl = pts[np.argmin(d)]
    return [tuple(tl), tuple(tr), tuple(br), tuple(bl)]


def smooth(prev, cur, a=0.55):
    if prev is None:
        return cur
    if cur is None:
        return prev
    return [tuple(a * np.array(c) + (1 - a) * np.array(p)) for p, c in zip(prev, cur)]


def replace_screen(frame: Image.Image, content: Image.Image, roi, prev_quad=None, dim=0.92,
                   lum=(0.52, 0.93), sat=0.13):
    """Composite content into the device screen found inside roi. Returns (frame, quad)."""
    mask = screen_mask(frame, roi, lum=lum, sat=sat)
    quad = quad_from_mask(mask)
    quad = smooth(prev_quad, quad)
    if quad is None:
        return frame, None
    layer = warp(content, quad, frame.size)
    layer = Image.eval(layer, lambda v: int(v * dim))
    out = frame.convert("RGB").copy()
    out.paste(layer, (0, 0), mask.filter(ImageFilter.GaussianBlur(1.2)))
    return out, quad


# Per-clip screen search: roi (x0, y0, x1, y1) in the 1080x1920 frame + luminance band.
# The kid's tablet in "V-P3 watch" reads dark rather than light grey, hence its own band.
ROI = {
    "V-P3 watch": ((300, 560, 1010, 1560), (0.08, 0.42), 0.14),
    "V-A3 swipe": ((120, 430, 1000, 1250), (0.52, 0.93), 0.13),
    "V-C1 write": ((250, 380, 1010, 1330), (0.52, 0.93), 0.13),
    "V-C2 tap": ((330, 330, 900, 1350), (0.52, 0.93), 0.13),
    "V-B2 photo": ((230, 780, 900, 1250), (0.52, 0.93), 0.13),
}

if __name__ == "__main__":
    import subprocess
    import tempfile

    content = Image.open(HERE / "keyframes/SC-anim.png")
    out_dir = Path("/private/tmp/claude-502/-Users-xiaozuo-Projects/"
                   "b9680419-c0cd-4e56-ad3b-a546448de063/scratchpad")
    tiles = []
    for name, (roi, lum, sat) in ROI.items():
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "2", "-i",
                            str(HERE / f"clips/{name}.mp4"), "-frames:v", "1",
                            "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
                            f"{td}/f.jpg"], check=True)
            fr = Image.open(f"{td}/f.jpg").convert("RGB")
        done, quad = replace_screen(fr, content, roi, lum=lum, sat=sat)
        print(name, "quad:", None if quad is None else [(round(x), round(y)) for x, y in quad])
        t = done.resize((270, 480))
        tiles.append(t)
    sheet = Image.new("RGB", (len(tiles) * 278, 480), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * 278, 0))
    sheet.save(out_dir / "screen_test.jpg", quality=88)
    print("wrote", out_dir / "screen_test.jpg")
