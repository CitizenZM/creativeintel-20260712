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

Type follows the brand kit rather than the stock overlay look: a serif headline
in a translucent brand-background pill with a soft drop shadow, wrapped by
measured width to two lines inside the platform safe zone, with disclaimer
sentences demoted to a small line at the bottom of the safe zone. CTA windows
are a designed end card — brand plate, packshot with a contact shadow and a soft
reflection, the offer line, and the call to action as a real button — carrying
nothing that is not in `cta.text` / `cta.offer`.

Inputs (written by worker.mjs into the run directory):
  run.json        the claimed run payload — frames[], jobs[], clips[], aspect
  manifest.json   one entry per executed node with its downloaded localPath
  refs/PROD-*.*   official packshots
  refs/LOGO.*     brand logo

Optional per-clip overrides on `manifest.clips[i]` / `run.json.clips[i]` (both
are ignored when absent, so older runs assemble unchanged):
  cropBottomPct   0-40, drop that share off the bottom of every frame cut from
                  the clip and rescale to fill the canvas anchored at the top
                  (hides a defect baked into the bottom of a generated clip)
  zoom            1.0-1.4, punch in anchored centre-top

Outputs:
  final/master.mp4          1080x1920 @30fps
  final/preview-720p.mp4
  final/contact-sheet.jpg

Usage:
  python3 assemble.py --run-dir <dir> [--music track.m4a] [--brand-color "#0C233F"] [--dry-run]
