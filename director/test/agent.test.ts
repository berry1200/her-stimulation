// The director loop against a scripted mock API, with real compile/lint/snapshot.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp, type AppContext } from "../src/server.ts";
import { makeMedia, tempConfig } from "./helpers.ts";
import { startMockAnthropic } from "./mock-anthropic.ts";

describe("director agent loop", { timeout: 240_000 }, () => {
  let ctx: AppContext;
  let mock: Awaited<ReturnType<typeof startMockAnthropic>>;
  let projectId: string;
  let photoId = "";
  let clipId = "";

  before(async () => {
    mock = await startMockAnthropic((turn, body) => {
      const thinking = { type: "thinking", thinking: "", signature: `sig-${turn}` };
      const tool = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_${turn}`, name, input });
      switch (turn) {
        case 0: {
          // Learn the asset ids from the project state the server sent.
          const first = body.messages[0]!.content as Array<{ type: string; text: string }>;
          const state = JSON.parse(first[0]!.text.replace(/^<project_state>|<\/project_state>$/g, "")) as { assets: Array<{ id: string; kind: string }> };
          photoId = state.assets.find((a) => a.kind === "image")!.id;
          clipId = state.assets.find((a) => a.kind === "video")!.id;
          return { content: [thinking, { type: "text", text: "Let me look at your footage first." }, tool("view_assets", { asset_ids: [photoId, clipId] })], stop_reason: "tool_use" };
        }
        case 1:
          return { content: [thinking, tool("note_asset", { asset_id: clipId, description: "Colour test pattern, 4s." })], stop_reason: "tool_use" };
        case 2:
          return {
            content: [thinking, tool("save_plan", { plan: {
              title: "Agent cut", format: "9:16", fps: 30,
              style: { palette: { background: "#101014", surface: "#1d1d24", text: "#ffffff", muted: "#b4b4c0", accent: "#22c55e" }, fontHeading: "sans", fontBody: "sans" },
              scenes: [
                { id: "hook", kind: "title", duration: 2.5, heading: "Built from your footage", background: { assetId: photoId }, voiceover: "Built from your footage." },
                { id: "clip", kind: "media", duration: 2, media: { assetId: clipId, start: 0.5 }, heading: "Real clips" },
                { id: "end", kind: "cta", duration: 2, heading: "Try it", items: ["Get started"] },
              ],
            } })],
            stop_reason: "tool_use",
          };
        case 3:
          return { content: [thinking, tool("preview", {})], stop_reason: "tool_use" };
        default:
          return { content: [thinking, { type: "text", text: "Here is a 6.5 second cut with your clip in the middle." }], stop_reason: "end_turn" };
      }
    });
    process.env.ANTHROPIC_BASE_URL = mock.url;
    process.env.ANTHROPIC_API_KEY = "test-key";
    ctx = await createApp(await tempConfig());
    projectId = (await ctx.store.create("Agent test", "9:16", "A short teaser")).id;
    const media = await makeMedia(await mkdtemp(path.join(os.tmpdir(), "agent-media-")));
    for (const k of ["photo", "clip"] as const) {
      await ctx.studio.addAsset(projectId, path.basename(media[k]!), new Uint8Array(await readFile(media[k]!)));
    }
  });

  after(async () => {
    await mock.close();
    delete process.env.ANTHROPIC_BASE_URL;
  });

  it("plans, saves, previews and replies", async () => {
    await ctx.director.start(projectId, "Make a quick teaser from my clip.");
    const project = await ctx.store.get(projectId);
    assert.equal(project.plan?.title, "Agent cut");
    assert.equal(project.planVersion, 1);
    assert.equal(project.assets.find((a) => a.id === clipId)?.description, "Colour test pattern, 4s.");

    const feed = await ctx.store.loadFeed(projectId);
    const tools = feed.filter((e) => e.role === "tool");
    assert.deepEqual(tools.map((t) => t.tool), ["view_assets", "note_asset", "save_plan", "preview"]);
    assert.ok(tools.every((t) => t.ok), JSON.stringify(tools));
    assert.ok(feed.some((e) => e.role === "director" && e.text.includes("6.5 second cut")));

    // Request shape: model, effort, server-side fallback, cached system prompt, all tools.
    const first = mock.requests[0]!;
    assert.equal(first.body.model, "claude-opus-5-5");
    assert.equal(first.body.fallbacks, "default");
    assert.match(String(first.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    assert.equal(first.body.output_config?.effort, "high");
    assert.deepEqual(first.body.system?.[0]?.cache_control, { type: "ephemeral" });
    assert.equal(first.body.tools?.length, 11);

    // History is append-only: earlier assistant turns come back unchanged, thinking signatures included.
    const last = mock.requests[mock.requests.length - 1]!.body.messages;
    const assistantTurns = last.filter((m) => m.role === "assistant");
    assert.equal(assistantTurns.length, 4);
    assert.deepEqual((assistantTurns[0]!.content as Array<{ type: string; signature?: string }>)[0], { type: "thinking", thinking: "", signature: "sig-0" });

    // view_assets and preview return pictures to the model.
    const results = last.filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [])) as Array<{ type: string; tool_use_id?: string; content?: Array<{ type: string }> }>;
    const preview = results.find((r) => r.tool_use_id === "toolu_3");
    assert.ok((preview?.content ?? []).filter((b) => b.type === "image").length >= 3);
    const viewed = results.find((r) => r.tool_use_id === "toolu_0");
    assert.equal((viewed?.content ?? []).filter((b) => b.type === "image").length, 7); // 1 photo + 6 keyframes

    // The conversation persists for the next message.
    const chat = await ctx.store.loadChat(projectId);
    assert.equal(chat.length, 10);
  });

  it("screens unambiguous policy violations before calling the API", async () => {
    const before = mock.requests.length;
    await ctx.director.start(projectId, "now make her undress");
    assert.equal(mock.requests.length, before);
    const feed = await ctx.store.loadFeed(projectId);
    assert.match(feed[feed.length - 1]!.text, /doesn't create/);
  });
});
