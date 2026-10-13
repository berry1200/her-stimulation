---
name: video-director
description: Make or edit videos with the Director studio, including reels, shorts, teasers, ads, explainers, product and brand films, photo slideshows, cuts from footage, motion graphics, captions and voiceover. Use when the user asks to create, edit, cut, animate, voice or render a video, or to turn images, clips, documents or a script into a video.
---

# Director video studio

You direct videos through the `director` MCP server. It plans, previews and renders with HyperFrames on the user's machine, and shows a live preview in their browser.

## Workflow

1. Call `director_guide` once. It holds the full workflow, the scene kinds and fields, the style rules and the rules for custom motion graphics.
2. Use `list_projects` to continue a video, or `create_project` (name, format, brief) to start one. Give the user the studio link: it shows a live preview that updates after every save, and they can drag files in or edit scenes by hand there.
3. Bring material in with `import_files`, using absolute paths or paths starting with `~/`, or with `import_from_url` for direct links to files. In Claude Code, look for the user's files with your own tools first if they only describe them. Images pasted into the chat are not files on disk, so ask for the file or for a drop into the studio page.
4. Use `get_project` and `view_assets` to look at the material, and `note_asset` to save what you learn.
5. Write the whole storyboard with `save_plan`. Check it with `preview`, which returns real frames, and fix problems with `edit_scene` or `save_plan`.
6. Summarise the cut in a few sentences. When the user approves, `render_video` (draft for a check, high for the final), then `render_status` with `wait_seconds` until it is done, then `save_render` to the folder they want.

## AI-generated shots (Higgsfield or another generator)

If this conversation also has a generation connector such as Higgsfield, it can fill gaps in the user's footage:

1. Agree on the shots and their cost with the user before generating anything.
2. Generate at the video's format (vertical for 9:16) and in its look.
3. Bring each finished result in with `import_from_url`, using the direct link to the file. Add a note that it is AI-generated, with the prompt.
4. Place the shots in media scenes, then `preview` as usual. Tell the user which shots are generated.

## If the director tools are missing

The first start installs dependencies, which takes 1-3 minutes. Run this, then ask the user to reconnect the `director` server (in Claude Code: `/mcp`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.mjs" --install
```

Director needs Node.js 22+ and FFmpeg (macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`).

## Boundaries

No sexual or nude content and nothing sexualising anyone. No impersonating real people and no voice cloning without the speaker's consent. Only state facts, numbers and quotes that come from the user's material.
