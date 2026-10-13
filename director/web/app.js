// Director Studio UI: plain ES modules, no build step.
// All user- or model-provided text is inserted with textContent (never innerHTML).

const app = document.getElementById("app");
const titleEl = document.getElementById("project-title");
const actionsEl = document.getElementById("topbar-actions");
const banner = document.getElementById("banner");

const FORMATS = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
const KINDS = ["title", "statement", "media", "list", "stat", "quote", "cta", "custom"];
const TRANSITIONS = ["fade", "cut", "slide-up", "zoom", "wipe"];
const MOTIONS = ["", "rise", "fade", "scale", "slide-left", "blur", "words", "none"];

let health = null;
let state = { project: null, feed: [], agentRunning: false, selected: null };
let events = null;

// ── tiny DOM helper ──
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function toast(text, bad = false) {
  banner.textContent = text;
  banner.hidden = false;
  banner.classList.toggle("bad", bad);
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (banner.hidden = true), 6000);
}

// ── routing ──
async function route() {
  if (events) {
    events.close();
    events = null;
  }
  const m = location.pathname.match(/^\/p\/(p_[a-z0-9]+)/);
  if (m) await openProject(m[1]);
  else await showHome();
}
window.addEventListener("popstate", route);
function go(path) {
  history.pushState(null, "", path);
  route();
}

// ── home ──
async function showHome() {
  titleEl.textContent = "";
  actionsEl.replaceChildren();
  const projects = await api("GET", "/api/projects");
  const name = h("input", { type: "text", placeholder: "Spring launch teaser", maxlength: 120 });
  const format = h("select", {}, ...Object.keys(FORMATS).map((f) => h("option", { value: f }, `${f} ${f === "9:16" ? "(Reels, Shorts, TikTok)" : f === "16:9" ? "(YouTube)" : ""}`)));
  const brief = h("textarea", { rows: 5, placeholder: "What is the video for, who is it for, and what should it feel like?" });
  const create = h("button", { class: "btn primary", onclick: async () => {
    create.disabled = true;
    try {
      const p = await api("POST", "/api/projects", { name: name.value || "Untitled video", format: format.value, brief: brief.value });
      go(`/p/${p.id}`);
    } catch (e) {
      toast(e.message, true);
      create.disabled = false;
    }
  } }, "Create video");
  app.replaceChildren(
    h("div", { class: "home" },
      h("div", {},
        h("h1", {}, "Your videos"),
        h("p", { class: "lead" }, "Bring images, footage, documents or a script. The director plans, voices, edits and renders the video with you."),
        projects.length
          ? h("div", { class: "project-grid" }, ...projects.map((p) => {
              const cover = h("div", { class: "cover" }, h("span", { class: "fmt" }, p.format), p.seconds ? h("span", { class: "len" }, `${Math.round(p.seconds)}s`) : null);
              if (p.cover) cover.style.backgroundImage = `url("${p.cover}")`;
              return h("a", { class: "project-card", href: `/p/${p.id}`, onclick: (e) => { e.preventDefault(); go(`/p/${p.id}`); } },
                cover,
                h("div", { class: "info" },
                  h("div", { class: "name" }, p.name),
                  h("div", { class: "meta" }, `${p.scenes} scenes · ${p.assets} assets · ${new Date(p.updatedAt).toLocaleDateString()}`)));
            }))
          : h("div", { class: "empty" }, "No videos yet. Create your first one.")),
      h("div", { class: "card" },
        h("h2", { style: "margin:0 0 6px;font-size:16px" }, "New video"),
        h("label", {}, "Name"), name,
        h("label", {}, "Format"), format,
        h("label", {}, "Brief"), brief,
        h("div", { style: "margin-top:14px" }, create))));
}

// ── project ──
async function openProject(id) {
  const data = await api("GET", `/api/projects/${id}`);
  state = { project: data.project, feed: data.feed, agentRunning: data.agentRunning, selected: state.project?.id === id ? state.selected : null };
  subscribe(id);
  renderStudio();
}

