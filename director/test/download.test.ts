// Link import: the downloader against a local web server, and its address checks.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { downloadFile, isPrivateAddress } from "../src/ingest/download.ts";
import { makeMedia } from "./helpers.ts";

describe("link import", () => {
  let server: http.Server;
  let base: string;
  let clip: Buffer;
  let photo: Buffer;

  before(async () => {
    const media = await makeMedia(await mkdtemp(path.join(os.tmpdir(), "dl-media-")));
    clip = await readFile(media.clip!);
    photo = await readFile(media.photo!);
    server = http.createServer((req, res) => {
      const send = (status: number, type: string, body: Buffer | string, extra: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": type, ...extra });
        res.end(body);
      };
      switch (req.url) {
        case "/shots/dolly.mp4": return send(200, "video/mp4", clip);
        case "/image?id=42&token=secret": return send(200, "image/png", photo);
        case "/files/photo.png": return send(200, "application/octet-stream", photo);
        case "/go": return send(302, "text/plain", "", { location: "/shots/dolly.mp4" });
        case "/loop": return send(302, "text/plain", "", { location: "/loop" });
        case "/share/abc": return send(200, "text/html; charset=utf-8", "<html><body>Share page</body></html>");
        case "/big.mp4": return send(200, "video/mp4", Buffer.alloc(4096));
        case "/data.json": return send(200, "application/json", "{}");
        default: return send(404, "text/plain", "not found");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = (p: string, extra: Partial<Parameters<typeof downloadFile>[1]> = {}) => downloadFile(`${base}${p}`, { maxBytes: 50 * 1024 * 1024, allowPrivate: true, ...extra });

  it("recognises private, loopback and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "64:ff9b::127.0.0.1"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "151.101.1.69", "2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it("downloads media, naming it from the link or its type", async () => {
    const video = await get("/shots/dolly.mp4");
    assert.equal(video.name, "dolly.mp4");
    assert.deepEqual(Buffer.from(video.data), clip);
    const image = await get("/image?id=42&token=secret");
    assert.equal(image.name, "image.png");
    const generic = await get("/files/photo.png");
    assert.equal(generic.name, "photo.png");
    const named = await get("/shots/dolly.mp4", { name: "Hero shot.mov" });
    assert.equal(named.name, "Hero shot.mp4"); // the extension follows the real type
  });

  it("follows redirects, but not forever", async () => {
    const r = await get("/go");
    assert.equal(r.name, "dolly.mp4");
    assert.equal(r.url.pathname, "/shots/dolly.mp4");
    await assert.rejects(get("/loop"), /redirected too many times/);
  });

  it("explains links it can't use", async () => {
    await assert.rejects(get("/share/abc"), /web page, not a media file/);
    await assert.rejects(get("/nothing.mp4"), /HTTP 404/);
    await assert.rejects(get("/data.json"), /can't use this file type \(application\/json\)/);
    await assert.rejects(get("/big.mp4", { maxBytes: 1024 }), /larger than/);
    await assert.rejects(downloadFile("ftp://example.com/a.mp4", { maxBytes: 1024 }), /only http and https/);
    await assert.rejects(downloadFile("https://user:pw@example.com/a.mp4", { maxBytes: 1024 }), /user name or password/);
    await assert.rejects(downloadFile("not a link", { maxBytes: 1024 }), /not a valid link/);
  });

  it("refuses this computer and private networks unless allowed", async () => {
    await assert.rejects(downloadFile(`${base}/shots/dolly.mp4`, { maxBytes: 1 << 20 }), /private network/);
    await assert.rejects(downloadFile("http://localhost:9/a.mp4", { maxBytes: 1 << 20 }), /private network/);
    await assert.rejects(downloadFile("http://169.254.169.254/latest/meta-data", { maxBytes: 1 << 20 }), /private network/);
    await assert.rejects(downloadFile("http://2130706433/a.mp4", { maxBytes: 1 << 20 }), /private network/); // 127.0.0.1 written as a number
    await assert.rejects(downloadFile("http://[::1]:9/a.mp4", { maxBytes: 1 << 20 }), /private network/);
  });
});
