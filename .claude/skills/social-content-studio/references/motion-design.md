# Motion Design in Code (no footage needed)

Make motion graphics videos (kinetic type, product/UI explainers, launch videos, data stories, animated hooks) by writing the animation as code. A browser draws every frame and ffmpeg encodes the frames into an MP4. No After Effects, no camera.

The method follows @0xMovez's "How to build motion design studio with Opus 5.5 (Full-course)" (Sept 2026) and related public guides (see Sources). Its core claim: **the prompt is ~10% of the video; the harness is the other 90%.** The harness is the render contract, a style reference, banned defaults, beat-synced sound and a self-review loop.

## Contents
1. When to use code-rendered motion
2. Quick start (tested commands)
3. The render contract
4. Directing the look: references beat descriptions
5. Banned defaults and what to do instead
6. Motion vocabulary
7. Pacing and sound
8. Phone readability
9. The review loop (contact sheet → score → fix → render)
10. From script table to scenes
11. Framework choice
12. Hybrid: AI video base + code-drawn layer
13. Prompt patterns
14. Troubleshooting
15. Sources

---

## 1. When to use code-rendered motion

**Good fit:** faceless brands; product launches and feature announcements; UI and app demos (re-drawn UI, cursor, taps); kinetic-typography hooks; data and number reveals; explainers and listicles told with type and shapes; series intros/outros and branded templates; animated carousels turned into video; loops.

**Poor fit:** anything that needs real people, faces, real products in real light, emotion from a performance, or UGC authenticity. Film those (`video-production.md`), then add code-drawn overlays if needed. Polished motion can also read as "ad" on TikTok. Mix it with human content rather than replacing it.

## 2. Quick start (tested commands)

Prereqs: Node 18+, ffmpeg, Python 3, Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`). librosa is optional and improves beat detection (`pip install librosa`). All scripts live in this skill's `scripts/motion/`.

```bash
cp <skill>/scripts/motion/template.html content/film.html      # start from the template; edit BRAND, CONTENT, scenes

python <skill>/scripts/motion/beats.py track.mp3 --out beats.json                 # if using a music track
python <skill>/scripts/motion/sound.py bed --bpm 110 --duration 12 --out bed.wav  # or synthesize a simple bed

node <skill>/scripts/motion/render.mjs content/film.html --sheet sheet.png --every 1 --beats beats.json   # REVIEW FIRST
node <skill>/scripts/motion/render.mjs content/film.html --still f.png --at 3.2 --guides                  # inspect one frame + safe zone
node <skill>/scripts/motion/render.mjs content/film.html --out silent.mp4 --beats beats.json              # full render

