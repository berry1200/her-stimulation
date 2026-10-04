#!/usr/bin/env python3
"""Export any video as a platform-ready vertical (9:16) MP4 with ffmpeg.

- Reframes to 1080x1920: center crop, blurred-background fill (for landscape
  footage), or padding.
- Optionally burns in captions from an .srt, styled for social and placed
  inside the Reels/TikTok/Shorts safe zone.
- Normalises loudness to -14 LUFS, encodes H.264/AAC with faststart.

Examples:
  python vertical_export.py raw.mov out.mp4
  python vertical_export.py landscape.mp4 out.mp4 --mode blur --captions captions.srt
  python vertical_export.py raw.mp4 out.mp4 --start 2.5 --end 34 --dry-run

Caption timings in the .srt are relative to the *output* (after trimming).
Use --captions-offset to shift them if needed.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def hex_to_ass(color: str, alpha: int = 0) -> str:
    """'FFCC00' -> '&H0000CCFF' (ASS uses AABBGGRR)."""
    c = color.lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", c):
        raise ValueError(f"color must be 6 hex digits, got {color!r}")
    r, g, b = c[0:2], c[2:4], c[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def srt_time_to_seconds(ts: str) -> float:
    h, m, rest = ts.strip().split(":")
    s, ms = rest.replace(".", ",").split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def seconds_to_ass(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def parse_srt(path: Path) -> list[tuple[float, float, str]]:
    content = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    cues = []
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = [l for l in block.split("\n") if l.strip()]
        timing_idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if timing_idx is None:
            continue
        start_s, end_s = [p.strip().split(" ")[0] for p in lines[timing_idx].split("-->")]
        text = "\\N".join(lines[timing_idx + 1:])
        cues.append((srt_time_to_seconds(start_s), srt_time_to_seconds(end_s), text))
    return cues


def build_ass(cues, args) -> str:
    margin_v = int(round(args.height * (1.0 - args.caption_y)))
    style = (
        f"Style: Caption,{args.font},{args.font_size},{hex_to_ass(args.text_color)},"
        f"{hex_to_ass(args.text_color)},{hex_to_ass(args.outline_color)},{hex_to_ass('000000', 0x80)},"
        f"-1,0,0,0,100,100,0,0,1,{args.outline},0,2,{args.margin_left},{args.margin_right},{margin_v},1"
    )
    header = "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {args.width}",
        f"PlayResY: {args.height}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        style,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    events = []
    for start, end, text in cues:
        start += args.captions_offset
        end += args.captions_offset
        if end <= 0:
            continue
        if args.uppercase:
            text = text.upper()
        text = text.replace("{", "(").replace("}", ")")
        events.append(f"Dialogue: 0,{seconds_to_ass(start)},{seconds_to_ass(end)},Caption,,0,0,0,,{text}")
    return header + "\n" + "\n".join(events) + "\n"


def filter_path(p: Path) -> str:
    """Escape a path for use inside an ffmpeg filtergraph option."""
    s = p.resolve().as_posix()
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def has_audio(path: Path) -> bool:
    if not shutil.which("ffprobe"):
        return True
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "json",
         str(path)],
        capture_output=True, text=True)
    try:
        return bool(json.loads(out.stdout or "{}").get("streams"))
    except json.JSONDecodeError:
        return True


def build_video_filter(args, ass_path: Path | None) -> str:
    w, h = args.width, args.height
    if args.mode == "crop":
        chain = f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    elif args.mode == "pad":
        chain = (f"[0:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                 f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")
    else:  # blur
        chain = (f"[0:v]split=2[bg][fg];"
                 f"[bg]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=40:2,"
                 f"eq=brightness=-0.08[bgb];"
                 f"[fg]scale={w}:{h}:force_original_aspect_ratio=decrease[fgs];"
                 f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1")
    if args.fps:
        chain += f",fps={args.fps}"
    if ass_path is not None:
        chain += f",ass=filename='{filter_path(ass_path)}'"
    return chain + "[vout]"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--mode", choices=["crop", "blur", "pad"], default="crop",
                   help="crop = fill frame (default); blur = fit with blurred background; pad = fit with bars")
    p.add_argument("--captions", type=Path, help=".srt file to burn in")
    p.add_argument("--captions-offset", type=float, default=0.0, help="shift caption times (seconds)")
    p.add_argument("--font", default="Arial", help="caption font family (falls back via fontconfig)")
    p.add_argument("--font-size", type=int, default=72, help="caption size in px at 1080x1920")
    p.add_argument("--text-color", default="FFFFFF")
    p.add_argument("--outline-color", default="000000")
    p.add_argument("--outline", type=int, default=6, help="outline thickness in px")
    p.add_argument("--caption-y", type=float, default=0.70,
                   help="where the bottom of the caption sits, as a fraction of frame height (0.70 keeps it "
                        "above the bottom UI)")
    p.add_argument("--margin-left", type=int, default=90)
    p.add_argument("--margin-right", type=int, default=150, help="extra space for the right-side buttons")
    p.add_argument("--uppercase", action="store_true", help="render captions in uppercase")
    p.add_argument("--start", type=float, help="trim: start time in seconds")
    p.add_argument("--end", type=float, help="trim: end time in seconds (of the source)")
    p.add_argument("--width", type=int, default=1080)
    p.add_argument("--height", type=int, default=1920)
    p.add_argument("--fps", type=float, default=None, help="force frame rate (default: keep source)")
    p.add_argument("--crf", type=int, default=18, help="x264 quality (lower = better/larger)")
    p.add_argument("--lufs", type=float, default=-14.0, help="integrated loudness target")
    p.add_argument("--no-loudnorm", action="store_true", help="skip loudness normalisation")
    p.add_argument("--dry-run", action="store_true", help="print the ffmpeg command without running it")
    p.add_argument("-y", "--overwrite", action="store_true")
    args = p.parse_args(argv)

    if not shutil.which("ffmpeg"):
        print("error: ffmpeg not found on PATH. Install it (e.g. `brew install ffmpeg` / `apt install ffmpeg`).",
              file=sys.stderr)
        return 2
    if not args.input.exists():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 2
    if args.output.exists() and not args.overwrite and not args.dry_run:
        print(f"error: {args.output} exists (use -y to overwrite)", file=sys.stderr)
        return 2
    if args.start is not None and args.end is not None and args.end <= args.start:
        print("error: --end must be greater than --start", file=sys.stderr)
        return 2

    tmpdir = Path(tempfile.mkdtemp(prefix="vexport_"))
    ass_path = None
    if args.captions:
        if not args.captions.exists():
            print(f"error: captions not found: {args.captions}", file=sys.stderr)
            return 2
        cues = parse_srt(args.captions)
        if not cues:
            print("error: no cues parsed from the .srt", file=sys.stderr)
            return 2
        ass_path = tmpdir / "captions.ass"
        ass_path.write_text(build_ass(cues, args), encoding="utf-8")

    cmd = ["ffmpeg", "-hide_banner", "-y" if (args.overwrite or args.dry_run) else "-n"]
    if args.start is not None:
        cmd += ["-ss", f"{args.start}"]
    cmd += ["-i", str(args.input)]
    if args.end is not None:
        duration = args.end - (args.start or 0.0)
        cmd += ["-t", f"{duration}"]

    cmd += ["-filter_complex", build_video_filter(args, ass_path), "-map", "[vout]"]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf), "-profile:v", "high",
            "-pix_fmt", "yuv420p"]

    if has_audio(args.input):
        cmd += ["-map", "0:a:0"]
        if not args.no_loudnorm:
            cmd += ["-af", f"loudnorm=I={args.lufs}:TP=-1.5:LRA=11,aresample=48000"]
        cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    cmd += ["-movflags", "+faststart", str(args.output)]

    print(" ".join(shlex.quote(c) for c in cmd))
    if args.dry_run:
        if ass_path:
            print(f"(captions converted to {ass_path})")
        return 0

    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"Exported {args.output} ({args.width}x{args.height}, mode={args.mode}"
              f"{', captions' if ass_path else ''}{'' if args.no_loudnorm else f', {args.lufs} LUFS'})")
    shutil.rmtree(tmpdir, ignore_errors=True)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
