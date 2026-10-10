// Scene templates: each storyboard scene becomes one HyperFrames sub-composition
// made of flat, individually timed clips (background, media, text, captions, cover).
import type { Plan, Scene } from "../plan/schema.ts";
import { mediaMotion, textAnimation, textKeyframes, transitionCss, type MediaMotion, type TextMotion } from "./motion.ts";
import { captionChunks, cssString, escapeHtml, fitFontSize, round, timeCues, wrapLineCount } from "./text.ts";

export interface ResolvedAsset {
  /** Path relative to the build root, e.g. "assets/a_x.png". */
  src: string;
  kind: "image" | "video" | "audio" | "document" | "font";
  width?: number;
  height?: number;
  duration?: number;
  hasAudio?: boolean;
}

export interface SceneContext {
  cid: string;
  scene: Scene;
  plan: Plan;
  width: number;
  height: number;
  fontHeading: string;
  fontBody: string;
  resolve: (assetId: string) => ResolvedAsset | undefined;
  /** Seconds of narration audio, when a voiceover asset is attached. */
  voiceoverSeconds?: number;
  warnings: string[];
}

interface Block {
  key: string;
  html: string;
  css: string;
  height: number;
}

const TRACK = { bg: 0, media: 1, overlay: 2, text: 3, captions: 6, cover: 9 } as const;

function clip(cid: string, key: string, track: number, start: number, duration: number, inner: string, tag = "div", extra = ""): string {
  return `<${tag} id="${cid}-${key}" class="clip" data-start="${round(start)}" data-duration="${round(duration)}" data-track-index="${track}"${extra}>${inner}</${tag}>`;
}

export function layoutFor(width: number, height: number) {
  const unit = Math.min(width, height) / 1080;
  const vertical = height > width * 1.2;
  const marginX = Math.round(width * (vertical ? 0.08 : 0.07));
  const top = Math.round(height * (vertical ? 0.13 : 0.1));
  // Vertical video keeps clear of the platform UI along the bottom edge.
  const captionTop = Math.round(height * (vertical ? 0.7 : 0.82));
  const bottom = captionTop - Math.round(24 * unit);
  return { unit, vertical, marginX, boxWidth: width - 2 * marginX, top, bottom, captionTop };
}

function textBlock(ctx: SceneContext, key: string, text: string, opts: { maxSize: number; minSize: number; maxLines: number; weight: number; font: string; color: string; delayMs: number; motion: TextMotion; italic?: boolean; align?: "center" | "left"; lineHeight?: number }): Block {
  const L = layoutFor(ctx.width, ctx.height);
  const { size, fits } = fitFontSize(text, L.boxWidth, opts.maxLines, opts.maxSize * L.unit, opts.minSize * L.unit);
  if (!fits) ctx.warnings.push(`scene "${ctx.scene.id}": ${key} text is long and was set at the minimum size; consider shortening it`);
  const lh = opts.lineHeight ?? 1.12;
  const lines = Math.min(wrapLineCount(text, Math.floor(L.boxWidth / (size * 0.56))), opts.maxLines + 2);
  const cid = ctx.cid;
  let inner = escapeHtml(text);
  let anim = textAnimation(cid, opts.motion, opts.delayMs);
  if (opts.motion === "words") {
    const words = text.split(/\s+/).filter(Boolean);
    inner = words
      .map((w, i) => `<span class="w" style="animation-delay:${Math.round(opts.delayMs + i * 90)}ms">${escapeHtml(w)}</span>`)
      .join(" ");
    anim = "";
  }
  const css = `
#${cid}-${key} { position: absolute; left: ${L.marginX}px; width: ${L.boxWidth}px; margin: 0;
  font-family: ${opts.font}; font-size: ${size}px; font-weight: ${opts.weight}; line-height: ${lh};
  color: ${opts.color}; text-align: ${opts.align ?? "center"}; letter-spacing: ${opts.weight >= 700 ? "-0.02em" : "0"};
  ${opts.italic ? "font-style: italic;" : ""} overflow-wrap: anywhere; ${anim} }
${opts.motion === "words" ? `#${cid}-${key} .w { display: inline-block; animation-name: ${cid}-rise; animation-duration: 600ms; animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1); animation-iteration-count: 1; animation-fill-mode: both; }` : ""}`;
  const track = /^i\d+$/.test(key) ? TRACK.text + 10 + Number(key.slice(1)) : TRACK.text;
  return { key, html: clip(cid, key, track, 0, ctx.scene.duration, inner), css, height: Math.ceil(lines * size * lh) };
}

