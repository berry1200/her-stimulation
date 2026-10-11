#!/usr/bin/env node
// Launches the Director connector for Claude (MCP over stdio). Dependency-free on purpose:
// it runs before anything is installed.
//
//   node scripts/start-mcp.mjs            start the connector (what Claude runs)
//   node scripts/start-mcp.mjs --install  install dependencies and a render browser, then exit
//
// In a git checkout with `npm install` done, it runs straight from the checkout. Installed as a
// Claude Code plugin, the code arrives without node_modules in CLAUDE_PLUGIN_ROOT (replaced on
// every update), so the app is copied to CLAUDE_PLUGIN_DATA and its dependencies are installed
// there once per lockfile. A first start without dependencies begins that install in the
// background and exits with a message, because it takes longer than a client waits for a server.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const installOnly = process.argv.includes("--install");
const log = (...args) => console.error("[director]", ...args);

const checkout = existsSync(path.join(root, "node_modules", "tsx")) || !pluginData;
const app = checkout ? root : path.join(pluginData, "app");
const lockHash = createHash("sha256").update(readFileSync(path.join(root, "package-lock.json"))).digest("hex").slice(0, 16);
const stampFile = path.join(app, "node_modules", ".director-install");
const ready = () => existsSync(path.join(app, "node_modules", "tsx")) && (checkout || (existsSync(stampFile) && readFileSync(stampFile, "utf8") === lockHash));

/** Copy the app (not its dependencies) from the plugin root into the runtime folder. */
function syncApp() {
  if (checkout) return;
  mkdirSync(app, { recursive: true });
  for (const entry of ["src", "web", "scripts"]) {
    rmSync(path.join(app, entry), { recursive: true, force: true });
    cpSync(path.join(root, entry), path.join(app, entry), { recursive: true });
  }
  for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) cpSync(path.join(root, file), path.join(app, file));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: app, stdio: ["ignore", process.stderr, process.stderr], shell: process.platform === "win32", ...opts });
  return r.status === 0;
}

function install() {
  syncApp();
  if (!ready()) {
    log(`installing dependencies in ${app} (one time, a minute or two)...`);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    if (!run(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], { env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1" } })) {
      log("npm ci failed; see the output above");
      process.exit(1);
    }
    if (!checkout) writeFileSync(stampFile, lockHash);
  }
  log("checking the browser HyperFrames renders with...");
  if (!process.env.HYPERFRAMES_BROWSER_PATH && !run(process.execPath, [path.join(app, "node_modules", "hyperframes", "bin", "hyperframes.mjs"), "browser", "ensure"], { env: { ...process.env, HYPERFRAMES_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } })) {
    log("could not download a browser; set HYPERFRAMES_BROWSER_PATH to Chrome or Chromium");
  }
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
    log("FFmpeg was not found. Install it (macOS: brew install ffmpeg; Windows: winget install ffmpeg; Linux: your package manager).");
  }
  log("ready");
}

if (installOnly) {
  install();
  process.exit(0);
}

if (!ready()) {
  if (checkout) {
    log(`dependencies are missing; run "npm install" in ${root}`);
    process.exit(1);
  }
  // Start the install in the background, once, and tell the user to reconnect afterwards.
  mkdirSync(pluginData, { recursive: true });
  const lock = path.join(pluginData, "install.lock");
  const logFile = path.join(pluginData, "install.log");
  const running = existsSync(lock) && (() => {
    try {
      process.kill(Number(readFileSync(lock, "utf8")), 0);
      return true;
    } catch {
      return false;
    }
  })();
  if (!running) {
    const out = openSync(logFile, "w");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--install"], { detached: true, stdio: ["ignore", out, out], env: process.env });
    writeFileSync(lock, String(child.pid));
    child.unref();
  }
  log(`Director is installing its dependencies (first run, about 1-3 minutes). Reconnect the "director" MCP server when it finishes (in Claude Code: /mcp). Progress: ${logFile}`);
  process.exit(1);
}

syncApp();
const child = spawn(process.execPath, ["--import", "tsx", path.join(app, "src", "mcp.ts")], { cwd: app, stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
