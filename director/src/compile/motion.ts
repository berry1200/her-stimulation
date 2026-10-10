// CSS keyframe motion presets. HyperFrames seeks CSS animations frame by frame,
// so these render deterministically with no animation library.

export type TextMotion = "rise" | "fade" | "scale" | "slide-left" | "blur" | "words" | "none";
export type MediaMotion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "none";
export type Transition = "cut" | "fade" | "slide-up" | "zoom" | "wipe";

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
  const frames: Record<Exclude<MediaMotion, "none">, [string, string]> = {
    "zoom-in": ["scale(1)", "scale(1.12)"],
    "zoom-out": ["scale(1.12)", "scale(1)"],
    "pan-left": ["scale(1.12) translateX(3%)", "scale(1.12) translateX(-3%)"],
    "pan-right": ["scale(1.12) translateX(-3%)", "scale(1.12) translateX(3%)"],
    "pan-up": ["scale(1.12) translateY(3%)", "scale(1.12) translateY(-3%)"],
  };
  const [from, to] = frames[motion];
  const name = `${cid}-${el}-kb`;
  return `
#${cid}-${el} { animation: ${name} ${Math.round(durationS * 1000)}ms linear 0ms 1 both; }
@keyframes ${name} { from { transform: ${from}; } to { transform: ${to}; } }`;
}

/**
 * Scene entrance. A full-frame "cover" element on the top track animates away to
 * reveal the scene, which keeps every scene self-contained (no overlapping clips).
 */
export function transitionCss(cid: string, transition: Transition, coverColor: string): { css: string; duration: number } {
  if (transition === "cut") return { css: "", duration: 0 };
  const specs: Record<Exclude<Transition, "cut">, { ms: number; from: string; to: string }> = {
    fade: { ms: 450, from: "opacity: 1;", to: "opacity: 0;" },
    "slide-up": { ms: 600, from: "transform: translateY(0);", to: "transform: translateY(-100%);" },
    zoom: { ms: 650, from: "clip-path: circle(75% at 50% 50%);", to: "clip-path: circle(0% at 50% 50%);" },
    wipe: { ms: 550, from: "clip-path: inset(0 0 0 0);", to: "clip-path: inset(0 0 0 100%);" },
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
