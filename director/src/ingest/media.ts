// Thin wrappers over ffprobe/ffmpeg and a few document tools, using execFile (no shell).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await run("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

export interface Probe {
  width?: number;
  height?: number;
  duration?: number;
  videoCodec?: string;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 8 * 1024 * 1024 });
  const info = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }>;
    format?: { duration?: string };
  };
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const durationRaw = Number(info.format?.duration ?? video?.duration ?? audio?.duration);
  let width = video?.width;
  let height = video?.height;
  // Phone footage often stores portrait video as landscape plus a rotation flag.
  const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  if (width && height && (rotation === 90 || rotation === 270)) [width, height] = [height, width];
  return {
    width,
    height,
    duration: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined,
    videoCodec: video?.codec_name,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
  };
}

/** Grab `count` evenly spaced frames as JPEGs (max `maxWidth` wide). */
export async function extractKeyframes(file: string, duration: number, outPattern: (i: number) => string, count = 6, maxWidth = 640): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = duration > 0 ? (duration * (i + 0.5)) / count : 0;
    const dest = outPattern(i);
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-q:v", "4", dest]);
      out.push(dest);
    } catch {
      // A failed seek near the end is harmless; keep the frames we have.
    }
  }
  return out;
}

/** Downscaled JPEG preview of an image. */
export async function imagePreview(file: string, dest: string, maxWidth = 640): Promise<void> {
  await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-q:v", "4", dest]);
}

/** Re-encode to H.264/AAC MP4 so browsers (preview player) and the renderer agree. */
export async function transcodeToMp4(src: string, dest: string): Promise<void> {
  await run(
    "ffmpeg",
    ["-v", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", dest],
    { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 },
  );
}

export async function pdfToText(file: string): Promise<string | undefined> {
  if (!(await hasCommand("pdftotext"))) return undefined;
  const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** Render the first pages of a PDF to JPEG for the director to look at. */
export async function pdfPreviews(file: string, prefix: string, pages = 3): Promise<string[]> {
  if (!(await hasCommand("pdftoppm"))) return [];
  await run("pdftoppm", ["-jpeg", "-r", "60", "-f", "1", "-l", String(pages), file, prefix]);
  const { readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  return (await readdir(dir)).filter((f) => f.startsWith(base) && f.endsWith(".jpg")).sort().map((f) => path.join(dir, f));
}

export async function docxToText(file: string): Promise<string | undefined> {
  if (!(await hasCommand("unzip"))) return undefined;
  const { stdout } = await run("unzip", ["-p", file, "word/document.xml"], { maxBuffer: 64 * 1024 * 1024 });
  return xmlToText(stdout);
}

export function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}
