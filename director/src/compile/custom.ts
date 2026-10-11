// Validation for agent-written "custom" scenes: bespoke HTML + CSS motion graphics.
// Custom scenes run in the render browser and in the studio's same-origin preview,
// so anything that could run script, load remote content or reach outside the scene
// is rejected. URL-bearing attributes and CSS url() are allowlisted, not blocklisted,
// and checks run on entity-decoded text so encoded payloads can't slip through.

export interface CustomCheck {
  ok: boolean;
  errors: string[];
}

const MAX_LENGTH = 60_000;

const FORBIDDEN: Array<[RegExp, string]> = [
  [/<\s*script\b/i, "<script> is not allowed; animate with CSS @keyframes instead"],
  [/<\s*(iframe|object|embed|frame|frameset|portal|applet)\b/i, "embedded documents are not allowed"],
  [/<\s*(link|meta|base)\b/i, "<link>, <meta> and <base> are not allowed"],
  [/<\s*(form|input|button|textarea|select)\b/i, "form controls are not allowed"],
  [/<\s*template\b/i, "do not include <template>; the compiler wraps the scene"],
  [/\bon[a-z]+\s*=/i, "inline event handlers (onclick=, onload=, ...) are not allowed"],
  [/javascript\s*:|vbscript\s*:/i, "script URLs are not allowed"],
  [/@import\b/i, "@import is not allowed"],
  [/\b(image-set|cross-fade|element|src|expression)\s*\(|-moz-binding|\bbehavior\s*:/i, "this CSS function is not allowed; use url({{asset:a_...}})"],
  [/data-composition-src\s*=/i, "nested sub-compositions are not allowed in custom scenes"],
  [/attributeName\s*=\s*["']?\s*(on|(xlink:)?href\b)/i, "SVG animations may not target event handlers or links"],
  [/\b(srcset|lowsrc|dynsrc|ping|background|codebase|archive|formaction|action)\s*=/i, "this attribute is not allowed; use src or href with {{asset:a_...}}"],
];

/** The only values allowed where a URL goes: an asset placeholder, an in-document #fragment, or an inline image/font data URI. */
const ALLOWED_URL = /^(\{\{asset:a_[a-z0-9]{4,16}\}\}|#[A-Za-z_][\w:.-]*|data:(image|font)\/[\w.+-]+[;,][\s\S]*)$/i;

const NAMED_ENTITIES: Record<string, string> = { colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", bsol: "\\", period: ".", quot: '"', apos: "'", amp: "&", lt: "<", gt: ">" };

/** Decode numeric and common named character references, as the browser does for attribute values. */
function decodeEntities(s: string): string {
  const char = (code: number) => (Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "");
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => char(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => char(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Check custom scene HTML. Asset references use the {{asset:a_xxxx}} placeholder.
 * When `cid` is given, ids, CSS selectors, @keyframes and @property names must be
 * scoped to the scene so custom scenes never restyle or collide with each other.
 */
export function checkCustomHtml(html: string, durationS: number, cid?: string): CustomCheck {
  const errors: string[] = [];
  if (html.length > MAX_LENGTH) errors.push(`custom scene HTML is ${html.length} characters; the limit is ${MAX_LENGTH}`);
  const decoded = decodeEntities(html);
  for (const [re, msg] of FORBIDDEN) if (re.test(html) || re.test(decoded)) errors.push(msg);

  // URL-bearing attributes and CSS url() may only point at assets, fragments or inline data.
  for (const m of decoded.matchAll(/(?:^|[\s"'/])((?:xlink:)?(?:src|href|poster|data))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!ALLOWED_URL.test(value)) errors.push(`${m[1]}="${value.slice(0, 60)}" is not allowed; use {{asset:a_...}}, a #fragment or a data: image`);
  }
  for (const m of decoded.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!ALLOWED_URL.test(value)) errors.push(`url(${value.slice(0, 60)}) is not allowed; use url({{asset:a_...}}), url(#id) or a data: image`);
  }
  // CSS escapes can spell url( or a scheme in a way the checks above can't see.
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1] ?? "");
  const inline = [...decoded.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2] ?? "");
  if ([...styles, ...inline].some((css) => css.includes("\\"))) errors.push("CSS escapes (backslashes) are not allowed; write characters directly");

  // Every timed element must stay inside the scene's own time window.
  const timed = html.matchAll(/data-start\s*=\s*["']([^"']+)["'][^>]*?data-duration\s*=\s*["']([^"']+)["']/gi);
  for (const m of timed) {
    const start = Number(m[1]);
    const dur = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(dur) || start < 0 || dur <= 0) {
      errors.push(`invalid timing data-start="${m[1]}" data-duration="${m[2]}"`);
    } else if (start + dur > durationS + 1e-6) {
      errors.push(`an element runs to ${start + dur}s but the scene is ${durationS}s long`);
    }
  }
  if (cid) {
    for (const m of html.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)) {
      if (m[1] && !m[1].startsWith(`${cid}-`)) errors.push(`element id "${m[1]}" must start with "${cid}-"`);
    }
    const svg = svgNames(html);
    for (const css of styles) checkCssScope(css, cid, errors, svg);
    for (const id of svg.inlineAnimated) errors.push(`SVG element "${id}" has an inline animation; ${SVG_ANIMATION_HINT}`);
  }
  if (!/class\s*=\s*["'][^"']*\bclip\b/i.test(html)) {
    errors.push('no timed elements found; give each visible element class="clip" plus data-start and data-duration (seconds, local to the scene)');
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

// HyperFrames seeks CSS animations only on HTML elements; animations on SVG elements
// would run on the page clock instead of the video timeline.
const SVG_ANIMATION_HINT = "HyperFrames only seeks CSS animations on HTML elements, so SVG elements would ignore the video timeline. Put the SVG artwork inside a <div> and animate the div (transform, opacity, filter, clip-path)";
const SVG_TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "text", "tspan", "textpath", "use", "image", "symbol", "defs", "stop", "lineargradient", "radialgradient", "mask", "clippath", "pattern", "filter", "marker", "foreignobject"]);

interface SvgNames {
  ids: Set<string>;
  classes: Set<string>;
  /** Ids (or tag names) of SVG elements with an inline `animation` style. */
  inlineAnimated: string[];
}

/** Ids and classes used by elements inside inline <svg> blocks (the SVG namespace). */
function svgNames(html: string): SvgNames {
  const names: SvgNames = { ids: new Set(), classes: new Set(), inlineAnimated: [] };
  for (const block of html.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/gi)) {
    for (const tag of block[0].matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
      const attrs = tag[2] ?? "";
      const id = /\sid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      if (id) names.ids.add(id);
      for (const c of (/\sclass\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "").split(/\s+/)) if (c) names.classes.add(c);
      if (/\sstyle\s*=\s*["'][^"']*\banimation(-name)?\s*:(?!\s*none\b)/i.test(attrs)) names.inlineAnimated.push(id ?? tag[1]!);
    }
  }
  return names;
}

/** Whether a selector's subject (its last compound) is an SVG element. */
function targetsSvg(selector: string, svg: SvgNames): boolean {
  let depth = 0;
  let last = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) last = "";
    else last += ch;
  }
  const type = /^[a-zA-Z][\w-]*/.exec(last)?.[0]?.toLowerCase();
  if (type && SVG_TAGS.has(type)) return true;
  for (const m of last.matchAll(/#([\w-]+)/g)) if (svg.ids.has(m[1]!)) return true;
  for (const m of last.matchAll(/\.([\w-]+)/g)) if (svg.classes.has(m[1]!)) return true;
  return false;
}

/** Index just past the block that opens at `open` (a "{"), skipping strings. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return css.length;
}

/** Split a selector list on commas outside parentheses and brackets. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Rules must target this scene only, and global names (@keyframes, @property) must carry its prefix. */
function checkCssScope(raw: string, cid: string, errors: string[], svg: SvgNames): void {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const scoped = (sel: string) => sel.startsWith(`#${cid}-`) || new RegExp(`^\\[data-composition-id=(["']?)${cid}\\1\\]`).test(sel);
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    // Top-level statements (@charset, @namespace, stray declarations) have no place in a scene.
    if (semi >= 0 && (brace < 0 || semi < brace)) {
      const statement = css.slice(i, semi).trim();
      if (statement) errors.push(`CSS statement "${statement.slice(0, 60)}" is not allowed in custom scenes`);
      i = semi + 1;
      continue;
    }
    if (brace < 0) break;
    const prelude = css.slice(i, brace).trim();
    const end = blockEnd(css, brace);
    if (prelude.startsWith("@")) {
      const [, at = "", name = ""] = /^@([\w-]+)\s*([^\s{]*)/.exec(prelude) ?? [];
      const rule = at.toLowerCase();
      if (rule === "keyframes" || rule === "-webkit-keyframes") {
        if (!name.startsWith(`${cid}-`)) errors.push(`@keyframes "${name}" must be named "${cid}-..."`);
      } else if (rule === "property") {
        if (!name.startsWith(`--${cid}-`)) errors.push(`@property "${name}" must be named "--${cid}-..."`);
      } else if (rule === "media" || rule === "supports" || rule === "container") {
        checkCssScope(css.slice(brace + 1, end - 1), cid, errors, svg);
      } else if (rule !== "font-face") {
        errors.push(`@${at} is not allowed in custom scenes`);
      }
    } else {
      const animates = /\banimation(-name)?\s*:(?!\s*none\b)/i.test(css.slice(brace + 1, end - 1));
      for (const sel of splitSelectors(prelude)) {
        if (!scoped(sel)) errors.push(`CSS selector "${sel.slice(0, 60)}" must start with [data-composition-id="${cid}"] or #${cid}-`);
        else if (animates && targetsSvg(sel, svg)) errors.push(`"${sel.slice(0, 60)}" animates an SVG element. ${SVG_ANIMATION_HINT}`);
      }
    }
    i = end;
  }
}

/** Replace {{asset:a_xxxx}} placeholders with build-relative paths. Unknown ids are reported. */
export function resolveAssetPlaceholders(html: string, resolve: (id: string) => string | undefined): { html: string; missing: string[] } {
  const missing: string[] = [];
  const out = html.replace(/\{\{asset:(a_[a-z0-9]{4,16})\}\}/g, (_m, id: string) => {
    const src = resolve(id);
    if (!src) missing.push(id);
    return src ?? "";
  });
  return { html: out, missing };
}
