// Shared test fixtures: temp data dirs and small generated media files.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig, type Config } from "../src/config.ts";

const run = promisify(execFile);

export async function tempConfig(): Promise<Config> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "director-test-"));
  return { ...loadConfig(), dataDir: dir, tts: { ...loadConfig().tts, provider: "none" }, genVideo: { provider: "none", command: "" } };
}

export async function makeMedia(dir: string): Promise<Record<string, string>> {
  const f = (n: string) => path.join(dir, n);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "gradients=s=800x600:c0=0x223355:c1=0xff5722:d=1", "-frames:v", "1", f("photo.png")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=4", "-f", "lavfi", "-i", "sine=frequency=330:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f("clip.mp4")]);
  // A MOV with a codec browsers can't play, to exercise the transcode path.
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2", "-c:v", "mjpeg", f("legacy.mov")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", f("voice.wav")]);
  await writeFile(f("notes.md"), "# Notes\n\nOur product helps teams ship faster.\n");
  await writeFile(f("page.html"), "<html><body><h1>Title</h1><script>evil()</script><p>Para &amp; more</p></body></html>");
  // Minimal DOCX: just enough of the OOXML package for text extraction.
  const docxDir = await mkdtemp(path.join(os.tmpdir(), "docx-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(docxDir, "word"));
  await writeFile(path.join(docxDir, "word", "document.xml"), '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>');
  await run("zip", ["-q", "-r", f("brief.docx"), "word"], { cwd: docxDir });
  return { photo: f("photo.png"), clip: f("clip.mp4"), legacy: f("legacy.mov"), voice: f("voice.wav"), notes: f("notes.md"), page: f("page.html"), docx: f("brief.docx") };
}
