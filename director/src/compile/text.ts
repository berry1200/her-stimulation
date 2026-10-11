// Escaping and text-fitting helpers shared by the scene templates.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A CSS string literal, e.g. for `content:`. */
export function cssString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

/** Number of lines greedy word wrap produces for `text` at `charsPerLine`. */
export function wrapLineCount(text: string, charsPerLine: number): number {
  if (charsPerLine < 1) return Number.POSITIVE_INFINITY;
  let lines = 0;
  for (const paragraph of text.split(/\n/)) {
    let line = 0;
    lines += 1;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const len = word.length;
      if (line === 0) {
        line = len;
        lines += Math.floor((len - 1) / charsPerLine);
      } else if (line + 1 + len <= charsPerLine) {
        line += 1 + len;
      } else {
        lines += 1;
        line = len;
        lines += Math.floor((len - 1) / charsPerLine);
      }
    }
  }
  return lines;
}

/**
 * Largest font size (px) at which `text` fits in `maxLines` lines of `boxWidth` px.
 * Uses an average glyph width, which is close enough for layout decisions.
 */
export function fitFontSize(text: string, boxWidth: number, maxLines: number, maxSize: number, minSize: number, glyph = 0.56): { size: number; fits: boolean } {
  for (let size = Math.round(maxSize); size >= minSize; size -= 2) {
    const chars = Math.floor(boxWidth / (size * glyph));
    if (wrapLineCount(text, chars) <= maxLines) return { size, fits: true };
  }
  return { size: Math.round(minSize), fits: false };
}

/** Split narration into caption cues of a few words each. */
export function captionChunks(text: string, maxChars = 34, maxWords = 6): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const candidate = [...cur, w].join(" ");
    if (cur.length && (candidate.length > maxChars || cur.length >= maxWords)) {
      chunks.push(cur.join(" "));
      cur = [w];
    } else {
      cur.push(w);
    }
    // Break after sentence-ending punctuation so cues follow the speech.
    if (/[.!?;:]$/.test(w) && cur.length >= 2) {
      chunks.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}

export interface Cue {
  text: string;
  start: number;
  duration: number;
}

/** Time caption chunks across [start, start + span], proportional to their length. */
export function timeCues(chunks: string[], start: number, span: number): Cue[] {
  if (!chunks.length || span <= 0) return [];
  const weights = chunks.map((c) => c.length + 6);
  const total = weights.reduce((a, b) => a + b, 0);
  const cues: Cue[] = [];
  let t = start;
  chunks.forEach((text, i) => {
    const d = (span * (weights[i] ?? 0)) / total;
    cues.push({ text, start: round(t), duration: round(Math.max(0.3, d)) });
    t += d;
  });
  return cues;
}

export function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
