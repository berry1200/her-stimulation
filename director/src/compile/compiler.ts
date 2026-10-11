// Compile a validated storyboard into a HyperFrames project:
//   build/index.html               root composition: scene hosts + music + narration
//   build/compositions/<scene>.html one sub-composition per scene
//   build/assets/<asset files>     hard links (or copies) of the project assets in use
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FONT_PRESETS, FORMATS, referencedAssets, totalDuration, type Plan } from "../plan/schema.ts";
import type { Asset } from "../store/projects.ts";
import { checkCustomHtml, resolveAssetPlaceholders } from "./custom.ts";
import { lookLayers } from "./motion.ts";
import { renderScene, type ResolvedAsset } from "./scenes.ts";
import { escapeHtml, round } from "./text.ts";

export interface CompileInput {
  plan: Plan;
  assets: Asset[];
  customScenes: Record<string, string>;
  /** Project directory (asset files are resolved relative to it). */
  projectDir: string;
  /** Output directory for the HyperFrames project. */
  buildDir: string;
}

export interface CompileResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  duration: number;
  width: number;
  height: number;
  timeline: Array<{ id: string; kind: string; start: number; duration: number }>;
}

export function sceneCompositionId(sceneId: string): string {
  return `s-${sceneId}`;
}

function fontStack(f: string, resolve: (id: string) => ResolvedAsset | undefined): string {
  if (f.startsWith("asset:")) {
    const id = f.slice(6);
    return resolve(id) ? `"brand-${id}", ${FONT_PRESETS.sans}` : FONT_PRESETS.sans;
  }
  return FONT_PRESETS[f as keyof typeof FONT_PRESETS] ?? FONT_PRESETS.sans;
}

