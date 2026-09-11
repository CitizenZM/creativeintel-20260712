#!/usr/bin/env bash
#
# Offline assembly test. Builds a synthetic economy-mode run — two 6-second
# colour-bar clips standing in for Hailuo output, a fake packshot and logo — and
# proves assemble.py cuts a 15s / 8-window storyboard out of them: six windows
# from two clips at the recorded offsets, two CTA windows composited locally.
#
# It also covers the local-design contract: the optional per-clip cropBottomPct /
# zoom overrides, brand-kit colour resolution, the disclaimer split, and the
# "CTA + offer only" rule for CTA cards.
#
# Nothing here touches the network or spends a LibTV credit.
#
#   bash workers/libtv-worker/test-assemble.sh
#   KEEP=1 bash workers/libtv-worker/test-assemble.sh   # keep the run dir
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for tool in ffmpeg ffprobe python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 1; }
done
python3 -c "import PIL" 2>/dev/null || { echo "missing Pillow: python3 -m pip install --user Pillow" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/libtv-assemble-test.XXXXXX")"
cleanup() { [ "${KEEP:-0}" = "1" ] || rm -rf "$WORK"; }
trap cleanup EXIT

RUN_DIR="$WORK/fixture-economy-15s"
mkdir -p "$RUN_DIR"/refs "$RUN_DIR"/keyframes "$RUN_DIR"/clips "$RUN_DIR"/final

echo "== synthesising clips =="
for node in V1 V4; do
  ffmpeg -v error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=6" \
    -c:v libx264 -pix_fmt yuv420p -crf 28 "$RUN_DIR/clips/$node.mp4"
done

python3 - "$RUN_DIR" <<'PY'
import sys
from pathlib import Path
from PIL import Image, ImageDraw

run_dir = Path(sys.argv[1])

packshot = Image.new("RGBA", (520, 1180), (0, 0, 0, 0))
draw = ImageDraw.Draw(packshot)
draw.rounded_rectangle((60, 120, 460, 1120), radius=70, fill=(236, 244, 255, 255), outline=(30, 30, 40, 255), width=8)
draw.rounded_rectangle((170, 20, 350, 150), radius=30, fill=(255, 79, 163, 255))
draw.rectangle((110, 520, 410, 700), fill=(255, 255, 255, 255))
packshot.save(run_dir / "refs" / "PROD-1.png")

logo = Image.new("RGBA", (900, 260), (0, 0, 0, 0))
ImageDraw.Draw(logo).rounded_rectangle((0, 0, 900, 260), radius=64, fill=(24, 24, 27, 255))
logo.save(run_dir / "refs" / "LOGO.png")
PY

echo "== writing fixture run.json / manifest.json =="
python3 - "$RUN_DIR" <<'PY'
import json
import sys
from pathlib import Path

run_dir = Path(sys.argv[1])
frame_seconds = 2
total = 15
segments = {7: "CTA", 8: "CTA", 1: "HOOK", 2: "HOOK"}

frames = []
for i in range(8):
    start = i * frame_seconds
    end = min(total, start + frame_seconds)
    n = i + 1
    frames.append(
        {
            "frameNumber": n,
            "startSec": start,
            "endSec": end,
            "duration": f"{start}s-{end}s",
            "segment": segments.get(n, "BODY"),
            "scene": f"synthetic beat {n}",
            "textOverlay": (
                "Buy it now \u00b7 20% off this week \u00b7 Limited time offer"
                if n == 7
                else (
                    "Day 1 \u2794 Day 7\n*Individual results can and will vary."
                    if n == 3
                    else (f"beat {n}" if n % 2 else "")
                )
            ),
            "voiceover": "20% off this week only." if n == 7 else "Fixture line.",
        }
    )


def offsets(numbers):
    out = []
    for i, n in enumerate(numbers):
        frame = frames[n - 1]
        length = frame["endSec"] - frame["startSec"]
        start = i * frame_seconds
        out.append({"frameNumber": n, "clipStartSec": start, "clipEndSec": start + length})
    return out


clips = [
    {
        "nodeName": "V1",
        "coversFrames": [1, 2, 3],
        "frameOffsetsSec": offsets([1, 2, 3]),
        "frameSeconds": frame_seconds,
        "localPath": str(run_dir / "clips" / "V1.mp4"),
        "resultUrl": None,
    },
    {
        "nodeName": "V4",
        "coversFrames": [4, 5, 6],
        "frameOffsetsSec": offsets([4, 5, 6]),
        "frameSeconds": frame_seconds,
        "cropBottomPct": 26,
        "zoom": 1.12,
        "localPath": str(run_dir / "clips" / "V4.mp4"),
        "resultUrl": None,
    },
]

payload = {
    "run": {"id": run_dir.name, "aspectRatio": "9:16", "clipDurationSec": 6, "creditsEstimated": 76},
    "brandKit": {"primaryColor": "#0C233F", "backgroundColor": "#f7f4f0"},
    "frames": frames,
    "clips": clips,
    "jobs": [],
}
(run_dir / "run.json").write_text(json.dumps(payload, indent=2))

manifest = {
    "runId": run_dir.name,
    "frames": frames,
    "clips": clips,
    "nodes": [
        {
            "nodeName": c["nodeName"],
            "kind": "video",
            "coversFrames": c["coversFrames"],
            "frameOffsetsSec": c["frameOffsetsSec"],
            "localPath": c["localPath"],
            "skipped": False,
        }
        for c in clips
    ],
}
(run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
PY

echo "== copy + brand-kit unit checks =="
python3 - "$HERE" <<'UNITPY'
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("assemble", Path(sys.argv[1]) / "assemble.py")
asm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asm)

fail = 0


def check(label, got, want):
    global fail
    if got == want:
        print(f"ok   {label}")
    else:
        print(f"FAIL {label}: got {got!r}, want {want!r}")
        fail = 1


# a third "\u00b7"-separated segment never reaches the card
check(
    "cta split drops the third segment",
    asm.split_cta({"textOverlay": "Buy it now \u00b7 20% off this week \u00b7 Limited time offer"}),
    ("Buy it now", "20% off this week"),
)
check(
    "cta object wins over the overlay",
    asm.split_cta({"cta": {"text": "Shop Now", "offer": "30% off"}, "textOverlay": "ignore \u00b7 me"}),
    ("Shop Now", "30% off"),
)
check("cta split on empty copy", asm.split_cta({}), ("", ""))

# disclaimers are demoted out of the headline
check(
    "disclaimer split on a newline",
    asm.split_caption("Day 1 \u2794 Day 7\n*Individual results can and will vary."),
    ("Day 1 \u2192 Day 7", "*Individual results can and will vary."),
)
check(
    "disclaimer split inside one line",
    asm.split_caption("Firmer in 7 days *Individual results vary."),
    ("Firmer in 7 days", "*Individual results vary."),
)

# brand kit resolution + fallbacks
check(
    "brand kit primary from the payload",
    asm.resolve_brand({"brandKit": {"primaryColor": "#0C233F"}}, {})["primary"],
    (12, 35, 63),
)
check("brand fallback primary", asm.resolve_brand({}, {})["primary"], asm.NAVY)
check("brand fallback background", asm.resolve_brand({}, {})["background"], asm.SAND)
check(
    "--brand-color overrides the kit",
    asm.resolve_brand({"brandKit": {"primaryColor": "#0C233F"}}, {}, "#FF4FA3")["primary"],
    (255, 79, 163),
)
check("malformed kit never raises", asm.resolve_brand({"brandKit": ["nope", 3]}, {})["primary"], asm.NAVY)

# optional overrides are clamped, and absent ones are a no-op
clips = asm.collect_clips(
    {"clips": [{"nodeName": "V1", "coversFrames": [1], "localPath": "/x.mp4",
                "cropBottomPct": 99, "zoom": 9}]},
    {},
    {},
)
check("cropBottomPct clamps to 40", clips[1]["crop"], 40.0)
check("zoom clamps to 1.4", clips[1]["zoom"], 1.4)
clips = asm.collect_clips({"clips": [{"nodeName": "V1", "coversFrames": [1], "localPath": "/x.mp4"}]}, {}, {})
check("missing overrides default to no-op", (clips[1]["crop"], clips[1]["zoom"]), (0.0, 1.0))

# a frame carrying none of the optional fields still builds a window
check("bare frame still yields a window", len(asm.build_timeline([{}], {}, {}, [], 2.0)), 1)

sys.exit(fail)
UNITPY

echo "== dry-run timeline =="
python3 "$HERE/assemble.py" --run-dir "$RUN_DIR" --frame-seconds 2 --dry-run

echo "== assembling =="
python3 "$HERE/assemble.py" --run-dir "$RUN_DIR" --frame-seconds 2 --brand-color "#FF4FA3"

MASTER="$RUN_DIR/final/master.mp4"
PREVIEW="$RUN_DIR/final/preview-720p.mp4"
SHEET="$RUN_DIR/final/contact-sheet.jpg"

fail=0
for f in "$MASTER" "$PREVIEW" "$SHEET"; do
  if [ -s "$f" ]; then
    echo "ok   exists  $(basename "$f")  $(wc -c <"$f" | tr -d ' ') bytes"
  else
    echo "FAIL missing $(basename "$f")"
    fail=1
  fi
done

AUDIO="$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$MASTER")"
if [ -z "$AUDIO" ]; then
  echo "ok   audio      none (-an with no music)"
