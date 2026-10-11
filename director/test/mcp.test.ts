// The Claude connector, driven through the official MCP client over stdio (as Claude Code
// and Claude Desktop run it) and over HTTP (a running studio's /mcp endpoint).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { APP_ROOT } from "../src/config.ts";
import { createApp } from "../src/server.ts";
import { makeMedia, tempConfig } from "./helpers.ts";

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
const contentOf = (r: unknown) => ((r as { content?: Content }).content ?? []);
const textOf = (r: unknown) => contentOf(r).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const jsonOf = (r: unknown) => JSON.parse(textOf(r)) as Record<string, any>;

describe("claude connector over stdio", { timeout: 300_000 }, () => {
  let client: Client;
  let media: Record<string, string>;
  let dataDir: string;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "mcp-data-"));
    media = await makeMedia(await mkdtemp(path.join(os.tmpdir(), "mcp-media-")));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, { DIRECTOR_DATA_DIR: dataDir, DIRECTOR_UI: "off", TTS_PROVIDER: "none", GENVIDEO_PROVIDER: "none", DIRECTOR_ALLOW_PRIVATE_URLS: "1" });
    delete env.CLAUDE_PLUGIN_DATA;
    client = new Client({ name: "director-test", version: "1.0.0" });
    // The same launcher the plugin and Claude Desktop config run.
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(APP_ROOT, "scripts", "start-mcp.mjs")], env, stderr: "ignore" }));
  });

  after(async () => {
    await client?.close();
  });

  it("introduces itself and lists every editing tool", async () => {
    assert.match(client.getInstructions() ?? "", /director_guide/);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["director_guide", "list_projects", "create_project", "import_files", "import_from_url", "get_project", "view_assets", "note_asset", "save_plan", "edit_scene", "write_custom_scene", "preview", "generate_voiceover", "generate_clip", "render_video", "render_status", "save_render"]) {
      assert.ok(names.includes(n), n);
    }
    const save = tools.find((t) => t.name === "save_plan")!;
    assert.deepEqual(save.inputSchema.required, ["project_id", "plan"]);
    assert.match(tools.find((t) => t.name === "write_custom_scene")!.description ?? "", /HTML elements only/);
    assert.match(textOf(await client.callTool({ name: "director_guide", arguments: {} })), /Working through the Director connector/);
    const prompt = await client.getPrompt({ name: "make_video", arguments: { brief: "A 15s teaser", format: "1:1" } });
    assert.match(JSON.stringify(prompt.messages), /A 15s teaser/);
  });

  it("creates, imports, plans, previews, renders and delivers a video", async () => {
    const created = jsonOf(await client.callTool({ name: "create_project", arguments: { name: "Connector test", format: "9:16", brief: "Quick teaser" } }));
    const pid = created.project_id as string;
    assert.match(pid, /^p_/);
    assert.equal(created.studio, null); // UI disabled in this test

    // Hidden folders and unsupported files are refused; real media comes in.
    const secretDir = path.join(path.dirname(media.photo!), ".secret");
    await mkdir(secretDir, { recursive: true });
    await writeFile(path.join(secretDir, "keys.txt"), "nope");
    const imported = jsonOf(await client.callTool({ name: "import_files", arguments: { project_id: pid, paths: [media.photo, media.clip, media.notes, path.join(secretDir, "keys.txt"), "relative/file.png"] } }));
    assert.equal(imported.added.length, 3);
    assert.equal(imported.failed.length, 2);
    assert.match(imported.failed[0].error, /hidden/);
    assert.match(imported.failed[1].error, /absolute/);
    const photo = imported.added.find((a: { kind: string }) => a.kind === "image").asset_id;
    const clip = imported.added.find((a: { kind: string }) => a.kind === "video").asset_id;

    // A shot "generated" elsewhere comes in by link, with its note and source kept.
    const cdn = http.createServer(async (req, res) => {
      if (new URL(req.url ?? "/", "http://cdn").pathname === "/gen/shot-001.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(await readFile(media.photo!));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => cdn.listen(0, "127.0.0.1", resolve));
    const cdnBase = `http://127.0.0.1:${(cdn.address() as { port: number }).port}`;
    const linked = jsonOf(await client.callTool({ name: "import_from_url", arguments: { project_id: pid, files: [
      { url: `${cdnBase}/gen/shot-001.png?sig=abc`, note: "AI-generated with Higgsfield: neon city at night" },
      { url: `${cdnBase}/gen/missing.png` },
    ] } }));
    cdn.close();
    assert.equal(linked.added.length, 1, JSON.stringify(linked));
    assert.match(linked.failed[0].error, /HTTP 404/);
    const state = jsonOf(await client.callTool({ name: "get_project", arguments: { project_id: pid } }));
    const shot = state.assets.find((a: { id: string }) => a.id === linked.added[0].asset_id);
    assert.equal(shot.origin, "link");
    assert.equal(shot.source, `${cdnBase}/gen/shot-001.png`); // query string (often an access token) dropped
    assert.match(shot.description, /AI-generated/);

    const viewed = await client.callTool({ name: "view_assets", arguments: { project_id: pid, asset_ids: [photo] } });
    assert.ok(contentOf(viewed).some((c) => c.type === "image" && c.mimeType === "image/jpeg"));

    const plan = {
      title: "Connector cut", format: "9:16", fps: 30,
      style: { palette: { background: "#101014", surface: "#1d1d24", text: "#ffffff", muted: "#b4b4c0", accent: "#8b5cf6" }, fontHeading: "sans", fontBody: "sans" },
      scenes: [
        { id: "hook", kind: "title", duration: 1.5, heading: "Made by Claude", background: { assetId: photo } },
        { id: "clip", kind: "media", duration: 1.5, media: { assetId: clip } },
      ],
    };
    const bad = await client.callTool({ name: "save_plan", arguments: { project_id: pid, plan: { ...plan, scenes: [] } } });
    assert.equal(bad.isError, true);
    const saved = await client.callTool({ name: "save_plan", arguments: { project_id: pid, plan } });
    assert.equal(saved.isError, false, textOf(saved));
    assert.equal(jsonOf(saved).planVersion, 1);

    const frames = await client.callTool({ name: "preview", arguments: { project_id: pid } });
    assert.equal(contentOf(frames).filter((c) => c.type === "image").length, 2);

    const started = jsonOf(await client.callTool({ name: "render_video", arguments: { project_id: pid, quality: "draft" } }));
    let status: Record<string, any> = {};
    for (let i = 0; i < 6 && status.status !== "done" && status.status !== "failed"; i++) {
      status = jsonOf(await client.callTool({ name: "render_status", arguments: { project_id: pid, render_id: started.render_id, wait_seconds: 40 } }));
    }
    assert.equal(status.status, "done", JSON.stringify(status));
    assert.ok(existsSync(status.file));

    const outDir = await mkdtemp(path.join(os.tmpdir(), "mcp-out-"));
    const delivered = jsonOf(await client.callTool({ name: "save_render", arguments: { project_id: pid, render_id: started.render_id, destination: outDir } }));
    assert.ok(existsSync(delivered.saved_to));
    const again = await client.callTool({ name: "save_render", arguments: { project_id: pid, render_id: started.render_id, destination: delivered.saved_to } });
    assert.equal(again.isError, true);
    assert.match(textOf(again), /already exists/);

    const missing = await client.callTool({ name: "get_project", arguments: { project_id: "p_nothere000" } });
    assert.equal(missing.isError, true);
  });
});

describe("claude connector over http", { timeout: 120_000 }, () => {
  let server: ServerType;
  let base: string;

  before(async () => {
    const { app } = await createApp(await tempConfig());
    server = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("serves the same tools at /mcp", async () => {
    const client = new Client({ name: "director-http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "save_plan"));
    const created = jsonOf(await client.callTool({ name: "create_project", arguments: { name: "Over HTTP", format: "16:9" } }));
    assert.equal(created.studio, `${base}/p/${created.project_id}`);
    await client.close();
  });

  it("rejects requests whose Host is not local (DNS rebinding)", async () => {
    // fetch() won't send a custom Host header, so use node:http directly.
    const status = (host: string) =>
      new Promise<number>((resolve, reject) => {
        http.get(`${base}/api/health`, { headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }).on("error", reject);
      });
    assert.equal(await status("evil.example"), 403);
    assert.equal(await status("evil.example:4321"), 403);
    assert.equal(await status(new URL(base).host), 200);
    assert.equal(await status("localhost"), 200);
  });
});