"""

import argparse
import json
import re
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
NAVY = (12, 35, 63)  # #0C233F — brand fallback when the payload carries no kit
SAND = (247, 244, 240)  # #f7f4f0
SRC_OFFSET_SEC = 0.25  # skip the settle at the head of every generated clip
BEAT_SNAP_SEC = 0.25

# Platform chrome covers the top 14% and bottom 20% of a 9:16 feed; nothing
# legible may be drawn there (reference/shot-design.md). Sides keep an 8% margin.
SAFE_TOP = 0.14
SAFE_BOTTOM = 0.80
SAFE_SIDE = 0.08

# Type scale, as a share of frame height (reference/shot-design.md).
HEADLINE_PCT = 0.052
CAPTION_PCT = 0.034
FINE_PCT = 0.024
BUTTON_PCT = 0.038
TEXT_MAX_PCT = 0.84  # wrap by measured width to 84% of the frame
MAX_LINES = 2
TRACKING = -0.014  # tight letter-spacing, as a share of the font size

DIMENSIONS = {
    "9:16": (1080, 1920),
    "4:5": (1080, 1350),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

SERIF_FONTS = (
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/Library/Fonts/Georgia Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/Library/Fonts/DejaVuSerif-Bold.ttf",
    "DejaVuSerif-Bold.ttf",
)
SANS_FONTS = (
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/DejaVuSans.ttf",
    "DejaVuSans.ttf",
)
# Georgia/Times have no arrow glyphs; borrow them per character from these.
GLYPH_FALLBACKS = (
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "DejaVuSans.ttf",
)

PRIMARY_KEYS = (
    "primarycolor", "primary", "brandcolor", "accentcolor", "accent",
    "colorprimary", "primaryhex", "maincolor", "themecolor",
)
BACKGROUND_KEYS = (
    "backgroundcolor", "background", "surfacecolor", "surface", "bgcolor",
    "neutralcolor", "secondarycolor", "papercolor", "canvascolor",
)
HEADLINE_FONT_KEYS = ("headlinefont", "displayfont", "titlefont", "serif", "headingfont")
BODY_FONT_KEYS = ("bodyfont", "captionfont", "textfont", "sans", "uifont")
BRAND_SCOPE_KEYS = (
    "brandkit", "brand", "project", "run", "theme", "style", "styleguide", "design",
)

DISCLAIMER_RE = re.compile(
    r"(individual\s+results|results\s+(?:can|may|will)\s+.*vary|results\s+vary|"
    r"not\s+a\s+substitute|terms\s+apply)",
    re.IGNORECASE,
)
CTA_SPLIT_RE = re.compile(r"\s+[·•|]\s+")
ARROWS = {"➔": "→", "➡": "→", "➜": "→", "⮕": "→",
          "➙": "→", "⇨": "→", "⟶": "→"}
NOTDEF_PROBE = "\ue000"  # private use: whatever the face draws for a missing glyph


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


def load_truetype(candidates, size: int):
    for name in candidates:
        if not name:
            continue
        try:
            return ImageFont.truetype(str(name), max(8, int(size)))
        except (OSError, ValueError):
            continue
    return ImageFont.load_default()


def load_font(size: int):
    """Kept for callers that only want a legible sans face at a given size."""
    return load_truetype(SANS_FONTS, size)


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


def luminance(color):
    r, g, b = (c / 255.0 for c in color[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


# ─── Brand kit ───────────────────────────────────────────────────────────────


def _hex_like(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text if re.fullmatch(r"#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", text) else None


def _normalise_key(key):
    return re.sub(r"[^a-z]", "", str(key).lower())


def _scan(node, wanted, predicate, depth=0):
    """First value under a key in `wanted` that satisfies `predicate`."""
    if depth > 5 or node is None:
        return None
    if isinstance(node, dict):
        for key, value in node.items():
            if _normalise_key(key) in wanted:
                hit = predicate(value)
                if hit:
                    return hit
                if isinstance(value, dict):
                    for nested in value.values():
                        hit = predicate(nested)
                        if hit:
                            return hit
                elif isinstance(value, list):
                    for nested in value[:8]:
                        hit = predicate(nested)
                        if hit:
                            return hit
        for value in node.values():
            if isinstance(value, (dict, list)):
                hit = _scan(value, wanted, predicate, depth + 1)
                if hit:
                    return hit
    elif isinstance(node, list):
        for value in node[:16]:
            hit = _scan(value, wanted, predicate, depth + 1)
            if hit:
                return hit
    return None


def _font_path(value):
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = Path(value.strip()).expanduser()
    return str(candidate) if candidate.is_file() else None


def resolve_brand(payload, manifest, override=None):
    """Brand colours/fonts from whatever the payload happens to carry.

    Looks under `brandKit`, `project`, `run`, `theme`, … in run.json and
    manifest.json; every field is optional and any gap falls back to the house
    palette (navy on sand). Never raises.
    """
    scope = {}
    for source in (payload, manifest):
        if not isinstance(source, dict):
            continue
        for key, value in source.items():
            if _normalise_key(key) in BRAND_SCOPE_KEYS and isinstance(value, (dict, list)):
                scope.setdefault(key, value)

    try:
        primary_hex = _scan(scope, PRIMARY_KEYS, _hex_like)
        background_hex = _scan(scope, BACKGROUND_KEYS, _hex_like)
        headline_font = _scan(scope, HEADLINE_FONT_KEYS, _font_path)
        body_font = _scan(scope, BODY_FONT_KEYS, _font_path)
    except Exception:  # pragma: no cover - a malformed kit must never stop the cut
        primary_hex = background_hex = headline_font = body_font = None

    primary = parse_color(override, None) or parse_color(primary_hex, NAVY)
    background = parse_color(background_hex, SAND)
    if abs(luminance(primary) - luminance(background)) < 0.28:
        background = SAND if luminance(primary) < 0.5 else NAVY
    ink = primary if luminance(primary) < 0.62 else INK

    return {
        "primary": primary,
        "background": background,
        "ink": ink,
        "headline_fonts": ((headline_font,) if headline_font else ()) + SERIF_FONTS,
        "body_fonts": ((body_font,) if body_font else ()) + SANS_FONTS,
        "source": "payload" if (primary_hex or background_hex) else "fallback",
    }


# ─── Copy ────────────────────────────────────────────────────────────────────


def sanitize(text):
    out = str(text or "")
    for bad, good in ARROWS.items():
        out = out.replace(bad, good)
    return out.replace("\r", "\n")


def split_caption(text):
    """(headline, disclaimer) — legal small print never shares the headline pill."""
    raw = sanitize(text).strip()
    if not raw:
        return "", ""
    pieces = [p.strip() for p in raw.split("\n") if p.strip()]
    if len(pieces) == 1:
        marked = re.split(r"(?<=\S)\s+(?=\*)", pieces[0], maxsplit=1)
        if len(marked) == 2:
            pieces = [marked[0].strip(), marked[1].strip()]
    head, fine = [], []
    for piece in pieces:
        (fine if piece.lstrip().startswith("*") or DISCLAIMER_RE.search(piece) else head).append(piece)
    return " ".join(head).strip(), " ".join(fine).strip()


def split_cta(frame):
    """(cta, offer) from `cta.text` / `cta.offer`, else the text overlay.

    A third segment ("Limited time offer", …) is dropped: the card carries the
    call to action and the offer, nothing else.
    """
    cta_field = frame.get("cta") if isinstance(frame, dict) else None
    if isinstance(cta_field, dict):
        cta = sanitize(cta_field.get("text") or cta_field.get("label") or "").strip()
        offer = sanitize(cta_field.get("offer") or cta_field.get("subtext") or "").strip()
        if cta or offer:
            return cta, offer
    raw = sanitize((frame or {}).get("textOverlay") or "").replace("\n", " · ")
    parts = [p.strip(" ·•|") for p in CTA_SPLIT_RE.split(raw) if p.strip(" ·•|")]
    if not parts:
        return "", ""
    return parts[0], (parts[1] if len(parts) > 1 else "")


# ─── Type ────────────────────────────────────────────────────────────────────


class FontSet:
    """A face plus per-character fallbacks, measured and drawn on one baseline."""

    def __init__(self, candidates, size):
        self.font = load_truetype(candidates, size)
        self.size = getattr(self.font, "size", size) or size
        self._fallbacks = None
        try:
            self._missing = self.font.getbbox("")
        except Exception:
            self._missing = None

    @property
    def fallbacks(self):
        if self._fallbacks is None:
            self._fallbacks = []
            for name in GLYPH_FALLBACKS:
                try:
                    self._fallbacks.append(ImageFont.truetype(str(name), int(self.size)))
                except (OSError, ValueError):
                    continue
        return self._fallbacks

    def metrics(self):
        try:
            return self.font.getmetrics()
        except Exception:
            return int(self.size * 0.8), int(self.size * 0.2)

    def _has(self, font, ch):
        if self._missing is None:
            return True
        try:
            return font.getbbox(ch) != self._missing
        except Exception:
            return True

    def font_for(self, ch):
        if ch.isspace() or self._has(self.font, ch):
            return self.font
        for fallback in self.fallbacks:
            try:
                if fallback.getbbox(ch) != fallback.getbbox(""):
                    return fallback
            except Exception:
                continue
        return self.font

    def advance(self, ch, font=None):
        font = font or self.font_for(ch)
        try:
            return font.getlength(ch)
        except AttributeError:  # pragma: no cover - very old Pillow
            return font.getsize(ch)[0]

    def width(self, text, tracking=0.0):
        if not text:
            return 0.0
        total = sum(self.advance(ch) for ch in text)
        return total + tracking * max(0, len(text) - 1)

    def draw(self, draw, x, baseline, text, fill, tracking=0.0):
        for ch in text:
            font = self.font_for(ch)
            draw.text((x, baseline), ch, font=font, fill=fill, anchor="ls")
            x += self.advance(ch, font) + tracking


def wrap_measured(fontset, text, max_width, tracking=0.0, max_lines=MAX_LINES):
    words = str(text or "").split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if fontset.width(trial, tracking) <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    if max_lines and len(lines) > max_lines:
        kept = lines[: max_lines - 1]
        tail = " ".join(lines[max_lines - 1 :])
        while tail and fontset.width(tail + "…", tracking) > max_width:
            tail = tail.rsplit(" ", 1)[0] if " " in tail else tail[:-1]
        kept.append((tail + "…") if tail else "…")
        lines = kept
    return lines


def wrap(draw, text, font, max_width):
    """Legacy width-wrap kept for callers outside the compositor."""
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


def _even(value, floor=2):
    return max(floor, int(round(value)) // 2 * 2)


def extract(clip: Path, out_dir: Path, width: int, height: int, crop_bottom_pct=0.0,
            zoom=1.0, dry_run=False):
    """Cut a clip to JPEG frames at the canvas size.

    `crop_bottom_pct` drops that share off the bottom and rescales the remainder
    to fill the canvas anchored at the top (aspect preserved — the sides are
    trimmed rather than the picture stretched). `zoom` punches in centre-top.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    chain = [
        f"fps={FPS}",
        f"scale={width}:{height}:force_original_aspect_ratio=increase",
        f"crop={width}:{height}",
    ]
    if crop_bottom_pct and crop_bottom_pct > 0.05:
        kept = _even(height * (1.0 - min(crop_bottom_pct, 40.0) / 100.0))
        chain += [
            f"crop={width}:{kept}:0:0",
            f"scale=-2:{height}:flags=lanczos",
            f"crop={width}:{height}:(in_w-{width})/2:0",
        ]
    if zoom and zoom > 1.005:
        factor = min(float(zoom), 1.4)
        chain += [
            f"crop={_even(width / factor)}:{_even(height / factor)}:(in_w-out_w)/2:0",
            f"scale={width}:{height}:flags=lanczos",
        ]
    run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", clip,
            "-vf", ",".join(chain),
            "-q:v", "3", out_dir / "f%04d.jpg",
        ],
        dry_run=dry_run,
    )
    return sorted(out_dir.glob("f*.jpg"))


