# Video Generation & Editing with Claude Opus 5.5
### Turn Gazebo recordings of the HER lab into an edited, captioned video

---

## What Claude Opus 5.5 does here (and what it doesn't)

Claude Opus 5.5 is a text + image model: it **cannot output video pixels**, and it
cannot open an MP4 directly. What it is good at is the editor's job: watching
frames, deciding what matters, and writing the plan and the script. The pipeline
splits the work like this:

| Stage    | Tool                          | Output                                        |
|----------|-------------------------------|-----------------------------------------------|
| Footage  | Gazebo + screen recorder      | `her_sim_raw.mp4` (raw simulation run)        |
| Watch    | ffmpeg                        | Timestamped frames, 1 every ~2 s              |
| Direct   | **Claude Opus 5.5** (API)     | Edit plan: clips, speed, captions, title, narration |
| Render   | ffmpeg                        | `her_sim_edit.mp4` + `her_sim_edit.plan.json` |
| Optional | TTS / music / AI video tool   | Voice-over, soundtrack, generated intro shots |

```
Gazebo ──record──▶ raw.mp4 ──frames──▶ Claude Opus 5.5 ──plan.json──▶ ffmpeg ──▶ edit.mp4
                                              ▲                            │
                                              └── edit plan.json by hand ◀─┘  (re-render, no API call)
```

---

## SETUP — Run These Commands Once

Tested on Ubuntu 24.04 (same machine as the ROS 2 Jazzy simulation). macOS works too
with `brew install ffmpeg`.

### Step 1: Install ffmpeg and a caption font

```bash
sudo apt update
sudo apt install -y ffmpeg fonts-dejavu-core x11-utils
ffmpeg -version | head -1    # 6.1 or newer centres multi-line captions
```

### Step 2: Create a Python environment

Ubuntu 24.04 blocks `pip install` into the system Python, so use a venv:

```bash
cd ~/her-stimulation/video_pipeline
python3 -m venv ~/her_video_venv
source ~/her_video_venv/bin/activate
pip install -r requirements.txt
```

### Step 3: Get a Claude API key

1. Sign in at **platform.claude.com**, add billing, and create an API key.
2. Export it (add the line to `~/.bashrc` to keep it):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