function subscribe(id) {
  events = new EventSource(`/api/projects/${id}/events`);
  events.addEventListener("feed", (e) => {
    state.feed.push(JSON.parse(e.data).entry);
    renderFeed();
  });
  events.addEventListener("agent", (e) => {
    state.agentRunning = JSON.parse(e.data).state === "thinking";
    renderFeed();
  });
  events.addEventListener("hello", (e) => {
    state.agentRunning = JSON.parse(e.data).agentRunning;
    renderFeed();
  });
  const refresh = async () => {
    const data = await api("GET", `/api/projects/${id}`);
    const versionChanged = data.project.planVersion !== state.project.planVersion;
    state.project = data.project;
    renderAssets();
    renderRenders();
    if (versionChanged) {
      renderStage();
    }
  };
  events.addEventListener("plan", refresh);
  events.addEventListener("assets", refresh);
  events.addEventListener("thumbs", async () => {
    const data = await api("GET", `/api/projects/${id}`);
    state.project.thumbs = data.project.thumbs;
    renderStage();
  });
  events.addEventListener("render", (e) => {
    const r = JSON.parse(e.data);
    const rec = state.project.renders.find((x) => x.id === r.id);
    if (rec) Object.assign(rec, { status: r.status, progress: r.progress, message: r.message, file: r.file });
    else refresh();
    renderRenders();
  });
}

const refs = {};

function renderStudio() {
  const p = state.project;
  titleEl.textContent = `${p.name} · ${p.format}`;
  const quality = h("select", { style: "width:auto" }, h("option", { value: "draft" }, "Draft"), h("option", { value: "standard", selected: true }, "Standard"), h("option", { value: "high" }, "High"), h("option", { value: "4k" }, "4K master"));
  actionsEl.replaceChildren(
    quality,
    h("button", { class: "btn primary", onclick: async () => {
      try {
        await api("POST", `/api/projects/${p.id}/renders`, { quality: quality.value });
      } catch (e) {
        toast(e.message, true);
      }
    } }, "Render MP4"),
  );

  refs.assets = h("div");
  refs.renders = h("div", { class: "renders" });
  refs.stage = h("div", { class: "stage" });
  refs.feed = h("div", { class: "feed" });
  const input = h("textarea", { placeholder: "Tell the director what to make or change…", maxlength: 8000 });
  const send = h("button", { class: "btn primary", onclick: () => sendMessage(input, send) }, "Send");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendMessage(input, send);
  });
  refs.send = send;

  app.replaceChildren(
    h("div", { class: "studio" },
      h("aside", { class: "col" },
        h("div", { class: "section" }, h("h2", {}, "Assets"), refs.assets),
        h("div", { class: "section" }, h("h2", {}, "Renders"), refs.renders)),
      h("section", { class: "col" }, refs.stage),
      h("aside", { class: "col chat" },
        refs.feed,
        h("div", { class: "composer" },
          input,
          h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
            h("span", { class: "hint" }, health && !health.claude ? "Chat needs ANTHROPIC_API_KEY, or direct from Claude with the connector" : "Ctrl/⌘ + Enter to send"),
            send)))));
  renderAssets();
  renderRenders();
  renderStage();
  renderFeed();
}

