#!/usr/bin/env python3
"""Measure audio delay between a rendered ad and its source music window.

Decodes both to mono 8 kHz, builds an onset-strength envelope (positive energy
difference), cross-correlates within +/-200 ms and prints the lag of the video's
audio relative to the source. A positive lag means the music inside the video
starts later than the source -- i.e. every cut lands early against the beat.
"""
import subprocess, sys
import numpy as np

def pcm(path, sr=8000):
    out = subprocess.run(["ffmpeg","-v","error","-i",path,"-ac","1","-ar",str(sr),
                          "-f","s16le","-"],capture_output=True).stdout
    return np.frombuffer(out,dtype=np.int16).astype(np.float32)/32768.0

def env(x, sr=8000, hop=80):                       # 10 ms hop
    n = len(x)//hop
    e = np.array([np.sqrt((x[i*hop:(i+1)*hop]**2).mean()+1e-12) for i in range(n)])
    d = np.diff(e, prepend=e[:1])
    return np.maximum(d, 0)

a, b = sys.argv[1], sys.argv[2]
ea, eb = env(pcm(a)), env(pcm(b))
n = min(len(ea), len(eb)); ea, eb = ea[:n], eb[:n]
ea = (ea-ea.mean())/(ea.std()+1e-9); eb = (eb-eb.mean())/(eb.std()+1e-9)
lags = range(-20, 21)                               # +/-200 ms in 10 ms steps
sc = [(np.corrcoef(ea[max(0,l):n+min(0,l)], eb[max(0,-l):n+min(0,-l)])[0,1], l) for l in lags]
best = max(sc)
print(f"{a.split('/')[-1]}: audio lag {best[1]*10:+d} ms (corr {best[0]:.3f})")