A claude.ai Pro/Max chat subscription does **not** include API access; the API is
billed separately per token (see [Cost](#cost)).

---

## STEP A — Record the Simulation

Start the simulation as usual (`ros2 launch her_robot_sim launch_her_simulation.py`),
then record with **one** of these:

**Option 1: Gazebo's built-in recorder (works on Wayland and X11).**
In the Gazebo window open the plugin menu (⋮, top-right), search for
**Video Recorder**, add it, then use its record button to start and stop. Save as MP4.
This records only the 3D scene, at a clean resolution.

**Option 2: GNOME screen recorder (Ubuntu 24.04 default desktop).**
Press `Print Screen`, switch the toggle to video, pick the Gazebo window or the whole
screen, and press record; stop from the red button in the top bar. Files land in
`~/Videos/Screencasts/*.webm`; the editor accepts WebM.

**Option 3: `record_sim.sh` (X11 sessions, scriptable).**

```bash
chmod +x record_sim.sh
./record_sim.sh her_sim_raw.mp4 300     # 5 minutes, Ctrl+C stops early
```

A full run (10 catalysts × 6 steps ≈ 19 s each) is about 3–4 minutes.

---

## STEP B — Edit with Claude Opus 5.5

```bash
source ~/her_video_venv/bin/activate
python claude_video_editor.py her_sim_raw.mp4 --out her_sim_edit.mp4
```

This will:
1. Sample up to 60 frames from the recording (one every 2 s, spread wider for long videos)
2. Send them to Claude Opus 5.5 with timestamps and your brief
3. Receive a validated edit plan (clips, playback speed, captions, title card, narration)
4. Render the cut with ffmpeg and save the plan next to it

```
  Source: her_sim_raw.mp4  1920x1080  30.0 fps  212.4s
  Sending 60 frames to claude-opus-5-5 (effort=high)...
  Claude (claude-opus-5-5): 28950 input / 3120 output tokens
  Plan: 9 clips, ~57s of footage -> her_sim_edit.plan.json
  Rendered: her_sim_edit.mp4
```

### Options

| Flag            | Default                         | What it does                                        |
|-----------------|---------------------------------|-----------------------------------------------------|
| `--out`         | `her_sim_edit.mp4`              | Output video (plan saved as `<out>.plan.json`)      |
| `--brief`       | dissertation highlight video    | Tell Claude who the video is for and what to stress |
| `--target`      | `60`                            | Target edited length in seconds                     |
| `--interval`    | `2.0`                           | Seconds between sampled frames                      |
| `--max-frames`  | `60`                            | Frames sent to Claude (API limit: 100 per request)  |
| `--effort`      | `high`                          | `low` / `medium` / `high` / `xhigh` / `max` (Opus 5.5's own default is `medium`) |
| `--plan-only`   | off                             | Write the plan JSON and stop                         |
| `--plan FILE`   | none                            | Render a saved plan without calling Claude           |
| `--font-file`   | fontconfig `Sans`               | Custom TTF/OTF for captions                          |

### Examples

```bash
# 30-second teaser for a conference talk
python claude_video_editor.py her_sim_raw.mp4 --out teaser.mp4 --target 30 \
    --brief "Fast teaser: show the arm visiting every station, end on data logging."

# Detailed walkthrough of one catalyst for the viva
python claude_video_editor.py her_sim_raw.mp4 --out walkthrough.mp4 --target 120 \
    --brief "Explain each of the 6 protocol steps in real time for the first catalyst only."
```

### Fine-tune by hand (no extra API cost)

```bash
python claude_video_editor.py her_sim_raw.mp4 --out cut.mp4 --plan-only   # plan only
nano cut.plan.json                                                          # tweak times/captions
python claude_video_editor.py her_sim_raw.mp4 --out cut.mp4 --plan cut.plan.json
```

The plan is plain JSON:

```json
{
  "title": "Virtual HER Laboratory: Automated Catalyst Testing",
  "clips": [
    {"start_s": 6.0,  "end_s": 25.5,  "speed": 1.0, "caption": "Step 1: PICK — catalyst sample from S1"},
    {"start_s": 25.5, "end_s": 196.0, "speed": 8.0, "caption": "Catalysts 2–10 (8× speed)"}
  ],
  "narration": "In this virtual laboratory a two-joint arm..."
}
```

The script clamps times to the recording, removes overlaps and limits speed to
0.25×–8×, so a bad plan can't crash ffmpeg.

---

## STEP C — Voice-over and Music (optional)

The `narration` field in the plan is a voice-over script matched to the cut. Record
it yourself or run it through any text-to-speech tool, then mix:

```bash
# Voice-over only
ffmpeg -i her_sim_edit.mp4 -i voiceover.mp3 -map 0:v -map 1:a \
    -c:v copy -c:a aac -shortest her_sim_final.mp4

# Voice-over + quiet background music
ffmpeg -i her_sim_edit.mp4 -i voiceover.mp3 -i music.mp3 \
    -filter_complex "[2:a]volume=0.15[m];[1:a][m]amix=inputs=2:duration=first[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -shortest her_sim_final.mp4
```

---

## STEP D — AI-Generated Shots (optional)

To *generate* new footage (an intro shot of a hydrogen lab, animated catalyst
graphics), you need a separate video-generation model. Claude can drive one for you:

- **Claude Code or claude.ai with a video-generation connector** (for example
  Higgsfield): ask *"Generate a 5-second cinematic intro shot of a robotic
  electrochemistry lab, 16:9"*. Claude writes the prompt and calls the connector;
  the connector's model renders the clip and its credits are charged.
- Download the clip, then join it in front of your edit:

```bash
ffmpeg -i intro.mp4 -i her_sim_edit.mp4 -filter_complex \
  "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1,fps=30[a];\
   [1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1,fps=30[b];\
   [a][b]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -crf 20 -pix_fmt yuv420p her_sim_with_intro.mp4
```

For a dissertation, label generated shots as illustrative. They are not simulation
output.

---

## Using Claude Code instead of the script

If you use Claude Code, it can run this whole pipeline conversationally:

```
> Record is in ~/Videos/Screencasts/run1.webm. Make a 45-second captioned cut
  for my viva using video_pipeline/claude_video_editor.py, then show me the plan.
```

Claude Code runs ffmpeg and the script, reads the plan, and re-renders when you ask
for changes ("slow the IMMERSE step down", "drop the last catalyst").

---

## Cost

Claude Opus 5.5 is $4 per million input tokens and $20 per million output tokens.
A 768-px-wide frame is roughly 450–600 input tokens, so one plan with 60 frames is about
27–36k input tokens plus a few thousand output tokens, **around $0.15–$0.40 per run**.
Re-rendering a saved plan (`--plan`) is free.

The script opts into server-side fallback (`fallbacks: "default"`): if a safety
classifier declines a request, the API retries it on Anthropic's recommended fallback
model in the same call. The `Claude (...)` line shows which model answered.

---

## TROUBLESHOOTING

**`Authentication failed`**
```bash
echo $ANTHROPIC_API_KEY     # must be set in the same terminal
```

**`ffmpeg not found` / captions in the wrong font**
```bash
sudo apt install -y ffmpeg fonts-dejavu-core
python claude_video_editor.py raw.mp4 --font-file /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
```

**`record_sim.sh` says Wayland / recording is black**
Use Gazebo's Video Recorder or GNOME's recorder (Step A), or choose **Ubuntu on Xorg**
on the login screen.

**`Edit plan was cut off` or `Request rejected`**
Send fewer frames: `--max-frames 40 --interval 4`.

**Captions or cuts are off by a second or two**
Sample more densely (`--interval 1`), or fix the times in the `.plan.json` and
re-render with `--plan`.

**`error: externally-managed-environment` on pip install**
You skipped the venv, so run Step 2.
