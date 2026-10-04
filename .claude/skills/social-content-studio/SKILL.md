---
name: social-content-studio
description: Plan, script and produce social media content, especially short-form video (Instagram Reels, TikTok, YouTube Shorts, LinkedIn video), plus carousels, captions and brand strategy. Use this skill whenever the user wants a video script, hooks, reel/TikTok/Shorts ideas, a content calendar, UGC or founder-led ad scripts, Instagram captions and hashtags, a shot list or editing plan, social media branding (bio, voice, visual identity, content pillars), repurposing a long video into clips, or a diagnosis of why posts are not performing. Trigger even on casual asks like "make me a reel", "what should I post this week", "grow my Instagram", "content for my brand" or "turn this footage into a TikTok". It also makes motion graphics videos entirely in code (kinetic type, product/launch explainers, animated hooks, no footage needed) and turns raw footage into 9:16 vertical exports with burned-in captions via ffmpeg.
---

# Social Content Studio

This skill turns a brand, product, or person into social content that gets watched, shared, and remembered. It covers the full chain: brand foundation, content strategy, ideas, hooks, scripts, production, editing/export, and performance review.

## The three ideas everything else follows from

1. **Retention drives distribution.** Every major feed shows a new post to a small test audience, measures whether they keep watching, and only then expands distribution. Instagram has publicly named watch time, sends per reach, and likes per reach as its top signals. TikTok and YouTube Shorts lean on completion and swipe-away rate. So judge every script decision by one question: *does this make the viewer stay for the next beat?*
2. **Sends and shares carry content to strangers.** People who don't follow you find your content mainly because someone forwarded it. Write things a viewer would send to one specific friend, such as "this is literally you" or "we need this", or would save to use later.
3. **A brand is a repeated promise.** People follow when they know what they'll get next time. Keep the pillars, voice, look, and recurring series consistent. Vary the hooks and formats.

## Step 0 — Identify the job and load only what you need

| The user wants… | Deliver | Read |
|---|---|---|
| A script / "make a reel/TikTok/Short about X" | Full script package (template below) | `references/hooks.md`, `references/script-formats.md`, the platform's section of `references/platforms.md` |
| Many ideas / "what should I post" / a calendar | Idea table → calendar CSV | `references/strategy.md` |
| Branding, profile/bio, voice, visual identity, pillars | Brand brief + profile copy | `references/branding.md` |
| Carousel, caption, static post, LinkedIn text post | Slide-by-slide copy + caption | `references/script-formats.md` (carousel & caption sections) |
| Help filming or editing; they have footage | Shot list / edit plan / export | `references/video-production.md`, `scripts/vertical_export.py` |
| Motion graphics / animated video with no footage (kinetic text, launch or product explainer, animated hook, "make the video for me") | Script package + rendered MP4 | `references/motion-design.md`, `scripts/motion/` |
| "Why isn't this working?" / analytics review | Diagnosis + experiments | `references/analytics.md` |
| Sponsored content, AI-generated visuals, music, health/finance/results claims | Flag and fix compliance issues | `references/compliance.md` |

`references/example-package.md` shows a finished script package. Skim it once to calibrate quality and level of detail before writing your first script in a session.

All `references/`, `assets/` and `scripts/` paths in this file are relative to this skill's own directory, not the user's project.

## Step 1 — Load or build the brand brief

Look for an existing brief first: `content/brand-brief.md` in the working directory, or any brand/style file the user points to. If one exists, follow it. It's the user's source of truth for voice, audience, and pillars.

If there's no brief, you need a minimum of context:
- **Who it's for:** the audience, plus the specific problem or desire this content serves
- **What's being offered:** product, service, or expertise, and the goal (reach, followers, leads, sales)
- **Voice:** three adjectives, or a creator/brand they want to sound like
- **Platforms**, and the **production reality**: on camera or faceless, solo or team, phone or studio

