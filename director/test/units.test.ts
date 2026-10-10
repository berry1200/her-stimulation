import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCustomHtml, resolveAssetPlaceholders } from "../src/compile/custom.ts";
import { captionChunks, fitFontSize, timeCues, wrapLineCount } from "../src/compile/text.ts";
import { referencedAssets, totalDuration, validatePlan, type Plan } from "../src/plan/schema.ts";
import { screenRequest } from "../src/policy.ts";
import { splitTemplate } from "../src/providers/command.ts";

const basePlan = (): Plan => ({
  title: "T",
  format: "9:16",
  fps: 30,
  style: { palette: { background: "#000000", surface: "#111111", text: "#ffffff", muted: "#aaaaaa", accent: "#ff5722" }, fontHeading: "sans", fontBody: "serif" },
  scenes: [
    { id: "a", kind: "title", duration: 2, heading: "Hello" },
    { id: "b", kind: "media", duration: 3, media: { assetId: "a_abcd1234" }, background: { assetId: "a_bg000001" } },
  ],
});

describe("text layout", () => {
  it("counts wrapped lines", () => {
    assert.equal(wrapLineCount("one two three", 100), 1);
    assert.equal(wrapLineCount("one two three", 7), 2);
    assert.equal(wrapLineCount("aaaaaaaaaaaaaaaaaaaa", 10), 2);
  });
  it("shrinks long text to fit", () => {
    const short = fitFontSize("Hi", 900, 2, 120, 40);
    const long = fitFontSize("A considerably longer headline that has to wrap over several lines", 900, 2, 120, 40);
    assert.equal(short.size, 120);
    assert.ok(long.size < 120);
  });
  it("chunks narration into short cues timed across the span", () => {
    const chunks = captionChunks("Meet Director. Your ideas in, finished video out, in minutes rather than days of editing.");
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((c) => c.length <= 40));
    const cues = timeCues(chunks, 0.25, 6);
    assert.equal(cues[0]!.start, 0.25);
    const end = cues[cues.length - 1]!;
    assert.ok(Math.abs(end.start + end.duration - 6.25) < 0.05);
  });
});

describe("plan validation", () => {
  it("accepts a valid plan and lists referenced assets", () => {
    const r = validatePlan(basePlan());
    assert.equal(r.ok, true);
    assert.deepEqual(referencedAssets(basePlan()).sort(), ["a_abcd1234", "a_bg000001"]);
    assert.equal(totalDuration(basePlan()), 5);
  });
  it("rejects duplicate ids, bad colours and missing kind fields", () => {
    const p = basePlan() as unknown as { scenes: Array<Record<string, unknown>>; style: { palette: Record<string, string> } };
    p.scenes.push({ id: "a", kind: "list", duration: 2 });
    const r = validatePlan(p);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.issues.some((i) => i.message.includes("duplicate")));
      assert.ok(r.issues.some((i) => i.path.endsWith("items")));
    }
    p.style.palette.text = "white";
    const r2 = validatePlan(p);
    assert.equal(r2.ok, false);
  });
});

