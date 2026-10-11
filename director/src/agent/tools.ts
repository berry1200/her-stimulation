// The director's tools: JSON-schema definitions plus handlers that call the Studio.
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { planJsonSchema, SceneSchema } from "../plan/schema.ts";
import type { Studio } from "../studio.ts";

const run = promisify(execFile);
type ResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>;

export interface ToolOutcome {
  content: string | ResultContent;
  isError?: boolean;
  /** One-line summary for the activity feed. */
  summary: string;
}

const sceneFieldList = Object.keys(SceneSchema.shape).join(", ");

export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return [
    {
      name: "get_project",
      description: "Current project state: brief, format, assets (ids, kinds, sizes, durations, notes), the saved storyboard, custom scene ids, recent renders and which voice/video providers are available.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "view_assets",
      description: "Look at up to 4 assets. Images come back as pictures, videos as evenly spaced keyframes, documents as their text (PDFs also as the document itself), audio as metadata. Use before deciding how to use a piece of media.",
      input_schema: {
        type: "object",
        properties: { asset_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 } },
        required: ["asset_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "note_asset",
      description: "Save a one-line description of an asset (what it shows, its mood, usable moments with timestamps) so future turns can plan without viewing it again.",
      input_schema: {
        type: "object",
        properties: { asset_id: { type: "string" }, description: { type: "string", maxLength: 300 } },
        required: ["asset_id", "description"],
        additionalProperties: false,
      },
    },
    {
      name: "save_plan",
      description:
        "Replace the whole storyboard. The plan is validated, compiled to HyperFrames and linted; it is saved only if all of that passes, otherwise the errors are returned to fix. Returns the scene timeline and any layout warnings. Colours are 6-digit hex; fonts are sans, serif, mono, rounded or asset:<font asset id>; durations are seconds.",
      input_schema: {
        type: "object",
        properties: { plan: planJsonSchema() },
        required: ["plan"],
        additionalProperties: false,
      },
    },
    {
      name: "edit_scene",
      description: `Change one scene without rewriting the plan: pass only the fields to change (${sceneFieldList}); null removes a field. Set delete: true to remove the scene. Use save_plan to reorder or add scenes.`,
      input_schema: {
        type: "object",
        properties: {
          scene_id: { type: "string" },
          changes: { type: "object", description: "Partial scene; same fields and rules as in save_plan." },
          delete: { type: "boolean" },
        },
        required: ["scene_id"],
        additionalProperties: false,
      },
    },
    {
      name: "write_custom_scene",
      description:
        'Set the HTML of a scene whose kind is "custom": positioned elements, inline SVG and one <style> block, animated with CSS @keyframes only. Every visible element needs class="clip", data-start, data-duration (local seconds) and data-track-index; ids start with "s-<scene id>-". No scripts or external URLs; reference uploads as {{asset:a_xxxxxxxx}}.',
      input_schema: {
        type: "object",
        properties: { scene_id: { type: "string" }, html: { type: "string", maxLength: 60000 } },
        required: ["scene_id", "html"],
        additionalProperties: false,
      },
    },
    {
      name: "preview",
      description: "Capture still frames from the current storyboard to check the result. With no times, takes one frame from each scene (up to 8). Returns the frames as images, labelled with time and scene.",
      input_schema: {
        type: "object",
        properties: { times: { type: "array", items: { type: "number", minimum: 0 }, maxItems: 8 } },
        additionalProperties: false,
      },
    },
    {
      name: "generate_voiceover",
      description: "Synthesize each scene's voiceover line with the configured voice provider and attach the audio. Scenes too short for their line are lengthened. Fails if no voice provider is available.",
      input_schema: {
        type: "object",
        properties: { scene_ids: { type: "array", items: { type: "string" }, description: "Defaults to every scene with a voiceover line." } },
        additionalProperties: false,
      },
    },
    {
      name: "generate_clip",
      description: "Generate a short AI video clip from a text prompt (optionally starting from an image asset) with the configured video generator. The clip becomes a new video asset to place in a media scene. Fails if no generator is configured.",
      input_schema: {
        type: "object",
        properties: {
          prompt: { type: "string", maxLength: 1500 },
          seconds: { type: "number", minimum: 2, maximum: 10 },
          image_asset_id: { type: "string" },
        },
        required: ["prompt", "seconds"],
        additionalProperties: false,
      },
    },
    {
      name: "render_video",
      description: "Render the saved storyboard to an MP4 the user can download. Runs in the background; progress shows in the studio. Use draft for quick checks, high for the final, 4k for a 4K master (16:9, 9:16 and 1:1).",
      input_schema: {
        type: "object",
        properties: { quality: { type: "string", enum: ["draft", "standard", "high", "4k"] } },
        required: ["quality"],
        additionalProperties: false,
      },
    },
  ];
}