When the request already gives enough to work with, don't interrogate the user. Make sensible assumptions, state them in one or two lines at the top, and deliver. A good draft with visible assumptions is more useful than a questionnaire. Ask first only when the answer would change the whole output (e.g., you can't tell what the product is). For larger jobs like a calendar, a batch of scripts, or branding, offer to save the brief to `content/brand-brief.md` from `assets/brand-brief-template.md` so future requests stay consistent.

## Step 2 — Find the angle before writing anything

The idea decides most of a video's performance. Production polish matters far less, so spend real effort here. A strong short-form idea:
- carries **one** takeaway (two ideas = two videos)
- is **specific**: numbers, names, real situations, not "tips for success"
- serves a **specific person** with a felt problem or desire
- has a **reason to share or save**: useful, relatable, surprising, funny, or something the viewer identifies with
- fits one of the brand's **content pillars**

Run the one-sentence test: *"This video shows [who] [how/why] [specific outcome] by [mechanism/insight]."* If you can't fill it in crisply, the idea is still too fuzzy to script.

Good idea sources include audience questions and comments, sales objections, common myths in the niche, mistakes and lessons, before/after transformations, behind-the-scenes processes, comparisons, "what I'd do if I started over", and trending *formats* adapted to the niche. If web search is available, look at what's currently working in the niche. Borrow the format, never the content.

## Step 3 — Write the hook (most of the effort goes here)

The first 1–3 seconds decide whether anyone sees the rest. A hook has three layers that should work together:
- **Visual hook:** the first frame and its motion. No logo sting, no fade-in, no slow walk to camera.
- **Text hook:** on-screen words, because many people watch muted. Keep it to about 3–7 words.
- **Spoken hook:** about 10 words or fewer, so it lands within roughly 3 seconds.

Write 5–10 candidate hooks across *different* hook types from `references/hooks.md`, pick the strongest 3, and recommend one with a one-line reason. Every hook must open a loop that the video actually closes. A hook that over-promises spikes early swipe-aways and teaches the audience not to trust you. Start in the middle of the action, and name the viewer or their problem as early as you can.

## Step 4 — Write the script

Choose a format from `references/script-formats.md` that fits the idea (tutorial, listicle, myth-bust, story, before/after, POV skit, UGC ad, founder story, faceless explainer, reply-to-comment…). Then build it as:

**Hook → Context (≤5s, only if needed) → Value beats, each with a re-hook → Payoff → One CTA, or a loop back to the start**

Writing rules, and why they matter:
- **Write for the ear.** Use short sentences, contractions, and one idea per sentence. Read every line aloud in your head, because stiff written-English lines get swiped.
- **Cut every line that doesn't earn its place.** Completion rate rewards shorter videos. If deleting a line loses nothing, delete it.
- **Re-hook every ~5–8 seconds** with a new visual, a turn ("but"), a number, or a reveal, so attention resets before it decays.
- **Give every spoken line a visual.** If the screen shows the same thing for more than ~3–4 seconds, add B-roll, a punch-in, text, or a demo.
- **Be concrete:** "$37 in ad spend" beats "a small budget"; "3 a.m. feed" beats "being tired".
- **Ask for one thing, matched to the goal.** For reach, prompt a share ("send this to the friend who…"). For follows, offer a series ("part 2 tomorrow"). For leads, use "comment WORD" (only if DM automation exists) or the link in bio. Stacked CTAs dilute all of them.
- **Loop when you can.** An ending that flows into the opening line earns replays.

Default lengths, unless the idea needs more: Reels/TikTok 15–45s, Shorts 20–60s, LinkedIn 30–90s. Social speaking pace is about **2.5–3 words per second**, so a 30s video is roughly 75–90 spoken words. Check your timing:

```bash
python scripts/script_tools.py time path/to/script.md   # per-beat timing, hook length, on-screen text density
```

## Step 5 — Package it for production

Deliver scripts in the format of `assets/script-template.md`: a header (platform, length, pillar, goal, format), hook options, a beat-by-beat table (time · visual · voice-over · on-screen text), shot list and B-roll, edit notes, cover text, caption, hashtags, CTA, platform variants, and a pre-post checklist. The table is the core because it lets one person film and another edit without guessing.

