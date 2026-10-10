// Projects live on disk: data/projects/<id>/{project.json, chat.json, assets/, build/, renders/}.
// Writes are atomic (temp file + rename) and serialized per project.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Format, Plan } from "../plan/schema.ts";

export type AssetKind = "image" | "video" | "audio" | "document" | "font";

export interface Asset {
  id: string;
  kind: AssetKind;
  /** Original file name, for display. */
  name: string;
  /** Path relative to the project directory. */
  file: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  hasAudio?: boolean;
  /** Extracted text (documents), truncated. */
  text?: string;
  /** Relative paths to preview images (video keyframes, document page renders, image thumbnail). */
  previews?: string[];
  /** One-line description written by the director after looking at the asset. */
  description?: string;
  origin: "upload" | "voiceover" | "generated";
  createdAt: string;
}

export interface RenderRecord {
  id: string;
  status: "queued" | "rendering" | "done" | "failed";
  progress: number;
  message: string;
  quality: "draft" | "standard" | "high";
  planVersion: number;
  file?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  format: Format;
  /** What the user wants, in their words. */
  brief: string;
  assets: Asset[];
  plan?: Plan;
  /** Raw HTML of custom scenes, keyed by scene id. */
  customScenes: Record<string, string>;
  planVersion: number;
  renders: RenderRecord[];
  createdAt: string;
  updatedAt: string;
}

/** One entry in the human-readable activity feed shown in the UI. */
export interface FeedEntry {
  at: string;
  role: "user" | "director" | "tool" | "system";
  text: string;
  tool?: string;
  ok?: boolean;
}

export function newId(prefix: "p" | "a" | "r", length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

const ID_PATTERN = /^p_[a-z0-9]{4,16}$/;

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export class ProjectStore {
  private readonly root: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "projects");
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  dir(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`invalid project id: ${id}`);
    return path.join(this.root, id);
  }

  async list(): Promise<Project[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const projects: Project[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !ID_PATTERN.test(e.name)) continue;
      const p = await this.get(e.name).catch(() => null);
      if (p) projects.push(p);
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(name: string, format: Format, brief = ""): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: newId("p", 10),
      name: name.trim().slice(0, 120) || "Untitled video",
      format,
      brief: brief.slice(0, 4000),
      assets: [],
      customScenes: {},
      planVersion: 0,
      renders: [],
      createdAt: now,
      updatedAt: now,
    };
    const dir = this.dir(project.id);
    for (const sub of ["assets", "build", "renders", "previews"]) await mkdir(path.join(dir, sub), { recursive: true });
    await writeJsonAtomic(path.join(dir, "project.json"), project);
    return project;
  }

  async get(id: string): Promise<Project> {
    const raw = await readFile(path.join(this.dir(id), "project.json"), "utf8");
    return JSON.parse(raw) as Project;
  }

  async exists(id: string): Promise<boolean> {
    return ID_PATTERN.test(id) && existsSync(path.join(this.dir(id), "project.json"));
  }

  /** Read-modify-write under a per-project lock so concurrent edits never clobber each other. */
  async update(id: string, fn: (p: Project) => void | Promise<void>): Promise<Project> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const project = await this.get(id);
      await fn(project);
      project.updatedAt = new Date().toISOString();
      await writeJsonAtomic(path.join(this.dir(id), "project.json"), project);
      return project;
    });
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  // ── Conversation with the director (Claude message history, append-only) ──
  async loadChat(id: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
    const raw = await readFile(path.join(this.dir(id), "chat.json"), "utf8").catch(() => "[]");
    return JSON.parse(raw) as Anthropic.Beta.BetaMessageParam[];
  }

  async saveChat(id: string, messages: Anthropic.Beta.BetaMessageParam[]): Promise<void> {
    await writeJsonAtomic(path.join(this.dir(id), "chat.json"), messages);
  }

  // ── Activity feed for the UI ──
  async loadFeed(id: string): Promise<FeedEntry[]> {
    const raw = await readFile(path.join(this.dir(id), "feed.json"), "utf8").catch(() => "[]");
    return JSON.parse(raw) as FeedEntry[];
  }

  async appendFeed(id: string, entry: Omit<FeedEntry, "at">): Promise<FeedEntry> {
    const full: FeedEntry = { at: new Date().toISOString(), ...entry };
    const prev = this.locks.get(`${id}:feed`) ?? Promise.resolve();
    const next = prev.then(async () => {
      const feed = await this.loadFeed(id);
      feed.push(full);
      await writeJsonAtomic(path.join(this.dir(id), "feed.json"), feed.slice(-500));
    });
    this.locks.set(`${id}:feed`, next.catch(() => undefined));
    await next;
    return full;
  }
}
