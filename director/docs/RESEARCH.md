# Research: HyperFrames and the open-source tools around it

This note explains why Director renders with HyperFrames, what HyperFrames does well and where it needs help, and which other open-source projects could make the platform better. Licences are summarised as found in October 2026. Check each project's LICENSE file before commercial use, especially for model weights.

## HyperFrames: the rendering core

[HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0, v0.8.145, Node 22+) renders HTML compositions to MP4. A headless Chrome captures every frame deterministically and FFmpeg encodes them. Its tagline is "Write HTML. Render video. Built for agents." ([docs](https://hyperframes.heygen.com/introduction)).

**How a composition works**
- **Clips:** the root element has `data-composition-id`. Every timed element is a clip, with `class="clip"`, `data-start`, `data-duration` and `data-track-index`.
- **Nesting:** scenes can be sub-compositions (`data-composition-src` plus a `<template>`).
- **Media:** attributes cover trims (`data-media-start`), volume, fades and whether a clip has audio.
- **Animation:** GSAP timelines register in `window.__timelines`. A CSS keyframe adapter seeks `@keyframes` frame-accurately, so pure CSS motion renders exactly.
- **Tooling:** a CLI for `lint`, `snapshot`, `render`, `tts` (Kokoro-82M), `transcribe` (word-level timestamps), `beats`, `normalize-audio`, `remove-background`, `check`/`validate`, and cloud, Lambda and Cloud Run rendering. There is also a producer API, an editing SDK (`openComposition`, `setText`, `setTiming`, `serialize`) and a `<hyperframes-player>` web component.

**Why it suits an AI director**
- HTML and CSS are the visual languages models write best, so the agent can design real motion graphics, not just fill templates.
- Rendering is deterministic: what the preview shows is what the MP4 contains.
- `lint` and `snapshot` close the loop. The agent can validate a cut and look at frames before anyone renders, which is how Director checks its own work.
- Apache-2.0 allows commercial use and modification.

**What Director had to work around**
- **CSS-only compositions waited 45s per scene** in render setup, looking for a GSAP timeline that never came. Marking scene hosts `data-no-timeline` cut setup from 45s to about 1s.
- **The player loads its runtime from a CDN by default**, so previews broke offline or behind a strict proxy. Director serves the runtime from `@hyperframes/core` and sets the player's `runtime-src`.
- **CSS animations only follow the timeline on HTML elements.** The CSS adapter seeks animations on elements in the XHTML namespace. Animations on SVG elements (`<circle>`, `<path>`, the `<svg>` itself) run on the page clock, so they ignore scene timing and seeking. Director's validator rejects them and tells the agent to animate an HTML wrapper instead. A clip's animations are timed from the nearest `data-start`.
- **The producer README is behind its API.** `executeRenderJob(job, projectDir, outputPath, onProgress)` differs from the documented call. Director drives the CLI instead, which is also more robust: a browser crash can't take the server down, and renders can be cancelled.
- **Video in the live preview** depends on the viewer's browser codecs. Renders don't, because frames are extracted with FFmpeg.
- **GSAP licence.** GSAP is free now, but its standard licence excludes tools that compete with Webflow's visual builder. Director animates with CSS keyframes only, so it carries no GSAP dependency (see [GSAP licence](https://gsap.com/community/standard-license/)).

## The landscape, by layer

### Agentic video editors: ideas worth borrowing

| Project | Licence | What it is | What Director takes from it |
| --- | --- | --- | --- |
| [VideoDB Director](https://github.com/video-db/Director) | MIT | A framework for video agents (search, summarise, clip, overlay, generate) built on VideoDB's hosted "video-as-data" service. Last commit January 2026 when reviewed. | Chat-first agents with tools. Its strength is **semantic search over long footage**. For large libraries, add an indexing tool (transcripts plus visual notes) so the director can "find the moment where…". |
| [FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline) | Apache-2.0 | Conversational video creation: media search and clip understanding, script generation with few-shot style transfer, music, voice and font suggestions with beat-sync, natural-language refinement, and editing workflows saved as reusable "Skills". | **Saved workflows** (reuse a finished video's structure and style on new media for batch creation), style transfer for narration from reference text, beat-synced cutting. |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | AGPL-3.0 | Turns a coding agent into a production studio: research, script, generated clips (Veo, Kling via fal.ai), narration, stock footage from open archives, and composition with Remotion or HyperFrames. | Multi-provider generation and **stock-footage retrieval** as providers, and "start from a video you love" (analyse a reference video's structure). AGPL means Director takes ideas only, no code. |

### Editors and programmatic video frameworks

| Project | Licence | Notes |
| --- | --- | --- |
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | MIT | Browser-based, CapCut-style timeline editor. A ground-up rewrite with a Rust core is under way, with a plugin system, an MCP server and headless rendering planned. A model for a future frame-precise multi-track view, and a possible export target for hand-finishing a cut. |
| [Remotion](https://www.remotion.dev/) | Source-available | React-based video. Free for individuals and small teams; companies above 3 employees need a [company licence](https://www.remotion.pro/license). Excellent, but the licence and React-only authoring make it a poor default here. |
| [Revideo](https://github.com/redotvideo/revideo) | MIT | Fork of Motion Canvas for programmatic, headless rendering. A permissive alternative to Remotion. |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) | MIT | TypeScript animation library with a visual editor; generator-based scenes. Strong for explainer animation; less natural for LLM-authored layouts than HTML/CSS. |

HyperFrames remains the best fit: it is permissively licensed, takes plain HTML/CSS (no framework lock-in), and ships agent-oriented tooling (`lint`, `snapshot`, skills).

### Voice (text to speech)

| Model | Licence | Fit |
| --- | --- | --- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Apache-2.0 | Small and fast, runs on CPU. Built into `hyperframes tts`, so it is Director's local default (`TTS_PROVIDER=hyperframes`). Preset voices, no cloning. |
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | MIT | Zero-shot voice cloning from a short reference clip, plus emotion-intensity control. Turbo and multilingual variants exist. Use through `TTS_PROVIDER=command`, and **only with the speaker's consent**. |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | Apache-2.0 | Voice design from a description, custom voices, 10 languages (released January 2026). A good multilingual option through `command`. |
| ElevenLabs (hosted) | Commercial API | Built in (`TTS_PROVIDER=elevenlabs`) for teams that prefer a managed service. |

### Generated video (text or image to video)

| Model | Licence | Fit |
| --- | --- | --- |
| [Wan 2.2](https://github.com/Wan-Video/Wan2.2) | Apache-2.0 | The most permissive strong option. The 5B text-and-image-to-video model targets 720p at 24 fps on a single consumer GPU (RTX 4090 class); the A14B mixture-of-experts models are higher quality. ComfyUI and Diffusers support. Recommended default for `GENVIDEO_COMMAND`. |
| [LTX-2](https://github.com/Lightricks/LTX-2) | LTX-2 Community License | Open weights since January 2026. Generates video and synchronised audio together (up to 20s, native 4K at 50 fps). Free for commercial use below $10M annual revenue; larger organisations need a paid licence. Not an OSI licence. |
| [HunyuanVideo 1.5](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5) | Tencent Hunyuan Community License | High quality, but the licence territory **excludes the EU, the UK and South Korea**, which rules it out for many teams. |

Director doesn't bundle a model. `GENVIDEO_COMMAND` runs any of these (or a ComfyUI workflow, or a hosted API's CLI), and the director labels generated shots as AI-generated.

### Lip-sync and avatars

| Model | Licence | Notes |
| --- | --- | --- |
| [LatentSync](https://github.com/bytedance/LatentSync) | Apache-2.0 | Audio-conditioned latent diffusion lip-sync, the cleanest licence in this group. |
| [MuseTalk](https://github.com/TMElyralab/MuseTalk) | MIT code; bundled components have their own licences | Real-time lip-sync. Review the licence manifest (Whisper, VAE, face-parsing, DWPose) before commercial use. |

Lip-sync is only appropriate for a person who has consented to it. Director's policy forbids impersonating real people, so any lip-sync tool must be gated on consent.

### Transcription

HyperFrames' `transcribe` gives word-level timestamps (whisper.cpp or on-device models such as Parakeet). [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) is the standalone option.

## What Director uses today

- **Rendering, linting, snapshots, local voices:** HyperFrames (CLI, player and runtime).
- **Direction:** Claude through the Messages API, with tools, server-side fallback, prompt caching and effort control.
- **Voices:** Kokoro (local), ElevenLabs (hosted), or any command such as Chatterbox or Qwen3-TTS.
- **Generated clips:** any command (Wan 2.2 recommended, LTX-2 or a hosted API).
- **Media handling:** FFmpeg and ffprobe, poppler for PDFs, and unzip for DOCX.

## Roadmap: highest value next

1. **Transcript-aware editing.** Run `hyperframes transcribe` on uploaded talking-head footage so captions use the real words. Give the director a "cut by transcript" tool that trims media scenes to sentences, which is the fastest way to edit interviews and podcasts.
2. **Beat-synced cuts.** Use `hyperframes beats` on the music track and snap scene boundaries to beats, as OpenStoryline does.
3. **Style kits.** Save a finished project's palette, fonts, pacing and scene structure as a reusable kit and apply it to new material for batch production, like OpenStoryline's saved Skills.
4. **Footage search.** Index long uploads (transcript plus keyframe notes) so the agent can retrieve moments by meaning, the core of VideoDB Director.
5. **Cutouts and loudness.** Expose `remove-background` (subject cutouts over motion graphics) and `normalize-audio` (consistent loudness across clips).
6. **Stock footage provider.** Add a retrieval provider for openly licensed archives with licence metadata, as OpenMontage does.
7. **Scale-out rendering.** Use HyperFrames' Lambda or Cloud Run targets for parallel renders when the studio serves a team.
8. **Accounts and sharing.** Add authentication, per-user projects and review links before running Director as a shared service.

## Sources

- HyperFrames: [repository](https://github.com/heygen-com/hyperframes), [documentation](https://hyperframes.heygen.com/introduction), [npm](https://www.npmjs.com/package/hyperframes)
- Agentic editors: [VideoDB Director](https://github.com/video-db/Director), [FireRed-OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline), [OpenMontage](https://github.com/calesthio/OpenMontage)
- Editors and frameworks: [OpenCut](https://github.com/OpenCut-app/OpenCut), [OpenCut classic vs rewrite](https://mer.vin/2026/07/opencut-explained-open-source-capcut-alternative-classic-editor-vs-ground-up-rewrite/), [Remotion licence](https://www.remotion.pro/license), [Remotion terms](https://www.remotion.dev/docs/terms), [Revideo](https://github.com/redotvideo/revideo), [Motion Canvas](https://github.com/motion-canvas/motion-canvas), [GSAP standard licence](https://gsap.com/community/standard-license/)
- Voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [Qwen3-TTS release coverage](https://gigazine.net/gsc_news/en/20260123-qwen3-tts-family-opensource)
- Video models: [Wan 2.2](https://github.com/Wan-Video/Wan2.2), [LTX-2](https://github.com/Lightricks/LTX-2), [LTX-2 release coverage](https://www.opensourceforu.com/2026/01/ltx-2-from-lightricks-delivers-native-4k-audio-video-with-fully-open-weights/), [LTX-2 licence text](https://huggingface.co/Lightricks/LTX-2.3/blob/main/LICENSE), [LTX-2 licence summary](https://canirun.ai/license/ltx-2-community/), [HunyuanVideo 1.5](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5), [HunyuanVideo licence (European Open Source AI Index)](https://osai-index.eu/model/hunyuanvideo)
- Lip-sync: [LatentSync](https://github.com/bytedance/LatentSync), [MuseTalk](https://github.com/TMElyralab/MuseTalk), [open-source lip-sync licences (2026)](https://www.creativeainews.com/articles/open-source-lip-sync-licenses-commercial-use-2026/)
- Transcription: [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
