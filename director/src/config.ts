// Runtime configuration, read once from the environment.
import { existsSync } from "node:fs";
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
}

export function loadConfig(): Config {
  const effort = env("DIRECTOR_EFFORT", "high") as Effort;
  const browserPath = env("HYPERFRAMES_BROWSER_PATH") || BROWSER_CANDIDATES.find((p) => existsSync(p)) || "";
  return {
    port: intEnv("PORT", 4321),
    host: env("HOST", "127.0.0.1"),
    dataDir: path.resolve(env("DIRECTOR_DATA_DIR", path.join(APP_ROOT, "data"))),
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
