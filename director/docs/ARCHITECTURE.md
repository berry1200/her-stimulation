# Architecture

Director has four parts:
- **Storyboard:** the source of truth for each video.
- **Compiler:** turns the storyboard into a HyperFrames composition.
- **Director agent:** an AI that edits the storyboard through tools.
- **Studio server and UI:** let a person do the same by hand.
- **Claude connector:** an MCP server that lets Claude, in Claude Code or Claude Desktop, act as the director through the same tools.

Every path into a video goes through the same validation and compile step, whether it starts from a person, the API, the built-in agent or Claude through the connector.

```
 ┌──────────── web UI (web/) ────────────┐        ┌──────── Claude API ────────┐
 │ assets · live preview · storyboard    │        │ model + effort, server-side│
 │ scene editor · chat · renders         │        │ fallback, cached system    │
 └───────┬──────────────────▲────────────┘        └──────────▲─────────────────┘
         │ REST              │ SSE (feed, agent, plan,        │ messages + tools
         ▼                   │      assets, render)           │
 ┌──────────────── server.ts (Hono) ──────────────────┐  ┌────┴──────────────────┐
 │ /api/projects… /files/… /vendor/… /static/…        │  │ agent/director.ts      │
 └───────┬────────────────────────────────────────────┘  │ manual tool loop       │
         ▼                                               │ agent/tools.ts (10)    │
 ┌──────────────────── studio.ts ─────────────────────┐◄─┤                        │
 │ addAsset · savePlan · editScene · writeCustomScene  │  └────────────────────────┘
 │ build · preview · generateVoiceovers · generateClip │
 │ queueRender / cancelRender                          │
 └──┬──────────┬──────────────┬───────────────┬────────┘
    ▼          ▼              ▼               ▼
 store/     ingest/        compile/        render/hyperframes.ts ──► HyperFrames CLI
 projects   (ffprobe,      (plan → HTML     (lint, snapshot, render,    (headless Chrome
 (JSON,     ffmpeg,        composition)     tts)                         + FFmpeg)
  locks)    pdftotext,                     providers/ (tts, genvideo: none | hyperframes |
            docx)                                      elevenlabs | command)
```

## Storyboard (`src/plan/schema.ts`)

A plan is a format (9:16, 16:9, 1:1 or 4:5), a frame rate, a style, optional music, and 1 to 60 scenes:
- **Style:** a five-colour palette, heading and body fonts (presets or uploaded font files), a corner radius and a mood.
- **Scenes:** each has an `id`, a `kind` (title, statement, media, list, stat, quote, cta, custom), a duration, and optional text, media, background, motion, transition, voiceover and captions.

Zod validates the shape, and `validatePlan` adds the rules Zod can't express: unique ids and the fields each kind requires. The same Zod schema produces the JSON Schema for the agent's `save_plan` tool, so the model, the API and the UI share one contract.

## Projects on disk (`src/store/projects.ts`)

```
~/Director/projects/<p_id>/      (DIRECTOR_DATA_DIR)
  project.json     name, format, brief, assets, plan, planVersion, custom scenes, renders
  chat.json        the director conversation, exactly as exchanged with the API
  feed.json        what the UI shows: messages, tool results, system notes
  assets/          uploads and generated media, named by asset id
  previews/        thumbnails, video keyframes, PDF pages, snapshot frames
  build/           the compiled HyperFrames project (index.html, compositions/, assets/)
  renders/         finished MP4s
```

Writes are atomic: the file is written to a temp path and renamed into place. A per-project lock serialises read-modify-write updates, so the agent, the UI and the render queue never clobber each other.

## Ingest (`src/ingest/`)

- Each upload is classified by extension against an allowlist and stored under a generated id. The original file name is kept for display only.
- Images and video are probed with ffprobe, including rotation.
- Video in codecs browsers can't play (anything except H.264, VP8, VP9 or AV1) is transcoded to H.264 MP4. Videos get six keyframes.
- PDFs get page previews and text via poppler. DOCX, HTML, Markdown, SRT and VTT become plain text, with HTML scripts stripped. Text is capped at 60k characters.
- Links (`download.ts`) are fetched with undici:
  - only public addresses; loopback, private, link-local, CGNAT, multicast and reserved ranges are refused, IPv4-mapped and NAT64 forms included
  - every redirect is checked again (at most 5)
  - without a proxy, the connection is pinned to the checked address; with `HTTPS_PROXY` it goes through the proxy
  - size and time limits apply
  - the file name comes from the content type, and a web page is rejected with a hint to use the direct file link

## Compiler (`src/compile/`)

`compileProject` writes a HyperFrames project:

