#!/usr/bin/env python3
"""
HER Simulation Video Editor — Claude Opus 5.5 + ffmpeg

Claude Opus 5.5 does not generate or render video. It *watches* timestamped
frames sampled from a screen recording of the Gazebo simulation, decides
which moments to keep, how fast to play them and what to caption, and returns
a structured edit plan. ffmpeg then cuts and renders the final MP4.

Usage:
    python claude_video_editor.py her_sim_raw.mp4 --out her_sim_edit.mp4
    python claude_video_editor.py her_sim_raw.mp4 --plan-only        # plan JSON only
    python claude_video_editor.py her_sim_raw.mp4 --plan my_plan.json  # render a saved plan, no API call
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap

from pydantic import BaseModel

MODEL = 'claude-opus-5-5'

# Allowed playback speed range for a clip (1.0 = real time)
MIN_SPEED, MAX_SPEED = 0.25, 8.0
MIN_CLIP_S = 0.3
MAX_FRAMES = 100   # the API accepts at most 100 images per request

SYSTEM_PROMPT = """You are a video editor cutting a screen recording of a Gazebo robotics simulation.

The recording shows a 2-DOF robot arm in a virtual laboratory running a 6-step
Hydrogen Evolution Reaction (HER) electrocatalyst test protocol on 10 catalysts:
1 PICK at S1 Sample Storage, 2 DISPENSE at S2 Electrolyte Prep, 3 IMMERSE at S3
Electrochemical Cell, 4 MEASURE (LSV sweep) and 5 ANALYSE (Tafel) at S4
Potentiostat, 6 LOG at S5 Data Logger. Each catalyst repeats the same cycle.

You receive frames sampled from the recording, each labelled with its timestamp.
Return an edit plan:
- clips: chronological, non-overlapping [start_s, end_s] ranges of the source,
  each with a playback speed (1.0 = real time, up to 8.0 to compress repetitive
  or idle stretches) and a short on-screen caption (under 60 characters, or an
  empty string for no caption).
- title: a short title card for the start of the video.
- narration: a voice-over script timed to the edited cut.

