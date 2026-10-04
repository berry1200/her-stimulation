#!/usr/bin/env python3
"""Measure a music track's beat grid and write beats.json for beat-synced motion.

Uses librosa when installed (more accurate); otherwise falls back to a
dependency-free energy-onset detector that decodes audio with ffmpeg.

Usage:
  python beats.py track.mp3 --out beats.json
  python beats.py track.mp3 --out beats.json --bpm 120     # force tempo, detect phase only

Output:
  {"tempo": 118.2, "beats": [0.51, 1.02, ...], "downbeats": [...every 4th...],
   "onsets": [...strong hits...], "duration": 31.4, "method": "librosa" | "energy"}

Pass it to the renderer with: node render.mjs film.html --beats beats.json ...
(the film reads window.BEATS). Cut and land hits on beats, not between them.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from array import array
from pathlib import Path

SR = 11025
HOP = 128
WIN = 512
# An onset registers as soon as its attack enters the analysis window, so frames are
# stamped near the window's end (calibrated on synthetic kicks at 92-128 BPM).
OFFSET = WIN * 0.85 / SR


def detect_librosa(path: Path, bpm: float | None):
    import librosa  # noqa: PLC0415 (optional dependency)

    y, sr = librosa.load(str(path), sr=22050, mono=True)
    kwargs = {"bpm": bpm} if bpm else {}
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames", **kwargs)
    beats = librosa.frames_to_time(frames, sr=sr).tolist()
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames")
    onsets = librosa.frames_to_time(onset_frames, sr=sr).tolist()
    tempo = float(tempo[0]) if hasattr(tempo, "__len__") else float(tempo)
    return tempo, beats, onsets, len(y) / sr


def decode(path: Path) -> array:
    if not shutil.which("ffmpeg"):
        sys.exit("error: ffmpeg not found on PATH")
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True, check=True).stdout
    samples = array("h")
    samples.frombytes(raw[: len(raw) // 2 * 2])
    if sys.byteorder == "big":
        samples.byteswap()
    return samples


def onset_envelope(samples: array) -> list[float]:
    n_frames = max(0, (len(samples) - WIN) // HOP + 1)
    prefix = [0.0]
    acc = 0.0
    for v in samples:
        acc += v * v
        prefix.append(acc)
    log_e = [math.log1p((prefix[i * HOP + WIN] - prefix[i * HOP]) / WIN) for i in range(n_frames)]
    env = [0.0] + [max(0.0, log_e[i] - log_e[i - 1]) for i in range(1, len(log_e))]
    # subtract a local mean (~0.5s) so sustained loudness doesn't read as onsets
    k = max(1, int(0.25 * SR / HOP))
    csum = [0.0]
    for v in env:
        csum.append(csum[-1] + v)
    out = []
    for i, v in enumerate(env):
        a, b = max(0, i - k), min(len(env), i + k + 1)
        out.append(max(0.0, v - (csum[b] - csum[a]) / (b - a)))
    return out


def _grid_score(env: list[float], lag: float) -> float:
    lo, frac = int(lag), lag - int(lag)
    return sum(env[i] * ((1 - frac) * env[i + lo] + frac * env[i + lo + 1]) for i in range(len(env) - lo - 1))


def estimate_period(env: list[float], bpm: float | None) -> float:
    fps = SR / HOP
    if bpm:
        return 60.0 * fps / bpm
    env = env[: int(60 * fps)]  # the first minute is plenty for tempo
    # coarse pass with a log-gaussian prior around 120 BPM (reduces half/double-tempo mistakes)
    coarse = max((x / 2 for x in range(120, 401)),
                 key=lambda b: _grid_score(env, 60.0 * fps / b)
                 * math.exp(-0.5 * (math.log2(b / 120.0) / 0.9) ** 2))
    fine = max((coarse + d / 20 for d in range(-40, 41)), key=lambda b: _grid_score(env, 60.0 * fps / b))
    return 60.0 * fps / fine


def detect_energy(path: Path, bpm: float | None):
    samples = decode(path)
    duration = len(samples) / SR
    env = onset_envelope(samples)
    if not env or max(env) == 0:
        return (bpm or 120.0), [], [], duration
    fps = SR / HOP
    period = estimate_period(env, bpm)

    # choose the phase whose beat grid lands on the most onset energy
    best_phase, best_score = 0.0, -1.0
    steps = max(1, int(period * 4))
    for s in range(steps):
        phase = s * period / steps
        score, t = 0.0, phase
        while t < len(env):
            score += env[int(t)]
            t += period
        if score > best_score:
            best_phase, best_score = phase, score

    # snap grid points to nearby strong onsets, then fit a straight line (time = a + b*k)
    # so the output is a steady grid with an accurate tempo rather than jittery peaks
    win = max(1, int(period * 0.12))
    strong = sorted(env, reverse=True)[: max(1, len(env) // 20)]
    floor = 0.3 * strong[-1] if strong else 0.0
    pts, k, t = [], 0, best_phase
    while t < len(env):
        c = int(round(t))
        lo, hi = max(0, c - win), min(len(env), c + win + 1)
        if hi > lo:
            peak = max(range(lo, hi), key=lambda i: env[i])
            if env[peak] > floor:
                pts.append((k, peak))
        k += 1
        t += period
    a, b = best_phase, period
    if len(pts) >= 4:
        n = len(pts)
        mk = sum(p[0] for p in pts) / n
        mt = sum(p[1] for p in pts) / n
        var = sum((p[0] - mk) ** 2 for p in pts)
        if var > 0:
            b = sum((p[0] - mk) * (p[1] - mt) for p in pts) / var
            a = mt - b * mk
    first, step, end = a / fps + OFFSET, b / fps, len(env) / fps + OFFSET
    while first - step >= -0.03:      # extend the grid back to the start (keeps a beat at ~0s)
        first -= step
    beats, t = [], first
    while t < end:
        beats.append(round(max(0.0, t), 3))
        t += step
    period = b

    mean = sum(env) / len(env)
    sd = math.sqrt(sum((v - mean) ** 2 for v in env) / len(env))
    thresh, min_gap = mean + 1.5 * sd, int(0.1 * fps)
    onsets, last = [], -min_gap
    for i in range(1, len(env) - 1):
        if env[i] > thresh and env[i] >= env[i - 1] and env[i] >= env[i + 1] and i - last >= min_gap:
            onsets.append(round(i / fps + OFFSET, 3))
            last = i
    return 60.0 * fps / period, beats, onsets, duration


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("audio", type=Path)
    p.add_argument("--out", type=Path, default=Path("beats.json"))
    p.add_argument("--bpm", type=float, help="force a known tempo")
    p.add_argument("--fallback", action="store_true", help="skip librosa even if installed")
    args = p.parse_args()
    if not args.audio.exists():
        print(f"error: {args.audio} not found", file=sys.stderr)
        return 2

    method = "energy"
    if not args.fallback:
        try:
            tempo, beats, onsets, duration = detect_librosa(args.audio, args.bpm)
            method = "librosa"
        except ImportError:
            tempo, beats, onsets, duration = detect_energy(args.audio, args.bpm)
    else:
        tempo, beats, onsets, duration = detect_energy(args.audio, args.bpm)

    result = {
        "tempo": round(tempo, 1),
        "beats": [round(b, 3) for b in beats],
        "downbeats": [round(b, 3) for b in beats[::4]],
        "onsets": [round(o, 3) for o in onsets],
        "duration": round(duration, 3),
        "method": method,
    }
    args.out.write_text(json.dumps(result, indent=1))
    print(f"Wrote {args.out}: {result['tempo']} BPM, {len(beats)} beats, {len(onsets)} onsets "
          f"over {result['duration']}s (method: {method})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
