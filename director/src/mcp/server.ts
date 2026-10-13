// The Director connector: an MCP server that lets Claude (Claude Code, Claude Desktop or any
// MCP client) direct the edit itself. It exposes the built-in director's tools, each scoped by
// project_id, plus tools to manage projects, import local files and deliver renders. Every
// action goes through the same Studio, so validation, locking and the live preview all apply.
import { constants as fsConstants } from "node:fs";
import { copyFile, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CONNECTOR_GUIDE, CUSTOM_SCENE_RULES } from "../agent/prompts.ts";
import { runTool, toolDefinitions, type ToolOutcome } from "../agent/tools.ts";
import type { Config } from "../config.ts";
import { FORMATS } from "../plan/schema.ts";
import type { Studio } from "../studio.ts";

export interface ConnectorContext {
  studio: Studio;
  config: Config;
  /** Studio page for a project (or the studio home), or null when no UI is running. */
  studioUrl: (projectId?: string) => string | null;
  /** Problems with this machine's setup, passed on to Claude in the server instructions. */
  setupNotes?: string[];
}

const INSTRUCTIONS = `Director is a local AI video studio that renders with HyperFrames. With these tools you direct the edit: plan the storyboard, write narration, choose shots and trims, design motion graphics, check frames and render MP4s.
Before planning a video, call director_guide once for the full workflow, scene types and custom-scene rules.
Typical flow: list_projects or create_project (share the studio link: it shows a live preview), import_files or import_from_url, get_project and view_assets, save_plan, preview and fix with edit_scene, then render_video, render_status and save_render when the user approves.
Shots generated with another connector (such as Higgsfield) come in through import_from_url with their direct file links.`;

const READ_ONLY = new Set(["director_guide", "list_projects", "get_project", "view_assets", "preview", "render_status"]);

const OVERRIDES: Record<string, string> = {
  write_custom_scene: `Set the HTML of a scene whose kind is "custom". Add the scene to the plan first.\n\n${CUSTOM_SCENE_RULES}`,
  render_video: "Render the saved storyboard to an MP4 in the background. Use draft for quick checks, high for the final and 4k for a 4K master (16:9, 9:16 and 1:1). Follow up with render_status, then save_render to deliver the file.",
};

function projectTools(): Tool[] {
  return toolDefinitions().map((t) => {
    const schema = t.input_schema as { properties?: Record<string, unknown>; required?: string[] };
    return {
      name: t.name,
      description: OVERRIDES[t.name] ?? t.description ?? "",
      inputSchema: {
        type: "object" as const,
        properties: { project_id: { type: "string", description: "Project id (p_...), from list_projects or create_project." }, ...(schema.properties ?? {}) },
        required: ["project_id", ...(schema.required ?? [])],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: READ_ONLY.has(t.name) },
    };
  });
}

const CONNECTOR_TOOLS: Tool[] = [
  {
    name: "director_guide",
    description: "The full director guide: workflow, scene kinds and fields, style rules, custom motion-graphics rules and content boundaries. Read it once before planning a video.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_projects",
    description: "List video projects with their ids, formats, scene and asset counts and studio links.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_project",
    description: "Create a video project and return its id and studio link (live preview and editor).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120 },
        format: { type: "string", enum: Object.keys(FORMATS), description: "9:16 for Reels/Shorts/TikTok, 16:9 for YouTube, 1:1 or 4:5 for feeds." },
        brief: { type: "string", maxLength: 4000, description: "What the video is for, who it is for, and how it should feel." },
      },
      required: ["name", "format"],
      additionalProperties: false,
    },
  },
  {
    name: "import_files",
    description: "Import local files into a project: images, video, audio, PDF, DOCX, Markdown, HTML, text scripts, subtitles or fonts. Pass absolute paths or paths starting with ~/. Hidden files and folders are refused.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
      },
      required: ["project_id", "paths"],
      additionalProperties: false,
    },
  },
  {
    name: "render_status",
    description: "Status of a render (the latest one if render_id is omitted). wait_seconds keeps the call open until the render finishes or the time runs out. When done, returns the MP4 path.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        render_id: { type: "string" },
        wait_seconds: { type: "number", minimum: 0, maximum: 55 },
      },
      required: ["project_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "save_render",
    description: "Copy a finished render to a location the user chooses: a folder or a path ending in .mp4 (absolute or ~/). Refuses to overwrite unless overwrite is true.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        render_id: { type: "string" },
        destination: { type: "string" },
        overwrite: { type: "boolean" },
      },
      required: ["project_id", "render_id", "destination"],
      additionalProperties: false,
    },
  },
];

