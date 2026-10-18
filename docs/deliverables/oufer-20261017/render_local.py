from __future__ import annotations

import math
import subprocess
import wave
from array import array
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"
FRAMES = ROOT / "frames"
VIDEOS = ROOT / "videos"
FRAMES.mkdir(exist_ok=True)
VIDEOS.mkdir(exist_ok=True)
W, H = 720, 1280
FONT = "/System/Library/Fonts/Supplemental/Futura.ttc"
SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"

CONCEPTS = [
    {
        "slug": "01-celestial-pov", "name": "CELESTIAL POV", "bg": "#111827", "fg": "#F5F1EA", "accent": "#C8B584",
        "voice": "A little star. A lot of presence. Meet OUFER's titanium star stud. One clear crystal, one small dangling star. Shop the star.",
        "cards": [
            ("A LITTLE STAR.\nA LOT OF PRESENCE.", "Your next ear-stack detail", "hero.jpg"),
            ("EIGHT-POINT STAR", "One clear CZ at the center", "view-3.jpg"),
            ("A QUIET SPARK", "A small star moves below", "view-6.jpg"),
            ("THE DETAILS MATTER", "ASTM F-136 titanium · 16G", "view-4.jpg"),
            ("SHOP THE STAR", "OUFERBODYJEWELRY.COM", "hero.jpg"),
        ],
    },
    {
        "slug": "02-ear-stack-styling", "name": "EAR STACK STYLING", "bg": "#F3EEE5", "fg": "#252620", "accent": "#856A55",
        "voice": "One small detail can change the whole look. OUFER's eight-point star has a clear center stone and a tiny dangling star. Style your ear stack your way.",
        "cards": [
            ("ONE DETAIL.\nNEW ENERGY.", "The ear-stack edit", "view-6.jpg"),
            ("LOOK CLOSER", "A precise eight-point silhouette", "view-3.jpg"),
            ("LET IT MOVE", "A tiny star dangles below", "hero.jpg"),
            ("STYLE YOUR WAY", "A silver-tone accent for your stack", "view-6.jpg"),
            ("FIND YOUR STAR", "OUFERBODYJEWELRY.COM", "hero.jpg"),
        ],
    },
    {
        "slug": "03-day-to-night", "name": "DAY TO NIGHT", "bg": "#302E35", "fg": "#FFF9F0", "accent": "#DFC9A2",
        "voice": "Morning light, midday close-up, evening sparkle. The same OUFER star in every frame. A clear center crystal and a small star below. Find your detail.",
        "cards": [
            ("MORNING", "A small detail catches the first light", "view-6.jpg"),
            ("MIDDAY", "Eight points, one clear center CZ", "view-3.jpg"),
            ("AFTER DARK", "The little dangling star comes into focus", "hero.jpg"),
            ("ONE PIECE", "The same exact OUFER stud throughout", "view-4.jpg"),
            ("YOUR STAR, YOUR DAY", "Shop OUFER Body Jewelry", "view-6.jpg"),
        ],
    },
    {
        "slug": "04-celestial-macro", "name": "CELESTIAL MACRO", "bg": "#E9E7E4", "fg": "#1C242B", "accent": "#576B79",
        "voice": "Look closer. Eight sculpted points. One clear cubic zirconia. One tiny dangling star. An internally threaded flat back completes OUFER's titanium cartilage stud.",
        "cards": [
            ("LOOK CLOSER", "The OUFER titanium star stud", "hero.jpg"),
            ("EIGHT POINTS", "A sculpted celestial silhouette", "view-3.jpg"),
            ("ONE CLEAR CZ", "Set at the star's center", "hero.jpg"),
            ("ONE DANGLING STAR", "Subtle movement below", "view-4.jpg"),
            ("EVERY DETAIL COUNTS", "Shop the exact OUFER piece", "hero.jpg"),
        ],
    },
    {
        "slug": "05-structure-demo", "name": "STRUCTURE DEMO", "bg": "#18232A", "fg": "#F0F5F4", "accent": "#A4C0BA",
        "voice": "Front, side, back. This is OUFER's titanium CZ star cartilage stud. See the eight-point star, dangling detail, and internally threaded flat back. Choose a six or eight millimeter post.",
        "cards": [
            ("FRONT / SIDE / BACK", "A closer look at one exact piece", "view-4.jpg"),
            ("THE FRONT", "Eight points · one clear CZ", "view-3.jpg"),
            ("THE DETAIL", "One small star dangles below", "hero.jpg"),
            ("THE BACK", "Internally threaded flat back · 16G", "view-4.jpg"),
            ("CHOOSE YOUR LENGTH", "6 mm or 8 mm options · sold singly", "hero.jpg"),
        ],
    },
]


