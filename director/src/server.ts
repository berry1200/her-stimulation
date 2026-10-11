// HTTP API + static UI. Single-user and local by default (binds 127.0.0.1).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { Director, DirectorBusyError } from "./agent/director.ts";
import { APP_ROOT, type Config } from "./config.ts";
import { EventBus, type DirectorEvent } from "./events.ts";
import { supportedExtensions } from "./ingest/ingest.ts";
import { createConnector } from "./mcp/server.ts";
import { DEFAULT_STYLE, FORMATS, type Plan, type Scene } from "./plan/schema.ts";
import { ProjectStore } from "./store/projects.ts";
import { Studio } from "./studio.ts";

const FormatSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
const CreateSchema = z.object({ name: z.string().max(120).default("Untitled video"), format: FormatSchema.default("9:16"), brief: z.string().max(4000).default("") });
const PatchSchema = z.object({ name: z.string().max(120).optional(), brief: z.string().max(4000).optional(), format: FormatSchema.optional() });
const ChatSchema = z.object({ message: z.string().min(1).max(8000) });
const LinkSchema = z.object({ url: z.string().min(1).max(4000), note: z.string().max(300).optional() });
const RenderSchema = z.object({ quality: z.enum(["draft", "standard", "high", "4k"]).default("standard") });
/** Only these project sub-folders are served over HTTP. */
const SERVED_DIRS = new Set(["assets", "previews", "renders", "build"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Host name from a Host header ("[::1]:4321" -> "::1"). */
function hostName(header: string | undefined): string {
  if (!header) return "";
  const h = header.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.replace(/:\d+$/, "");
}

export interface AppContext {
  app: Hono;
  store: ProjectStore;
  studio: Studio;
  director: Director;
  bus: EventBus;
}

export async function createApp(config: Config): Promise<AppContext> {
  const store = new ProjectStore(config.dataDir);
  await store.init();
  const bus = new EventBus();
  const studio = new Studio(config, store, bus);
  await studio.recover();
  const director = new Director(studio, config);
  const app = new Hono();

  app.onError((err, c) => {
    const status = err instanceof DirectorBusyError ? 409 : 500;
    return c.json({ error: err.message }, status);
  });

  // DNS-rebinding protection: while the studio listens on a loopback address, a web page
  // that points its own domain at 127.0.0.1 must not be able to drive the API.
  const localOnly = LOOPBACK.has(hostName(config.host));
  app.use("*", async (c, next) => {
    const host = hostName(c.req.header("host"));
    if (localOnly && host && !LOOPBACK.has(host) && !config.allowedHosts.includes(host)) return c.text("Forbidden host", 403);
    return next();
  });

  const projectId = async (c: Context): Promise<string> => {
    const id = c.req.param("id") ?? "";
    if (!(await store.exists(id))) throw Object.assign(new Error("project not found"), { status: 404 });
    return id;
  };
  const guard = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    try {
      return await handler(c);
    } catch (err) {
      const status = (err as { status?: number }).status ?? (err instanceof DirectorBusyError ? 409 : err instanceof z.ZodError ? 400 : 500);
      const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (err as Error).message;
      return c.json({ error: message }, status as 400 | 404 | 409 | 500);
    }
  };

  // ── Health / configuration ──
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      model: config.model,
      effort: config.effort,
      claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      browser: config.browserPath || "managed by HyperFrames",
      voice: studio.tts.ready ? studio.tts.id : null,
      voiceReason: studio.tts.ready ? undefined : studio.tts.reason,
      videoGeneration: studio.genVideo.ready ? studio.genVideo.id : null,
      formats: Object.keys(FORMATS),
      uploadTypes: supportedExtensions(),
      maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
    }),
  );

  // ── Projects ──
  app.get("/api/projects", guard(async (c) => c.json((await store.list()).map((p) => {
    const first = p.plan?.scenes[0]?.id;
    const cover = first ? p.thumbs?.files[first] : undefined;
    const seconds = p.plan ? p.plan.scenes.reduce((sum, s) => sum + s.duration, 0) : 0;
    return { id: p.id, name: p.name, format: p.format, updatedAt: p.updatedAt, scenes: p.plan?.scenes.length ?? 0, assets: p.assets.length, seconds, cover: cover ? `/files/${p.id}/${cover}` : null };
  }))));

  app.post("/api/projects", guard(async (c) => {
    const body = CreateSchema.parse(await c.req.json().catch(() => ({})));
    const p = await store.create(body.name, body.format, body.brief);
    return c.json(p, 201);
  }));

  app.get("/api/projects/:id", guard(async (c) => {
    const id = await projectId(c);
    const [project, feed] = await Promise.all([store.get(id), store.loadFeed(id)]);
    return c.json({ project, feed, agentRunning: director.isRunning(id) });
  }));

  app.patch("/api/projects/:id", guard(async (c) => {
    const id = await projectId(c);
    const body = PatchSchema.parse(await c.req.json());
    const p = await store.update(id, (proj) => {
      if (body.name !== undefined) proj.name = body.name.trim() || proj.name;
      if (body.brief !== undefined) proj.brief = body.brief;
      if (body.format !== undefined) proj.format = body.format;
    });
    // A format change must reach the storyboard too.
    if (body.format && p.plan && p.plan.format !== body.format) await studio.savePlan(id, { ...p.plan, format: body.format });
    return c.json(await store.get(id));
  }));

  app.delete("/api/projects/:id", guard(async (c) => {
    const id = await projectId(c);
    if (director.isRunning(id)) throw new DirectorBusyError("the director is working on this project");
    await store.remove(id);
    return c.json({ ok: true });
  }));

  // ── Assets ──
  app.post(
    "/api/projects/:id/assets",
    bodyLimit({ maxSize: config.maxUploadBytes * 4, onError: (c) => c.json({ error: `upload too large (limit ${Math.round(config.maxUploadBytes / 1048576)} MB per file)` }, 413) }),
    guard(async (c) => {
      const id = await projectId(c);
      const body = await c.req.parseBody({ all: true });
      const raw = body["files"] ?? body["file"];
      const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
      if (!files.length) return c.json({ error: 'send files as multipart field "files"' }, 400);
      const added = [];
      const failed: Array<{ name: string; error: string }> = [];
      for (const f of files) {
        if (f.size > config.maxUploadBytes) {
          failed.push({ name: f.name, error: "file too large" });
          continue;
        }
        try {
          added.push(await studio.addAsset(id, f.name, new Uint8Array(await f.arrayBuffer())));
        } catch (err) {
          failed.push({ name: f.name, error: (err as Error).message });
        }
      }
      if (added.length) await studio.feed(id, { role: "user", text: `Uploaded ${added.map((a) => a.name).join(", ")}` });
      return c.json({ added, failed }, added.length ? 201 : 400);
    }),
  );

  app.post("/api/projects/:id/assets/url", guard(async (c) => {
    const id = await projectId(c);
    const body = LinkSchema.parse(await c.req.json().catch(() => ({})));
    try {
      const asset = await studio.importFromUrl(id, body.url, { note: body.note });
      await studio.feed(id, { role: "user", text: `Added ${asset.name} from a link` });
      return c.json(asset, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }));

  app.delete("/api/projects/:id/assets/:assetId", guard(async (c) => {
    const id = await projectId(c);
    await studio.removeAsset(id, c.req.param("assetId") ?? "");
    return c.json({ ok: true });
  }));

  // ── Storyboard ──
  app.put("/api/projects/:id/plan", guard(async (c) => {
    const id = await projectId(c);
    const report = await studio.savePlan(id, await c.req.json());
    return c.json(report, report.ok ? 200 : 422);
  }));

  /** Start an empty storyboard by hand (no AI needed). */
  app.post("/api/projects/:id/plan/starter", guard(async (c) => {
    const id = await projectId(c);
    const p = await store.get(id);
    // A first cut from what was uploaded: title card, one shot per image or clip (up to 4), end card.
    const shots = p.assets.filter((a) => a.kind === "image" || a.kind === "video").slice(0, 4);
    const plan: Plan = {
      title: p.name,
      format: p.format,
      fps: 30,
      style: DEFAULT_STYLE,
      scenes: [
        { id: "intro", kind: "title", duration: 3, heading: p.name, body: p.brief.slice(0, 140) || undefined },
        ...shots.map((a, i): Scene => ({
          id: `shot-${i + 1}`,
          kind: "media",
          duration: a.kind === "video" ? Math.min(6, Math.max(2, Math.round(a.duration ?? 3))) : 3,
          media: { assetId: a.id },
        })),
        { id: "outro", kind: "cta", duration: 3, heading: "Thanks for watching" },
      ],
    };
    const report = await studio.savePlan(id, plan);
    return c.json(report, report.ok ? 200 : 422);
  }));

  app.patch("/api/projects/:id/scenes/:sceneId", guard(async (c) => {
    const id = await projectId(c);
    const body = (await c.req.json()) as { changes?: Record<string, unknown>; delete?: boolean };
    const report = await studio.editScene(id, c.req.param("sceneId") ?? "", body.changes ?? {}, body.delete ?? false);
    return c.json(report, report.ok ? 200 : 422);
  }));

  app.post("/api/projects/:id/build", guard(async (c) => {
    const id = await projectId(c);
    const report = await studio.rebuild(id);
    return c.json(report, report.ok ? 200 : 422);
  }));

  // ── Director ──
  app.post("/api/projects/:id/chat", guard(async (c) => {
    const id = await projectId(c);
    const { message } = ChatSchema.parse(await c.req.json());
    void director.start(id, message).catch(async (err) => {
      await studio.feed(id, { role: "system", text: `Director stopped: ${(err as Error).message}`, ok: false });
    });
    return c.json({ accepted: true }, 202);
  }));

  // ── Renders ──
  app.post("/api/projects/:id/renders", guard(async (c) => {
    const id = await projectId(c);
    const { quality } = RenderSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await studio.queueRender(id, quality), 202);
  }));

  app.delete("/api/projects/:id/renders/:renderId", guard(async (c) => {
    await projectId(c);
    return c.json({ cancelled: studio.cancelRender(c.req.param("renderId") ?? "") });
  }));

  // ── Live events (SSE) ──
  app.get("/api/projects/:id/events", guard(async (c) => {
    const id = await projectId(c);
    return streamSSE(c, async (stream) => {
      const queue: DirectorEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe(id, (e) => {
        queue.push(e);
        wake?.();
      });
      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ agentRunning: director.isRunning(id) }) });
      while (open) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 15_000);
          });
          wake = null;
          if (!queue.length && open) await stream.writeSSE({ event: "ping", data: "{}" });
          continue;
        }
        const e = queue.shift()!;
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      }
    });
  }));

  // ── Project files (media, previews, renders, compiled composition) ──
  const filesRoot = path.join(config.dataDir, "projects");
  app.use("/files/:id/*", async (c, next) => {
    const id = c.req.param("id") ?? "";
    const rest = c.req.path.slice(`/files/${id}/`.length);
    const segments = rest.split("/");
    if (!(await store.exists(id)) || !SERVED_DIRS.has(segments[0] ?? "") || segments.some((s) => s === ".." || s === "" || s.startsWith("."))) {
      return c.json({ error: "not found" }, 404);
    }
    if (segments[0] === "build") c.header("Cache-Control", "no-store");
    if (segments[0] === "renders" && c.req.query("download") !== undefined) {
      c.header("Content-Disposition", `attachment; filename="${segments[segments.length - 1]}"`);
    }
    return next();
  });
  app.use("/files/*", serveStatic({ root: filesRoot, rewriteRequestPath: (p) => p.replace(/^\/files/, "") }));

  // ── Claude connector over HTTP (MCP streamable HTTP, stateless) ──
  // Local clients such as Claude Code can connect to a running studio at /mcp. On a
  // non-local address a bearer token (DIRECTOR_MCP_TOKEN) is mandatory.
  app.all("/mcp", async (c) => {
    if (!localOnly && !config.mcpToken) return c.json({ error: "set DIRECTOR_MCP_TOKEN to use /mcp on a non-local address" }, 403);
    if (config.mcpToken && c.req.header("authorization") !== `Bearer ${config.mcpToken}`) return c.json({ error: "unauthorized" }, 401);
    const origin = new URL(c.req.url).origin;
    const server = createConnector({ studio, config, studioUrl: (id) => (id ? `${origin}/p/${id}` : origin) });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });

  // ── UI ──
  const webRoot = path.join(APP_ROOT, "web");
  // The player and the runtime it injects into previews are served locally, so the
  // studio works offline (the player's default runtime URL points at a CDN).
  const vendor: Record<string, string> = {
    "hyperframes-player.js": path.join(APP_ROOT, "node_modules", "@hyperframes", "player", "dist", "hyperframes-player.global.js"),
    "hyperframe.runtime.js": path.join(APP_ROOT, "node_modules", "@hyperframes", "core", "dist", "hyperframe.runtime.iife.js"),
  };
  app.get("/vendor/:file", async (c) => {
    const name = c.req.param("file") ?? "";
    if (!Object.hasOwn(vendor, name)) return c.notFound();
    const file = vendor[name]!;
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(await readFile(file, "utf8"));
  });
  app.use("/static/*", serveStatic({ root: webRoot, rewriteRequestPath: (p) => p.replace(/^\/static/, "") }));
  app.get("/", async (c) => c.html(await readFile(path.join(webRoot, "index.html"), "utf8")));
  app.get("/p/:id", async (c) => c.html(await readFile(path.join(webRoot, "index.html"), "utf8")));

  return { app, store, studio, director, bus };
}
