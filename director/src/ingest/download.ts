// Download a media file from an http(s) link, for shots made in other tools (such as
// Higgsfield) or files the user links to. Links come from the model, so the download is
// defensive: public addresses only (checked again for every redirect, and pinned for the
// connection when there is no proxy), a size cap, timeouts, and a file type Director can use.
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { Agent, EnvHttpProxyAgent, request, type Dispatcher } from "undici";
import { classify } from "./ingest.ts";

export class DownloadError extends Error {}

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 127], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(address, prefix, "ipv6");

/**
 * Loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved ranges.
 * IPv4-mapped IPv6 addresses are matched against the IPv4 rules by BlockList itself.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family !== 6) return true;
  // NAT64 (64:ff9b::/96, used on IPv6-only networks) embeds an IPv4 address: judge that address.
  if (/^64:ff9b::/i.test(ip)) {
    const m = /^64:ff9b::(?:(\d+\.\d+\.\d+\.\d+)|([\da-f]{1,4}):([\da-f]{1,4}))$/i.exec(ip);
    if (!m) return true;
    const v4 = m[1] ?? [m[2]!, m[3]!].flatMap((h) => { const n = Number.parseInt(h, 16); return [n >> 8, n & 255]; }).join(".");
    return isPrivateAddress(v4);
  }
  return blocked.check(ip, "ipv6");
}

/** File extension for the content types Director can ingest. */
const TYPE_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/x-m4v": "m4v",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mp4": "m4a",
  "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/flac": "flac",
  "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "font/ttf": "ttf", "font/otf": "otf", "font/woff": "woff", "font/woff2": "woff2",
};
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/binary"]);

export interface Downloaded {
  /** File name with an extension Director recognises. */
  name: string;
  data: Uint8Array;
  contentType: string;
  /** Final address after redirects. */
  url: URL;
}

export interface DownloadOptions {
  maxBytes: number;
  /** Allow loopback and private addresses (tests and trusted local setups only). */
  allowPrivate?: boolean;
  /** Preferred file name; the extension follows the downloaded type. */
  name?: string;
  timeoutMs?: number;
}

function parseLink(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DownloadError(`not a valid link: ${raw.slice(0, 120)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new DownloadError("only http and https links can be imported");
  if (url.username || url.password) throw new DownloadError("links with a user name or password are not imported");
  return url;
}

function proxyConfigured(url: URL): boolean {
  const env = url.protocol === "https:" ? process.env.HTTPS_PROXY ?? process.env.https_proxy : process.env.HTTP_PROXY ?? process.env.http_proxy;
  return Boolean(env);
}

/** Check where a link points, then build the dispatcher that will fetch it. */
async function dispatcherFor(url: URL, allowPrivate: boolean): Promise<Dispatcher> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const viaProxy = proxyConfigured(url);
  if (!allowPrivate && (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host) || (net.isIP(host) && isPrivateAddress(host)))) {
    throw new DownloadError("the link points to this computer or a private network, which Director does not download from");
  }
  let addresses: Array<{ address: string; family: number }> = [];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    // Behind a proxy the proxy resolves the name; without one the host must resolve here.
    if (!viaProxy) throw new DownloadError(`could not find the server ${host}`);
  }
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
    throw new DownloadError("the link points to this computer or a private network, which Director does not download from");
  }
  if (viaProxy) return new EnvHttpProxyAgent();
  // Connect to the address that was checked, so DNS can't change between the check and the connection.
  const first = addresses[0]!;
  return new Agent({
    connect: {
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, first.address, first.family);
      },
    },
  });
}

function fileName(url: URL, type: string, wanted?: string): string {
  let fromUrl = "";
  try {
    fromUrl = path.posix.basename(decodeURIComponent(url.pathname));
  } catch {
    fromUrl = path.posix.basename(url.pathname);
  }
  const base = (wanted?.trim() ? path.basename(wanted.trim()) : fromUrl).replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(-100) || "download";
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "download";
  const isPage = type === "text/html" || type === "application/xhtml+xml";
  if (isPage && !/\.html?$/i.test(base)) {
    throw new DownloadError("the link opened a web page, not a media file; use the direct link to the image, video or audio file");
  }
  const ext = TYPE_EXT[type];
  if (ext) return `${stem}.${ext}`;
  if ((GENERIC_TYPES.has(type) || isPage) && classify(base)) return base;
  throw new DownloadError(`Director can't use this file type${type ? ` (${type})` : ""}`);
}

/** Download one file. Throws DownloadError with a user-readable reason. */
export async function downloadFile(raw: string, opts: DownloadOptions): Promise<Downloaded> {
  let url = parseLink(raw);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 5 * 60 * 1000);
  const mb = Math.round(opts.maxBytes / 1048576);
  for (let hop = 0; hop <= 5; hop++) {
    const dispatcher = await dispatcherFor(url, opts.allowPrivate ?? false);
    try {
      let res: Dispatcher.ResponseData;
      try {
        res = await request(url, {
          dispatcher,
          method: "GET",
          headers: { "user-agent": "Director/0.1 (video studio)", accept: "image/*,video/*,audio/*,application/pdf,*/*;q=0.5" },
          headersTimeout: 30_000,
          bodyTimeout: 60_000,
          signal,
        });
      } catch (err) {
        throw new DownloadError(signal.aborted ? "the download took too long" : `could not download the link (${(err as Error).message})`);
      }
      const location = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        await res.body.dump();
        url = parseLink(new URL(String(location), url).href);
        continue;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        await res.body.dump();
        throw new DownloadError(`the link returned HTTP ${res.statusCode}`);
      }
      const type = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      let name: string;
      try {
        name = fileName(url, type, opts.name);
      } catch (err) {
        await res.body.dump();
        throw err;
      }
      if (Number(res.headers["content-length"] ?? 0) > opts.maxBytes) {
        res.body.destroy();
        throw new DownloadError(`the file is larger than ${mb} MB`);
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += (chunk as Buffer).length;
        if (total > opts.maxBytes) {
          res.body.destroy();
          throw new DownloadError(`the file is larger than ${mb} MB`);
        }
        chunks.push(chunk as Buffer);
      }
      if (!total) throw new DownloadError("the link returned an empty file");
      return { name, data: new Uint8Array(Buffer.concat(chunks)), contentType: type, url };
    } finally {
      void dispatcher.close().catch(() => undefined);
    }
  }
  throw new DownloadError("the link redirected too many times");
}