/** Stack blocks vertically, centred inside [top, bottom], and pin each block's `top`. */
function stack(ctx: SceneContext, blocks: Block[], gap: number, top: number, bottom: number): string {
  const total = blocks.reduce((s, b) => s + b.height, 0) + gap * Math.max(0, blocks.length - 1);
  let y = Math.round(top + Math.max(0, (bottom - top - total) / 2));
  if (total > bottom - top) ctx.warnings.push(`scene "${ctx.scene.id}": content is taller than the safe area; consider less text`);
  const css: string[] = [];
  for (const b of blocks) {
    css.push(`#${ctx.cid}-${b.key} { top: ${y}px; }`);
    y += b.height + gap;
  }
  return css.join("\n");
}

function backgroundLayers(ctx: SceneContext, hasText: boolean): { html: string[]; css: string[] } {
  const { cid, scene, plan } = ctx;
  const p = plan.style.palette;
  const color = scene.background?.color ?? p.background;
  const html = [clip(cid, "bg", TRACK.bg, 0, scene.duration, "")];
  const css = [`#${cid}-bg { position: absolute; inset: 0; background: radial-gradient(120% 75% at 50% 0%, ${p.surface} 0%, ${color} 72%); }`];
  const bgId = scene.background?.assetId;
  if (bgId) {
    const a = ctx.resolve(bgId);
    if (!a || (a.kind !== "image" && a.kind !== "video")) {
      ctx.warnings.push(`scene "${scene.id}": background asset ${bgId} is missing or not an image/video`);
    } else {
      html.push(mediaElement(cid, "bgm", a, scene.duration, { fit: "cover", start: 0, withAudio: false, volume: 0 }));
      css.push(`#${cid}-bgm { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }`);
      css.push(mediaMotion(cid, "bgm", a.kind === "image" ? "zoom-in" : "none", scene.duration));
      const overlay = scene.background?.overlay ?? (hasText ? 0.5 : 0);
      if (overlay > 0) {
        html.push(clip(cid, "ov", TRACK.overlay, 0, scene.duration, ""));
        css.push(`#${cid}-ov { position: absolute; inset: 0; background: rgba(0,0,0,${overlay}); }`);
      }
    }
  }
  return { html, css };
}

function mediaElement(cid: string, key: string, a: ResolvedAsset, duration: number, o: { fit: "cover" | "contain"; start: number; withAudio: boolean; volume: number }): string {
  if (a.kind === "image") {
    return clip(cid, key, TRACK.media, 0, duration, "", "img", ` src="${escapeHtml(a.src)}" alt=""`).replace("></img>", " />");
  }
  const audio = o.withAudio && a.hasAudio ? ` data-has-audio="true" data-volume="${o.volume}"` : " muted";
  return clip(cid, key, TRACK.media, 0, duration, "", "video", ` src="${escapeHtml(a.src)}" data-media-start="${round(o.start)}" playsinline${audio}`);
}

function captions(ctx: SceneContext): { html: string[]; css: string[] } {
  const { cid, scene } = ctx;
  if (!scene.voiceover || scene.captions === false) return { html: [], css: [] };
  const L = layoutFor(ctx.width, ctx.height);
  const lead = 0.25;
  const span = Math.max(0.5, Math.min(ctx.voiceoverSeconds ?? scene.duration - lead - 0.3, scene.duration - lead - 0.1));
  const cues = timeCues(captionChunks(scene.voiceover), lead, span);
  const html = cues.map((c, i) => clip(cid, `cap${i}`, TRACK.captions, c.start, c.duration, escapeHtml(c.text)));
  const size = Math.round(46 * L.unit);
  const css = [
    `[data-composition-id="${cid}"] [id^="${cid}-cap"] { position: absolute; top: ${L.captionTop}px; left: 50%; transform: translateX(-50%);
  width: max-content; max-width: ${L.boxWidth}px; padding: ${Math.round(14 * L.unit)}px ${Math.round(26 * L.unit)}px;
  border-radius: ${Math.round(18 * L.unit)}px; background: rgba(0,0,0,0.62); color: #ffffff; text-align: center;
  font-family: ${ctx.fontBody}; font-weight: 700; font-size: ${size}px; line-height: 1.2;
  animation: ${cid}-fade 140ms linear 0ms 1 both; }`,
  ];
  return { html, css };
}