python <skill>/scripts/motion/sound.py mix --video silent.mp4 --cues cues.json --music track.mp3 --out final.mp4
```

`render.mjs` options: `--fps` (default 30), `--width/--height` (default 1080×1920), `--from/--to` (partial render), `--audio` (quick mux), `--crf` (default 16), `--guides`, `--no-check`. On a cloud container, 12s at 30fps renders in ~30s. Render previews at 24–30fps and finals at 30 (60 only for very fast motion).

`sound.py mix` places SFX cues (`hit`, `whoosh`, `pop`, `tick`, `riser`, or a file path) at exact times, lays music underneath, and normalizes to −14 LUFS. Its cue file is a JSON list: `[{"t": 0.0, "sfx": "hit"}, {"t": 2.45, "sfx": "whoosh", "gain": -3}]`.

## 3. The render contract

Every film is a **pure function of time**. These rules are what make renders reliable, so keep them:

- `window.seek(t)` paints the exact frame for time `t` in seconds. The renderer calls it once per frame and screenshots the page.
- **No CSS transitions or animations, `setTimeout`, `setInterval` or `requestAnimationFrame`** in render mode. They run on wall-clock time, not film time.
- **No state carried between frames.** `seek(5)` must look identical whether it follows `seek(4)` or `seek(11)`. Compute positions from `t` directly (closed-form springs and easing), never by accumulating velocity frame to frame.
- **Seeded randomness only** (the template's `rng(seed)` / `noise1(x, seed)`), never `Math.random()`.
- `window.DURATION` gives the length in seconds. `window.ready` (optional Promise) resolves when fonts and images are loaded.
- The renderer checks determinism automatically (it paints the middle frame twice with other frames in between) and warns if the pixels differ.

Why it matters: any frame can be inspected or re-rendered alone, so a fix to second 7 doesn't require re-checking seconds 0–6. Renders are reproducible, and the review loop in §9 becomes possible.

## 4. Directing the look: references beat descriptions

Left without direction, models fall back to the same generic video. Push against that in this order of strength:

1. **A reference video or frames (strongest).** Extract frames and study them before writing any code:
   ```bash
   ffmpeg -i reference.mp4 -vf "fps=2,scale=270:-2,tile=6x4" -frames:v 1 ref_sheet.png   # one frame every 0.5s
   ```
   Then write a short **style guide** from it: palette (hex), type (family, weight, case, tracking, size range), layout grid, average shot length, transition types (cut, wipe, morph, push, match cut), camera moves, motion feel (snappy springs vs. smooth easing), texture (grain, blur, gradients or flat), and how text enters and leaves.
   **Take the grammar of the reference, never its content.** Copy the rhythm, type logic and transition vocabulary, not its words, logos or exact layouts.
2. **A named style.** Naming a style works better than describing one, because a name carries a whole set of rules: "Apple keynote bumper", "Linear launch video", "Stripe docs motion", "Swiss poster kinetic type", "brutalist newspaper", "Saul Bass title sequence", "MTV 90s bumper", "Teenage Engineering product reel". Names of genres work too: "showreel for a résumé", "music-video lyric cut", "sports broadcast lower-third package".
3. **The brand brief.** Colors, fonts and voice from `content/brand-brief.md` go into the template's `BRAND` object.

## 5. Banned defaults and what to do instead

| Default (looks like AI slop) | Do this instead |
|---|---|
| Centered title on a gradient background | Off-center type on a grid, flat brand color or texture, a strong focal shape |
| Everything fades in | Mask wipes, spring slams, slides with overshoot, scale pops, letter-by-letter, morphs |
| Corner labels, frame borders, fake HUD chrome | Let the content fill the frame; use hierarchy instead of decoration |
| Glow on everything, neon UI | Contrast through color and weight, not bloom |
| Generic particle bursts / bokeh | One meaningful motif that repeats (a shape, a line, a texture) |
| Logo sting at the start | Hook in frame 1; logo at the end or not at all |
| Same easing for every move | Springs for physical objects, expo-out for UI, sine for ambient drift |
| Nothing changes for 5+ seconds | Something new every 2–4s (see §7) |

## 6. Motion vocabulary

The template ships with helpers for all of these: `spring`, `ease.*`, `prog`, `lerp`, `maskReveal`, `noise1`, `beatPulse`.

- **Springs (closed form):** `spring(t, {freq, damping})` gives overshoot and settle without state. Use a lower damping (0.4–0.5) for playful motion, 0.6–0.8 for confident motion. Offset start times (`spring(t - 0.18)`) to stagger elements.
- **Easing:** `outExpo` for UI and snappy entrances, `outBack` for a small overshoot, `inOutCubic` for camera moves, `inOutSine` for ambient drift. `linear` is only for constant motion like tickers.
- **Anticipation → action → settle:** a tiny move backwards before a big move forwards reads as intentional.
- **Stagger:** reveal lists and letters 60–150ms apart. Order follows reading direction.
- **Masks and wipes:** reveal text by moving a clip rect (`maskReveal`) instead of fading. It reads crisper on phones.
- **One shape, never cut:** a single element morphs size, radius, color and position through the whole film (circle → pill → card → button). It gives continuity without cuts. The last frame can match the first for seamless loops.
- **Match cuts and morph transitions:** the end shape of one scene becomes the start shape of the next.
- **Camera moves:** fake them by transforming the whole scene (slow push-in 2–5%, parallax layers at different speeds, whip pans with motion blur streaks).
- **Kinetic typography:** one idea per screen, emphasis words in the accent color or at a heavier weight, words land on beats, scale contrast between headline and support text.
- **Counters and data:** animate numbers with `outExpo`, draw bars and lines with springs, and hold the final value ≥1s.
- **UI demos:** re-draw the UI as simple shapes rather than screenshotting it, with a cursor, taps (a ring pulse) and zooms to the relevant area.
- **Texture:** subtle seeded grain (`grain(t)`) or paper texture removes the sterile vector look.

## 7. Pacing and sound

- **Hook in the first 2 seconds:** the first frame already has motion and the hook text (see `hooks.md`). No intro.
- **Something new every 2–4s:** a new element, a transformation, a scene change, a camera move or a reveal. This is the motion-design version of the retention rules in `script-formats.md`.
- **Hold what must be read:** ~3–4 words/second of reading time plus 0.5s. Payoff frames get 1–2s of stillness.
- **Beat grid:** `beats.py` writes `beats.json` (tempo, beats, downbeats, onsets). The renderer passes it to the film as `window.BEATS`. Land cuts, slams and reveals on beats or downbeats, and use `beatPulse(T)` for subtle on-beat scale or brightness pulses.
- **SFX on every hit:** whoosh into transitions, pop on text, tick on counters, hit on slams, riser into reveals. `sound.py mix` places them at exact times. Build the cue list from the scene timings or from `beats.json`.
- **Music:** a licensed track (check the account type in `compliance.md`), or `sound.py bed` for a simple synthesized beat. Synthesized beds are fine for drafts and minimal styles; hero pieces deserve real music.
- **Voice-over (optional):** record or generate it, time the scenes to the VO, and caption it (see `script_tools.py srt`). Disclose cloned or realistic AI voices.
- **Loudness:** finals at −14 LUFS. `sound.py mix` measures and corrects to within ~0.3 LU.

## 8. Phone readability

Design at 1080×1920 for a phone held at arm's length:
- Headlines 120–240px, supporting text ≥ 56–64px, nothing under ~44px. The template's `text()` auto-shrinks to `maxWidth` so words never leave the frame.
- Keep important content inside the safe zone (≈ x 60–930, y 250–1470). Render a frame with `--guides` to check.
- Use strong contrast, at most 2 typefaces and 2–3 colors plus neutrals.
- Keep each screen to ≤ 7 words where possible. The audience is scrolling, not reading.

## 9. The review loop (do this before every full render)

Models can see images, so use that ability to review your own work before spending time on a full render:

1. **Render a contact sheet**, one frame per beat or scene: `render.mjs film.html --sheet sheet.png --every 1` (or `--times` at each scene's key moments).
2. **Look at it** and score each criterion 1–10:
   | Criterion | Question |
   |---|---|
   | Hook (first 2s) | Does frame 1 already stop the scroll, muted? |
   | Readability at phone size | Can every word be read at thumbnail size? Is it inside the safe zone? |
   | Motion quality | Do moves have intent (springs, overshoot, staggers), or is everything a fade? |
   | Variety | Does something new happen every 2–4s? Are scenes visually distinct? |
   | Brand accuracy | Do the palette, type and voice match the brief or reference? |
   | Sound sync | Do hits, cuts and reveals land on beats or cues? |
3. **List the 3 worst problems, fix them,** then re-render the sheet. Repeat until no criterion is under 7.
4. **Only then do the full render.** Spot-check with `--still --at` and partial renders (`--from/--to`) instead of re-rendering everything.
5. Before delivering, run the general quality checklist in SKILL.md (hook, payoff, one CTA, compliance).

## 10. From script table to scenes

Write the script first (`assets/script-template.md`). Each row of the script table becomes one scene object in the film:

| Script column | Becomes |
|---|---|
| Time | the scene's `start`/`end` |
| Visual | what `draw(t, T)` paints and how it moves |
| Voice-over | VO audio (optional) + captions |
| On-screen text | the `CONTENT` strings |
| Beat / edit notes | transitions and SFX cues for `cues.json` |

Add a **motion shot list** to the package for motion pieces:
`| Scene | Time | Visual idea | Motion (enter → hold → exit) | Transition out | Sound cue |`

## 11. Framework choice

| Approach | Best for | Notes |
|---|---|---|
| **Single HTML + canvas `seek(t)`** (this skill's template) | One-off social clips, hooks, launch teasers, fast iteration | No build step. The model tends to choose this by default, and it's the easiest to keep deterministic. |
| **Remotion** (React, `useCurrentFrame()`) | Reusable templates, data-driven or personalized video at scale, long projects | Check Remotion's license for company use |
| **HyperFrames / GSAP timelines** rendered headless | Web designers, DOM/CSS-heavy layouts, design-tool handoffs | Drive the timeline with `seek(t)`, never wall-clock time |

The same rules apply to all three: frames are pure functions of time, a contact-sheet review comes first, and the encode is H.264 yuv420p.

## 12. Hybrid: AI video base + code-drawn layer

For characters, physics or realistic scenes, some creators render base shots with an AI video model (e.g., Seedance), then have the model redraw or overlay the whole video in code. This gives a consistent graphic style the video model alone wouldn't guarantee. If a video-generation tool is connected, it can produce those base shots. Composite them by drawing the video frames onto the canvas or layering in ffmpeg. Realistic AI-generated people or scenes need an AI label (`compliance.md`).

## 13. Prompt patterns

When briefing yourself, a subagent or the user's model, use a six-part spec rather than "make a cool video":

1. **Message:** the one idea, the audience, and the CTA.
2. **Format:** platform, 9:16, duration, fps, and silent-first (works muted)?
3. **Style:** a named style and/or a reference video plus the extracted style guide, and the brand tokens.
4. **Structure:** scenes with timings, mirroring the script table, and the hook in the first 2s.
5. **Motion rules:** the render contract, the banned defaults, something new every 2–4s, the easing and spring character.
6. **Sound:** a track with its beat grid, or a synthesized bed, plus the SFX cue plan and −14 LUFS.

Useful one-liners:
- "Write a shotlist for a [N]s video about [subject] in THAT style. Take the grammar of the reference, never its content."
- "A showreel for a résumé of [brand/person]": naming a genre brings its rules (fast cuts, technique variety, a big finish).
- "Explain [product] using one shape that never cuts": forces continuity and invention instead of slides.

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Determinism warning, flicker, jitter | State carried between frames: `Math.random`, accumulators, CSS animation, timers. Compute from `t`. |
| Fallback font in the render | Fonts not loaded. Add `@font-face` with local files and set `window.ready = document.fonts.load('800 100px "YourFont"')`. |
| Text cut off at the edges | Use `text(..., {maxWidth})` and check with `--guides`. |
| Blurry text or shapes | Draw at full 1080×1920 (not scaled up). Keep `deviceScaleFactor` at 1. Avoid sub-pixel scaling on small text. |
| Render too slow | Review with `--sheet` first; preview at 24fps; use `--from/--to` for one scene. Canvas is faster than heavy DOM/CSS filters. |
| Audio ends early or late | Make `DURATION` match the music edit. `sound.py mix` pads or trims audio to the video length. |
| Hits feel late | Visual hits should land on or up to 1 frame *before* the beat. Check `beats.json` (or force `--bpm`). |
| Looks generic | Add a reference video, name a style, and apply §5. Review the sheet against the reference side by side. |

## 15. Sources

- @0xMovez, "How to build motion design studio with Opus 5.5 (Full-course)", X article, Sept 2026: https://x.com/0xMovez/article/2104216919033192746 (studio rules, render contract, banned defaults, contact-sheet scoring, beat grid, hybrid workflow)
- Rexan Wong's breakdown of viral clips (naming a style, reference frames every 0.5s): https://x.com/rexan_wong/status/2103707054108299437
- "Opus 5.5 Video Prompts: A Six-Part Spec" (DEV Community); "Opus 5.5 generates motion design videos by writing a program that draws every frame" (pasqualepillitteri.it); ciyo.ai Opus 5.5 video guide
- Open-source implementations of the same pattern: github.com/howseen-ai/claude-motion-design, github.com/florian-ivadolabs/motion-design
