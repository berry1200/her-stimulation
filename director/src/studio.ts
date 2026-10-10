// Studio: the operations shared by the HTTP API and the director agent's tools.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import { checkCustomHtml } from "./compile/custom.ts";
import { compileProject, sceneCompositionId, type CompileResult } from "./compile/compiler.ts";
import { round } from "./compile/text.ts";
import type { EventBus } from "./events.ts";
import { ingestFile } from "./ingest/ingest.ts";
import { probe } from "./ingest/media.ts";
import { referencedAssets, SceneSchema, totalDuration, validatePlan, type Plan, type PlanIssue } from "./plan/schema.ts";
import { createGenVideo, type GenVideoProvider } from "./providers/genvideo.ts";
import { createTts, type TtsProvider } from "./providers/tts.ts";
import { lint, render, snapshot, type LintFinding } from "./render/hyperframes.ts";
import { newId, type Asset, type FeedEntry, type Project, type ProjectStore, type RenderRecord } from "./store/projects.ts";

export interface BuildReport {
  ok: boolean;
  issues?: PlanIssue[];
  errors: string[];
  warnings: string[];
  lint?: { errors: LintFinding[]; warnings: LintFinding[] };
  duration?: number;
  timeline?: CompileResult["timeline"];
  planVersion?: number;
}