async function sendMessage(input, btn) {
  const text = input.value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    await api("POST", `/api/projects/${state.project.id}/chat`, { message: text });
    input.value = "";
    state.agentRunning = true;
    renderFeed();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ── assets ──
function fileUrl(rel) {
  return `/files/${state.project.id}/${rel}`;
}

function renderAssets() {
  const p = state.project;
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, onchange: () => upload(fileInput.files) });
  const zone = h("div", { class: "dropzone", onclick: () => fileInput.click() }, "Drop images, video, audio, documents or fonts here, or click to choose", fileInput);
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drag"); upload(e.dataTransfer.files); });
  const grid = h("div", { class: "assets" }, ...p.assets.map((a) => {
    const preview = a.previews?.[0];
    const thumb = h("div", { class: preview ? "thumb" : "thumb blank" }, preview ? "" : a.kind);
    if (preview) thumb.style.backgroundImage = `url("${fileUrl(preview)}")`;
    return h("div", { class: "asset", title: `${a.id}\n${a.name}` },
      thumb,
      h("button", { class: "remove", title: "Remove", onclick: async () => {
        try {
          await api("DELETE", `/api/projects/${p.id}/assets/${a.id}`);
        } catch (e) {
          toast(e.message, true);
        }
      } }, "✕"),
      h("div", { class: "info" },
        h("div", { class: "name" }, a.name),
        h("div", { class: "kind" }, [a.kind, a.duration ? `${a.duration.toFixed(1)}s` : "", a.width ? `${a.width}×${a.height}` : "", a.origin !== "upload" ? a.origin : ""].filter(Boolean).join(" · ")),
        a.description ? h("div", { class: "desc" }, a.description) : null));
  }));
  const link = h("input", { type: "url", placeholder: "Or paste a link to a file", "aria-label": "Link to an image, video or audio file" });
  const addLink = h("button", { class: "btn small", type: "submit" }, "Add");
  const linkForm = h("form", { class: "linkrow", onsubmit: async (e) => {
    e.preventDefault();
    const url = link.value.trim();
    if (!url) return;
    addLink.disabled = true;
    toast("Downloading…");
    try {
      await api("POST", `/api/projects/${p.id}/assets/url`, { url });
      link.value = "";
      banner.hidden = true;
    } catch (err) {
      toast(err.message, true);
    } finally {
      addLink.disabled = false;
    }
  } }, link, addLink);
  refs.assets.replaceChildren(zone, linkForm, grid);
}

async function upload(files) {
  if (!files?.length) return;
  const form = new FormData();
  for (const f of files) form.append("files", f);
  toast(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
  try {
    const res = await api("POST", `/api/projects/${state.project.id}/assets`, form);
    if (res.failed?.length) toast(`Some files failed: ${res.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`, true);
    else banner.hidden = true;
  } catch (e) {
    toast(e.message, true);
  }
}

// ── renders ──
function renderRenders() {
  const p = state.project;
  if (!p.renders.length) {
    refs.renders.replaceChildren(h("div", { class: "kind", style: "color:var(--muted);font-size:12px" }, "Rendered videos appear here."));
    return;
  }
  refs.renders.replaceChildren(...p.renders.slice(0, 8).map((r) =>
    h("div", { class: "render" },
      h("div", { style: "display:flex;justify-content:space-between;gap:8px" },
        h("span", {}, `${r.quality} · v${r.planVersion}`),
        r.status === "done" && r.file
          ? h("a", { href: `${fileUrl(r.file)}?download`, download: "" }, "Download")
          : r.status === "rendering" || r.status === "queued"
            ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); api("DELETE", `/api/projects/${p.id}/renders/${r.id}`); } }, "Cancel")
            : h("span", { style: "color:var(--bad)" }, r.status)),
      h("div", { style: "color:var(--muted)" }, `${r.message}${r.status === "rendering" ? ` · ${Math.round(r.progress)}%` : ""}`),
      r.status === "rendering" || r.status === "queued" ? h("div", { class: "bar" }, h("span", { style: `width:${r.progress}%` })) : null,
      r.error ? h("div", { class: "err" }, r.error) : null)));
}

