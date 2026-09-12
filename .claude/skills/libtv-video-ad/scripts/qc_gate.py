#!/usr/bin/env python3
"""qc_gate — run this on every rendered ad BEFORE showing it to anyone.

    python3 qc_gate.py out/AD-15s-9x16.mp4 --beats assets/music/track_15s.beats.txt
    python3 qc_gate.py out/*.mp4 --beats ... --json

It measures the six things that were wrong in the first two campaigns and prints PASS/FAIL
per check. Exit code 1 if any check fails, so it can gate a build script.

Thresholds come from measured benchmark ads (TCL EU/US, Hisense, Walmart) — see
reference/qc-gate.md for the table and how to widen a threshold deliberately.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_cut import analyse                      # noqa: E402

# name -> (getter, predicate, human rule)
LIMITS = {
    "cuts_per_15s":    (lambda m: m["cuts"] * 15 / max(m["dur"], .01), lambda v: v >= 9,      ">= 9 per 15s"),
    "static_share":    (lambda m: m["static_share"],                   lambda v: v <= 0.42,   "<= 0.42"),
    "motion_mean":     (lambda m: m["motion_mean"],                    lambda v: v >= 2.0,    ">= 2.0"),
    "longest_static_s":(lambda m: m["longest_static_s"],               lambda v: v <= 1.2,    "<= 1.2s"),
    "avg_shot_s":      (lambda m: m["avg_shot_s"],                     lambda v: v <= 1.7,    "<= 1.7s"),
    "beat_bias_ms":    (lambda m: abs(m.get("beat_bias_ms", 0)),       lambda v: v <= 20,     "<= +-20ms"),
    "beat_max_ms":     (lambda m: m.get("beat_max_ms", 0),             lambda v: v <= 50,     "<= 50ms"),
    "beat_accent_pct": (lambda m: 100*m.get("beats_with_cut", 0)/max(m.get("beats_total", 1), 1),
                                                                       lambda v: v >= 25,     ">= 25% of beats cut"),
    "true_peak_dbfs":  (lambda m: m["true_peak_dbfs"],                 lambda v: v <= -1.0,   "<= -1.0 dBFS"),
    "loudness_lufs":   (lambda m: m["loudness_lufs"],                  lambda v: -17 <= v <= -12, "-17..-12 LUFS"),
}


def loudness(video):
    p = subprocess.run(["ffmpeg", "-v", "info", "-i", video, "-af",
                        "loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    m = re.search(r"\{[^{}]*input_i[^{}]*\}", p, re.S)
    if not m:
        return {"loudness_lufs": float("nan"), "true_peak_dbfs": float("nan")}
    j = json.loads(m.group(0))
    return {"loudness_lufs": float(j["input_i"]), "true_peak_dbfs": float(j["input_tp"])}


def check(video, beats=None):
    m = analyse(video, beats)
    m.update(loudness(video))
    rows, ok = [], True
    for name, (get, pred, rule) in LIMITS.items():
        try:
            v = get(m)
        except KeyError:
            continue
        if v != v:                                     # NaN -> can't judge
            rows.append((name, "n/a", rule, "SKIP")); continue
        good = pred(v)
        ok &= good
        rows.append((name, round(v, 3), rule, "PASS" if good else "FAIL"))
    return m, rows, ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--beats")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    all_ok = True
    for v in a.videos:
        m, rows, ok = check(v, a.beats)
        all_ok &= ok
        if a.json:
            print(json.dumps({"file": v, "metrics": m,
                              "checks": [dict(zip(("name", "value", "rule", "status"), r)) for r in rows]},
                             ensure_ascii=False))
        else:
            print(f"\n=== {Path(v).name}  {m['dur']}s  {m['cuts']} cuts ===")
            for n, val, rule, st in rows:
                print(f"  {st:4}  {n:<18} {val:<8} ({rule})")
    sys.exit(0 if all_ok else 1)
