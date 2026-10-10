// Turn an uploaded file into a project asset: classify it, store it under a safe
// name, probe it, and prepare previews/text the director can look at.
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { newId, type Asset, type AssetKind } from "../store/projects.ts";
import { docxToText, extractKeyframes, htmlToText, imagePreview, pdfPreviews, pdfToText, probe, transcodeToMp4 } from "./media.ts";

const KINDS: Record<string, { kind: AssetKind; mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  webp: { kind: "image", mime: "image/webp" },
  gif: { kind: "image", mime: "image/gif" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/mp4" },
  mov: { kind: "video", mime: "video/quicktime" },
  webm: { kind: "video", mime: "video/webm" },
  mkv: { kind: "video", mime: "video/x-matroska" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  aac: { kind: "audio", mime: "audio/aac" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  flac: { kind: "audio", mime: "audio/flac" },
  pdf: { kind: "document", mime: "application/pdf" },
  txt: { kind: "document", mime: "text/plain" },
  md: { kind: "document", mime: "text/markdown" },
  markdown: { kind: "document", mime: "text/markdown" },
  html: { kind: "document", mime: "text/html" },
  htm: { kind: "document", mime: "text/html" },
  docx: { kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  srt: { kind: "document", mime: "text/plain" },
  vtt: { kind: "document", mime: "text/vtt" },
  ttf: { kind: "font", mime: "font/ttf" },
  otf: { kind: "font", mime: "font/otf" },
  woff: { kind: "font", mime: "font/woff" },
  woff2: { kind: "font", mime: "font/woff2" },
};

/** Video codecs every mainstream browser can decode in an MP4/WebM container. */
const BROWSER_SAFE_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const MAX_TEXT = 60_000;

export function classify(fileName: string): { ext: string; kind: AssetKind; mime: string } | undefined {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const k = KINDS[ext];
  return k ? { ext, ...k } : undefined;
}

export function supportedExtensions(): string[] {
  return Object.keys(KINDS);
}

/**
 * Store `data` as a new asset in `projectDir`. The original name is kept for display only;
 * the stored file name is derived from the asset id, so user input never becomes a path.
 */
export async function ingestFile(projectDir: string, originalName: string, data: Uint8Array, origin: Asset["origin"] = "upload"): Promise<Asset> {
  const c = classify(originalName);
  if (!c) throw new Error(`unsupported file type: ${path.extname(originalName) || originalName}`);
  const id = newId("a");
  let file = `assets/${id}.${c.ext}`;
  let mime = c.mime;
  const abs = (rel: string) => path.join(projectDir, rel);
  await writeFile(abs(file), data);

  const asset: Asset = {
    id,
    kind: c.kind,
    name: path.basename(originalName).slice(0, 200),
    file,
    mime,
    bytes: data.byteLength,
    origin,
    createdAt: new Date().toISOString(),
  };

  try {
    if (c.kind === "image") {
      const p = await probe(abs(file));
      asset.width = p.width;
      asset.height = p.height;
      const preview = `previews/${id}.jpg`;
      await imagePreview(abs(file), abs(preview));
      asset.previews = [preview];
    } else if (c.kind === "video") {
      let p = await probe(abs(file));
      if (!p.hasVideo) throw new Error("file has no video stream");
      if ((c.ext !== "mp4" && c.ext !== "webm") || !BROWSER_SAFE_CODECS.has(p.videoCodec ?? "")) {
        const mp4 = `assets/${id}.mp4`;
        const tmp = `${mp4}.tmp.mp4`;
        await transcodeToMp4(abs(file), abs(tmp));
        if (file !== mp4) await rm(abs(file), { force: true });
        await rename(abs(tmp), abs(mp4));
        file = mp4;
        mime = "video/mp4";
        p = await probe(abs(file));
      }
      Object.assign(asset, { file, mime, width: p.width, height: p.height, duration: p.duration, hasAudio: p.hasAudio });
      const frames = await extractKeyframes(abs(file), p.duration ?? 0, (i) => abs(`previews/${id}-k${i}.jpg`));
      asset.previews = frames.map((f) => path.relative(projectDir, f));
    } else if (c.kind === "audio") {
      const p = await probe(abs(file));
      asset.duration = p.duration;
      asset.hasAudio = true;
    } else if (c.kind === "document") {
      let text: string | undefined;
      if (c.ext === "pdf") {
        text = await pdfToText(abs(file));
        const pages = await pdfPreviews(abs(file), abs(`previews/${id}-p`));
        if (pages.length) asset.previews = pages.map((f) => path.relative(projectDir, f));
      } else if (c.ext === "docx") {
        text = await docxToText(abs(file));
      } else {
        const raw = await readFile(abs(file), "utf8");
        text = c.ext === "html" || c.ext === "htm" ? htmlToText(raw) : raw;
      }
      if (text) asset.text = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[truncated]` : text;
    }
  } catch (err) {
    await rm(abs(file), { force: true });
    throw new Error(`could not read ${asset.name}: ${(err as Error).message}`);
  }
  asset.bytes = (await stat(abs(asset.file))).size;
  return asset;
}
