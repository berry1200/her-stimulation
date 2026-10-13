// End-to-end demo without an API key: generate sample media, ingest it, compile a
// storyboard that exercises every scene type, lint it, snapshot it and render it.
//   npm run demo            (writes into ./data)
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "../src/config.ts";
import { compileProject } from "../src/compile/compiler.ts";
import { ingestFile } from "../src/ingest/ingest.ts";
import { validatePlan, type Plan } from "../src/plan/schema.ts";
import { lint, render, snapshot } from "../src/render/hyperframes.ts";
import { ProjectStore } from "../src/store/projects.ts";

const run = promisify(execFile);

async function makeSamples(dir: string): Promise<Record<string, string>> {
  const f = (n: string) => path.join(dir, n);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "gradients=s=1600x1200:c0=0x1d2b53:c1=0xff5722:c2=0x7e2553:n=3:d=1", "-frames:v", "1", f("photo.png")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=220:duration=8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f("footage.mp4")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=196:duration=30", "-af", "volume=0.4", f("music.mp3")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.2", "-af", "volume=0.3", f("narration.wav")]);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(f("brief.md"), "# Launch brief\n\nWe are launching Director: an AI that turns your images, footage and documents into finished videos.\n");
  return { photo: f("photo.png"), footage: f("footage.mp4"), music: f("music.mp3"), narration: f("narration.wav"), brief: f("brief.md") };
}

async function main() {
  const config = loadConfig();
  const store = new ProjectStore(config.dataDir);
  await store.init();
  const project = await store.create("Director demo", "9:16", "Show off every scene type.");
  const dir = store.dir(project.id);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "director-demo-"));
  const samples = await makeSamples(tmp);
  const ids: Record<string, string> = {};
  for (const [key, file] of Object.entries(samples)) {
    const asset = await ingestFile(dir, path.basename(file), await readFile(file));
    ids[key] = asset.id;
    await store.update(project.id, (p) => void p.assets.push(asset));
  }
  await rm(tmp, { recursive: true, force: true });

  const plan: Plan = {
    title: "Director demo",
    format: "9:16",
    fps: 30,
    style: { palette: { background: "#0d0d0d", surface: "#1c1c1c", text: "#f5f5f5", muted: "#b0b0b0", accent: "#ff5722" }, fontHeading: "sans", fontBody: "sans", radius: 28 },
    music: { assetId: ids.music!, volume: 0.25 },
    scenes: [
      { id: "intro", kind: "title", duration: 3.5, heading: "Meet Director", body: "Your footage, documents and ideas in. Finished video out.", background: { assetId: ids.photo!, overlay: 0.45 }, voiceover: "Meet Director. Your ideas in, finished video out.", voiceoverAssetId: ids.narration! },
      { id: "hook", kind: "statement", duration: 3, body: "Every video starts as a conversation.", transition: "wipe" },
      { id: "footage", kind: "media", duration: 3.5, media: { assetId: ids.footage!, start: 1, fit: "cover" }, heading: "Uses your real footage", transition: "slide-up" },
      { id: "photo", kind: "media", duration: 3, media: { assetId: ids.photo!, motion: "pan-left" }, body: "Stills get cinematic camera moves.", transition: "fade" },
      { id: "steps", kind: "list", duration: 4.5, heading: "How it works", items: ["Upload anything", "Chat with the director", "Preview instantly", "Render in HD"], transition: "zoom" },
      { id: "speed", kind: "stat", duration: 3, stat: { value: 120, suffix: "x", label: "faster than editing by hand" }, transition: "fade" },
      { id: "quote", kind: "quote", duration: 3.5, heading: "It feels like working with a real editor.", attribution: "Early tester", transition: "fade" },
      { id: "outro", kind: "cta", duration: 3, heading: "Start directing", body: "Open source, built on HyperFrames.", items: ["Try the demo"], transition: "wipe" },
    ],
  };
  const v = validatePlan(plan);
  if (!v.ok) throw new Error(JSON.stringify(v.issues, null, 2));
  await store.update(project.id, (p) => {
    p.plan = v.plan;
    p.planVersion += 1;
  });
  const fresh = await store.get(project.id);
  const buildDir = path.join(dir, "build");
  const result = await compileProject({ plan: v.plan, assets: fresh.assets, customScenes: {}, projectDir: dir, buildDir });
  console.log(`compile: ok=${result.ok} duration=${result.duration}s warnings=${result.warnings.length}`);
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const l = await lint(config, buildDir);
  console.log(`lint: ok=${l.ok} errors=${l.errors.length} warnings=${l.warnings.length}`);
  for (const f of [...l.errors, ...l.warnings]) console.log(`  ${f.severity} ${f.code}: ${f.message.slice(0, 160)}`);
  const times = result.timeline.map((s) => s.start + Math.min(s.duration - 0.3, 1.6));
  const frames = await snapshot(config, buildDir, times, path.join(dir, "previews", "demo-snapshots"));
  console.log(`snapshot: ${frames.length} frames in ${path.dirname(frames[0] ?? "")}`);
  const out = path.join(dir, "renders", "demo.mp4");
  let last = -10;
  await render(config, buildDir, out, {
    quality: "draft",
    onProgress: (pct, msg) => {
      if (pct >= last + 20) {
        last = pct;
        console.log(`render: ${pct}% ${msg}`);
      }
    },
  });
  console.log(`done: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