const CreateInput = z.object({ name: z.string().min(1).max(120), format: z.enum(["9:16", "16:9", "1:1", "4:5"]), brief: z.string().max(4000).optional() });
const ImportInput = z.object({ project_id: z.string(), paths: z.array(z.string().min(1)).min(1).max(20) });
const StatusInput = z.object({ project_id: z.string(), render_id: z.string().optional(), wait_seconds: z.number().min(0).max(55).optional() });
const SaveInput = z.object({ project_id: z.string(), render_id: z.string(), destination: z.string().min(1), overwrite: z.boolean().optional() });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new Error(`invalid input: ${r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  return r.data;
}

const text = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const failure = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Convert Claude API tool-result blocks into MCP content. */
function toMcpContent(content: ToolOutcome["content"]): CallToolResult["content"] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  const out: CallToolResult["content"] = [];
  for (const block of content) {
    if (block.type === "text") out.push({ type: "text", text: block.text });
    else if (block.type === "image" && block.source.type === "base64") out.push({ type: "image", data: block.source.data, mimeType: block.source.media_type });
  }
  return out;
}

/** Expand ~ and require an absolute path. */
function userPath(raw: string): string {
  const p = raw.trim();
  const expanded = p === "~" ? os.homedir() : p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(2)) : p;
  if (!path.isAbsolute(expanded)) throw new Error(`use an absolute path or one starting with ~/ (got "${raw}")`);
  return path.resolve(expanded);
}

/** Refuse hidden files and folders (keys, configs, caches) and, when configured, anything outside the import roots. */
function checkAllowed(file: string, roots: string[]): void {
  const parts = file.split(/[\\/]+/);
  if (parts.some((part) => part.startsWith("."))) throw new Error("hidden files and folders are not imported");
  if (roots.length && !roots.some((root) => {
    const rel = path.relative(root, file);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  })) {
    throw new Error(`outside the folders Director may read (${roots.join(", ")})`);
  }
}

export function createConnector(ctx: ConnectorContext): Server {
  const { studio, config } = ctx;
  const notes = ctx.setupNotes?.length ? `\n\nSetup problems to tell the user about:\n${ctx.setupNotes.map((n) => `- ${n}`).join("\n")}` : "";
  const server = new Server({ name: "director", version: "0.1.0" }, { capabilities: { tools: {}, prompts: {} }, instructions: INSTRUCTIONS + notes });
  const tools = [...CONNECTOR_TOOLS, ...projectTools()];
  const projectToolNames = new Set(toolDefinitions().map((t) => t.name));

  const requireProject = async (id: unknown): Promise<string> => {
    if (typeof id !== "string" || !(await studio.store.exists(id))) throw new Error(`project "${String(id)}" not found; use list_projects or create_project`);
    return id;
  };
  const note = (projectId: string, tool: string, summary: string, ok = true) =>
    studio.feed(projectId, { role: "tool", tool, text: `Claude: ${summary}`, ok }).catch(() => undefined);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (projectToolNames.has(name)) {
        const { project_id, ...rest } = args;
        const projectId = await requireProject(project_id);
        const outcome = await runTool(studio, projectId, name, rest, { pdfDocuments: false });
        await note(projectId, name, outcome.summary, !outcome.isError);
        return { content: toMcpContent(outcome.content), isError: outcome.isError ?? false };
      }
      switch (name) {
        case "director_guide":
          return text(CONNECTOR_GUIDE);

        case "list_projects": {
          const projects = await studio.store.list();
          return text(projects.map((p) => ({ project_id: p.id, name: p.name, format: p.format, scenes: p.plan?.scenes.length ?? 0, assets: p.assets.length, updated: p.updatedAt, studio: ctx.studioUrl(p.id) })));
        }

        case "create_project": {
          const input = parse(CreateInput, args);
          const p = await studio.store.create(input.name, input.format, input.brief ?? "");
          await note(p.id, name, `Created "${p.name}" (${p.format})`);
          return text({ project_id: p.id, name: p.name, format: p.format, studio: ctx.studioUrl(p.id), next: "Import material with import_files (or the user can drop files into the studio), then read director_guide and plan." });
        }

        case "import_files": {
          const input = parse(ImportInput, args);
          const projectId = await requireProject(input.project_id);
          const added: Array<Record<string, unknown>> = [];
          const failed: Array<{ path: string; error: string }> = [];
          for (const raw of input.paths) {
            try {
              const file = userPath(raw);
              checkAllowed(file, config.importRoots);
              const real = await realpath(file);
              checkAllowed(real, config.importRoots);
              const info = await stat(real);
              if (!info.isFile()) throw new Error("not a file");
              if (info.size > config.maxUploadBytes) throw new Error(`larger than ${Math.round(config.maxUploadBytes / 1048576)} MB`);
              const a = await studio.addAsset(projectId, path.basename(file), new Uint8Array(await readFile(real)));
              added.push({ asset_id: a.id, name: a.name, kind: a.kind, ...(a.width ? { size: `${a.width}x${a.height}` } : {}), ...(a.duration ? { seconds: a.duration } : {}) });
            } catch (err) {
              failed.push({ path: raw, error: (err as Error).message });
            }
          }
          if (added.length) await note(projectId, name, `Imported ${added.map((a) => a.name).join(", ")}`);
          return { ...text({ added, failed }), isError: added.length === 0 };
        }

        case "render_status": {
          const input = parse(StatusInput, args);
          const projectId = await requireProject(input.project_id);
          const deadline = Date.now() + (input.wait_seconds ?? 0) * 1000;
          for (;;) {
            const p = await studio.store.get(projectId);
            const r = input.render_id ? p.renders.find((x) => x.id === input.render_id) : p.renders[0];
            if (!r) return failure(input.render_id ? `render ${input.render_id} not found` : "no renders yet; start one with render_video");
            const finished = r.status === "done" || r.status === "failed";
            if (finished || Date.now() >= deadline) {
              const base = ctx.studioUrl();
              return text({
                render_id: r.id,
                status: r.status,
                progress: Math.round(r.progress),
                message: r.message,
                quality: r.quality,
                plan_version: r.planVersion,
                ...(r.error ? { error: r.error } : {}),
                ...(r.status === "done" && r.file ? { file: path.join(studio.store.dir(projectId), r.file), ...(base ? { download: `${base}/files/${projectId}/${r.file}?download` } : {}) } : {}),
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        case "save_render": {
          const input = parse(SaveInput, args);
          const projectId = await requireProject(input.project_id);
          const p = await studio.store.get(projectId);
          const r = p.renders.find((x) => x.id === input.render_id);
          if (!r || r.status !== "done" || !r.file) return failure(`render ${input.render_id} is not finished`);
          let dest = userPath(input.destination);
          const existing = await stat(dest).catch(() => null);
          if (existing?.isDirectory()) {
            const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
            dest = path.join(dest, `${slug}-${r.id}.mp4`);
          } else if (!dest.toLowerCase().endsWith(".mp4")) {
            return failure("destination must be a folder or a path ending in .mp4");
          }
          checkAllowed(dest, []);
          await copyFile(path.join(studio.store.dir(projectId), r.file), dest, input.overwrite ? 0 : fsConstants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => {
            throw new Error(err.code === "EEXIST" ? `${dest} already exists; pass overwrite: true to replace it` : err.code === "ENOENT" ? `folder ${path.dirname(dest)} does not exist` : err.message);
          });
          await note(projectId, name, `Saved render to ${dest}`);
          return text({ saved_to: dest });
        }

        default:
          return failure(`unknown tool ${name}`);
      }
    } catch (err) {
      return failure((err as Error).message);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "make_video",
        description: "Direct a new video with Director: plan, check and render it from your brief and files.",
        arguments: [
          { name: "brief", description: "What the video is for, who it is for, how long, and how it should feel.", required: true },
          { name: "format", description: "9:16, 16:9, 1:1 or 4:5 (default 9:16)." },
          { name: "files", description: "Local files to use, separated by commas." },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "make_video") throw new Error(`unknown prompt ${request.params.name}`);
    const a = request.params.arguments ?? {};
    const lines = [
      CONNECTOR_GUIDE,
      "---",
      `Make this video: ${a.brief ?? "(ask me what the video is for)"}`,
      `Format: ${a.format || "9:16"}`,
      a.files ? `Use these files: ${a.files}` : "Ask me for the material, or plan typographic and motion-graphics scenes if there is none.",
    ];
    return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n\n") } }] };
  });

  return server;
}
