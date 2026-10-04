#!/usr/bin/env node
// Render a seek(t) HTML film to MP4, or to a contact sheet for review, with Playwright + ffmpeg.
//
//   node render.mjs film.html --out out.mp4 [--fps 30] [--duration 12] [--audio mix.wav]
//   node render.mjs film.html --sheet sheet.png [--every 1 | --times 0.5,2,4.5]   # review frames first
//   node render.mjs film.html --still frame.png --at 3.2                         # one frame
//
// Options: --width 1080 --height 1920 --from 0 --to 5 (partial render) --beats beats.json
//          --crf 16 --guides (draw safe zone) --no-check (skip determinism check)
//
// The film must define window.seek(t) and window.DURATION (or pass --duration).
// Needs: Node 18+, ffmpeg on PATH, and the `playwright` package with Chromium
// (`npm i -D playwright && npx playwright install chromium`).

import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through to global install */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const require = createRequire(join(root, 'noop.js'));
    return require('playwright');
  } catch {
    console.error('error: playwright not found. Install it: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
}

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', code => (code === 0 ? ok() : fail(new Error(`${cmd} exited with ${code}`))));
  });
}

const args = parseArgs(process.argv.slice(2));
const film = args._[0];
if (!film || !existsSync(film)) {
  console.error('usage: node render.mjs film.html (--out out.mp4 | --sheet sheet.png | --still f.png --at t) [options]');
  process.exit(2);
}
if (!args.out && !args.sheet && !args.still) {
  console.error('error: pass --out, --sheet or --still');
  process.exit(2);
}
try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch {
  console.error('error: ffmpeg not found on PATH');
  process.exit(2);
}

const width = parseInt(args.width || '1080', 10);
const height = parseInt(args.height || '1920', 10);
const fps = parseFloat(args.fps || '30');
const beats = args.beats ? JSON.parse(readFileSync(args.beats, 'utf8')) : null;
const beatTimes = beats ? (Array.isArray(beats) ? beats : beats.beats || []) : [];

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.addInitScript(cfg => { window.RENDER = cfg.render; window.BEATS = cfg.beats; },
  { render: { width, height, fps, guides: Boolean(args.guides) }, beats: beatTimes });
await page.goto(pathToFileURL(resolve(film)).href);
await page.evaluate(async () => { if (window.ready) await window.ready; await document.fonts.ready; });

const filmInfo = await page.evaluate(() => ({ hasSeek: typeof window.seek === 'function', duration: window.DURATION }));
if (!filmInfo.hasSeek) {
  console.error('error: the film does not define window.seek(t)');
  await browser.close(); process.exit(1);
}
const duration = parseFloat(args.duration || filmInfo.duration || 0);
if (!(duration > 0) && !args.still) {
  console.error('error: set window.DURATION in the film or pass --duration');
  await browser.close(); process.exit(1);
}

const clip = { x: 0, y: 0, width, height };
async function frameAt(t) {
  await page.evaluate(tt => window.seek(tt), t);
  return page.screenshot({ type: 'png', clip });
}

// Determinism check: the same t must paint the same pixels regardless of what was drawn before.
if (!args['no-check'] && duration > 0) {
  const mid = duration / 2;
  const a = await frameAt(mid);
  await frameAt(duration * 0.9);
  await frameAt(0);
  const b = await frameAt(mid);
  if (!a.equals(b)) {
    console.warn(`warning: seek(${mid.toFixed(2)}) painted different pixels on a second call. ` +
      'Something carries state between frames (Math.random, timers, accumulated values, CSS animations).');
  }
}

try {
  if (args.still) {
    const t = parseFloat(args.at || '0');
    writeFileSync(args.still, await frameAt(t));
    console.log(`Wrote ${args.still} (t=${t}s)`);
  } else if (args.sheet) {
    let times;
    if (args.times) times = String(args.times).split(',').map(Number).filter(n => !Number.isNaN(n));
    else {
      const every = parseFloat(args.every || '1');
      times = [];
      for (let t = Math.min(0.25, duration / 2); t < duration; t += every) times.push(+t.toFixed(3));
    }
    const dir = mkdtempSync(join(tmpdir(), 'sheet_'));
    for (let i = 0; i < times.length; i++) {
      const raw = join(dir, `raw_${i}.png`);
      writeFileSync(raw, await frameAt(times[i]));
      const label = `t=${times[i].toFixed(2)}s`;
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vf',
        `scale=270:-2,drawbox=x=0:y=0:w=iw:h=34:color=black@0.7:t=fill,` +
        `drawtext=text='${label}':x=8:y=8:fontsize=20:fontcolor=white`, join(dir, `cell_${String(i).padStart(3, '0')}.png`)]);
    }
    const cols = Math.min(6, times.length);
    const rows = Math.ceil(times.length / cols);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', join(dir, 'cell_%03d.png'),
      '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=0x222222`, '-frames:v', '1', args.sheet]);
    rmSync(dir, { recursive: true, force: true });
    console.log(`Wrote ${args.sheet} (${times.length} frames: ${times.join(', ')}s)`);
  } else {
    const from = parseFloat(args.from || '0');
    const to = Math.min(parseFloat(args.to || String(duration)), duration);
    const total = Math.round((to - from) * fps);
    const ff = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
    if (args.audio) ff.push('-ss', String(from), '-i', args.audio);
    ff.push('-map', '0:v', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 16), '-pix_fmt', 'yuv420p',
      '-r', String(fps));
    if (args.audio) {
      ff.push('-map', '1:a', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000', '-c:a', 'aac', '-b:a', '192k',
        '-t', String(to - from));
    }
    ff.push('-movflags', '+faststart', args.out);
    const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, fail) => enc.on('close', c => (c === 0 ? ok() : fail(new Error(`ffmpeg exited with ${c}`)))));
    const started = Date.now();
    for (let i = 0; i < total; i++) {
      const buf = await frameAt(from + i / fps);
      if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
      if (i % Math.round(fps) === 0) process.stdout.write(`\rframe ${i}/${total}`);
    }
    enc.stdin.end();
    await done;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\rRendered ${args.out}: ${total} frames, ${(to - from).toFixed(2)}s at ${fps}fps, ${width}x${height} in ${secs}s`);
  }
} finally {
  await browser.close();
}