const ViewInput = z.object({ asset_ids: z.array(z.string()).min(1).max(4) });
const NoteInput = z.object({ asset_id: z.string(), description: z.string().max(300) });
const PlanInput = z.object({ plan: z.unknown() });
const EditInput = z.object({ scene_id: z.string(), changes: z.record(z.string(), z.unknown()).optional(), delete: z.boolean().optional() });
const CustomInput = z.object({ scene_id: z.string(), html: z.string().max(60000) });
const PreviewInput = z.object({ times: z.array(z.number().min(0)).max(8).optional() });
const VoiceInput = z.object({ scene_ids: z.array(z.string()).optional() });
const ClipInput = z.object({ prompt: z.string().min(3).max(1500), seconds: z.number().min(2).max(10), image_asset_id: z.string().optional() });
const RenderInput = z.object({ quality: z.enum(["draft", "standard", "high", "4k"]) });

async function jpegBase64(file: string, width: number): Promise<string> {
  const out = `${file}.${width}.jpg`;
  await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `scale=${width}:-2`, "-q:v", "5", out]);
  const data = (await readFile(out)).toString("base64");
  await rm(out, { force: true });
  return data;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new Error(`invalid input: ${r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  return r.data;
}

export interface ToolOptions {
  /** Send PDFs as document blocks (Claude API). When false, send their text and page images instead (MCP clients). */
  pdfDocuments?: boolean;
}

export async function runTool(studio: Studio, projectId: string, name: string, input: unknown, opts: ToolOptions = {}): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "get_project":
        return { content: json(await studio.snapshotState(projectId)), summary: "Read the project" };

      case "view_assets": {
        const { asset_ids } = parse(ViewInput, input);
        const project = await studio.store.get(projectId);
        const dir = studio.store.dir(projectId);
        const blocks: ResultContent = [];
        for (const id of asset_ids) {
          const a = project.assets.find((x) => x.id === id);
          if (!a) {
            blocks.push({ type: "text", text: `${id}: not found` });
            continue;
          }
          const meta = { id: a.id, kind: a.kind, name: a.name, size: a.width ? `${a.width}x${a.height}` : undefined, seconds: a.duration, hasAudio: a.hasAudio };
          blocks.push({ type: "text", text: json(meta) });
          if (a.kind === "image" || a.kind === "video") {
            const previews = (a.previews ?? []).slice(0, 6);
            for (const [i, p] of previews.entries()) {
              if (a.kind === "video" && a.duration) blocks.push({ type: "text", text: `keyframe at ${(((i + 0.5) * a.duration) / previews.length).toFixed(1)}s` });
              blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(path.join(dir, p))).toString("base64") } });
            }
          } else if (a.kind === "document") {
            if (a.mime === "application/pdf" && a.bytes < 8 * 1024 * 1024 && opts.pdfDocuments !== false) {
              blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: (await readFile(path.join(dir, a.file))).toString("base64") } });
            } else {
              blocks.push({ type: "text", text: (a.text ?? "(no text could be extracted)").slice(0, 20000) });
              for (const [i, p] of (a.previews ?? []).slice(0, 4).entries()) {
                blocks.push({ type: "text", text: `page ${i + 1}` });
                blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(path.join(dir, p))).toString("base64") } });
              }
            }
          }
        }
        return { content: blocks, summary: `Looked at ${asset_ids.length} asset${asset_ids.length > 1 ? "s" : ""}` };
      }

      case "note_asset": {
        const { asset_id, description } = parse(NoteInput, input);
        await studio.describeAsset(projectId, asset_id, description);
        return { content: "saved", summary: `Noted ${asset_id}` };
      }

      case "save_plan": {
        const { plan } = parse(PlanInput, input);
        const r = await studio.savePlan(projectId, plan);
        return {
          content: json(r.ok ? { saved: true, planVersion: r.planVersion, duration: r.duration, timeline: r.timeline, warnings: r.warnings } : { saved: false, errors: r.errors, warnings: r.warnings }),
          isError: !r.ok,
          summary: r.ok ? `Saved storyboard v${r.planVersion} (${r.duration}s, ${r.timeline?.length} scenes)` : `Storyboard rejected: ${r.errors[0] ?? "invalid"}`,
        };
      }

      case "edit_scene": {
        const { scene_id, changes, delete: del } = parse(EditInput, input);
        const r = await studio.editScene(projectId, scene_id, changes ?? {}, del ?? false);
        return {
          content: json(r.ok ? { saved: true, planVersion: r.planVersion, duration: r.duration, warnings: r.warnings } : { saved: false, errors: r.errors }),
          isError: !r.ok,
          summary: r.ok ? `${del ? "Removed" : "Edited"} scene "${scene_id}"` : `Edit rejected: ${r.errors[0] ?? "invalid"}`,
        };
      }

      case "write_custom_scene": {
        const { scene_id, html } = parse(CustomInput, input);
        const r = await studio.writeCustomScene(projectId, scene_id, html);
        return {
          content: json(r.ok ? { saved: true, planVersion: r.planVersion, warnings: r.warnings } : { saved: false, errors: r.errors }),
          isError: !r.ok,
          summary: r.ok ? `Wrote custom scene "${scene_id}"` : `Custom scene rejected: ${r.errors[0] ?? "invalid"}`,
        };
      }

      case "preview": {
        const { times } = parse(PreviewInput, input);
        const frames = await studio.preview(projectId, times);
        const blocks: ResultContent = [];
        for (const f of frames) {
          blocks.push({ type: "text", text: `t=${f.time}s scene=${f.scene}` });
          blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await jpegBase64(f.file, 360) } });
        }
        return { content: blocks, summary: `Previewed ${frames.length} frames` };
      }

      case "generate_voiceover": {
        const { scene_ids } = parse(VoiceInput, input);
        const { report, voiced, adjusted } = await studio.generateVoiceovers(projectId, scene_ids);
        return {
          content: json({ voiced, lengthened: adjusted, saved: report.ok, errors: report.errors, duration: report.duration }),
          isError: !report.ok,
          summary: `Voiced ${voiced.length} scene${voiced.length === 1 ? "" : "s"}`,
        };
      }

      case "generate_clip": {
        const c = parse(ClipInput, input);
        const asset = await studio.generateClip(projectId, c.prompt, c.seconds, c.image_asset_id);
        return { content: json({ asset_id: asset.id, seconds: asset.duration, size: `${asset.width}x${asset.height}` }), summary: `Generated clip ${asset.id}` };
      }

      case "render_video": {
        const { quality } = parse(RenderInput, input);
        const r = await studio.queueRender(projectId, quality);
        return { content: json({ render_id: r.id, status: r.status, note: "Rendering runs in the background; the user sees progress and the download link in the studio." }), summary: `Started a ${quality} render` };
      }

      default:
        return { content: `unknown tool ${name}`, isError: true, summary: `Unknown tool ${name}` };
    }
  } catch (err) {
    const message = (err as Error).message;
    return { content: message, isError: true, summary: `${name} failed: ${message.slice(0, 120)}` };
  }
}
