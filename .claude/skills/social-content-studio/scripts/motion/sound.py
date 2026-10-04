#!/usr/bin/env python3
"""Sound design in code: synthesize SFX and a simple music bed, then mix them onto a video.

Everything is generated with ffmpeg filters, so there are no licensing questions and
no extra dependencies. The results are clean but basic; for hero pieces use a licensed
track (see references/compliance.md) and keep these for hits, whooshes and ticks.

Usage:
  python sound.py sfx whoosh --out whoosh.wav          # presets: whoosh hit pop tick riser
  python sound.py bed --bpm 110 --duration 12 --out bed.wav
  python sound.py mix --video silent.mp4 --cues cues.json [--music bed.wav --music-gain -10] --out final.mp4

cues.json lists sounds placed on the timeline (seconds). "sfx" is a preset name or a path:
  [{"t": 0.0, "sfx": "hit"}, {"t": 2.6, "sfx": "whoosh", "gain": -4}, {"t": 6.7, "sfx": "riser"}]
Tip: build cue times from beats.json so hits land on the beat.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RATE = 48000

# Each preset is an ffmpeg lavfi source + filter chain producing a short mono clip.
PRESETS = {
    # filtered pink noise swelling in and out
    "whoosh": ("anoisesrc=d=0.7:c=pink:a=0.6:r={r}",
               "highpass=f=350,lowpass=f=7000,afade=t=in:d=0.4:curve=exp,afade=t=out:st=0.4:d=0.3:curve=exp"),
    # pitch-dropping kick for impacts and slams
    "hit": ("aevalsrc='0.95*sin(2*PI*(45*t+5*(1-exp(-25*t))))*exp(-7*t)':d=0.9:s={r}", "alimiter=limit=0.95"),
    # short bright blip for text pops and UI taps
    "pop": ("aevalsrc='0.6*sin(2*PI*(1400*t-2500*t*t))*exp(-35*t)':d=0.18:s={r}", "highpass=f=200"),
    # tiny click for counters and ticks
    "tick": ("aevalsrc='0.5*sin(2*PI*2400*t)*exp(-140*t)':d=0.06:s={r}", "highpass=f=800"),
    # rising chirp that builds into a reveal
    "riser": ("aevalsrc='0.35*sin(2*PI*(180*t+170*t*t))*(t/1.8)':d=1.8:s={r}",
              "afade=t=out:st=1.7:d=0.1,highpass=f=120"),
}


def need_ffmpeg() -> None:
    if not shutil.which("ffmpeg"):
        sys.exit("error: ffmpeg not found on PATH")


def ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def make_sfx(name: str, out: Path) -> Path:
    if name not in PRESETS:
        sys.exit(f"error: unknown preset {name!r}; choose from {', '.join(PRESETS)}")
    src, chain = PRESETS[name]
    ffmpeg(["-f", "lavfi", "-i", src.format(r=RATE), "-af", chain, "-ac", "2", "-ar", str(RATE), str(out)])
    return out


def make_bed(bpm: float, duration: float, out: Path) -> Path:
    b = 60.0 / bpm
    kick = f"0.8*sin(2*PI*(45*mod(t,{b})+4*(1-exp(-30*mod(t,{b})))))*exp(-9*mod(t,{b}))"
    hat_t = f"mod(t+{b / 2},{b})"
    hat = f"0.12*(sin(2*PI*7100*t)+sin(2*PI*9300*t))*exp(-90*{hat_t})"
    # A-minor pad (A3, C4, E4) with a slow swell
    pad = "0.07*(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t))*(0.6+0.4*sin(2*PI*t/8))"
    expr = f"{kick}+{hat}+{pad}"
    ffmpeg(["-f", "lavfi", "-i", f"aevalsrc='{expr}':d={duration}:s={RATE}",
            "-af", f"lowpass=f=12000,afade=t=in:d=0.3,afade=t=out:st={max(0.0, duration - 0.8)}:d=0.8",
            "-ac", "2", "-ar", str(RATE), str(out)])
    return out


def measure_lufs(path: Path) -> float:
    """Integrated loudness (LUFS) via ffmpeg's EBU R128 meter."""
    res = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=framelog=quiet",
                          "-f", "null", "-"], capture_output=True, text=True)
    values = re.findall(r"I:\s+(-?[\d.]+) LUFS", res.stderr)
    if not values:
        sys.exit("error: could not measure loudness")
    return float(values[-1])


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                          "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())