// ── stage: preview + storyboard + scene editor ──
function renderStage() {
  const p = state.project;
  const plan = p.plan;
  if (!plan) {
    refs.playerSrc = null;
    refs.stage.replaceChildren(
      h("div", { class: "player-wrap" },
        h("div", { class: "no-plan" },
          h("h2", { style: "margin:0 0 8px" }, "No storyboard yet"),
          h("p", {}, "Upload your material and tell the director what you want. Or start a storyboard by hand."),
          h("button", { class: "btn", onclick: async () => {
            const r = await api("POST", `/api/projects/${p.id}/plan/starter`);
            if (!r.ok) toast((r.errors || []).join("; "), true);
          } }, p.assets.some((a) => a.kind === "image" || a.kind === "video") ? "Start a storyboard from my uploads" : "Start a storyboard by hand"))));
    return;
  }
  // The player survives re-renders (selecting or editing a scene) and is only
  // replaced when a new build exists; moving an iframe in the DOM would reload it.
  const src = `/files/${p.id}/build/index.html?v=${p.planVersion}`;
  if (refs.playerSrc !== src || !refs.stage.contains(refs.player)) {
    const [w, hgt] = FORMATS[plan.format];
    const player = (refs.player = h("hyperframes-player", { src, "runtime-src": "/vendor/hyperframe.runtime.js", controls: true, width: w, height: hgt }));
    player.addEventListener("ready", () => {
      if (refs.player === player && refs.seekOnReady !== undefined) player.seek(refs.seekOnReady);
      refs.seekOnReady = undefined;
    });
    player.addEventListener("error", (e) => toast(`Preview: ${e.detail?.message ?? "failed to load"}`, true));
    refs.below = h("div");
    const total = plan.scenes.reduce((sum, s) => sum + s.duration, 0);
    const meta = h("div", { class: "stage-meta" },
      h("span", {}, h("b", {}, "PREVIEW"), `  ${plan.format} · ${w}×${hgt} · ${plan.fps} fps · ${timecode(total, plan.fps)} · v${p.planVersion}`),
      h("span", { class: "keys" }, "Space play/pause · ← → scenes · Esc close"));
    refs.stage.replaceChildren(h("div", { class: "player-wrap" }, meta, h("div", { class: "player-box", style: `--ar:${(w / hgt).toFixed(4)}` }, refs.player)), refs.below);
    refs.playerSrc = src;
    const selected = sceneStart(plan, state.selected);
    if (selected !== null) refs.seekOnReady = selected;
  }
  const assetName = (id) => p.assets.find((a) => a.id === id)?.name;
  let t = 0;
  const strip = h("div", { class: "strip" }, ...plan.scenes.map((s) => {
    const start = t;
    t += s.duration;
    const thumb = p.thumbs?.files?.[s.id];
    const shot = h("div", { class: "shot" }, h("span", { class: "tc" }, timecode(start, plan.fps)));
    if (thumb) shot.style.backgroundImage = `url("${fileUrl(thumb)}")`;
    return h("button", { class: `scene${state.selected === s.id ? " selected" : ""}`, onclick: () => selectScene(s.id) },
      shot,
      h("div", { class: "meta" },
        h("div", { class: "k" }, s.kind),
        h("div", { class: "t" }, s.heading || s.body || s.items?.[0] || assetName(s.media?.assetId) || s.id),
        h("div", { class: "d" }, `${s.duration}s${s.transition ? ` · ${s.transition} in` : ""}`)));
  }), h("button", { class: "scene add", title: "Add a scene", onclick: addScene }, "+ Scene"));
  const editor = state.selected ? sceneEditor(plan.scenes.find((s) => s.id === state.selected)) : null;
  refs.below.replaceChildren(...[lookBar(plan), strip, editor].filter(Boolean));
}

