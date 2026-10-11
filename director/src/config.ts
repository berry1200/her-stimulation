// Runtime configuration, read once from the environment.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, "..");

/** Chromium binaries that are commonly present; the first one found is used when no path is configured. */
const BROWSER_CANDIDATES = [
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Claude model that directs the edit. */
  model: string;
  effort: Effort;
  /** Upper bound on agent iterations per user message (each iteration is one API call). */
  maxAgentSteps: number;
  /** Max upload size per file, in bytes. */
  maxUploadBytes: number;
  /** Chromium used by HyperFrames for previews and renders (empty: let HyperFrames resolve its own). */
  browserPath: string;
  tts: { provider: string; voice: string; command: string; elevenLabsKey: string; elevenLabsModel: string; elevenLabsBaseUrl: string };
  genVideo: { provider: string; command: string };
  /** Make a small frame per scene after each save, for the storyboard strip. */
  thumbnails: boolean;
  /** Allow downloading files from http(s) links. */
  urlImport: boolean;
  /** Allow links to loopback and private network addresses (tests and trusted local setups only). */
  allowPrivateUrls: boolean;
  /** Folders the Claude connector may import from (empty: any non-hidden path). */
  importRoots: string[];
  /** Bearer token required on /mcp; needed when the studio listens on a non-local address. */
  mcpToken: string;
  /** Extra Host header names accepted besides localhost (DNS-rebinding protection). */
  allowedHosts: string[];
}

const list = (value: string): string[] => value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);

export function loadConfig(): Config {
  const effort = env("DIRECTOR_EFFORT", "high") as Effort;
  const browserPath = env("HYPERFRAMES_BROWSER_PATH") || BROWSER_CANDIDATES.find((p) => existsSync(p)) || "";
  return {
    port: intEnv("PORT", 4321),
    host: env("HOST", "127.0.0.1"),
    dataDir: path.resolve(env("DIRECTOR_DATA_DIR", path.join(os.homedir(), "Director"))),
    model: env("DIRECTOR_MODEL", "claude-opus-5-5"),
    effort: EFFORTS.includes(effort) ? effort : "high",
    maxAgentSteps: intEnv("DIRECTOR_MAX_STEPS", 24),
    maxUploadBytes: intEnv("DIRECTOR_MAX_UPLOAD_MB", 512) * 1024 * 1024,
    browserPath,
    tts: {
      provider: env("TTS_PROVIDER", "none"),
      voice: env("TTS_VOICE", "af_heart"),
      command: env("TTS_COMMAND"),
      elevenLabsKey: env("ELEVENLABS_API_KEY"),
      elevenLabsModel: env("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
      elevenLabsBaseUrl: env("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io"),
    },
    genVideo: {
      provider: env("GENVIDEO_PROVIDER", "none"),
      command: env("GENVIDEO_COMMAND"),
    },
    thumbnails: env("DIRECTOR_THUMBNAILS", "on") !== "off",
    urlImport: env("DIRECTOR_URL_IMPORT", "on") !== "off",
    allowPrivateUrls: ["1", "true", "on"].includes(env("DIRECTOR_ALLOW_PRIVATE_URLS").toLowerCase()),
    importRoots: env("DIRECTOR_IMPORT_ROOTS").split(path.delimiter).map((r) => r.trim()).filter(Boolean).map((r) => path.resolve(r.replace(/^~(?=$|[\\/])/, os.homedir()))),
    mcpToken: env("DIRECTOR_MCP_TOKEN"),
    allowedHosts: list(env("DIRECTOR_ALLOWED_HOSTS")).map((h) => h.toLowerCase()),
  };
}

/** Environment for child processes that run HyperFrames (CLI or producer). */
export function hyperframesEnv(config: Config): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(config.browserPath ? { HYPERFRAMES_BROWSER_PATH: config.browserPath } : {}),
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  };
}