def mix(video: Path, cues_path: Path | None, music: Path | None, music_gain: float, out: Path,
        lufs: float) -> None:
    cues = json.loads(cues_path.read_text()) if cues_path else []
    duration = probe_duration(video)
    tmp = Path(tempfile.mkdtemp(prefix="sound_"))
    inputs, filters, labels = ["-i", str(video)], [], []
    idx = 1
    cache: dict[str, Path] = {}
    for n, cue in enumerate(cues):
        sfx = str(cue["sfx"])
        if sfx in PRESETS:
            if sfx not in cache:
                cache[sfx] = make_sfx(sfx, tmp / f"{sfx}.wav")
            src = cache[sfx]
        else:
            src = Path(sfx)
            if not src.exists():
                sys.exit(f"error: cue {n}: {sfx} is not a preset or an existing file")
        delay_ms = max(0, int(round(float(cue["t"]) * 1000)))
        inputs += ["-i", str(src)]
        filters.append(f"[{idx}:a]aresample={RATE},adelay={delay_ms}:all=1,volume={float(cue.get('gain', 0))}dB[c{n}]")
        labels.append(f"[c{n}]")
        idx += 1
    if music:
        inputs += ["-i", str(music)]
        filters.append(f"[{idx}:a]aresample={RATE},volume={music_gain}dB[mus]")
        labels.append("[mus]")
        idx += 1
    if not labels:
        sys.exit("error: nothing to mix (pass --cues and/or --music)")
    filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,"
                   f"apad,atrim=0:{duration}[aout]")
    # Pass 1: render the raw mix and measure it. Single-pass loudnorm undershoots on short,
    # punchy mixes, so apply a measured gain and a peak limiter instead.
    raw = tmp / "mix.wav"
    ffmpeg([*inputs, "-filter_complex", ";".join(filters), "-map", "[aout]", "-c:a", "pcm_s16le",
            "-ar", str(RATE), str(raw)])
    # The limiter shaves loudness off transients, so re-measure and correct until within 0.3 LU.
    gain, chain, measured = lufs - measure_lufs(raw), "", None
    for _ in range(4):
        chain = f"volume={gain:.2f}dB,alimiter=limit=0.84:level=disabled"
        limited = tmp / "limited.wav"
        ffmpeg(["-i", str(raw), "-af", chain, "-c:a", "pcm_s16le", "-ar", str(RATE), str(limited)])
        measured = measure_lufs(limited)
        if abs(lufs - measured) < 0.3:
            break
        gain += lufs - measured
    ffmpeg(["-i", str(video), "-i", str(raw), "-map", "0:v", "-map", "1:a",
            "-af", f"{chain},aresample={RATE}",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", str(duration),
            str(out)])
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"Wrote {out}: {len(cues)} cues{' + music' if music else ''}, {duration:.2f}s, "
          f"{measured:.1f} LUFS (target {lufs})")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sfx", help="render one SFX preset")
    s.add_argument("name", choices=sorted(PRESETS))
    s.add_argument("--out", type=Path, required=True)
    b = sub.add_parser("bed", help="render a simple beat + pad bed")
    b.add_argument("--bpm", type=float, default=110)
    b.add_argument("--duration", type=float, required=True)
    b.add_argument("--out", type=Path, required=True)
    m = sub.add_parser("mix", help="mix cues and/or music onto a video")
    m.add_argument("--video", type=Path, required=True)
    m.add_argument("--cues", type=Path)
    m.add_argument("--music", type=Path)
    m.add_argument("--music-gain", type=float, default=-8.0)
    m.add_argument("--lufs", type=float, default=-14.0)
    m.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    need_ffmpeg()

    if args.cmd == "sfx":
        make_sfx(args.name, args.out)
        print(f"Wrote {args.out}")
    elif args.cmd == "bed":
        make_bed(args.bpm, args.duration, args.out)
        print(f"Wrote {args.out} ({args.bpm} BPM, {args.duration}s)")
    else:
        mix(args.video, args.cues, args.music, args.music_gain, args.out, args.lufs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