export interface SceneOutput {
  /** Inner HTML of the sub-composition root (clips only). */
  body: string;
  css: string;
}

export function renderScene(ctx: SceneContext): SceneOutput {
  const { cid, scene, plan } = ctx;
  const p = plan.style.palette;
  const L = layoutFor(ctx.width, ctx.height);
  const motion: TextMotion = scene.textMotion ?? (scene.kind === "statement" ? "words" : "rise");
  const html: string[] = [];
  const css: string[] = [textKeyframes(cid, L.unit)];
  const hasText = Boolean(scene.heading || scene.body || scene.items?.length || scene.stat);
  const radius = Math.round((plan.style.radius ?? 24) * L.unit);

  if (scene.kind !== "custom") {
    const bg = backgroundLayers(ctx, hasText);
    html.push(...bg.html);
    css.push(...bg.css);
  }

  const heading = (key: string, text: string, maxSize: number, maxLines: number, delayMs = 250) =>
    textBlock(ctx, key, text, { maxSize, minSize: 40, maxLines, weight: 800, font: ctx.fontHeading, color: p.text, delayMs, motion });
  const body = (key: string, text: string, delayMs = 600) =>
    textBlock(ctx, key, text, { maxSize: 42, minSize: 26, maxLines: 7, weight: 500, font: ctx.fontBody, color: p.muted, delayMs, motion: motion === "words" ? "fade" : motion, lineHeight: 1.35 });

  switch (scene.kind) {
    case "title":
    case "statement": {
      const blocks: Block[] = [];
      if (scene.kind === "title") {
        const h = Math.max(4, Math.round(8 * L.unit));
        html.push(clip(cid, "rule", TRACK.overlay, 0, scene.duration, ""));
        css.push(`#${cid}-rule { position: absolute; left: 50%; width: ${Math.round(120 * L.unit)}px; height: ${h}px;
  margin-left: ${-Math.round(60 * L.unit)}px; background: ${p.accent}; border-radius: 99px; transform-origin: 50% 50%;
  animation: ${cid}-grow 700ms cubic-bezier(0.2, 0.8, 0.2, 1) 150ms 1 both; }
@keyframes ${cid}-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }`);
        blocks.push({ key: "rule", html: "", css: "", height: h });
      }
      if (scene.heading) blocks.push(heading("h", scene.heading, scene.kind === "title" ? 128 : 100, scene.kind === "title" ? 4 : 6));
      if (scene.body) blocks.push(scene.heading ? body("b", scene.body) : heading("b", scene.body, 96, 6));
      for (const b of blocks) { if (b.html) html.push(b.html); if (b.css) css.push(b.css); }
      css.push(stack(ctx, blocks, Math.round(36 * L.unit), L.top, L.bottom));
      break;
    }
    case "media": {
      const a = scene.media ? ctx.resolve(scene.media.assetId) : undefined;
      if (!a || (a.kind !== "image" && a.kind !== "video")) {
        ctx.warnings.push(`scene "${scene.id}": media asset ${scene.media?.assetId ?? "(none)"} is missing or not an image/video`);
      } else {
        const fit = scene.media?.fit ?? "cover";
        const m: MediaMotion = scene.media?.motion ?? (a.kind === "image" ? "zoom-in" : "none");
        html.push(mediaElement(cid, "m", a, scene.duration, { fit, start: scene.media?.start ?? 0, withAudio: scene.media?.withAudio ?? false, volume: scene.media?.volume ?? 1 }));
        css.push(`#${cid}-m { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: ${fit}; }`);
        css.push(mediaMotion(cid, "m", m, scene.duration));
        if (a.kind === "video" && a.duration !== undefined && (scene.media?.start ?? 0) + scene.duration > a.duration + 0.05) {
          ctx.warnings.push(`scene "${scene.id}": clip is ${a.duration.toFixed(1)}s but the scene needs ${((scene.media?.start ?? 0) + scene.duration).toFixed(1)}s from it; the last frame will hold`);
        }
      }
      const blocks: Block[] = [];
      if (scene.heading) blocks.push(heading("h", scene.heading, 84, 3, 400));
      if (scene.body) {
        blocks.push(scene.heading
          ? textBlock(ctx, "b", scene.body, { maxSize: 44, minSize: 28, maxLines: 5, weight: 600, font: ctx.fontBody, color: p.text, delayMs: 700, motion: motion === "words" ? "fade" : motion, lineHeight: 1.3 })
          : heading("b", scene.body, 72, 4, 400));
      }
      if (blocks.length) {
        html.push(clip(cid, "scrim", TRACK.overlay, 0, scene.duration, ""));
        css.push(`#${cid}-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 55%; background: linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0)); }`);
        for (const b of blocks) { html.push(b.html); css.push(b.css); }
        const total = blocks.reduce((s, b) => s + b.height, 0) + 28 * L.unit * (blocks.length - 1);
        css.push(stack(ctx, blocks, Math.round(28 * L.unit), Math.max(L.top, L.bottom - total), L.bottom));
      }
      break;
    }
    case "list": {
      const blocks: Block[] = [];
      if (scene.heading) blocks.push(heading("h", scene.heading, 84, 3, 200));
      const items = scene.items ?? [];
      items.forEach((item, i) => {
        const b = textBlock(ctx, `i${i}`, item, { maxSize: 46, minSize: 28, maxLines: 3, weight: 600, font: ctx.fontBody, color: p.text, delayMs: 550 + i * 320, motion: motion === "words" ? "rise" : motion, align: "left", lineHeight: 1.25 });
        const pad = Math.round(28 * L.unit);
        b.css += `
#${cid}-i${i} { box-sizing: border-box; padding: ${pad}px ${pad}px ${pad}px ${pad * 2.6}px; background: ${p.surface}; border-radius: ${radius}px; }
#${cid}-i${i}::before { content: ""; position: absolute; left: ${pad}px; top: 50%; width: ${Math.round(18 * L.unit)}px; height: ${Math.round(18 * L.unit)}px; margin-top: ${-Math.round(9 * L.unit)}px; border-radius: 50%; background: ${p.accent}; }`;
        b.height += pad * 2;
        blocks.push(b);
      });
      for (const b of blocks) { html.push(b.html); css.push(b.css); }
      css.push(stack(ctx, blocks, Math.round(26 * L.unit), L.top, L.bottom));
      break;
    }
    case "stat": {
      const st = scene.stat!;
      const intCount = Number.isInteger(st.value) && Math.abs(st.value) < 100000;
      const shown = `${st.prefix ?? ""}${intCount ? "" : st.value.toLocaleString("en-US")}${intCount ? "" : st.suffix ?? ""}`;
      const sizeRef = `${st.prefix ?? ""}${st.value.toLocaleString("en-US")}${st.suffix ?? ""}`;
      const { size } = fitFontSize(sizeRef, L.boxWidth, 1, 260 * L.unit, 80 * L.unit, 0.62);
      html.push(clip(cid, "n", TRACK.text, 0, scene.duration, intCount ? "" : escapeHtml(shown)));
      const statBlock: Block = { key: "n", html: "", css: "", height: Math.round(size * 1.05) };
      css.push(`#${cid}-n { position: absolute; left: ${L.marginX}px; width: ${L.boxWidth}px; text-align: center; font-family: ${ctx.fontHeading};
  font-weight: 800; font-size: ${size}px; line-height: 1.05; color: ${p.accent}; letter-spacing: -0.03em;
  ${intCount ? `counter-reset: n var(--${cid}-n); animation: ${cid}-count 1500ms cubic-bezier(0.2, 0.8, 0.2, 1) 300ms 1 both;` : textAnimation(cid, "scale", 250)} }`);
      if (intCount) {
        css.push(`@property --${cid}-n { syntax: "<integer>"; inherits: false; initial-value: 0; }
#${cid}-n::after { content: ${cssString(st.prefix ?? "")} counter(n) ${cssString(st.suffix ?? "")}; }
@keyframes ${cid}-count { from { --${cid}-n: 0; } to { --${cid}-n: ${st.value}; } }`);
      }
      const blocks: Block[] = [statBlock];
      if (st.label) blocks.push(body("l", st.label, 900));
      if (scene.heading) blocks.unshift(heading("h", scene.heading, 64, 2, 150));
      for (const b of blocks.filter((b) => b.key !== "n")) { html.push(b.html); css.push(b.css); }
      css.push(stack(ctx, blocks, Math.round(30 * L.unit), L.top, L.bottom));
      break;
    }
    case "quote": {
      const text = scene.heading ?? scene.body ?? "";
      const q = textBlock(ctx, "q", text, { maxSize: 78, minSize: 36, maxLines: 7, weight: 600, font: ctx.fontHeading, color: p.text, delayMs: 350, motion, italic: true, lineHeight: 1.25 });
      const mark: Block = { key: "qm", html: clip(cid, "qm", TRACK.text, 0, scene.duration, "&ldquo;"), css: "", height: Math.round(160 * L.unit) };
      css.push(`#${cid}-qm { position: absolute; left: ${L.marginX}px; width: ${L.boxWidth}px; text-align: center; font-family: Georgia, serif;
  font-size: ${Math.round(220 * L.unit)}px; line-height: 0.9; color: ${p.accent}; ${textAnimation(cid, "scale", 100)} }`);
      const blocks: Block[] = [mark, q];
      if (scene.attribution) blocks.push(textBlock(ctx, "by", `— ${scene.attribution}`, { maxSize: 36, minSize: 24, maxLines: 2, weight: 500, font: ctx.fontBody, color: p.muted, delayMs: 900, motion: "fade" }));
      for (const b of blocks) { html.push(b.html); css.push(b.css); }
      css.push(stack(ctx, blocks, Math.round(30 * L.unit), L.top, L.bottom));
      break;
    }
    case "cta": {
      const blocks: Block[] = [];
      const logo = scene.media ? ctx.resolve(scene.media.assetId) : undefined;
      if (logo?.kind === "image") {
        const h = Math.round(220 * L.unit);
        html.push(clip(cid, "logo", TRACK.media, 0, scene.duration, "", "img", ` src="${escapeHtml(logo.src)}" alt=""`).replace("></img>", " />"));
        css.push(`#${cid}-logo { position: absolute; left: 50%; width: ${h}px; height: ${h}px; margin-left: ${-h / 2}px; object-fit: contain; ${textAnimation(cid, "scale", 100)} }`);
        blocks.push({ key: "logo", html: "", css: "", height: h });
      }
      if (scene.heading) blocks.push(heading("h", scene.heading, 96, 3, 300));
      if (scene.body) blocks.push(body("b", scene.body, 600));
      const label = scene.items?.[0];
      if (label) {
        const size = Math.round(40 * L.unit);
        html.push(clip(cid, "btn", TRACK.text, 0, scene.duration, escapeHtml(label)));
        css.push(`#${cid}-btn { position: absolute; left: 50%; transform: translateX(-50%); width: max-content; max-width: ${L.boxWidth}px;
  padding: ${Math.round(24 * L.unit)}px ${Math.round(56 * L.unit)}px; border-radius: 999px; background: ${p.accent}; color: ${p.background};
  font-family: ${ctx.fontBody}; font-weight: 800; font-size: ${size}px; animation: ${cid}-fade 500ms ease-out 900ms 1 both; }`);
        blocks.push({ key: "btn", html: "", css: "", height: Math.round(size * 1.2 + 48 * L.unit) });
      }
      for (const b of blocks) { if (b.html) html.push(b.html); if (b.css) css.push(b.css); }
      css.push(stack(ctx, blocks, Math.round(40 * L.unit), L.top, L.bottom));
      break;
    }
    case "custom":
      // Custom scenes are assembled by the compiler from validated agent HTML.
      break;
  }

  const cap = captions(ctx);
  html.push(...cap.html);
  css.push(...cap.css);

  const transition = scene.transition ?? "fade";
  const coverColor = transition === "wipe" || transition === "slide-up" ? p.accent : p.background;
  const t = transitionCss(cid, transition, coverColor);
  if (t.duration > 0) {
    html.push(clip(cid, "cover", TRACK.cover, 0, Math.min(t.duration, scene.duration), ""));
    css.push(t.css);
  }
  return { body: html.join("\n    "), css: css.filter(Boolean).join("\n") };
}