describe("custom scene validation", () => {
  const ok = `<div id="s-x-bg" class="clip" data-start="0" data-duration="3" data-track-index="0"></div><style>#s-x-bg{animation:a 1s both}</style>`;
  it("accepts scoped CSS motion graphics", () => {
    assert.deepEqual(checkCustomHtml(ok, 3, "s-x"), { ok: true, errors: [] });
  });
  it("rejects scripts, remote URLs, handlers, bad timing and unscoped ids", () => {
    const bad = [
      `${ok}<script>fetch('/x')</script>`,
      `${ok}<img class="clip" src="https://evil.example/x.png" data-start="0" data-duration="1">`,
      `${ok}<div class="clip" onclick="x()" data-start="0" data-duration="1"></div>`,
      `<div id="s-x-a" class="clip" data-start="2" data-duration="5"></div>`,
      `<div id="other" class="clip" data-start="0" data-duration="1"></div>`,
      `${ok}<style>@import url(//x.example/a.css);</style>`,
    ];
    for (const html of bad) assert.equal(checkCustomHtml(html, 3, "s-x").ok, false, html);
  });
  it("closes encoded and indirect ways to run script or load remote content", () => {
    const el = (attrs: string) => `<div id="s-x-bg" class="clip" data-start="0" data-duration="3" data-track-index="0" ${attrs}></div>`;
    const bad = [
      el(`style="background:u&#114;l(https://evil.example/a.png)"`),
      `${ok}<svg><a href="java&#115;cript:alert(1)"><text>x</text></a></svg>`,
      `${ok}<img id="s-x-i" class="clip" src="\\\\evil.example/x.png" data-start="0" data-duration="1">`,
      `${ok}<img id="s-x-i" class="clip" srcset="{{asset:a_abcd1234}} 1x, https://evil.example/x.png 2x" data-start="0" data-duration="1">`,
      `${ok}<style>#s-x-bg{background:\\75 rl(https://evil.example/a.png)}</style>`,
      `${ok}<style>#s-x-bg{background-image:image-set("https://evil.example/a.png" 1x)}</style>`,
      `${ok}<svg><animate attributeName="href" to="#x"/></svg>`,
    ];
    for (const html of bad) assert.equal(checkCustomHtml(html, 3, "s-x").ok, false, html);
  });
  it("keeps CSS and animation names scoped to the scene", () => {
    const base = `<div id="s-x-bg" class="clip" data-start="0" data-duration="3" data-track-index="0"></div>`;
    const good = `${base}<svg><defs><linearGradient id="s-x-g"></linearGradient></defs><rect id="s-x-r" fill="url(#s-x-g)"/></svg><img id="s-x-i" src="{{asset:a_abcd1234}}"><style>
      [data-composition-id="s-x"] .a, #s-x-bg:is(.b, .c) { animation: s-x-rise 1s both; background: url("{{asset:a_abcd1234}}"); }
      @keyframes s-x-rise { from { opacity: 0 } to { opacity: 1 } }
      @property --s-x-n { syntax: "<integer>"; inherits: false; initial-value: 0; }
      @media (min-width: 100px) { #s-x-bg { color: red } }
    </style>`;
    assert.deepEqual(checkCustomHtml(good, 3, "s-x"), { ok: true, errors: [] });
    for (const css of [".clip { display: none }", "@keyframes rise { to { opacity: 1 } }", "@property --n { syntax: '<integer>'; inherits: false; initial-value: 0; }", "@media (min-width: 1px) { body { color: red } }", '@charset "utf-8";']) {
      assert.equal(checkCustomHtml(`${base}<style>${css}</style>`, 3, "s-x").ok, false, css);
    }
  });
  it("rejects CSS animations on SVG elements, which HyperFrames does not seek", () => {
    const base = `<div id="s-x-bg" class="clip" data-start="0" data-duration="3" data-track-index="0"><svg id="s-x-svg" viewBox="0 0 10 10"><circle id="s-x-dot" class="s-x-spark" r="2"/></svg></div>`;
    for (const css of ["#s-x-dot { animation: s-x-a 1s both }", "#s-x-bg .s-x-spark { animation-name: s-x-a }", "#s-x-bg circle { animation: s-x-a 1s }", "#s-x-svg { animation: s-x-a 1s }"]) {
      const r = checkCustomHtml(`${base}<style>${css}</style>`, 3, "s-x");
      assert.equal(r.ok, false, css);
      assert.match(r.errors.join(" "), /SVG/);
    }
    assert.equal(checkCustomHtml(`${base.replace('r="2"', 'r="2" style="animation: s-x-a 1s"')}`, 3, "s-x").ok, false);
    // Animating the HTML wrapper is the supported way to move SVG artwork.
    assert.equal(checkCustomHtml(`${base}<style>#s-x-bg { animation: s-x-a 1s both } #s-x-dot { fill: red }</style>`, 3, "s-x").ok, true);
  });
  it("resolves asset placeholders", () => {
    const r = resolveAssetPlaceholders('<img src="{{asset:a_abcd1234}}"><img src="{{asset:a_missing0}}">', (id) => (id === "a_abcd1234" ? "assets/a_abcd1234.png" : undefined));
    assert.match(r.html, /assets\/a_abcd1234\.png/);
    assert.deepEqual(r.missing, ["a_missing0"]);
  });
});

describe("policy", () => {
  it("blocks unambiguous sexual requests and allows normal ones", () => {
    assert.equal(screenRequest("make a video where she shows her boobs").allowed, false);
    assert.equal(screenRequest("a nude photoshoot reel").allowed, false);
    assert.equal(screenRequest("Make a 30 second launch teaser for our lingerie brand's new colours").allowed, true);
    assert.equal(screenRequest("cut the interview down and add captions").allowed, true);
    assert.equal(screenRequest("now make her undress").allowed, false);
    assert.equal(screenRequest("have the model get naked at the end").allowed, false);
    // Ordinary briefs that share words with blocked phrases go through.
    assert.equal(screenRequest("feature our nude lipstick shades and nude heels").allowed, true);
    assert.equal(screenRequest("details too small for the naked eye, shown in macro").allowed, true);
  });
});

describe("command templates", () => {
  it("splits with quotes and keeps placeholders as single arguments", () => {
    assert.deepEqual(splitTemplate(`piper --model "en US" --out {out} '{text}'`), ["piper", "--model", "en US", "--out", "{out}", "{text}"]);
    assert.throws(() => splitTemplate(`say "unbalanced`));
  });
});
