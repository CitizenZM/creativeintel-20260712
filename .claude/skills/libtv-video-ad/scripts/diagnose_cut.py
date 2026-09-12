#!/usr/bin/env python3
"""Diagnose a finished ad: how much of it actually moves, where the cuts are,
and how those cuts sit against the music's beat grid.

Usage: diagnose_cut.py <video.mp4> [--beats beats.txt] [--json]
"""
import argparse, json, subprocess, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

def frames(video, fps=30, w=160):
    d = tempfile.mkdtemp()
    subprocess.run(["ffmpeg","-v","error","-y","-i",video,"-vf",f"fps={fps},scale={w}:-2",
                    "-q:v","4",f"{d}/f%05d.jpg"],check=True)
    fs = sorted(Path(d).glob("f*.jpg"))
    return [np.asarray(Image.open(f).convert("L"),dtype=np.float32) for f in fs], d

def analyse(video, beats=None, fps=30):
    fr,_ = frames(video, fps)
    n = len(fr)
    diff = np.array([np.abs(fr[i]-fr[i-1]).mean() for i in range(1,n)])   # motion per frame
    t = np.arange(1,n)/fps
    cut_idx = [i for i in range(len(diff)) if diff[i] > 18 and diff[i] > 3*np.median(diff)]
    # merge adjacent detections
    cuts=[]
    for i in cut_idx:
        if not cuts or t[i]-cuts[-1] > 0.12: cuts.append(round(float(t[i]),3))
    motion = diff.copy()
    for i in cut_idx: motion[i] = np.nan                                   # ignore cut spikes
    m = motion[~np.isnan(motion)]
    static = float((m < 1.0).mean())          # share of frames with almost no movement
    slow  = float((m < 2.5).mean())
    # longest near-static run in seconds
    run=best=0
    for v in m:
        run = run+1 if v < 1.5 else 0
        best = max(best,run)
    out = {"file": Path(video).name, "frames": n, "dur": round(n/fps,2),
           "cuts": len(cuts), "cut_times": cuts,
           "avg_shot_s": round((n/fps)/max(len(cuts)+1,1),2),
           "static_share": round(static,3), "lowmotion_share": round(slow,3),
           "longest_static_s": round(best/fps,2),
           "motion_mean": round(float(m.mean()),2)}
    if beats:
        b=[float(x) for x in Path(beats).read_text().split()]
        offs=[round((c-min(b,key=lambda y:abs(y-c)))*1000) for c in cuts]
        out["beat_offsets_ms"]=offs
        if offs:
            out["beat_bias_ms"]=round(float(np.mean(offs)),1)
            out["beat_jitter_ms"]=round(float(np.std(offs)),1)
            out["beat_max_ms"]=int(max(map(abs,offs)))
        # how many beats have NO cut or visual accent within 80ms
        acc=[]
        for bb in b:
            i=int(bb*fps)-1
            if 0<=i<len(diff): acc.append(diff[i])
        out["beats_total"]=len(b)
        out["beats_with_cut"]=sum(1 for bb in b if any(abs(bb-c)<0.08 for c in cuts))
    return out

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("--beats"); ap.add_argument("--json",action="store_true")
    a=ap.parse_args(); r=analyse(a.video,a.beats)
    print(json.dumps(r,ensure_ascii=False) if a.json else
          "\n".join(f"{k}: {v}" for k,v in r.items()))