# ─── Local composites ────────────────────────────────────────────────────────


class Compositor:
    def __init__(self, width, height, packshot: Path, logo: Path, brand=None):
        self.W, self.H = width, height
        brand = brand if isinstance(brand, dict) else {"primary": parse_color(brand, NAVY)}
        self.brand = brand.get("primary", NAVY)
        self.bg = brand.get("background", SAND)
        self.ink = brand.get("ink", self.brand)
        headline_fonts = brand.get("headline_fonts") or SERIF_FONTS
        body_fonts = brand.get("body_fonts") or SANS_FONTS

        try:
            self.packshot = Image.open(packshot).convert("RGBA") if packshot else None
        except (OSError, ValueError):
            self.packshot = None
        try:
            self.logo = Image.open(logo).convert("RGBA") if logo else None
        except (OSError, ValueError):
            self.logo = None
        if self.logo:
            self.logo.thumbnail((int(self.W * 0.60), int(self.H * 0.20)), Image.LANCZOS)

        self.headline = FontSet(headline_fonts, int(self.H * HEADLINE_PCT))
        self.caption = FontSet(body_fonts, int(self.H * CAPTION_PCT))
        self.fine = FontSet(body_fonts, int(self.H * FINE_PCT))
        self.button = FontSet(headline_fonts, int(self.H * BUTTON_PCT))

        self.text_max = int(self.W * TEXT_MAX_PCT)
        self._plate = None
        self._caption_cache = {}
        self._card_cache = {}

    # -- ground -------------------------------------------------------------

    @property
    def plate(self):
        """Soft background→primary gradient: light enough for a primary button."""
        if self._plate is None:
            deep = mix(self.bg, self.brand, 0.30)
            bg = Image.new("RGB", (self.W, self.H))
            draw = ImageDraw.Draw(bg)
            for y in range(self.H):
                u = y / max(1, self.H - 1)
                draw.line((0, y, self.W, y), fill=mix(self.bg, deep, u * u))
            glow = Image.new("RGB", (self.W, self.H), (0, 0, 0))
            gd = ImageDraw.Draw(glow)
            gd.ellipse(
                (-self.W * 0.25, -self.H * 0.06, self.W * 1.25, self.H * 0.52),
                fill=mix(self.brand, (255, 255, 255), 0.90),
            )
            self._plate = ImageChops.screen(
                bg, glow.filter(ImageFilter.GaussianBlur(int(self.W * 0.18)))
            )
        return self._plate

    # -- primitives ---------------------------------------------------------

    def _shadow(self, layer, mask, color=(0, 0, 0), opacity=0.34, blur=16, offset=(0, 8)):
        soft = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * opacity))
        if offset != (0, 0):
            soft = ImageChops.offset(soft, offset[0], offset[1])
        shade = Image.new("RGBA", layer.size, color + (0,))
        shade.putalpha(soft)
        return Image.alpha_composite(layer, shade)

    def _block(self, layer, lines, fontset, y_bottom, fill, tracking=0.0, pill=None,
               text_shadow=True):
        """Centred lines whose block bottom sits at `y_bottom`. Returns the top."""
        lines = [l for l in lines if l]
        if not lines:
            return int(y_bottom)
        ascent, descent = fontset.metrics()
        line_h = int(fontset.size * 1.16)
        text_h = line_h * (len(lines) - 1) + ascent + descent
        widths = [fontset.width(line, tracking) for line in lines]
        width = max(widths)

        pad_x = pill[1] if pill else 0
        pad_y = pill[2] if pill else 0
        top = int(y_bottom) - text_h - pad_y
        top = max(int(self.H * SAFE_TOP) + pad_y, top)

        if pill:
            x0 = (self.W - width) / 2 - pad_x
            x1 = (self.W + width) / 2 + pad_x
            box = (x0, top - pad_y, x1, top + text_h + pad_y)
            radius = pill[3]
            mask = Image.new("L", layer.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
            layer = self._shadow(layer, mask, opacity=0.30, blur=int(self.W * 0.02),
                                 offset=(0, int(self.H * 0.005)))
            plate = Image.new("RGBA", layer.size, (0, 0, 0, 0))
            ImageDraw.Draw(plate).rounded_rectangle(box, radius=radius, fill=pill[0])
            layer = Image.alpha_composite(layer, plate)
        elif text_shadow:
            mask = Image.new("L", layer.size, 0)
            md = ImageDraw.Draw(mask)
            for i, line in enumerate(lines):
                fontset.draw(md, (self.W - widths[i]) / 2, top + ascent + i * line_h, line,
                             255, tracking)
            layer = self._shadow(layer, mask, opacity=0.55, blur=int(self.W * 0.008),
                                 offset=(0, int(self.H * 0.002)))

        text_layer = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        td = ImageDraw.Draw(text_layer)
        for i, line in enumerate(lines):
            fontset.draw(td, (self.W - widths[i]) / 2, top + ascent + i * line_h, line,
                         fill, tracking)
        layer = Image.alpha_composite(layer, text_layer)
        self._last_layer = layer
        return top - pad_y

    def _button(self, layer, label, y_bottom, scale=1.0):
        """Rounded rectangle in the primary colour with a white label."""
        if not label:
            return layer, int(y_bottom)
        fontset = self.button if scale >= 0.95 else FontSet(
            self.button and SERIF_FONTS, int(self.H * BUTTON_PCT * scale)
        )
        tracking = fontset.size * TRACKING * 0.5
        max_label = int(self.W * TEXT_MAX_PCT) - int(self.W * 0.16 * scale)
        line = wrap_measured(fontset, label, max_label, tracking, max_lines=1)[0]
        width = fontset.width(line, tracking)
        ascent, descent = fontset.metrics()
        pad_x = int(self.W * 0.075 * scale)
        height = int((ascent + descent) + self.H * 0.026 * scale)
        box_w = min(int(self.W * TEXT_MAX_PCT), max(int(self.W * 0.46 * scale), int(width) + 2 * pad_x))
        x0 = (self.W - box_w) / 2
        top = int(y_bottom) - height
        box = (x0, top, x0 + box_w, top + height)
        radius = height // 2

        mask = Image.new("L", layer.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
        layer = self._shadow(layer, mask, color=mix(self.brand, (0, 0, 0), 0.5), opacity=0.32,
                             blur=int(self.W * 0.022), offset=(0, int(self.H * 0.007)))
        plate = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        ImageDraw.Draw(plate).rounded_rectangle(box, radius=radius, fill=self.brand + (255,))
        layer = Image.alpha_composite(layer, plate)

        text_layer = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        baseline = top + (height - (ascent + descent)) / 2 + ascent
        fontset.draw(ImageDraw.Draw(text_layer), (self.W - width) / 2, baseline, line,
                     (255, 255, 255, 255), tracking)
        return Image.alpha_composite(layer, text_layer), top

    def _product(self, frame, top, max_h_pct=0.36, max_w_pct=0.78):
        """Packshot with a contact shadow and a soft reflection. Returns bottom y."""
        if not self.packshot:
            return top
        product = self.packshot
        fit = min(
            (self.W * max_w_pct) / max(1, product.width),
            (self.H * max_h_pct) / max(1, product.height),
        )
        size = (max(1, int(product.width * fit)), max(1, int(product.height * fit)))
        product = product.resize(size, Image.LANCZOS)
        x = (self.W - product.width) // 2
        bottom = top + product.height

        shadow = Image.new("L", (self.W, self.H), 0)
        ImageDraw.Draw(shadow).ellipse(
            (x + product.width * 0.06, bottom - product.height * 0.05,
             x + product.width * 0.94, bottom + product.height * 0.10),
            fill=105,
        )
        frame = Image.composite(
            Image.new("RGB", (self.W, self.H), mix(self.brand, (90, 90, 100), 0.45)),
            frame,
            shadow.filter(ImageFilter.GaussianBlur(int(self.W * 0.024))),
        )

        reflection = product.transpose(Image.FLIP_TOP_BOTTOM).resize(
            (product.width, max(1, int(product.height * 0.26)))
        )
        fade = Image.linear_gradient("L").resize(reflection.size)
        reflection.putalpha(
            ImageChops.multiply(reflection.split()[3], fade.point(lambda v: 255 - v))
            .point(lambda v: int(v * 0.34))
        )
        frame.paste(reflection, (x, bottom + int(self.H * 0.004)), reflection)
        frame.paste(product, (x, top), product)
        return bottom

    # -- cards --------------------------------------------------------------

    def caption_layer(self, headline, disclaimer):
        key = (headline, disclaimer)
        cached = self._caption_cache.get(key)
        if cached is not None:
            return cached
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        bottom = int(self.H * SAFE_BOTTOM) - int(self.H * 0.012)

        if disclaimer:
            tracking = self.fine.size * TRACKING * 0.4
            lines = wrap_measured(self.fine, disclaimer, self.text_max, tracking)
            bottom = self._block(layer, lines, self.fine, bottom, (255, 255, 255, 236),
                                 tracking) - int(self.H * 0.016)
            layer = self._last_layer

        if headline:
            tracking = self.headline.size * TRACKING
            pad_x = int(self.W * 0.042)
            lines = wrap_measured(
                self.headline, headline, self.text_max - 2 * pad_x, tracking
            )
            pill = (self.bg + (229,), pad_x, int(self.H * 0.016), int(self.H * 0.019))
            self._block(layer, lines, self.headline, bottom, self.ink + (255,), tracking, pill)
            layer = self._last_layer

        self._caption_cache[key] = layer
        return layer

    def overlay(self, frame, text: str):
        """Caption burned over a generated window, inside the safe zones."""
        headline, disclaimer = split_caption(text)
        if not headline and not disclaimer:
            return frame
        layer = self.caption_layer(headline, disclaimer)
        return Image.alpha_composite(frame.convert("RGBA"), layer).convert("RGB")

    def cta_card(self, cta: str, offer: str = ""):
        """Brand plate · packshot · offer line · CTA button. Nothing else."""
        key = ("cta", cta, offer)
        cached = self._card_cache.get(key)
        if cached is not None:
            return cached.copy()

        frame = self.plate.copy()
        self._product(frame, int(self.H * 0.145))
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))

        button_bottom = int(self.H * 0.778)
        layer, button_top = self._button(layer, cta, button_bottom)
        if offer:
            tracking = self.headline.size * TRACKING
            lines = wrap_measured(self.headline, offer, self.text_max, tracking)
            self._block(layer, lines, self.headline, button_top - int(self.H * 0.030),
                        self.ink + (255,), tracking, pill=None, text_shadow=False)
            layer = self._last_layer

        card = Image.alpha_composite(frame.convert("RGBA"), layer).convert("RGB")
        self._card_cache[key] = card
        return card.copy()

    def end_card(self, cta: str = ""):
        """Logo centred on the background colour, CTA button small beneath it."""
        key = ("end", cta)
        cached = self._card_cache.get(key)
        if cached is not None:
            return cached.copy()

        frame = Image.new("RGB", (self.W, self.H), self.bg)
        if self.logo:
            frame.paste(
                self.logo,
                ((self.W - self.logo.width) // 2, int(self.H * 0.42) - self.logo.height // 2),
                self.logo,
            )
        else:
            draw = ImageDraw.Draw(frame)
            r = int(self.W * 0.14)
            draw.ellipse(
                (self.W // 2 - r, int(self.H * 0.42) - r, self.W // 2 + r, int(self.H * 0.42) + r),
                fill=self.brand,
            )
        layer = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        layer, _ = self._button(layer, cta, int(self.H * 0.62), scale=0.78)
        card = Image.alpha_composite(frame.convert("RGBA"), layer).convert("RGB")
        self._card_cache[key] = card
        return card.copy()

    def poster_card(self, text: str = ""):
        """Fallback for a window with neither clip nor keyframe."""
        frame = self.plate.copy()
        self._product(frame, int(self.H * 0.20), max_h_pct=0.40)
        return self.overlay(frame, text)

    def product_card(self, headline: str, caption: str = ""):
        """Backward-compatible entry point (older callers passed raw overlay copy)."""
        cta, offer = split_cta({"textOverlay": headline})
        return self.cta_card(cta, offer or "")


# ─── Timeline ────────────────────────────────────────────────────────────────


def _clamped(value, lo, hi, default):
    try:
        if value is None:
            return default
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return default


def _first(*values):
    for value in values:
        if value is not None:
            return value
    return None


def collect_clips(payload, manifest, nodes_by_name):
    """frameNumber -> {path, offset, crop, zoom} using the compiler's clip mapping.

    Economy runs carry `frameOffsetsSec` (where in the clip each window starts);
    full-mode and legacy runs fall back to one V<n> per frame read from the head
    of the clip. `cropBottomPct` / `zoom` are optional per-clip overrides.
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
                    "cropBottomPct": _first(job.get("cropBottomPct"), settings.get("cropBottomPct")),
                    "zoom": _first(job.get("zoom"), settings.get("zoom")),
                }
            )

    clips = {}
    for source in sources:
        node = nodes_by_name.get(source.get("nodeName") or "", {})
        local = source.get("localPath") or node.get("localPath")
        if not local:
            continue
        crop = _clamped(_first(source.get("cropBottomPct"), node.get("cropBottomPct")), 0.0, 40.0, 0.0)
        zoom = _clamped(_first(source.get("zoom"), node.get("zoom")), 1.0, 1.4, 1.0)
        offsets = source.get("frameOffsetsSec") or node.get("frameOffsetsSec") or []
        if offsets:
            for offset in offsets:
                try:
                    number = int(offset["frameNumber"])
                except (KeyError, TypeError, ValueError):
                    continue
                clips[number] = {
                    "path": local,
                    "offset": float(offset.get("clipStartSec", 0.0) or 0.0),
                    "crop": crop,
                    "zoom": zoom,
                }
            continue
        for frame_number in source.get("coversFrames") or []:
            try:
                clips[int(frame_number)] = {
                    "path": local, "offset": SRC_OFFSET_SEC, "crop": crop, "zoom": zoom,
                }
            except (TypeError, ValueError):
                continue

    for name, node in nodes_by_name.items():
        if not name.startswith("V") or not node.get("localPath"):
            continue
        try:
            frame_number = int(name[1:])
        except ValueError:
            continue
        clips.setdefault(
            frame_number,
            {
                "path": node["localPath"],
                "offset": SRC_OFFSET_SEC,
                "crop": _clamped(node.get("cropBottomPct"), 0.0, 40.0, 0.0),
                "zoom": _clamped(node.get("zoom"), 1.0, 1.4, 1.0),
            },
        )

    return clips


def source_key(window):
    if window.get("clip"):
        return f"{window['clip']}|{window.get('cropBottomPct', 0.0)}|{window.get('zoom', 1.0)}"
    return f"composite:{window.get('segment')}"


def build_timeline(frames, clips, nodes_by_name, beats, frame_seconds):
    timeline = []
    for i, frame in enumerate(frames):
        frame = frame if isinstance(frame, dict) else {}
        try:
            n = int(frame.get("frameNumber", i + 1))
        except (TypeError, ValueError):
            n = i + 1
        start = float(frame.get("startSec", i * frame_seconds) or 0.0)
        end = float(frame.get("endSec", start + frame_seconds) or (start + frame_seconds))
        segment = str(frame.get("segment") or "BODY").upper()
        settings = frame.get("settings") if isinstance(frame.get("settings"), dict) else {}
        composite = bool(frame.get("compositeLocally") or settings.get("compositeLocally"))
        local = segment == "CTA" or composite
        clip = clips.get(n) if not local else None
        headline, disclaimer = split_caption(frame.get("textOverlay") or "")
        cta, offer = split_cta(frame)
        timeline.append(
            {
                "frameNumber": n,
                "start": snap(start, beats) if i else 0.0,
                "end": end,
                "segment": segment,
                "compositeLocally": local,
                "clip": (clip or {}).get("path"),
                "clipOffset": float((clip or {}).get("offset", 0.0)),
                "cropBottomPct": float((clip or {}).get("crop", 0.0)),
                "zoom": float((clip or {}).get("zoom", 1.0)),
                "keyframe": (nodes_by_name.get(f"K{n}") or {}).get("localPath"),
                "headline": headline,
                "disclaimer": disclaimer,
                "caption": frame.get("voiceover") or "",
                "cta": cta,
                "offer": offer,
                "endCard": False,
                "soleCta": False,
            }
        )
    for i in range(len(timeline) - 1):
        timeline[i]["end"] = timeline[i + 1]["start"]

    timeline = [w for w in timeline if w["end"] > w["start"]]

    cta = [w for w in timeline if w["compositeLocally"]]
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
    ap.add_argument("--no-flash", action="store_true",
                    help="hard cut between clip groups instead of a 1-frame flash")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    run_dir = Path(args.run_dir)
    width, height = DIMENSIONS.get(args.aspect, DIMENSIONS["9:16"])
    final_dir = run_dir / "final"
    final_dir.mkdir(parents=True, exist_ok=True)

    payload = load_json(run_dir / "run.json", {})
    manifest = load_json(run_dir / "manifest.json", {"nodes": []})
    frames = manifest.get("frames") or payload.get("frames") or []
    nodes_by_name = {n["nodeName"]: n for n in manifest.get("nodes", []) if n.get("nodeName")}

    if not frames:
        print("no storyboard frames in run.json/manifest.json — nothing to assemble", file=sys.stderr)
        return 1

    beats = beat_grid(Path(args.music)) if args.music else []
    if beats:
        print(f"beat grid: {len(beats)} beats from {args.music}")

    brand = resolve_brand(payload, manifest, args.brand_color)
    print(
        "brand: primary #{:02X}{:02X}{:02X} · background #{:02X}{:02X}{:02X} ({})".format(
            *brand["primary"], *brand["background"], brand["source"]
        )
    )

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
    for window in timeline:
        if window["cropBottomPct"] or window["zoom"] > 1.0:
            print(
                f"  F{window['frameNumber']}: cropBottomPct={window['cropBottomPct']:.1f} "
                f"zoom={window['zoom']:.2f}"
            )

    if args.dry_run:
        for w in timeline:
            if w["clip"]:
                source = f"{Path(w['clip']).name} @ {w['clipOffset']:.2f}s"
            elif w["compositeLocally"]:
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
        brand,
    )
    work = Path(tempfile.mkdtemp(prefix="libtv-assemble-"))

    try:
        extracted = {}
        for window in timeline:
            clip = window["clip"]
            if not clip or not Path(clip).exists():
                continue
            key = source_key(window)
            if key not in extracted:
                extracted[key] = extract(
                    Path(clip), work / f"c{len(extracted)}", width, height,
                    crop_bottom_pct=window["cropBottomPct"], zoom=window["zoom"],
                )

        # A clip-group change is a hard cut with one white frame on it — never a
        # crossfade, which smears two unrelated generated shots together.
        flash_frames = set()
        if not args.no_flash:
            for i in range(1, len(timeline)):
                if source_key(timeline[i]) != source_key(timeline[i - 1]):
                    flash_frames.add(int(round(timeline[i]["start"] * FPS)))
        white = Image.new("RGB", (width, height), (255, 255, 255))

        seq = work / "seq"
        seq.mkdir()
        contact_tiles = []
        seen_windows = set()
        total_frames = int(round(duration * FPS))

        for i in range(total_frames):
            t = i / FPS
            window = next((w for w in timeline if w["start"] <= t < w["end"]), timeline[-1])
            frame = render_window(
                window, t, extracted, compositor, width, height, captions=not args.no_captions
            )
            if id(window) not in seen_windows:
                seen_windows.add(id(window))
                contact_tiles.append((window["frameNumber"], frame.copy()))
            if i in flash_frames:
                frame = white
            frame.save(seq / f"f{i:04d}.jpg", quality=92)

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
    frames = extracted.get(source_key(window)) if clip else None

    if frames:
        offset = window["clipOffset"] + (t - window["start"])
        index = min(max(int(round(offset * FPS)), 0), len(frames) - 1)
        image = Image.open(frames[index]).convert("RGB")
        return compositor.overlay(image, window["headline"] and raw_caption(window)) if captions else image

    if window["compositeLocally"]:
        span = window["end"] - window["start"]
        if window["endCard"] and not (window["soleCta"] and span > 1.4 and t < window["end"] - 1.0):
            return compositor.end_card(window["cta"])
        return compositor.cta_card(window["cta"], window["offer"])

    keyframe = window.get("keyframe")
    if keyframe and Path(keyframe).exists():
        still = Image.open(keyframe).convert("RGB")
        still = crop_to_canvas(still, width, height, window["cropBottomPct"], window["zoom"])
        return compositor.overlay(still, raw_caption(window)) if captions else still

    return compositor.poster_card(raw_caption(window) if captions else "")


def raw_caption(window):
    """Headline + disclaimer recombined for the compositor's own splitter."""
    parts = [window.get("headline") or "", window.get("disclaimer") or ""]
    return "\n".join(p for p in parts if p)


def crop_to_canvas(image, width, height, crop_bottom_pct=0.0, zoom=1.0):
    """Same geometry as extract(), for stills cut straight from a keyframe."""
    scale = max(width / image.width, height / image.height)
    image = image.resize(
        (max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.LANCZOS
    )
    left = (image.width - width) // 2
    image = image.crop((left, 0, left + width, height))
    if crop_bottom_pct and crop_bottom_pct > 0.05:
        kept = max(2, int(height * (1.0 - min(crop_bottom_pct, 40.0) / 100.0)))
        region = image.crop((0, 0, width, kept))
        factor = height / kept
        region = region.resize((max(1, int(width * factor)), height), Image.LANCZOS)
        left = (region.width - width) // 2
        image = region.crop((left, 0, left + width, height))
    if zoom and zoom > 1.005:
        factor = min(float(zoom), 1.4)
        zw, zh = int(width / factor), int(height / factor)
        left = (width - zw) // 2
        image = image.crop((left, 0, left + zw, zh)).resize((width, height), Image.LANCZOS)
    return image


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