Show one full protocol cycle at a watchable pace so a viewer understands every
step, then compress the repeated cycles. Only reference times that exist in the
recording."""


# ── Edit plan schema (returned by Claude as structured output) ──
class Clip(BaseModel):
    start_s: float
    end_s: float
    speed: float
    caption: str


class EditPlan(BaseModel):
    title: str
    clips: list[Clip]
    narration: str


# ── ffmpeg helpers ──
def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f'Command failed: {" ".join(cmd)}\n{result.stderr[-2000:]}')
    return result.stdout


def probe(video):
    """Return duration (s), width, height and frame rate of the first video stream."""
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
               '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
               '-of', 'json', video])
    info = json.loads(out)
    stream = info['streams'][0]
    num, den = stream['r_frame_rate'].split('/')
    fps = float(num) / float(den) if float(den) else 0.0
    if not 1.0 <= fps <= 60.0:   # variable-frame-rate screen captures can report nonsense
        fps = 30.0
    return float(info['format']['duration']), int(stream['width']), int(stream['height']), fps


def extract_frames(video, duration, interval, max_frames, workdir, width=768):
    """Grab one JPEG every `interval` seconds; widen the interval to stay under max_frames."""
    max_frames = min(max_frames, MAX_FRAMES)
    interval = max(interval, duration / max_frames)
    frames = []
    t = 0.0
    while t < duration - 0.1 and len(frames) < max_frames:
        path = os.path.join(workdir, f'frame_{len(frames):04d}.jpg')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', video,
             '-frames:v', '1', '-vf', f'scale={width}:-2', '-q:v', '4', path])
        if os.path.exists(path):
            frames.append((t, path))
        t += interval
    return frames


# ── Claude: frames in, edit plan out ──
def plan_edit(frames, duration, brief, target_s, effort):
    import anthropic

    content = []
    for t, path in frames:
        with open(path, 'rb') as f:
            data = base64.standard_b64encode(f.read()).decode('utf-8')
        content.append({'type': 'text', 'text': f't={t:.1f}s'})
        content.append({'type': 'image',
                        'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': data}})
    content.append({'type': 'text', 'text': (
        f'Recording length: {duration:.1f}s. Target edited length: about {target_s}s '
        f'(including a 3s title card).\n\nBrief: {brief}')})

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            # Server-side fallback: if a safety classifier declines, the API
            # retries on Anthropic's recommended fallback model in the same call.
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
            output_config={'effort': effort},
            system=SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': content}],
            output_format=EditPlan,
        )
    except anthropic.AuthenticationError:
        sys.exit('Authentication failed: set ANTHROPIC_API_KEY (see video_pipeline/README.md).')
    except anthropic.BadRequestError as e:
        sys.exit(f'Request rejected: {e.message}')
    except anthropic.RateLimitError:
        sys.exit('Rate limited: wait a minute and retry, or lower --max-frames.')
    except anthropic.APIStatusError as e:
        sys.exit(f'API error {e.status_code}: {e.message}')
    except anthropic.APIConnectionError:
        sys.exit('Network error: could not reach the Claude API.')

    if response.stop_reason == 'refusal':
        sys.exit('Claude declined to plan this edit.')
    if response.stop_reason == 'max_tokens' or response.parsed_output is None:
        sys.exit('Edit plan was cut off; retry with fewer frames (--max-frames).')

    u = response.usage
    print(f'  Claude ({response.model}): {u.input_tokens} input / {u.output_tokens} output tokens')
    return response.parsed_output


def clean_plan(plan, duration):
    """Clamp the plan to the recording and remove overlaps so ffmpeg never sees bad ranges."""
    clips = []
    last_end = 0.0
    for c in sorted(plan.clips, key=lambda c: c.start_s):
        start = max(c.start_s, last_end, 0.0)
        end = min(c.end_s, duration)
        if end - start < MIN_CLIP_S:
            continue
        speed = min(max(c.speed, MIN_SPEED), MAX_SPEED)
        clips.append(Clip(start_s=round(start, 3), end_s=round(end, 3),
                          speed=speed, caption=c.caption.strip()))
        last_end = end
    if not clips:
        sys.exit('Edit plan has no usable clips.')
    return EditPlan(title=plan.title.strip(), clips=clips, narration=plan.narration)


# ── Render with ffmpeg ──
def render(video, plan, out, width, height, fps, workdir, font_file=None, title_s=3.0):
    w, h = width - width % 2, height - height % 2   # libx264 + yuv420p need even sizes
    font = f"fontfile='{font_file}'" if font_file else 'font=Sans'
    # Centre each wrapped line (ffmpeg >= 6.1); older builds left-align the block
    align = ':text_align=C' if 'text_align' in run(['ffmpeg', '-v', 'error', '-h', 'filter=drawtext']) else ''

    def text_opts(i, text, size_div, max_lines, y):
        # drawtext never wraps: shrink and wrap so the text fits 90% of the frame width
        size = h / size_div
        while True:
            chars = max(int(0.9 * w / (0.6 * size)), 8)
            lines = textwrap.wrap(text, chars) or ['']
            if len(lines) <= max_lines or size < 12:
                break
            size *= 0.9
        # Text goes through textfile= so quotes, colons and % need no escaping
        path = os.path.join(workdir, f'text_{i}.txt')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        return (f"drawtext={font}:textfile='{path}':expansion=none:fontcolor=white:"
                f'fontsize={int(size)}:line_spacing={int(size * 0.25)}{align}:'
                f'box=1:boxcolor=black@0.55:boxborderw={int(size * 0.5)}:'
                f'x=(w-text_w)/2:y={y}')

    chains, labels = [], []
    if plan.title:
        chains.append(f'color=c=0x101418:s={w}x{h}:r={fps:.3f}:d={title_s},format=yuv420p,'
                      f"{text_opts('title', plan.title, 14, 3, '(h-text_h)/2')},setsar=1[title]")
        labels.append('[title]')
    for i, c in enumerate(plan.clips):
        chain = (f'[0:v]trim=start={c.start_s}:end={c.end_s},'
                 f'setpts=(PTS-STARTPTS)/{c.speed},fps={fps:.3f},'
                 f'scale={w}:{h},format=yuv420p,setsar=1')
        if c.caption:
            chain += ',' + text_opts(i, c.caption, 22, 2, 'h-text_h-h/12')
        chains.append(chain + f'[v{i}]')
        labels.append(f'[v{i}]')
    chains.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[out]")

    run(['ffmpeg', '-v', 'error', '-y', '-i', video,
         '-filter_complex', ';'.join(chains), '-map', '[out]',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
         '-movflags', '+faststart', out])


def main():
    parser = argparse.ArgumentParser(description='Edit a HER simulation recording with Claude Opus 5.5 + ffmpeg.')
    parser.add_argument('video', help='source recording (MP4/MKV/WebM)')
    parser.add_argument('--out', default='her_sim_edit.mp4', help='edited output video')
    parser.add_argument('--brief', default='A highlight video of the virtual HER laboratory '
                        'for a dissertation presentation.', help='what the edit is for')
    parser.add_argument('--target', type=int, default=60, help='target edited length in seconds')
    parser.add_argument('--interval', type=float, default=2.0, help='seconds between sampled frames')
    parser.add_argument('--max-frames', type=int, default=60, help=f'frames sent to Claude (max {MAX_FRAMES})')
    parser.add_argument('--effort', default='high', choices=['low', 'medium', 'high', 'xhigh', 'max'])
    parser.add_argument('--plan', help='render this saved plan JSON instead of calling Claude')
    parser.add_argument('--plan-only', action='store_true', help='write the plan JSON and stop')
    parser.add_argument('--font-file', help='TTF/OTF font for captions (default: fontconfig "Sans")')
    args = parser.parse_args()

    for tool in ('ffmpeg', 'ffprobe'):
        if not shutil.which(tool):
            sys.exit(f'{tool} not found: install it with  sudo apt install -y ffmpeg')
    if not os.path.isfile(args.video):
        sys.exit(f'No such file: {args.video}')

    duration, width, height, fps = probe(args.video)
    print(f'  Source: {args.video}  {width}x{height}  {fps:.1f} fps  {duration:.1f}s')
    plan_path = os.path.splitext(args.out)[0] + '.plan.json'
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='her_video_') as workdir:
        if args.plan:
            with open(args.plan, encoding='utf-8') as f:
                plan = EditPlan.model_validate_json(f.read())
            print(f'  Using saved plan: {args.plan}')
        else:
            frames = extract_frames(args.video, duration, args.interval, args.max_frames, workdir)
            print(f'  Sending {len(frames)} frames to {MODEL} (effort={args.effort})...')
            plan = plan_edit(frames, duration, args.brief, args.target, args.effort)

        plan = clean_plan(plan, duration)
        with open(plan_path, 'w', encoding='utf-8') as f:
            f.write(plan.model_dump_json(indent=2))
        edited = sum((c.end_s - c.start_s) / c.speed for c in plan.clips)
        print(f'  Plan: {len(plan.clips)} clips, ~{edited:.0f}s of footage -> {plan_path}')

        if args.plan_only:
            return
        render(args.video, plan, args.out, width, height, fps, workdir, args.font_file)

    print(f'  Rendered: {args.out}')
    print('  Voice-over script is in the plan JSON ("narration").')


if __name__ == '__main__':
    main()