def rgb(h: str) -> tuple[int, int, int]:
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, x: int, y: int,
          fill: tuple[int, int, int], spacing: int = 12) -> int:
    for line in text.split("\n"):
        draw.text((x, y), line, font=font, fill=fill)
        y += draw.textbbox((0, 0), line, font=font)[3] + spacing
    return y


def make_card(concept: dict, index: int) -> Path:
    heading, sub, filename = concept["cards"][index]
    bg, fg, accent = map(rgb, (concept["bg"], concept["fg"], concept["accent"]))
    canvas = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((45, 42, 675, 44), fill=accent)
    draw.text((48, 68), "OUFER  /  BODY JEWELRY", font=ImageFont.truetype(FONT, 22), fill=accent)
    draw.text((48, 118), f"{index + 1:02d}  /  05", font=ImageFont.truetype(FONT, 20), fill=fg)
    lines(draw, heading, ImageFont.truetype(FONT, 48 if len(heading) < 25 else 41), 48, 188, fg, 8)

    source = Image.open(ASSETS / filename).convert("RGB")
    if filename != "view-6.jpg":
        crop = {
            "hero.jpg": (450, 690, 1550, 1820),
            "view-3.jpg": (530, 650, 1470, 1850),
            "view-4.jpg": (360, 680, 1640, 1810),
        }[filename]
        source = source.crop(crop)
    # Keep the real product photo intact. A bordered photo field preserves its
    # original pixels and makes inaccurate generative reconstruction unnecessary.
    box = (48, 350, 672, 1040)
    fitted = ImageOps.fit(source, (box[2] - box[0], box[3] - box[1]), method=Image.Resampling.LANCZOS,
                          centering=(0.5, 0.52 if filename == "view-6.jpg" else 0.5))
    canvas.paste(fitted, box[:2])
    draw = ImageDraw.Draw(canvas)
    draw.rectangle(box, outline=accent, width=2)
    draw.text((48, 1083), sub, font=ImageFont.truetype(SERIF, 28), fill=fg)
    draw.rectangle((48, 1160, 672, 1162), fill=accent)
    draw.text((48, 1180), "OUFERBODYJEWELRY.COM", font=ImageFont.truetype(FONT, 21), fill=accent)
    draw.text((625, 1180), "15s", font=ImageFont.truetype(FONT, 20), fill=accent)
    out = FRAMES / f"{concept['slug']}-{index + 1:02d}.png"
    canvas.save(out, optimize=True)
    return out


def music(path: Path, variant: int) -> None:
    sr, seconds = 32000, 15
    samples = array("h")
    root = [196.0, 220.0, 174.61, 246.94, 164.81][variant]
    for i in range(sr * seconds):
        t = i / sr
        beat = t % 0.5
        pluck = math.exp(-beat * 9) * math.sin(2 * math.pi * root * (2 if variant % 2 else 1.5) * t)
        bass = math.sin(2 * math.pi * root / 2 * t) * 0.25
        air = math.sin(2 * math.pi * root * 1.5 * t) * 0.08
        envelope = min(1.0, t / 0.4, (seconds - t) / 0.6)
        samples.append(int(32767 * 0.10 * envelope * (pluck + bass + air)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


for cnum, concept in enumerate(CONCEPTS):
    clips = []
    for index in range(5):
        card = make_card(concept, index)
        clip = VIDEOS / f"{concept['slug']}-part-{index + 1:02d}.mp4"
        # Slow 4% push-in keeps the photo and the copy within the title-safe area.
        zoom = "min(zoom+0.00055,1.04)" if index % 2 == 0 else "max(zoom-0.00055,1.0)"
        run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-framerate", "24", "-i", str(card),
             "-vf", f"zoompan=z='{zoom}':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x1280:fps=24,format=yuv420p",
             "-frames:v", "72", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", str(clip)])
        clips.append(clip)
    manifest = VIDEOS / f"{concept['slug']}.txt"
    manifest.write_text("".join(f"file '{p.resolve()}'\n" for p in clips))
    silent = VIDEOS / f"{concept['slug']}-silent.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(silent)])
    voice = VIDEOS / f"{concept['slug']}-voice.aiff"
    run(["say", "-v", "Samantha", "-r", "175", "-o", str(voice), concept["voice"]])
    track = VIDEOS / f"{concept['slug']}-music.wav"
    music(track, cnum)
    final = VIDEOS / f"{concept['slug']}-final.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(voice), "-i", str(track),
         "-filter_complex", "[1:a]adelay=450|450,volume=1.45[v];[2:a]volume=0.7[m];[v][m]amix=inputs=2:duration=longest:dropout_transition=0[a]",
         "-map", "0:v:0", "-map", "[a]", "-t", "15", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(final)])
    print(final)
