// Director as a Claude connector: an MCP server over stdio for Claude Code, Claude Desktop
// and other MCP clients (`npm run mcp`). It also serves the studio UI in the same process,
// so the live preview updates as Claude edits. stdout carries the protocol; logs go to stderr.
import { spawnSync } from "node:child_process";
import { serve, type ServerType } from "@hono/node-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { createConnector } from "./mcp/server.ts";
import { createApp } from "./server.ts";

console.log = console.error;
console.info = console.error;

/** Listen on the first free port from `port` upwards; null if none of the next 10 is free. */
async function listen(app: Hono, host: string, port: number): Promise<{ server: ServerType; port: number } | null> {
  for (let p = port; p < port + 10; p++) {
    const server = await new Promise<ServerType | null>((resolve) => {
      const s = serve({ fetch: app.fetch, port: p, hostname: host }, () => resolve(s));
      s.once("error", () => resolve(null));
    });
    if (server) return { server, port: p };
  }
  return null;
}

const config = loadConfig();
const { app, studio } = await createApp(config);

let base: string | null = null;
if (process.env.DIRECTOR_UI !== "off") {
  const ui = await listen(app, config.host, config.port);
  if (ui) base = `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${ui.port}`;
  else console.error(`Director: ports ${config.port}-${config.port + 9} are busy, so the studio UI is not running`);
}

const setupNotes: string[] = [];
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
  setupNotes.push("FFmpeg is not installed, so media import, previews and renders will fail. Install it (macOS: brew install ffmpeg; Windows: winget install ffmpeg; Linux: the package manager) and restart the connector.");
}
if (!base && process.env.DIRECTOR_UI !== "off") setupNotes.push(`The studio page could not start because ports ${config.port}-${config.port + 9} are busy; there is no live preview link.`);

const connector = createConnector({ studio, config, setupNotes, studioUrl: (id) => (base ? (id ? `${base}/p/${id}` : base) : null) });
const transport = new StdioServerTransport();
transport.onclose = () => process.exit(0);
process.stdin.on("end", () => process.exit(0));
await connector.connect(transport);
console.error(`Director connector ready (data: ${config.dataDir}${base ? `, studio: ${base}` : ""})`);
