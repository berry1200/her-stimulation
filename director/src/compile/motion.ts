// CSS keyframe motion presets. HyperFrames seeks CSS animations frame by frame,
// so these render deterministically with no animation library.

export type TextMotion = "rise" | "fade" | "scale" | "slide-left" | "blur" | "words" | "none";
export type MediaMotion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "dolly-in" | "crash-zoom" | "drift" | "none";
export type Transition = "cut" | "fade" | "slide-up" | "zoom" | "wipe" | "flash" | "whip";

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Keyframes for text entrances, parameterised by the layout unit (px per 1080 width). */
export function textKeyframes(cid: string, unit: number): string {
  const d = Math.round(40 * unit);
  return `
@keyframes ${cid}-rise { from { opacity: 0; transform: translateY(${d}px); } to { opacity: 1; transform: none; } }
@keyframes ${cid}-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ${cid}-scale { from { opacity: 0; transform: scale(0.86); } 70% { opacity: 1; transform: scale(1.02); } to { opacity: 1; transform: none; } }
@keyframes ${cid}-slide-left { from { opacity: 0; transform: translateX(${Math.round(d * 1.5)}px); } to { opacity: 1; transform: none; } }
@keyframes ${cid}-blur { from { opacity: 0; filter: blur(${Math.round(18 * unit)}px); } to { opacity: 1; filter: none; } }`;
}

/** `animation` shorthand for a text element (empty for "none"). */
export function textAnimation(cid: string, motion: TextMotion, delayMs: number): string {
  if (motion === "none") return "";
  const name = motion === "words" ? "rise" : motion;
  const dur = { rise: 700, fade: 600, scale: 650, "slide-left": 650, blur: 750 }[name] ?? 700;
  return `animation: ${cid}-${name} ${dur}ms ${EASE_OUT} ${Math.round(delayMs)}ms 1 both;`;
}

/** Ken Burns style motion for a full-bleed image or video over `durationS`. */
export function mediaMotion(cid: string, el: string, motion: MediaMotion, durationS: number): string {
  if (motion === "none") return "";
  const name = `${cid}-${el}-kb`;
  const ms = Math.round(durationS * 1000);
  // Camera moves with their own pacing: a slow eased push, a fast punch-in that settles, a diagonal float.
  if (motion === "dolly-in") {
    return `
#${cid}-${el} { animation: ${name} ${ms}ms cubic-bezier(0.45, 0, 0.25, 1) 0ms 1 both; }
@keyframes ${name} { from { transform: scale(1.02); } to { transform: scale(1.26); } }`;
  }
  if (motion === "crash-zoom") {
    return `
#${cid}-${el} { animation: ${name} ${ms}ms linear 0ms 1 both; }
@keyframes ${name} { 0% { transform: scale(1); animation-timing-function: cubic-bezier(0.7, 0, 0.3, 1); } 14% { transform: scale(1.3); animation-timing-function: linear; } 100% { transform: scale(1.36); } }`;
  }
  if (motion === "drift") {
    return `
#${cid}-${el} { animation: ${name} ${ms}ms cubic-bezier(0.37, 0, 0.63, 1) 0ms 1 both; }
@keyframes ${name} { from { transform: scale(1.16) translate(-2.5%, 2%) rotate(-0.6deg); } to { transform: scale(1.16) translate(2.5%, -2%) rotate(0.6deg); } }`;
  }
  const frames: Record<"zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up", [string, string]> = {
    "zoom-in": ["scale(1)", "scale(1.12)"],
    "zoom-out": ["scale(1.12)", "scale(1)"],
    "pan-left": ["scale(1.12) translateX(3%)", "scale(1.12) translateX(-3%)"],
    "pan-right": ["scale(1.12) translateX(-3%)", "scale(1.12) translateX(3%)"],
    "pan-up": ["scale(1.12) translateY(3%)", "scale(1.12) translateY(-3%)"],
  };
  const [from, to] = frames[motion];
  return `
#${cid}-${el} { animation: ${name} ${ms}ms linear 0ms 1 both; }
@keyframes ${name} { from { transform: ${from}; } to { transform: ${to}; } }`;
}

/**
 * Scene entrance. A full-frame "cover" element on the top track animates away to
 * reveal the scene, which keeps every scene self-contained (no overlapping clips).
 */