/** HH:MM:SS:FF timecode, as editors show it. */
function timecode(seconds, fps) {
  const total = Math.round(seconds * fps);
  const f = total % fps;
  const s = Math.floor(total / fps);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

const GRADES = [["none", "No grade"], ["cinematic", "Cinematic"], ["noir", "Noir"], ["warm", "Warm film"], ["cool", "Cool"], ["vivid", "Vivid"], ["matte", "Matte"]];

/** Film finish for the whole video: grade, grain, vignette, letterbox. */
function lookBar(plan) {
  const look = plan.style.look || {};
  const update = async (changes) => {
    const next = structuredClone(state.project.plan);
    next.style.look = { ...(next.style.look || {}), ...changes };
    for (const [k, v] of Object.entries(next.style.look)) if (v === false || v === 0 || v === "none") delete next.style.look[k];
    if (!Object.keys(next.style.look).length) delete next.style.look;
    await savePlan(next);
  };
  const grade = h("select", { "aria-label": "Colour grade", onchange: () => update({ grade: grade.value }) },
    ...GRADES.map(([v, label]) => h("option", { value: v, selected: (look.grade || "none") === v }, label)));
  const chip = (label, on, onclick, disabled) => h("button", { class: "chip", "aria-pressed": on ? "true" : "false", onclick, disabled, title: disabled || undefined }, label);
  const landscape = plan.format === "16:9";
  return h("div", { class: "lookbar" },
    h("span", { class: "lbl" }, "Look"),
    grade,
    chip("Film grain", !!look.grain, () => update({ grain: look.grain ? 0 : 0.6 })),
    chip("Vignette", !!look.vignette, () => update({ vignette: look.vignette ? 0 : 0.6 })),
    chip("Letterbox 2.39:1", !!look.letterbox, () => update({ letterbox: !look.letterbox }), landscape ? undefined : "Letterbox needs a 16:9 video"));
}

/** A moment shortly into the scene (after its entrance motion), or null if it is not in the plan. */
function sceneStart(plan, id) {
  let t = 0;
  for (const s of plan.scenes) {
    if (s.id === id) return Math.round((t + Math.min(1.2, s.duration / 2)) * 100) / 100;
    t += s.duration;
  }
  return null;
}

function selectScene(id) {
  state.selected = state.selected === id ? null : id;
  renderStage();
  const at = sceneStart(state.project.plan, state.selected);
  if (at === null) return;
  if (refs.player?.ready) {
    refs.player.pause();
    refs.player.seek(at);
  } else refs.seekOnReady = at;
}

async function savePlan(plan) {
  const r = await api("PUT", `/api/projects/${state.project.id}/plan`, plan);
  if (!r.ok) toast(`Not saved: ${(r.errors || []).slice(0, 3).join("; ")}`, true);
  return r;
}

async function addScene() {
  const plan = structuredClone(state.project.plan);
  let n = plan.scenes.length + 1;
  while (plan.scenes.some((s) => s.id === `scene-${n}`)) n++;
  const id = `scene-${n}`;
  const outro = plan.scenes.length && plan.scenes[plan.scenes.length - 1].kind === "cta" ? plan.scenes.length - 1 : plan.scenes.length;
  plan.scenes.splice(outro, 0, { id, kind: "statement", duration: 3, body: "New scene" });
  state.selected = id;
  await savePlan(plan);
}

function sceneEditor(scene) {
  if (!scene) return null;
  const p = state.project;
  const f = {
    kind: h("select", {}, ...KINDS.map((k) => h("option", { value: k, selected: k === scene.kind }, k))),
    duration: h("input", { type: "number", min: 0.5, max: 120, step: 0.5, value: scene.duration }),
    transition: h("select", {}, ...TRANSITIONS.map((k) => h("option", { value: k, selected: k === (scene.transition || "fade") }, k))),
    heading: h("input", { type: "text", value: scene.heading || "", maxlength: 160 }),
    body: h("textarea", { rows: 2, maxlength: 500 }, scene.body || ""),
    items: h("textarea", { rows: 3, placeholder: "One per line" }, (scene.items || []).join("\n")),
    voiceover: h("textarea", { rows: 3, maxlength: 800 }, scene.voiceover || ""),
    motion: h("select", {}, ...MOTIONS.map((k) => h("option", { value: k, selected: k === (scene.textMotion || "") }, k || "default"))),
    media: h("select", {}, h("option", { value: "" }, "none"), ...p.assets.filter((a) => a.kind === "image" || a.kind === "video").map((a) => h("option", { value: a.id, selected: scene.media?.assetId === a.id }, `${a.name} (${a.kind})`))),
  };
  const move = async (dir) => {
    const plan = structuredClone(p.plan);
    const i = plan.scenes.findIndex((s) => s.id === scene.id);
    const j = i + dir;
    if (j < 0 || j >= plan.scenes.length) return;
    [plan.scenes[i], plan.scenes[j]] = [plan.scenes[j], plan.scenes[i]];
    await savePlan(plan);
  };
  const save = async () => {
    const items = f.items.value.split("\n").map((s) => s.trim()).filter(Boolean);
    const changes = {
      kind: f.kind.value,
      duration: Number(f.duration.value),
      transition: f.transition.value,
      heading: f.heading.value.trim() || null,
      body: f.body.value.trim() || null,
      items: items.length ? items : null,
      voiceover: f.voiceover.value.trim() || null,
      textMotion: f.motion.value || null,
      media: f.media.value ? { ...(scene.media || {}), assetId: f.media.value } : null,
    };
    const r = await api("PATCH", `/api/projects/${p.id}/scenes/${scene.id}`, { changes });
    if (!r.ok) toast(`Not saved: ${(r.errors || []).slice(0, 3).join("; ")}`, true);
  };
  return h("div", { class: "editor" },
    h("div", { class: "row" },
      h("div", {}, h("label", {}, "Kind"), f.kind),
      h("div", {}, h("label", {}, "Duration (s)"), f.duration),
      h("div", {}, h("label", {}, "Transition in"), f.transition)),
    h("label", {}, "Heading"), f.heading,
    h("label", {}, "Body"), f.body,
    h("div", { class: "row" },
      h("div", {}, h("label", {}, "Items (list / button)"), f.items),
      h("div", {}, h("label", {}, "Media"), f.media, h("label", {}, "Text motion"), f.motion),
      h("div", {}, h("label", {}, "Voiceover / captions"), f.voiceover)),
    scene.kind === "custom" ? h("p", { class: "note" }, "Custom motion-graphics scene: ask the director to change its design.") : null,
    h("div", { class: "actions" },
      h("button", { class: "btn primary", onclick: save }, "Save scene"),
      h("button", { class: "btn", onclick: () => move(-1) }, "← Move"),
      h("button", { class: "btn", onclick: () => move(1) }, "Move →"),
      h("button", { class: "btn danger", onclick: async () => {
        if (p.plan.scenes.length === 1) return toast("A storyboard needs at least one scene.", true);
        state.selected = null;
        const r = await api("PATCH", `/api/projects/${p.id}/scenes/${scene.id}`, { delete: true });
        if (!r.ok) toast((r.errors || []).join("; "), true);
      } }, "Delete")));
}

// ── chat feed ──
function renderFeed() {
  if (!refs.feed) return;
  const items = state.feed.map((e) => {
    if (e.role === "tool") return h("div", { class: `msg tool ${e.ok === false ? "bad" : "ok"}` }, e.text);
    if (e.role === "system") return h("div", { class: `msg system${e.ok === false ? " bad" : ""}` }, e.text);
    return h("div", { class: `msg ${e.role}` }, e.text);
  });
  if (!state.feed.length) {
    items.push(h("div", { class: "msg system" }, "Upload material, then describe the video you want. For example: “Make a 30-second launch teaser from these clips with an upbeat voiceover.”"));
  }
  if (state.agentRunning) items.push(h("div", { class: "thinking" }, "Director is working…"));
  refs.feed.replaceChildren(...items);
  refs.feed.scrollTop = refs.feed.scrollHeight;
  if (refs.send) refs.send.disabled = state.agentRunning;
}

// ── boot ──
// ── theme: light by default, dark on request (remembered per browser) ──
const themeBtn = document.getElementById("theme-toggle");
function applyTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  themeBtn.title = themeBtn.getAttribute("aria-label");
  // SVG elements have no .hidden property, so set the attribute directly.
  themeBtn.querySelector(".sun").toggleAttribute("hidden", theme !== "dark");
  themeBtn.querySelector(".moon").toggleAttribute("hidden", theme === "dark");
}
let theme = "light";
try {
  theme = localStorage.getItem("director-theme") === "dark" ? "dark" : "light";
} catch {
  /* storage can be unavailable */
}
applyTheme(theme);
themeBtn.addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try {
    localStorage.setItem("director-theme", theme);
  } catch {
    /* ignore */
  }
});

// ── keyboard: Space plays, arrows step through scenes, Esc closes the editor ──
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || !state.project?.plan) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
  const scenes = state.project.plan.scenes;
  if (e.key === " " && refs.player) {
    e.preventDefault();
    if (refs.player.paused) refs.player.play();
    else refs.player.pause();
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const i = scenes.findIndex((s) => s.id === state.selected);
    const next = e.key === "ArrowRight" ? Math.min(scenes.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    if (scenes[next] && scenes[next].id !== state.selected) selectScene(scenes[next].id);
  } else if (e.key === "Escape" && state.selected) {
    state.selected = null;
    renderStage();
  }
});

(async () => {
  try {
    health = await api("GET", "/api/health");
  } catch {
    /* the studio still works without health info */
  }
  await route();
})();