- `build/index.html` is the root composition. Each scene is a host element: `data-composition-src="compositions/<scene>.html"`, timed with `data-start`/`data-duration`. It is marked `data-no-timeline`, because scenes animate with CSS keyframes, not GSAP. Voiceover `<audio>` clips sit on track 7 and start 0.25s into their scene. Music sits on track 8, at volume 0.18 under narration and 0.6 otherwise, with fades.
- `compositions/<scene>.html` holds one `<template>` per scene. It contains a flat list of timed clips on fixed tracks: background 0, media 1, overlay 2, text 3, list items from 13, captions 6, and transition cover 9. Its CSS is scoped to `[data-composition-id="s-<scene>"]`.
- **Text** is sized to fit: `fitFontSize` estimates line wrapping for the frame width and shrinks text within a range. Captions are chunked from the narration (at most 34 characters or 6 words, breaking at punctuation) and timed across the voiceover span.
- **Motion** is CSS keyframes, which HyperFrames seeks frame-accurately:
  - text entrances: rise, fade, scale, slide-left, blur, words
  - camera moves: Ken Burns zoom and pan, dolly-in, crash-zoom and drift
  - stat counters: `@property` integer interpolation
  - transitions: a cover element that fades, slides, irises, wipes or flashes; a whip moves the scene itself in with motion blur
  - film look (`style.look`): a grade as a filter on the root plus an optional soft-light tint, then grain, vignette and letterbox bars as full-length clips on tracks 10-13; letterbox also moves the text safe areas inside the bars
- **Custom scenes** are HTML the agent writes. They run in the render browser and in the same-origin preview, so `checkCustomHtml` is strict:
  - It rejects scripts, embedded documents, forms, `<link>`/`<meta>`/`<base>`, `on*` handlers, script URLs, `@import` and nested compositions. These checks also run on entity-decoded text, so encoded payloads can't slip through.
  - URLs are allowlisted. `src`/`href`/`poster` and CSS `url()` may only be `{{asset:a_…}}` placeholders, `#fragments` or data-URI images; CSS escapes and URL-taking CSS functions are rejected.
  - Scoping keeps scenes from colliding. Every id and selector, and every `@keyframes` and `@property` name, must carry the scene prefix.
  - CSS animations on SVG elements are rejected. HyperFrames only seeks animations on HTML elements, so animated SVG must sit in an HTML wrapper.
  - Timing must fit the scene and the HTML has a size limit. `{{asset:a_…}}` placeholders resolve to build paths.
- **Assets** are hard-linked into `build/assets/` (copied when hard links fail), so the build folder is self-contained.

After compiling, the studio runs `hyperframes lint`. Errors block the save and go back to the caller; warnings are reported but don't block.

## Preview and render (`src/render/hyperframes.ts`)

