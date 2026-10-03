#!/usr/bin/env bash
# Record the whole screen (Gazebo running) to an MP4 with ffmpeg.
# Needs an X11 session ("Ubuntu on Xorg" at the login screen). On Wayland use
# Gazebo's Video Recorder plugin or GNOME's screen recorder instead (see README).
#
# Usage: ./record_sim.sh [output.mp4] [seconds]
#   ./record_sim.sh her_sim_raw.mp4 180
set -euo pipefail

OUT="${1:-her_sim_raw.mp4}"
SECONDS_TO_RECORD="${2:-180}"
FPS="${FPS:-30}"

if ! command -v ffmpeg >/dev/null; then
    echo "ffmpeg not found: sudo apt install -y ffmpeg" >&2
    exit 1
fi
if [ "${XDG_SESSION_TYPE:-x11}" = "wayland" ]; then
    echo "Wayland session detected: ffmpeg cannot capture other windows here." >&2
    echo "Use Gazebo's Video Recorder plugin, GNOME's recorder (Print Screen -> video)," >&2
    echo "or log in with 'Ubuntu on Xorg'. See video_pipeline/README.md." >&2
    exit 1
fi

# Screen size: $SIZE if set, else ask the X server, else assume 1920x1080
SIZE="${SIZE:-$(xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2}')}"
SIZE="${SIZE:-1920x1080}"

echo "Recording ${SIZE} @ ${FPS} fps for ${SECONDS_TO_RECORD}s -> ${OUT}  (Ctrl+C stops early)"
ffmpeg -hide_banner -loglevel warning -y \
    -f x11grab -framerate "$FPS" -video_size "$SIZE" -i "${DISPLAY:-:0}" \
    -t "$SECONDS_TO_RECORD" \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart \
    "$OUT"
echo "Saved ${OUT}"