else
  echo "FAIL audio      expected no audio stream, got ${AUDIO}"
  fail=1
fi

COLUMNS="$(python3 -c "
from PIL import Image
import sys
print(Image.open(sys.argv[1]).size[0] // 320)
" "$SHEET")"
if [ "$COLUMNS" = "5" ]; then
  echo "ok   sheet      5 tile columns (one tile per window, no duplicates)"
else
  echo "FAIL sheet      ${COLUMNS} tile columns, expected 5"
  fail=1
fi

DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MASTER")"
DIMS="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$MASTER")"
PREVIEW_DIMS="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$PREVIEW")"

echo "master duration=${DURATION}s dimensions=${DIMS} preview=${PREVIEW_DIMS}"

if awk -v d="$DURATION" 'BEGIN { exit !(d >= 14.9 && d <= 15.1) }'; then
  echo "ok   duration  ${DURATION}s within 15.00s ±0.1s"
else
  echo "FAIL duration  ${DURATION}s is not 15.00s ±0.1s"
  fail=1
fi

if [ "$DIMS" = "1080x1920" ]; then
  echo "ok   dimensions 1080x1920"
else
  echo "FAIL dimensions ${DIMS}, expected 1080x1920"
  fail=1
fi

if [ "$PREVIEW_DIMS" = "720x1280" ]; then
  echo "ok   preview    720x1280"
else
  echo "FAIL preview    ${PREVIEW_DIMS}, expected 720x1280"
  fail=1
fi

[ "${KEEP:-0}" = "1" ] && echo "run dir kept at $RUN_DIR"

if [ "$fail" -ne 0 ]; then
  echo "test-assemble: FAILED"
  exit 1
fi
echo "test-assemble: PASSED"