export class Studio {
  readonly tts: TtsProvider;
  readonly genVideo: GenVideoProvider;
  private readonly renders = new Map<string, AbortController>();
  private renderChain: Promise<unknown> = Promise.resolve();
  /** Storyboard as it was when each render was queued, so later edits don't change a queued render. */
  private readonly queuedPlans = new Map<string, { plan: Plan; customScenes: Record<string, string> }>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    readonly config: Config,
    readonly store: ProjectStore,
    readonly bus: EventBus,
  ) {
    this.tts = createTts(config);
    this.genVideo = createGenVideo(config);
  }

  buildDir(projectId: string): string {
    return path.join(this.store.dir(projectId), "build");
  }

  /**
   * Run `fn` while holding the project's storyboard lock. Saves, edits, rebuilds and
   * previews from the UI and the agent then apply one at a time, so no edit is lost
   * and build/ never changes under a snapshot.
   */
  private exclusive<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(projectId) ?? Promise.resolve()).then(fn);
    this.locks.set(projectId, next.catch(() => undefined));
    return next;
  }

  /** After a restart: fail renders that were interrupted and remove half-finished build folders. */
  async recover(): Promise<void> {
    for (const p of await this.store.list()) {
      const dir = this.store.dir(p.id);
      for (const e of await readdir(dir).catch(() => [])) {
        if (e === "tmp" || e.startsWith("build.next-") || e.startsWith("build.old-")) await rm(path.join(dir, e), { recursive: true, force: true });
      }
      if (p.renders.some((r) => r.status === "queued" || r.status === "rendering")) {
        await this.store.update(p.id, (proj) => {
          for (const r of proj.renders) {
            if (r.status === "queued" || r.status === "rendering") Object.assign(r, { status: "failed", message: "Interrupted", error: "The studio restarted before this render finished. Queue it again." });
          }
        });
      }
    }
  }

  async feed(projectId: string, entry: Omit<FeedEntry, "at">): Promise<void> {
    const full = await this.store.appendFeed(projectId, entry);
    this.bus.publish(projectId, { type: "feed", entry: full });
  }

  // ── Assets ──
  async addAsset(projectId: string, name: string, data: Uint8Array, origin: Asset["origin"] = "upload"): Promise<Asset> {
    const asset = await ingestFile(this.store.dir(projectId), name, data, origin);
    await this.store.update(projectId, (p) => void p.assets.push(asset));
    this.bus.publish(projectId, { type: "assets" });
    return asset;
  }

  async removeAsset(projectId: string, assetId: string): Promise<void> {
    const project = await this.store.get(projectId);
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`asset ${assetId} not found`);
    if (project.plan && referencedAssets(project.plan).includes(assetId)) {
      throw new Error(`asset ${assetId} is used by the storyboard; remove it from the scenes first`);
    }
    const dir = this.store.dir(projectId);
    await rm(path.join(dir, asset.file), { force: true });
    for (const p of asset.previews ?? []) await rm(path.join(dir, p), { force: true });
    await this.store.update(projectId, (p) => {
      p.assets = p.assets.filter((a) => a.id !== assetId);
    });
    this.bus.publish(projectId, { type: "assets" });
  }

  async describeAsset(projectId: string, assetId: string, description: string): Promise<void> {
    await this.store.update(projectId, (p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (!a) throw new Error(`asset ${assetId} not found`);
      a.description = description.slice(0, 300);
    });
    this.bus.publish(projectId, { type: "assets" });
  }

  // ── Storyboard ──
  /** Validate, compile and lint `planInput`; persist it only when everything passes. */
  savePlan(projectId: string, planInput: unknown, customScenes?: Record<string, string>): Promise<BuildReport> {
    return this.exclusive(projectId, () => this.savePlanNow(projectId, planInput, customScenes));
  }

  private async savePlanNow(projectId: string, planInput: unknown, customScenes?: Record<string, string>): Promise<BuildReport> {
    const v = validatePlan(planInput);
    if (!v.ok) return { ok: false, issues: v.issues, errors: v.issues.map((i) => `${i.path}: ${i.message}`), warnings: [] };
    const project = await this.store.get(projectId);
    const custom = { ...project.customScenes, ...(customScenes ?? {}) };
    // Drop custom HTML for scenes that no longer exist or are no longer custom.
    for (const id of Object.keys(custom)) if (!v.plan.scenes.some((s) => s.id === id && s.kind === "custom")) delete custom[id];
    const report = await this.build(projectId, v.plan, project.assets, custom);
    if (!report.ok) return report;
    const saved = await this.store.update(projectId, (p) => {
      p.plan = v.plan;
      p.customScenes = custom;
      p.format = v.plan.format;
      p.planVersion += 1;
    });
    this.bus.publish(projectId, { type: "plan", version: saved.planVersion });
    return { ...report, planVersion: saved.planVersion };
  }

  /** Merge `changes` into one scene (or delete it) and save. */
  editScene(projectId: string, sceneId: string, changes: Record<string, unknown>, remove = false): Promise<BuildReport> {
    return this.exclusive(projectId, () => this.editSceneNow(projectId, sceneId, changes, remove));
  }

  private async editSceneNow(projectId: string, sceneId: string, changes: Record<string, unknown>, remove: boolean): Promise<BuildReport> {
    const project = await this.store.get(projectId);
    if (!project.plan) return { ok: false, errors: ["there is no storyboard yet; save a plan first"], warnings: [] };
    const plan = structuredClone(project.plan) as Plan;
    const idx = plan.scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) return { ok: false, errors: [`scene "${sceneId}" not found; scenes are ${plan.scenes.map((s) => s.id).join(", ")}`], warnings: [] };
    if (remove) {
      plan.scenes.splice(idx, 1);
    } else {
      const merged = { ...plan.scenes[idx], ...changes, id: changes.id ?? sceneId };
      // `null` in a change removes that field.
      for (const [k, val] of Object.entries(merged)) if (val === null) delete (merged as Record<string, unknown>)[k];
      const parsed = SceneSchema.safeParse(merged);
      if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), warnings: [] };
      plan.scenes[idx] = parsed.data;
    }
    return this.savePlanNow(projectId, plan);
  }

  writeCustomScene(projectId: string, sceneId: string, html: string): Promise<BuildReport> {
    return this.exclusive(projectId, async () => {
      const project = await this.store.get(projectId);
      const scene = project.plan?.scenes.find((s) => s.id === sceneId);
      if (!project.plan || !scene) return { ok: false, errors: [`scene "${sceneId}" not found; add it to the plan with kind "custom" first`], warnings: [] };
      if (scene.kind !== "custom") return { ok: false, errors: [`scene "${sceneId}" is a ${scene.kind} scene; set its kind to "custom" first`], warnings: [] };
      const check = checkCustomHtml(html, scene.duration, sceneCompositionId(sceneId));
      if (!check.ok) return { ok: false, errors: check.errors, warnings: [] };
      return this.savePlanNow(projectId, project.plan, { [sceneId]: html });
    });
  }

  /**
   * Compile and lint in a staging folder. Only a build that passes replaces build/,
   * so the live preview always shows the last saved storyboard.
   */
  private async build(projectId: string, plan: Plan, assets: Asset[], customScenes: Record<string, string>): Promise<BuildReport> {
    const live = this.buildDir(projectId);
    const tag = randomBytes(4).toString("hex");
    const staging = `${live}.next-${tag}`;
    try {
      const report = await this.compileInto(projectId, plan, assets, customScenes, staging);
      if (report.ok) {
        const old = `${live}.old-${tag}`;
        if (existsSync(live)) await rename(live, old);
        await rename(staging, live);
        await rm(old, { recursive: true, force: true });
      }
      return report;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private async compileInto(projectId: string, plan: Plan, assets: Asset[], customScenes: Record<string, string>, outDir: string): Promise<BuildReport> {
    const result = await compileProject({ plan, assets, customScenes, projectDir: this.store.dir(projectId), buildDir: outDir });
    if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };
    const l = await lint(this.config, outDir);
    return {
      ok: l.errors.length === 0,
      errors: l.errors.map((e) => `hyperframes lint ${e.code}: ${e.message}`),
      warnings: [...result.warnings, ...l.warnings.map((w) => `hyperframes lint ${w.code}: ${w.message}`)],
      lint: { errors: l.errors, warnings: l.warnings },
      duration: result.duration,
      timeline: result.timeline,
    };
  }

  /** Recompile the saved plan (e.g. after the build directory was cleaned). */
  rebuild(projectId: string): Promise<BuildReport> {
    return this.exclusive(projectId, async () => {
      const p = await this.store.get(projectId);
      if (!p.plan) return { ok: false, errors: ["no storyboard yet"], warnings: [] };
      return this.build(projectId, p.plan, p.assets, p.customScenes);
    });
  }

  // ── Preview frames for review ──
  preview(projectId: string, times?: number[], maxFrames = 8): Promise<Array<{ time: number; scene: string; file: string }>> {
    return this.exclusive(projectId, () => this.previewNow(projectId, times, maxFrames));
  }

  private async previewNow(projectId: string, times: number[] | undefined, maxFrames: number): Promise<Array<{ time: number; scene: string; file: string }>> {
    const p = await this.store.get(projectId);
    if (!p.plan) throw new Error("no storyboard yet");
    let t = 0;
    const spans = p.plan.scenes.map((s) => {
      const span = { id: s.id, start: t, end: t + s.duration };
      t += s.duration;
      return span;
    });
    const wanted = (times?.length ? times : spans.map((s) => s.start + Math.min(s.end - s.start - 0.2, Math.max(1.2, (s.end - s.start) * 0.6))))
      .map((x) => Math.max(0, Math.min(totalDuration(p.plan!) - 0.05, x)))
      .slice(0, maxFrames);
    const outDir = path.join(this.store.dir(projectId), "previews", "frames");
    const frames = await snapshot(this.config, this.buildDir(projectId), wanted, outDir);
    return frames.map((file, i) => {
      const time = wanted[i] ?? 0;
      return { time: round(time, 2), scene: spans.find((s) => time >= s.start && time < s.end)?.id ?? "", file };
    });
  }

  // ── Voice ──
  async generateVoiceovers(projectId: string, sceneIds?: string[]): Promise<{ report: BuildReport; voiced: string[]; adjusted: string[] }> {
    if (!this.tts.ready) throw new Error(this.tts.reason ?? "voice provider unavailable");
    const p = await this.store.get(projectId);
    if (!p.plan) throw new Error("no storyboard yet");
    const lines = p.plan.scenes
      .filter((s) => (!sceneIds?.length || sceneIds.includes(s.id)) && s.voiceover?.trim())
      .map((s) => ({ id: s.id, text: s.voiceover! }));
    const dir = this.store.dir(projectId);
    // Synthesis can take a while, so it runs without holding the storyboard lock.
    const audio = new Map<string, { assetId: string; seconds: number; text: string }>();
    for (const line of lines) {
      const base = path.join(dir, "previews", `vo-${line.id}-${Date.now()}`);
      const file = await this.tts.synthesize(line.text, base);
      const asset = await this.addAsset(projectId, `voiceover-${line.id}${path.extname(file)}`, new Uint8Array(await readFile(file)), "voiceover");
      await rm(file, { force: true });
      const seconds = asset.duration ?? (await probe(path.join(dir, asset.file))).duration ?? 0;
      audio.set(line.id, { assetId: asset.id, seconds, text: line.text });
    }
    // Attach the audio to the storyboard as it is now; a scene whose line changed meanwhile keeps no stale audio.
    return this.exclusive(projectId, async () => {
      const current = await this.store.get(projectId);
      if (!current.plan) throw new Error("the storyboard was removed while the voiceover was generated");
      const plan = structuredClone(current.plan) as Plan;
      const voiced: string[] = [];
      const adjusted: string[] = [];
      for (const scene of plan.scenes) {
        const a = audio.get(scene.id);
        if (!a || scene.voiceover !== a.text) continue;
        scene.voiceoverAssetId = a.assetId;
        voiced.push(scene.id);
        if (a.seconds + 0.6 > scene.duration) {
          scene.duration = round(Math.min(120, a.seconds + 0.6), 2);
          adjusted.push(scene.id);
        }
      }
      const report = await this.savePlanNow(projectId, plan);
      return { report, voiced, adjusted };
    });
  }

  // ── Generated clips ──
  async generateClip(projectId: string, prompt: string, seconds: number, imageAssetId?: string): Promise<Asset> {
    if (!this.genVideo.ready) throw new Error(this.genVideo.reason ?? "video generator unavailable");
    const p = await this.store.get(projectId);
    const dir = this.store.dir(projectId);
    const image = imageAssetId ? p.assets.find((a) => a.id === imageAssetId && a.kind === "image") : undefined;
    if (imageAssetId && !image) throw new Error(`image asset ${imageAssetId} not found`);
    const out = path.join(dir, "previews", `gen-${Date.now()}.mp4`);
    await this.genVideo.generate({ prompt, seconds, aspect: p.format, image: image ? path.join(dir, image.file) : undefined }, out);
    const asset = await this.addAsset(projectId, `generated-${Date.now()}.mp4`, new Uint8Array(await readFile(out)), "generated");
    await rm(out, { force: true });
    await this.describeAsset(projectId, asset.id, `Generated: ${prompt}`);
    return asset;
  }

  // ── Rendering (one at a time; each render runs in its own process) ──
  async queueRender(projectId: string, quality: RenderRecord["quality"]): Promise<RenderRecord> {
    const p = await this.store.get(projectId);
    if (!p.plan) throw new Error("no storyboard to render yet");
    const record: RenderRecord = {
      id: newId("r"),
      status: "queued",
      progress: 0,
      message: "Queued",
      quality,
      planVersion: p.planVersion,
      createdAt: new Date().toISOString(),
    };
    await this.store.update(projectId, (proj) => void proj.renders.unshift(record));
    this.queuedPlans.set(record.id, { plan: structuredClone(p.plan), customScenes: { ...p.customScenes } });
    this.publishRender(projectId, record);
    const controller = new AbortController();
    this.renders.set(record.id, controller);
    this.renderChain = this.renderChain.then(() => this.runRender(projectId, record.id, controller.signal)).catch(() => undefined);
    return record;
  }

  cancelRender(renderId: string): boolean {
    const c = this.renders.get(renderId);
    if (!c) return false;
    c.abort();
    return true;
  }

  private publishRender(projectId: string, r: RenderRecord): void {
    this.bus.publish(projectId, { type: "render", id: r.id, status: r.status, progress: r.progress, message: r.message, file: r.file });
  }

  private async patchRender(projectId: string, id: string, patch: Partial<RenderRecord>): Promise<void> {
    const p = await this.store.update(projectId, (proj) => {
      const r = proj.renders.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
    const r = p.renders.find((x) => x.id === id);
    if (r) this.publishRender(projectId, r);
  }

  private async runRender(projectId: string, renderId: string, signal: AbortSignal): Promise<void> {
    // Each render compiles the storyboard it was queued with into its own folder,
    // so edits made while it waits or runs never change it.
    const workDir = path.join(this.store.dir(projectId), "tmp", `render-${renderId}`);
    try {
      if (signal.aborted) throw new Error("render cancelled");
      const p = await this.store.get(projectId);
      const record = p.renders.find((r) => r.id === renderId);
      const queued = this.queuedPlans.get(renderId);
      if (!record || !queued) return;
      await this.patchRender(projectId, renderId, { status: "rendering", message: "Compiling" });
      const report = await this.compileInto(projectId, queued.plan, p.assets, queued.customScenes, workDir);
      if (!report.ok) throw new Error(`storyboard does not compile: ${report.errors.join("; ")}`);
      const file = `renders/${renderId}.mp4`;
      let last = -1;
      await render(this.config, workDir, path.join(this.store.dir(projectId), file), {
        quality: record.quality,
        signal,
        onProgress: (pct, message) => {
          if (pct - last >= 2 || pct === 100) {
            last = pct;
            void this.patchRender(projectId, renderId, { progress: pct, message });
          }
        },
      });
      await this.patchRender(projectId, renderId, { status: "done", progress: 100, message: "Done", file, finishedAt: new Date().toISOString() });
      await this.feed(projectId, { role: "system", text: `Render finished (${record.quality}). It is ready to download.` });
    } catch (err) {
      await this.patchRender(projectId, renderId, { status: "failed", message: "Failed", error: (err as Error).message.slice(0, 2000), finishedAt: new Date().toISOString() });
      await this.feed(projectId, { role: "system", text: `Render failed: ${(err as Error).message.slice(0, 300)}`, ok: false });
    } finally {
      this.renders.delete(renderId);
      this.queuedPlans.delete(renderId);
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // ── Summary for the director ──
  async snapshotState(projectId: string): Promise<Record<string, unknown>> {
    const p: Project = await this.store.get(projectId);
    return {
      name: p.name,
      format: p.format,
      brief: p.brief,
      planVersion: p.planVersion,
      providers: {
        voice: this.tts.ready ? this.tts.id : `unavailable (${this.tts.reason})`,
        videoGeneration: this.genVideo.ready ? this.genVideo.id : `unavailable (${this.genVideo.reason})`,
      },
      assets: p.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        origin: a.origin,
        ...(a.width ? { size: `${a.width}x${a.height}` } : {}),
        ...(a.duration ? { seconds: round(a.duration, 2) } : {}),
        ...(a.kind === "video" ? { hasAudio: Boolean(a.hasAudio) } : {}),
        ...(a.text ? { textChars: a.text.length } : {}),
        ...(a.description ? { description: a.description } : {}),
      })),
      plan: p.plan ?? null,
      customScenes: Object.keys(p.customScenes),
      renders: p.renders.slice(0, 3).map((r) => ({ id: r.id, status: r.status, quality: r.quality, planVersion: r.planVersion })),
    };
  }
}