For filming and editing guidance (gear, lighting, audio, framing, safe zones, pacing, captions, music), see `references/video-production.md`. If the user has footage, use the helper scripts:

```bash
python scripts/script_tools.py srt script.md --out captions.srt     # captions timed from the script table
python scripts/vertical_export.py input.mp4 out.mp4 --captions captions.srt   # 9:16, burned captions, -14 LUFS audio
```

Timing generated from a script is approximate. If a transcription tool such as Whisper is available, prefer real word timings for captions.

**No footage? Render it in code.** For kinetic type, explainers, launch videos and animated hooks, follow `references/motion-design.md`: start from `scripts/motion/template.html`, review a contact sheet before the full render, then mix SFX and music with `scripts/motion/sound.py`.

If an image/video generation tool is connected (for example a Higgsfield-style MCP), you can generate B-roll, product shots or visual hooks with it. Disclose realistic AI-generated people or scenes per `references/compliance.md`.

## Step 6 — Adapt per platform; don't just cross-post

Each platform has its own conventions, and the same file posted everywhere underperforms. At minimum, remove other apps' watermarks (Instagram deprioritizes them) and adjust these:

| | Instagram Reels | TikTok | YouTube Shorts | LinkedIn |
|---|---|---|---|---|
| Sweet-spot length | 15–60s | 15–45s | 20–60s (max 3 min) | 30–90s |
| What it rewards most | Watch time, sends, likes | Completion, rewatches, shares, saves | Viewed vs. swiped away | Dwell time, comments |
| Discovery text | Keyword caption + ≤5 hashtags (hard cap) | Keywords in caption, on-screen text and speech + 3–5 hashtags | Title/description keywords | Hook in first 2 lines; no external links in the post |
| Tone | Polished-casual, aesthetic | Native, lo-fi, fast, trend-aware | Searchable, evergreen | Professional, insight-led, captions on |

Details, specs and sources are in `references/platforms.md`.

## Step 7 — Quality check before delivering

Go through this list and fix anything that fails. Don't just mention it.
- [ ] The idea fits one sentence, and the payoff delivers what the hook promised
- [ ] The hook works **muted** (text + visual) and **with sound**
- [ ] No throat-clearing: the first word is already content
- [ ] Something changes on screen every few seconds, with a re-hook at least every ~8s
- [ ] Every line earns its place, and the timing check passes
- [ ] On-screen text sits inside the safe zone (central ~900×1400 of 1080×1920) and each card can be read in the time it's on screen
- [ ] One CTA, matched to the goal
- [ ] The caption opens with a hook line and uses the keywords people would search
- [ ] It sounds like the brand voice, not generic marketing copy
- [ ] Compliance is covered: ad/partnership disclosure, AI labels, licensed music, and substantiated claims

## Output conventions by request type

- **Single script:** the full template. Give 3 hook options, but write the script around the recommended one.
- **Batch ("10 reel ideas", "a week of content"):** first an idea table with title, hook, format, pillar, goal and why it will be shared. Then write full scripts for the top 3, or for whichever ones the user picks. Ten half-written scripts help nobody, and ten sharp concepts plus three finished scripts get filmed.
- **Calendar:** CSV from `assets/content-calendar-template.csv` plus a short rationale (pillar mix, cadence, series).
- **Branding:** a filled brand brief (`assets/brand-brief-template.md`) plus ready-to-paste profile copy.
- **Performance review:** a diagnosis ordered by funnel stage (hook → retention → shareability → conversion), naming the single most likely bottleneck and 2–3 experiments to try next.

When a deliverable is a file the user will keep (scripts, calendars, briefs), write it to `content/` in the working directory unless the user says otherwise.

## A note on numbers

Platforms change their rules often. In `references/platforms.md`, the signals and limits the platforms have confirmed themselves are marked separately from third-party estimates. Treat estimates (ideal lengths, "completion thresholds", engagement benchmarks) as direction, not law. If the user is making a real decision based on a spec or limit and web search is available, verify the current figure.
