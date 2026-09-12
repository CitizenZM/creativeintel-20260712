#!/usr/bin/env python3
"""Original synthesised SFX — no library, no licence question.

Three sounds, all generated from noise and sine primitives so nothing is sampled from a
third-party pack:

    whoosh(dur)   swept-noise transition sweetener, used on whip / zoom boundaries
    impact(dur)   low sine thump + click, used on section changes and the drop
    click(dur)    short UI blip, used when the CTA and the logo land

`bed(events, dur)` renders them onto a stereo 48 kHz bed and `write_wav` saves it; the build
script mixes that bed under the music with ffmpeg `amix`, then `loudnorm` normalises the sum.
"""
import struct
import numpy as np

SR = 48000


def _env(n, attack=0.01, decay=0.9, power=2.0):
    a = int(n * attack)
    e = np.ones(n)
    if a:
        e[:a] = np.linspace(0, 1, a)
    e[a:] = np.linspace(1, 0, n - a) ** power
    return e * decay


def whoosh(dur=0.45, up=True, seed=0):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = rng.normal(0, 1, n)
    # time-varying one-pole low-pass: cutoff sweeps 300 Hz -> 6 kHz (or back)
    f = np.linspace(300, 6000, n) if up else np.linspace(6000, 300, n)
    a = np.exp(-2 * np.pi * f / SR)
    y = np.empty(n)
    prev = 0.0
    for i in range(n):
        prev = (1 - a[i]) * x[i] + a[i] * prev
        y[i] = prev
    y *= _env(n, 0.25, 1.0, 1.6)
    return y / (np.abs(y).max() + 1e-9)


def impact(dur=0.35, f0=120.0, seed=1):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * np.exp(-t * 9)                                  # pitch drop
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)
    tick = rng.normal(0, 1, n) * np.exp(-t * 90) * 0.35
    y = body + tick
    return y / (np.abs(y).max() + 1e-9)


def click(dur=0.06, f=2200.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 70)
    return y / (np.abs(y).max() + 1e-9)


def bed(events, dur, gain_db=-17.0):
    """events: list of (time_s, kind, level) with kind in whoosh|whoosh_down|impact|click."""
    n = int(dur * SR)
    out = np.zeros(n)
    for i, (t0, kind, lvl) in enumerate(events):
        s = {"whoosh": lambda: whoosh(seed=i), "whoosh_down": lambda: whoosh(up=False, seed=i),
             "impact": lambda: impact(seed=i), "click": click}[kind]()
        a = int(t0 * SR)
        if kind.startswith("whoosh"):                        # centre the swell on the beat
            a -= len(s) // 2
        a = max(a, 0)
        b = min(a + len(s), n)
        out[a:b] += s[:b - a] * lvl
    peak = np.abs(out).max()
    if peak > 0:
        out = out / peak * (10 ** (gain_db / 20))
    return out


def write_wav(path, mono):
    data = np.clip(np.stack([mono, mono], 1).ravel(), -1, 1)
    pcm = (data * 32767).astype("<i2").tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 2, SR, SR * 4, 4, 16))
        f.write(b"data" + struct.pack("<I", len(pcm)) + pcm)
    return path
