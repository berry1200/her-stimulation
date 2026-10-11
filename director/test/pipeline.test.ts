// Ingest + compile against real media (ffmpeg), without rendering.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { compileProject } from "../src/compile/compiler.ts";
import { ingestFile } from "../src/ingest/ingest.ts";
import { validatePlan, type Plan } from "../src/plan/schema.ts";
import { ProjectStore, type Asset } from "../src/store/projects.ts";
import { makeMedia, tempConfig } from "./helpers.ts";

describe("ingest and compile", () => {
  let media: Record<string, string>;
  let store: ProjectStore;
  let projectId: string;
  const assets: Record<string, Asset> = {};

  before(async () => {
    const config = await tempConfig();
    store = new ProjectStore(config.dataDir);
    await store.init();
    projectId = (await store.create("Test", "9:16")).id;
    media = await makeMedia(await mkdtemp(path.join(os.tmpdir(), "media-")));
    for (const [k, file] of Object.entries(media)) {
      assets[k] = await ingestFile(store.dir(projectId), path.basename(file), await readFile(file));
    }
  });

  it("classifies and probes uploads", () => {
    assert.equal(assets.photo!.kind, "image");
    assert.equal(assets.photo!.width, 800);
    assert.equal(assets.clip!.kind, "video");
    assert.ok(Math.abs((assets.clip!.duration ?? 0) - 4) < 0.2);
    assert.equal(assets.clip!.hasAudio, true);
    assert.equal(assets.clip!.previews?.length, 6);
    assert.equal(assets.voice!.kind, "audio");
    assert.ok(Math.abs((assets.voice!.duration ?? 0) - 3) < 0.1);
  });

  it("transcodes browser-unsafe video to H.264 MP4", () => {
    assert.equal(assets.legacy!.mime, "video/mp4");
    assert.match(assets.legacy!.file, /\.mp4$/);
    assert.ok(!existsSync(path.join(store.dir(projectId), assets.legacy!.file.replace(/\.mp4$/, ".mov"))));
  });

  it("extracts document text (markdown, html without scripts, docx)", () => {
    assert.match(assets.notes!.text ?? "", /ship faster/);
    assert.match(assets.page!.text ?? "", /Para & more/);
    assert.doesNotMatch(assets.page!.text ?? "", /evil/);
    assert.match(assets.docx!.text ?? "", /Hello from Word\nSecond paragraph/);
  });

  it("rejects unsupported files", async () => {
    await assert.rejects(ingestFile(store.dir(projectId), "tool.exe", new Uint8Array([1, 2, 3])), /unsupported/);
  });

  it("compiles a storyboard into a HyperFrames project", async () => {
    const plan: Plan = {
      title: "Compile test",
      format: "9:16",
      fps: 30,
      style: { palette: { background: "#0d0d0d", surface: "#1a1a1a", text: "#ffffff", muted: "#aaaaaa", accent: "#ff5722" }, fontHeading: "sans", fontBody: "sans" },
      music: { assetId: assets.voice!.id, volume: 0.3 },
      scenes: [
        { id: "intro", kind: "title", duration: 3, heading: "Hello <world> & \"friends\"", voiceover: "Hello world, this is a caption test.", voiceoverAssetId: assets.voice!.id },
        { id: "clip", kind: "media", duration: 2, media: { assetId: assets.clip!.id, start: 1, withAudio: true } },
        { id: "art", kind: "custom", duration: 2 },
      ],
    };
    const v = validatePlan(plan);
    assert.equal(v.ok, true);
    const buildDir = path.join(store.dir(projectId), "build");
    const custom = { art: `<div id="s-art-bg" class="clip" data-start="0" data-duration="2" data-track-index="0"><img id="s-art-img" src="{{asset:${assets.photo!.id}}}"></div><style>[data-composition-id="s-art"] #s-art-bg{position:absolute;inset:0}</style>` };
    const project = await store.get(projectId);
    const r = await compileProject({ plan, assets: Object.values(assets), customScenes: custom, projectDir: store.dir(projectId), buildDir });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.duration, 7);
    assert.deepEqual(r.timeline.map((s) => s.start), [0, 3, 5]);
    const index = await readFile(path.join(buildDir, "index.html"), "utf8");
    // Every scene host opts out of the GSAP timeline wait.
    assert.equal((index.match(/data-composition-src="compositions\/[a-z]+\.html" data-no-timeline/g) ?? []).length, 3);
    assert.match(index, /id="vo-intro"[^>]+data-start="0.25"/);
    assert.match(index, /id="music"[^>]+data-volume="0.3"/);
    const intro = await readFile(path.join(buildDir, "compositions", "intro.html"), "utf8");
    assert.match(intro, /Hello &lt;world&gt; &amp; &quot;friends&quot;/);
    assert.match(intro, /id="s-intro-cap0"/);
    const clip = await readFile(path.join(buildDir, "compositions", "clip.html"), "utf8");
    assert.match(clip, /data-media-start="1"/);
    assert.match(clip, /data-has-audio="true"/);
    const art = await readFile(path.join(buildDir, "compositions", "art.html"), "utf8");
    assert.match(art, new RegExp(`assets/${assets.photo!.id}\\.png`));
    assert.ok(existsSync(path.join(buildDir, "assets", path.basename(assets.clip!.file))));
    assert.equal(project.id, projectId);
  });

  it("compiles a custom scene without HTML yet as a placeholder", async () => {
    const plan: Plan = {
      title: "x", format: "1:1", fps: 30,
      style: { palette: { background: "#000000", surface: "#111111", text: "#ffffff", muted: "#aaaaaa", accent: "#ff5722" }, fontHeading: "sans", fontBody: "sans" },
      scenes: [{ id: "art", kind: "custom", duration: 2 }],
    };
    const r = await compileProject({ plan, assets: [], customScenes: {}, projectDir: store.dir(projectId), buildDir: path.join(store.dir(projectId), "build3") });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.match(r.warnings.join(" "), /placeholder/);
  });

  it("reports missing assets instead of compiling", async () => {
    const plan: Plan = {
      title: "x",
      format: "16:9",
      fps: 30,
      style: { palette: { background: "#000000", surface: "#111111", text: "#ffffff", muted: "#aaaaaa", accent: "#ff5722" }, fontHeading: "sans", fontBody: "sans" },
      scenes: [{ id: "m", kind: "media", duration: 2, media: { assetId: "a_nothere1" } }],
    };
    const r = await compileProject({ plan, assets: [], customScenes: {}, projectDir: store.dir(projectId), buildDir: path.join(store.dir(projectId), "build2") });
    assert.equal(r.ok, false);
    assert.match(r.errors[0] ?? "", /a_nothere1/);
  });
});