export function transitionCss(cid: string, transition: Transition, coverColor: string): { css: string; duration: number } {
  if (transition === "cut") return { css: "", duration: 0 };
  if (transition === "whip") {
    // A whip pan: the scene itself flies in sideways with motion blur.
    return {
      duration: 0.4,
      css: `
[data-composition-id="${cid}"]:not([data-composition-src]) { animation: ${cid}-whip 400ms cubic-bezier(0.16, 1, 0.3, 1) 0ms 1 both; }
@keyframes ${cid}-whip { from { transform: translateX(38%); filter: blur(28px); } 60% { filter: blur(6px); } to { transform: none; filter: none; } }`,
    };
  }
  if (transition === "flash") coverColor = "#ffffff";
  const specs: Record<Exclude<Transition, "cut" | "whip">, { ms: number; from: string; to: string }> = {
    fade: { ms: 450, from: "opacity: 1;", to: "opacity: 0;" },
    "slide-up": { ms: 600, from: "transform: translateY(0);", to: "transform: translateY(-100%);" },
    zoom: { ms: 650, from: "clip-path: circle(75% at 50% 50%);", to: "clip-path: circle(0% at 50% 50%);" },
    wipe: { ms: 550, from: "clip-path: inset(0 0 0 0);", to: "clip-path: inset(0 0 0 100%);" },
    flash: { ms: 320, from: "opacity: 1;", to: "opacity: 0;" },
  };
  const s = specs[transition];
  return {
    duration: s.ms / 1000,
    css: `
#${cid}-cover { position: absolute; inset: 0; background: ${coverColor}; z-index: 50;
  animation: ${cid}-cover ${s.ms}ms cubic-bezier(0.65, 0, 0.35, 1) 0ms 1 both; }
@keyframes ${cid}-cover { from { ${s.from} } to { ${s.to} } }`,
  };
}

const GRADE_FILTERS: Record<string, { filter: string; tint?: string }> = {
  cinematic: { filter: "contrast(1.1) saturate(1.12)", tint: "linear-gradient(160deg, rgba(255, 150, 70, 0.32), rgba(0, 135, 160, 0.34))" },
  noir: { filter: "grayscale(1) contrast(1.28) brightness(0.96)" },
  warm: { filter: "sepia(0.18) saturate(1.15) contrast(1.05)" },
  cool: { filter: "saturate(0.92) contrast(1.06)", tint: "linear-gradient(180deg, rgba(60, 130, 210, 0.26), rgba(20, 70, 140, 0.26))" },
  vivid: { filter: "saturate(1.35) contrast(1.08)" },
  matte: { filter: "contrast(0.88) brightness(1.06) saturate(0.88)", tint: "linear-gradient(rgba(40, 40, 50, 0.18), rgba(40, 40, 50, 0.18))" },
};

/** Tile of film grain as an inline SVG noise texture. */
const GRAIN_TILE = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.2"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;

/**
 * The film finish applied over the whole video: grade (a filter on the root plus an optional
 * soft-light tint), grain, vignette and letterbox bars, as full-length clips on top tracks.
 */
export function lookLayers(look: { grade?: string; grain?: number; vignette?: number; letterbox?: boolean } | undefined, total: number, width: number, height: number, bar: number): { rootCss: string; html: string[]; css: string } {
  const out = { rootCss: "", html: [] as string[], css: "" };
  if (!look) return out;
  const clip = (id: string, track: number) => `<div id="${id}" class="clip" data-start="0" data-duration="${total}" data-track-index="${track}"></div>`;
  const grade = look.grade && look.grade !== "none" ? GRADE_FILTERS[look.grade] : undefined;
  if (grade) {
    out.rootCss = `#root { filter: ${grade.filter}; }`;
    if (grade.tint) {
      out.html.push(clip("look-tint", 10));
      out.css += `#look-tint { position: absolute; inset: 0; background: ${grade.tint}; mix-blend-mode: soft-light; pointer-events: none; z-index: 90; }\n`;
    }
  }
  if (look.vignette) {
    out.html.push(clip("look-vignette", 11));
    out.css += `#look-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${(0.75 * look.vignette).toFixed(2)}) 100%); pointer-events: none; z-index: 91; }\n`;
  }
  if (look.grain) {
    // Jump the noise tile to a new offset a dozen times a second, for a finite number of steps.
    const steps = Math.max(1, Math.ceil(total / 0.5));
    out.html.push(clip("look-grain", 12));
    out.css += `#look-grain { position: absolute; inset: -240px; background: ${GRAIN_TILE}; opacity: ${(0.35 * look.grain).toFixed(2)}; mix-blend-mode: overlay; pointer-events: none; z-index: 92;
  animation: look-grain 500ms steps(6) 0ms ${steps} both; }
@keyframes look-grain { 0% { transform: translate(0, 0); } 20% { transform: translate(-90px, 60px); } 40% { transform: translate(70px, -110px); } 60% { transform: translate(-130px, -40px); } 80% { transform: translate(110px, 90px); } 100% { transform: translate(0, 0); } }\n`;
  }
  if (bar > 0) {
    out.html.push(clip("look-bars", 13));
    out.css += `#look-bars { position: absolute; inset: 0; pointer-events: none; z-index: 93; border-top: ${bar}px solid #000; border-bottom: ${bar}px solid #000; box-sizing: border-box; width: ${width}px; height: ${height}px; }\n`;
  }
  return out;
}
