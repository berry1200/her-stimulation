// Entry point: `npm start`.
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";

const config = loadConfig();
const { app } = await createApp(config);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const claude = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "ready" : "not configured (set ANTHROPIC_API_KEY)";
  console.log(`Director studio running at http://${info.address}:${info.port}`);
  console.log(`  model: ${config.model} (effort ${config.effort}) - Claude API ${claude}`);
  console.log(`  data:  ${config.dataDir}`);
  console.log(`  browser: ${config.browserPath || "managed by HyperFrames"}`);
});