- **Live preview:** the UI embeds `<hyperframes-player>` pointed at `build/index.html`. The server provides the player and the runtime it injects, so previews work offline.
- **Agent preview:** the agent's `preview` tool runs `hyperframes snapshot --at …` and gets PNG frames back. Frames are downscaled before they are sent to the model.
- **Render:** `hyperframes render --quality draft|standard|high`, or `4k` (high quality at HyperFrames' 2x resolution preset for 16:9, 9:16 and 1:1). Renders run one at a time in a queue. `@hf-progress` lines become SSE progress events, and a cancel aborts the child process. The CLI runs as a child process, so a browser crash can't take the server down.
- **Thumbnails:** after each save (debounced), the studio compiles the storyboard into its own folder, snapshots one frame per scene and stores small JPEGs for the strip and the project cards. This never holds the edit lock, so it doesn't slow down Claude or the editor.

## Director agent (`src/agent/`)

- **Loop:** a manual tool-use loop on the Messages API (`client.beta.messages.create`):
  - the configured model (default `claude-opus-5-5`) with `output_config.effort`
  - server-side fallback (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta), so a request the primary model declines can be completed by a fallback model
  - a stable system prompt marked for prompt caching
- **History:** append-only and persisted in `chat.json`. Assistant turns are stored exactly as returned, thinking blocks and signatures included, so multi-turn reasoning stays valid across messages and restarts.
- **Project state:** each user message is preceded by a `<project_state>` snapshot (assets with notes, the storyboard, providers, recent renders), so the model always works from current facts.
- **Stop reasons:** `tool_use` runs the tools, `pause_turn` continues, `refusal` ends the turn with a message, and `max_tokens` never executes possibly truncated tool input. Each message is capped at `DIRECTOR_MAX_STEPS` API calls, and token usage is reported in the feed.
- **Tools** (all inputs are validated with Zod before anything runs):

| Tool | What it does |
| --- | --- |
| `get_project` | Current state: brief, assets, storyboard, custom scenes, renders, providers. |
| `view_assets` | Look at up to 4 assets: images as pictures, video as keyframes, documents as text (PDFs also as documents). |
| `note_asset` | Save a one-line description of an asset for later turns. |
| `save_plan` | Replace the storyboard; validated, compiled and linted, with errors returned for self-correction. |
| `edit_scene` | Change fields of one scene, remove fields with `null`, or delete the scene. |
| `write_custom_scene` | Provide sandboxed HTML/CSS for a custom motion-graphics scene. |
| `preview` | Snapshot frames (one per scene by default) and look at them. |
| `generate_voiceover` | Synthesize narration with the voice provider; lengthens scenes to fit. |
| `generate_clip` | Make an AI clip with the video provider; it becomes a new asset. |
| `render_video` | Queue an MP4 render. |

The system prompt (`prompts.ts`) sets the workflow:
1. Look at the material.
2. Write the whole storyboard in one call.
3. Preview it and fix what's wrong.
4. Reply briefly.
5. Render only on request.

It also covers style (one idea per scene, readable text, facts only from the user's material) and boundaries. `policy.ts` screens clear-cut sexual or deepfake requests before any API call. The model handles everything else.

## Claude connector (`src/mcp/`, `src/mcp.ts`, `scripts/start-mcp.mjs`)

- **Server:** built on the MCP SDK's low-level `Server`. It exposes the agent's ten tools, each with a required `project_id`, plus:
  - `director_guide`, `list_projects`, `create_project`
  - `import_files`: local paths; hidden paths refused, symlinks resolved first, optionally limited to `DIRECTOR_IMPORT_ROOTS`
  - `import_from_url` (shared with the built-in agent): direct file links, for example shots generated with Higgsfield in the same Claude conversation
  - `render_status`: long-polls up to 55s; `save_render`: copies the MP4 without overwriting by default
  - a `make_video` prompt
- **Results:** converted to MCP content, text and images. PDFs go as text plus page images rather than document blocks.
- **Activity:** each call is written to the project feed, so the studio shows what Claude did.
- **stdio** (`src/mcp.ts`): what Claude Code and Claude Desktop launch.
  - Serves the studio UI in the same process, on the first free port from 4321, so the live preview follows Claude's edits through the shared event bus.
  - Setup problems such as missing FFmpeg or busy ports go into the server instructions.
  - stdout is reserved for the protocol.
- **HTTP** (`/mcp` on the studio server): stateless streamable HTTP with a fresh server per request. A bearer token (`DIRECTOR_MCP_TOKEN`) is required when the studio listens on a non-local address. A Host-header check guards the whole app against DNS rebinding.
- **Plugin:** `.claude-plugin/plugin.json`, `.mcp.json` and `skills/video-director/SKILL.md` in `director/`, plus `.claude-plugin/marketplace.json` at the repository root.
  - The launcher runs straight from a checkout that has `node_modules`.
  - Installed as a plugin, it copies the app into `${CLAUDE_PLUGIN_DATA}/app` and runs `npm ci` there once per lockfile, then `hyperframes browser ensure`.
  - A first start without dependencies begins that install in the background and exits with a message to reconnect, because installing takes longer than a client waits for a server.
- **Guidance:** `agent/prompts.ts` is split into sections. The built-in agent's system prompt and the connector's guide are assembled from the same text.

## Providers (`src/providers/`)

| | Options | Notes |
| --- | --- | --- |
| Voice | `none`, `hyperframes`, `elevenlabs`, `command` | `hyperframes` runs Kokoro-82M locally through `hyperframes tts`. `command` runs any argv template with `{text}`, `{out}`, `{voice}`. |
| Generated video | `none`, `command` | Argv template with `{prompt}`, `{seconds}`, `{aspect}`, `{image}`, `{out}`, for a Wan 2.2/LTX-2 script, a ComfyUI runner or a hosted API CLI. |

Templates are split into argv and run with `execFile`; placeholders are substituted inside single arguments, never through a shell.

## Server and UI

- **Server** (`server.ts`):
  - a Hono app with JSON routes, a multipart upload with a body limit and a per-file size check, and an SSE stream per project
  - a file route restricted to `assets/`, `previews/`, `build/` and `renders/`, with traversal rejected, range requests supported (for video scrubbing) and `no-store` on builds
- **UI** (`web/`):
  - dependency-free ES modules; every piece of user or model text is inserted with `textContent`
  - the player element persists across re-renders, so selecting a scene seeks instead of reloading
  - a new plan version swaps in a new build

## Extending

- **New scene kind:** add it to `SCENE_KINDS` and the per-kind rules in `schema.ts`, render it in `compile/scenes.ts`, describe it in `agent/prompts.ts`, and add it to the UI's `KINDS`.
- **New provider:** implement `TtsProvider` or `GenVideoProvider` and select it in `createTts`/`createGenVideo`.
- **Different model:** set `DIRECTOR_MODEL` and `DIRECTOR_EFFORT`. The loop and tools don't depend on a particular model.
- **More HyperFrames features:** the CLI also offers `beats`, `transcribe`, `normalize-audio`, `remove-background`, `check`/`validate` and cloud, Lambda or Cloud Run rendering. Each maps to a new tool in `agent/tools.ts` backed by a `runCli` call (see `docs/RESEARCH.md`).