async function linkOrCopy(src: string, dest: string): Promise<void> {
  if (existsSync(dest)) await unlink(dest);
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

export async function compileProject(input: CompileInput): Promise<CompileResult> {
  const { plan, assets, projectDir, buildDir } = input;
  const { width, height } = FORMATS[plan.format];
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(assets.map((a) => [a.id, a]));

  // Assets the plan uses: verify they exist, then expose them under build/assets/.
  const used = referencedAssets(plan);
  for (const id of used) if (!byId.has(id)) errors.push(`asset ${id} is not in this project`);
  for (const [sceneId, html] of Object.entries(input.customScenes)) {
    if (!plan.scenes.some((s) => s.id === sceneId && s.kind === "custom")) continue;
    for (const m of html.matchAll(/\{\{asset:(a_[a-z0-9]{4,16})\}\}/g)) if (m[1] && !used.includes(m[1])) used.push(m[1]);
  }
  const resolve = (id: string): ResolvedAsset | undefined => {
    const a = byId.get(id);
    if (!a) return undefined;
    return { src: `assets/${path.basename(a.file)}`, kind: a.kind, width: a.width, height: a.height, duration: a.duration, hasAudio: a.hasAudio };
  };

  for (const s of plan.scenes) {
    if (s.kind === "custom") {
      const html = input.customScenes[s.id];
      // A new custom scene is saved before its HTML exists; it shows as a placeholder until then.
      if (!html) {
        warnings.push(`scene "${s.id}" is custom but has no HTML yet; it shows as a placeholder until write_custom_scene sets it`);
        continue;
      }
      const check = checkCustomHtml(html, s.duration, sceneCompositionId(s.id));
      errors.push(...check.errors.map((e) => `scene "${s.id}": ${e}`));
    }
  }
  if (errors.length) return { ok: false, errors, warnings, duration: totalDuration(plan), width, height, timeline: [] };

  await mkdir(path.join(buildDir, "assets"), { recursive: true });
  await rm(path.join(buildDir, "compositions"), { recursive: true, force: true });
  await mkdir(path.join(buildDir, "compositions"), { recursive: true });
  const wanted = new Set<string>();
  for (const id of used) {
    const a = byId.get(id);
    if (!a) continue;
    const name = path.basename(a.file);
    wanted.add(name);
    await linkOrCopy(path.join(projectDir, a.file), path.join(buildDir, "assets", name));
  }
  for (const f of await readdir(path.join(buildDir, "assets"))) {
    if (!wanted.has(f)) await rm(path.join(buildDir, "assets", f), { force: true });
  }

  const fontHeading = fontStack(plan.style.fontHeading, resolve);
  const fontBody = fontStack(plan.style.fontBody, resolve);
  const fontFaces = used
    .map((id) => byId.get(id))
    .filter((a): a is Asset => a?.kind === "font")
    .map((a) => `@font-face { font-family: "brand-${a.id}"; src: url("assets/${path.basename(a.file)}"); font-display: block; }`)
    .join("\n");

  // Letterbox bars only make sense on a landscape frame: crop 16:9 to about 2.39:1.
  const look = plan.style.look;
  let bar = 0;
  if (look?.letterbox) {
    if (width > height) bar = Math.max(0, Math.round((height - width / 2.39) / 2));
    else warnings.push("letterbox applies to 16:9 videos only; it was skipped for this format");
  }

  const timeline: CompileResult["timeline"] = [];
  const hosts: string[] = [];
  const audio: string[] = [];
  let t = 0;
  for (const scene of plan.scenes) {
    const cid = sceneCompositionId(scene.id);
    const vo = scene.voiceoverAssetId ? byId.get(scene.voiceoverAssetId) : undefined;
    let body: string;
    let css: string;
    if (scene.kind === "custom") {
      const html = input.customScenes[scene.id] || `<div id="${cid}-placeholder" class="clip" data-start="0" data-duration="${scene.duration}" data-track-index="0"></div>`;
      const resolved = resolveAssetPlaceholders(html, (id) => resolve(id)?.src);
      if (resolved.missing.length) warnings.push(`scene "${scene.id}": unknown assets ${resolved.missing.join(", ")}`);
      body = resolved.html;
      css = "";
    } else {
      const out = renderScene({ cid, scene, plan, width, height, fontHeading, fontBody, resolve, voiceoverSeconds: vo?.duration, warnings, bar });
      body = out.body;
      css = out.css;
    }
    const file = `compositions/${scene.id}.html`;
    const sceneBg = scene.background?.color ?? plan.style.palette.background;
    const doc = `<template id="${cid}-template">
  <div data-composition-id="${cid}" data-width="${width}" data-height="${height}" data-no-timeline>
    ${body}
    <style>
[data-composition-id="${cid}"] { position: absolute; inset: 0; overflow: hidden; background: ${sceneBg}; }
${css}
    </style>
  </div>
</template>
`;
    await writeFile(path.join(buildDir, file), doc);
    hosts.push(
      `<div id="${cid}" data-composition-id="${cid}" data-composition-src="${file}" data-no-timeline data-start="${round(t)}" data-duration="${round(scene.duration)}" data-track-index="0"></div>`,
    );
    if (vo) {
      const lead = 0.25;
      const span = Math.max(0.1, Math.min(vo.duration ?? scene.duration, scene.duration - lead));
      if ((vo.duration ?? 0) > scene.duration - lead + 0.05) {
        warnings.push(`scene "${scene.id}": narration is ${vo.duration?.toFixed(1)}s but the scene is ${scene.duration}s; lengthen the scene or shorten the line`);
      }
      audio.push(
        `<audio id="vo-${scene.id}" class="clip" src="assets/${path.basename(vo.file)}" data-start="${round(t + lead)}" data-duration="${round(span)}" data-track-index="7" data-volume="1"></audio>`,
      );
    }
    timeline.push({ id: scene.id, kind: scene.kind, start: round(t), duration: scene.duration });
    t += scene.duration;
  }
  const total = round(t);

  if (plan.music) {
    const m = byId.get(plan.music.assetId);
    if (m && m.kind === "audio") {
      const hasVoice = plan.scenes.some((s) => s.voiceoverAssetId);
      const volume = plan.music.volume ?? (hasVoice ? 0.18 : 0.6);
      const available = m.duration !== undefined ? m.duration - (plan.music.start ?? 0) : total;
      if (available < total - 0.05) warnings.push(`music track is ${available.toFixed(1)}s but the video is ${total}s; it will end early`);
      audio.push(
        `<audio id="music" class="clip" src="assets/${path.basename(m.file)}" data-start="0" data-duration="${round(Math.min(total, Math.max(0.1, available)))}" data-media-start="${round(plan.music.start ?? 0)}" data-volume="${volume}" data-fade-in="1" data-fade-out="2" data-track-index="8"></audio>`,
      );
    } else {
      warnings.push(`music asset ${plan.music.assetId} is missing or not audio`);
    }
  }

  const finish = lookLayers(look, total, width, height, bar);

  const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${escapeHtml(plan.title)}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${plan.style.palette.background}; }
      ${fontFaces}
      ${finish.rootCss}
      ${finish.css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${width}" data-height="${height}" data-fps="${plan.fps}" data-no-timeline>
      ${[...hosts, ...finish.html, ...audio].join("\n      ")}
    </div>
  </body>
</html>
`;
  await writeFile(path.join(buildDir, "index.html"), index);
  return { ok: true, errors, warnings: [...new Set(warnings)], duration: total, width, height, timeline };
}
