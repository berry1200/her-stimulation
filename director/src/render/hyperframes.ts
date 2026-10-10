// HyperFrames CLI wrapper. Lint, snapshot and render run as child processes so a
// browser crash cannot take the server down and long renders can be cancelled.
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, hyperframesEnv, type Config } from "../config.ts";

const CLI = path.join(APP_ROOT, "node_modules", "hyperframes", "bin", "hyperframes.mjs");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(config: Config, args: string[], cwd: string, opts: { timeoutMs?: number; onLine?: (line: string) => void; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: hyperframesEnv(config), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buffered = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const onData = (chunk: Buffer, sink: "out" | "err") => {
      const text = chunk.toString();
      if (sink === "out") stdout += text;
      else stderr += text;
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
      if (opts.onLine) {
        buffered += text;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? "";
        for (const l of lines) opts.onLine(l);
      }
    };
    child.stdout.on("data", (c: Buffer) => onData(c, "out"));
    child.stderr.on("data", (c: Buffer) => onData(c, "err"));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export interface LintFinding {
  severity: string;
  code: string;
  message: string;
  file?: string;
}

export async function lint(config: Config, buildDir: string): Promise<{ ok: boolean; errors: LintFinding[]; warnings: LintFinding[] }> {
  const r = await runCli(config, ["lint", "--json"], buildDir, { timeoutMs: 120_000 });
  try {
    const json = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as { ok: boolean; findings: LintFinding[] };
    const pick = (sev: string) => json.findings.filter((f) => f.severity === sev).map((f) => ({ ...f, file: f.file ? path.basename(f.file) : undefined }));
    return { ok: json.ok, errors: pick("error"), warnings: pick("warning") };
  } catch {
    return { ok: false, errors: [{ severity: "error", code: "lint_failed", message: (r.stderr || r.stdout).slice(-800) }], warnings: [] };
  }
}

/** Capture frames at the given times (seconds) without a full render. Returns PNG paths in time order. */
export async function snapshot(config: Config, buildDir: string, times: number[], outDir: string): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const at = times.map((t) => Math.max(0, t).toFixed(2)).join(",");
  const r = await runCli(config, ["snapshot", buildDir, "--at", at, "--no-end", "--output", outDir], buildDir, { timeoutMs: 180_000 });
  const files = (await readdir(outDir)).filter((f) => /^frame-\d+.*\.png$/.test(f)).sort();
  if (!files.length) throw new Error(`snapshot failed: ${(r.stderr || r.stdout).slice(-600)}`);
  return files.map((f) => path.join(outDir, f));
}

export interface RenderOptions {
  quality: "draft" | "standard" | "high";
  onProgress?: (pct: number, message: string) => void;
  signal?: AbortSignal;
}

/** Render the project in `buildDir` to `outFile` (MP4). */
export async function render(config: Config, buildDir: string, outFile: string, opts: RenderOptions): Promise<void> {
  const r = await runCli(config, ["render", "--output", outFile, "--quality", opts.quality], buildDir, {
    timeoutMs: 2 * 60 * 60 * 1000,
    signal: opts.signal,
    onLine: (line) => {
      const m = line.match(/^@hf-progress\s+(\{.*\})/);
      if (!m?.[1] || !opts.onProgress) return;
      try {
        const p = JSON.parse(m[1]) as { pct?: number; code?: string; done?: number; total?: number };
        const label = p.code === "capture" ? `Capturing frames ${p.done ?? ""}/${p.total ?? ""}` : p.code ? p.code[0]!.toUpperCase() + p.code.slice(1) : "Rendering";
        opts.onProgress(Math.max(0, Math.min(100, p.pct ?? 0)), label);
      } catch {
        // Ignore malformed progress lines.
      }
    },
  });
  if (opts.signal?.aborted) throw new Error("render cancelled");
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout).split("\n").filter((l) => !l.includes("Render:trace")).slice(-15).join("\n");
    throw new Error(`render failed (exit ${r.code}): ${tail.slice(-1500)}`);
  }
}

export async function tts(config: Config, text: string, voice: string, outFile: string, cwd: string): Promise<void> {
  const r = await runCli(config, ["tts", text, "--voice", voice, "--output", outFile], cwd, { timeoutMs: 10 * 60 * 1000 });
  if (r.code !== 0) throw new Error(`hyperframes tts failed: ${(r.stderr || r.stdout).slice(-800)}`);
}
