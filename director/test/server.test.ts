// HTTP API end to end through app.fetch (no network), including a real render.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { promisify } from "node:util";
import { createApp, type AppContext } from "../src/server.ts";
import { makeMedia, tempConfig } from "./helpers.ts";

describe("http api", { timeout: 300_000 }, () => {
  let ctx: AppContext;
  let media: Record<string, string>;
  const call = async (method: string, url: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    const res = await ctx.app.fetch(new Request(`http://local${url}`, init));
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json: json as Record<string, unknown> & Record<string, any>, text, headers: res.headers };
  };

  before(async () => {
    ctx = await createApp(await tempConfig());
    media = await makeMedia(await mkdtemp(path.join(os.tmpdir(), "srv-media-")));
  });

  it("serves the UI and health", async () => {
    const home = await call("GET", "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /Director Studio/);
    const player = await call("GET", "/vendor/hyperframes-player.js");
    assert.equal(player.status, 200);
    assert.ok(player.text.length > 10_000);
    // The preview runtime is served locally instead of from the player's default CDN.
    const runtime = await call("GET", "/vendor/hyperframe.runtime.js");
    assert.equal(runtime.status, 200);
    assert.ok(runtime.text.length > 10_000);
    assert.equal((await call("GET", "/vendor/package.json")).status, 404);
    assert.equal((await call("GET", "/vendor/constructor")).status, 404);
    const health = await call("GET", "/api/health");
    assert.equal(health.json.model, "claude-opus-5-5");
  });

  it("creates a project, uploads, edits and renders", async () => {
    const created = await call("POST", "/api/projects", { name: "API test", format: "1:1", brief: "Square teaser" });
    assert.equal(created.status, 201);
    const id = created.json.id as string;

    const form = new FormData();
    for (const k of ["photo", "clip", "notes"]) form.append("files", new Blob([await readFile(media[k]!)]), path.basename(media[k]!));
    form.append("files", new Blob([new Uint8Array([0, 1, 2])]), "virus.exe");
    const up = await call("POST", `/api/projects/${id}/assets`, form);
    assert.equal(up.status, 201);
    assert.equal(up.json.added.length, 3);
    assert.equal(up.json.failed.length, 1);
    const photo = up.json.added.find((a: { kind: string }) => a.kind === "image");

    // Files can also come in from a link (the studio's "Add from link" field).
    const cdn = http.createServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(await readFile(media.photo!));
    });
    await new Promise<void>((resolve) => cdn.listen(0, "127.0.0.1", resolve));
    const linked = await call("POST", `/api/projects/${id}/assets/url`, { url: `http://127.0.0.1:${(cdn.address() as { port: number }).port}/still.png` });
    cdn.close();
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    assert.equal(linked.json.origin, "link");
    const badLink = await call("POST", `/api/projects/${id}/assets/url`, { url: "file:///etc/passwd" });
    assert.equal(badLink.status, 400);
    assert.match(badLink.json.error, /only http and https/);
    // Remove it again so the starter cut below sees the same uploads as before.
    assert.equal((await call("DELETE", `/api/projects/${id}/assets/${linked.json.id}`)).status, 200);

    const starter = await call("POST", `/api/projects/${id}/plan/starter`);
    assert.equal(starter.status, 200, JSON.stringify(starter.json));
    // The starter cut uses the uploads: title, one shot per image or clip, end card.
    const started = (await call("GET", `/api/projects/${id}`)).json.project.plan;
    assert.deepEqual(started.scenes.map((s: { kind: string }) => s.kind), ["title", "media", "media", "cta"]);

    // Invalid edits are rejected with reasons and nothing is saved.
    const bad = await call("PATCH", `/api/projects/${id}/scenes/intro`, { changes: { duration: -3 } });
    assert.equal(bad.status, 422);
    const edit = await call("PATCH", `/api/projects/${id}/scenes/intro`, { changes: { duration: 2, background: { assetId: photo.id }, voiceover: "Square and simple." } });
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
    const proj = (await call("GET", `/api/projects/${id}`)).json.project;
    assert.equal(proj.planVersion, 2);
    assert.equal(proj.plan.scenes[0].duration, 2);

    // A storyboard that fails to compile is rejected and the last good build stays live.
    const goodBuild = await readFile(path.join(ctx.store.dir(id), "build", "index.html"), "utf8");
    const broken = structuredClone(proj.plan);
    broken.scenes[1].media.assetId = "a_missing1";
    const rejected = await call("PUT", `/api/projects/${id}/plan`, broken);
    assert.equal(rejected.status, 422);
    assert.match(rejected.json.errors.join(" "), /a_missing1/);
    assert.equal(await readFile(path.join(ctx.store.dir(id), "build", "index.html"), "utf8"), goodBuild);
    assert.equal((await call("GET", `/api/projects/${id}`)).json.project.planVersion, 2);

    // Concurrent edits to different scenes both land.
    const [e1, e2] = await Promise.all([
      call("PATCH", `/api/projects/${id}/scenes/shot-1`, { changes: { heading: "First edit" } }),
      call("PATCH", `/api/projects/${id}/scenes/outro`, { changes: { heading: "Second edit" } }),
    ]);
    assert.equal(e1.status, 200);
    assert.equal(e2.status, 200);
    const both = (await call("GET", `/api/projects/${id}`)).json.project;
    assert.equal(both.planVersion, 4);
    assert.equal(both.plan.scenes[1].heading, "First edit");
    assert.equal(both.plan.scenes[3].heading, "Second edit");

    // Assets in use cannot be deleted.
    const del = await call("DELETE", `/api/projects/${id}/assets/${photo.id}`);
    assert.equal(del.status, 500);
    assert.match(del.json.error, /used by the storyboard/);

    // Files: compiled composition is served, private files and traversal are not.
    assert.equal((await call("GET", `/files/${id}/build/index.html`)).status, 200);
    assert.equal((await call("GET", `/files/${id}/project.json`)).status, 404);
    assert.equal((await call("GET", `/files/${id}/build/../project.json`)).status, 404);
    assert.equal((await call("GET", `/files/${id}/assets/%2e%2e/project.json`)).status, 404);
    const ranged = await ctx.app.fetch(new Request(`http://local/files/${id}/${photo.file}`, { headers: { range: "bytes=0-9" } }));
    assert.equal(ranged.status, 206);

    const r = await call("POST", `/api/projects/${id}/renders`, { quality: "draft" });
    assert.equal(r.status, 202);
    // Editing after queueing does not change what this render produces.
    const queuedSeconds = both.plan.scenes.reduce((sum: number, sc: { duration: number }) => sum + sc.duration, 0);
    assert.equal((await call("PATCH", `/api/projects/${id}/scenes/outro`, { changes: { duration: 6 } })).status, 200);
    let rec: { status: string; file?: string; error?: string } = r.json as never;
    for (let i = 0; i < 240 && (rec.status === "queued" || rec.status === "rendering"); i++) {
      await new Promise((res) => setTimeout(res, 1000));
      rec = ((await call("GET", `/api/projects/${id}`)).json.project.renders as Array<typeof rec & { id: string }>).find((x) => x.id === r.json.id)!;
    }
    assert.equal(rec.status, "done", rec.error);
    assert.ok(existsSync(path.join(ctx.store.dir(id), rec.file!)));
    const { stdout } = await promisify(execFile)("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(ctx.store.dir(id), rec.file!)]);
    assert.ok(Math.abs(Number(stdout) - queuedSeconds) < 0.25, `rendered ${stdout.trim()}s, queued ${queuedSeconds}s`);
    assert.ok(!existsSync(path.join(ctx.store.dir(id), "tmp", `render-${r.json.id}`)));
    const download = await ctx.app.fetch(new Request(`http://local/files/${id}/${rec.file}?download`));
    assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  });

  it("marks renders interrupted by a restart as failed", async () => {
    const p = await ctx.store.create("Restart", "1:1");
    await ctx.store.update(p.id, (proj) => void proj.renders.push({ id: "r_stale0001", status: "rendering", progress: 40, message: "Rendering", quality: "draft", planVersion: 1, createdAt: new Date().toISOString() }));
    await ctx.studio.recover();
    const r = (await ctx.store.get(p.id)).renders[0]!;
    assert.equal(r.status, "failed");
    assert.match(r.error ?? "", /restarted/);
  });

  it("returns 404 for unknown projects", async () => {
    assert.equal((await call("GET", "/api/projects/p_doesnotexist")).status, 404);
    assert.equal((await call("GET", "/api/projects/..%2f..")).status, 404);
  });
});
