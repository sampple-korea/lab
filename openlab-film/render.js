'use strict';
/*
 * Render driver.
 *   node render.js still 4.3 16.2 ...   -> work/still_<t>.png   (motion blur + post)
 *   node render.js sheet                 -> work/sheet.png        (contact sheet)
 *   node render.js full [workers]        -> out/donggo-openlab-2026.mp4
 *
 * Each frame = average of N sub-frame renders across a 180° shutter
 * (4 normally, 12 on fast moves), then post-processing, then raw RGBA
 * straight into ffmpeg's stdin.
 */
const fs = require('fs');
const path = require('path');
const { spawn, fork, execFileSync } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');
const film = require('./film');

const { W, H, FPS, DUR } = film;
const FRAMES = Math.round(DUR * FPS);
const ROOT = __dirname;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const acc = createCanvas(W, H);
const accCtx = acc.getContext('2d');
const sum = new Uint16Array(W * H * 4);
const out = accCtx.createImageData(W, H);

function renderFrame(i) {
  const t = i / FPS;
  const n = film.samplesAt(t);
  const shutter = 0.5 / FPS;
  sum.fill(0);
  for (let k = 0; k < n; k++) {
    const ts = Math.min(DUR - 1e-4, Math.max(0, t + ((k + 0.5) / n - 0.5) * shutter));
    const c = film.renderScene(ts);
    const d = c.getContext('2d').getImageData(0, 0, W, H).data;
    for (let j = 0; j < d.length; j++) sum[j] += d[j];
  }
  const o = out.data;
  const inv = 1 / n;
  for (let j = 0; j < o.length; j++) o[j] = sum[j] * inv + 0.5;
  accCtx.putImageData(out, 0, 0);
  film.postProcess(acc, t, i);
  return acc;
}

async function stills(times) {
  await film.init();
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  for (const s of times) {
    const t = parseFloat(s);
    const c = renderFrame(Math.round(t * FPS));
    fs.writeFileSync(path.join(ROOT, 'work', `still_${t.toFixed(2)}.png`), c.toBuffer('image/png'));
    console.log('still', t);
  }
}

async function sheet(times, file) {
  await film.init();
  const cols = 5, tw = 384, th = 216, pad = 6;
  const rows = Math.ceil(times.length / cols);
  const sh = createCanvas(cols * (tw + pad) + pad, rows * (th + pad + 22) + pad);
  const x = sh.getContext('2d');
  x.fillStyle = '#111'; x.fillRect(0, 0, sh.width, sh.height);
  times.forEach((t, k) => {
    const c = renderFrame(Math.round(t * FPS));
    const cx = pad + (k % cols) * (tw + pad), cy = pad + Math.floor(k / cols) * (th + pad + 22);
    x.drawImage(c, cx, cy, tw, th);
    x.fillStyle = '#fff'; x.font = '700 16px "JetBrains Mono"'; x.fillText(t.toFixed(2) + 's', cx + 4, cy + th + 17);
  });
  fs.writeFileSync(path.join(ROOT, 'work', file), sh.toBuffer('image/png'));
  console.log('sheet', file);
}

// ---- worker: render [a, b) and pipe into an intermediate segment
async function worker(a, b, seg) {
  await film.init();
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '6',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = a; i < b; i++) {
    const c = renderFrame(i);
    const buf = Buffer.from(c.getContext('2d').getImageData(0, 0, W, H).data.buffer);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (process.send && (i - a) % 10 === 0) process.send({ done: i - a });
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error('ffmpeg ' + code)))));
}

async function full(nw) {
  const build = path.join(ROOT, 'build');
  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  // interleave cost: split by frame index into contiguous chunks of roughly equal size
  const chunk = Math.ceil(FRAMES / nw);
  const segs = [];
  await Promise.all(Array.from({ length: nw }, (_, k) => {
    const a = k * chunk, b = Math.min(FRAMES, (k + 1) * chunk);
    const seg = path.join(build, `seg_${k}.mkv`);
    segs.push(seg);
    return new Promise((res, rej) => {
      const p = fork(__filename, ['worker', a, b, seg]);
      p.on('message', m => { if (m.done % 60 === 0) console.log(`w${k}: ${m.done}/${b - a}  ${((Date.now() - t0) / 1000).toFixed(0)}s`); });
      p.on('exit', code => (code === 0 ? res() : rej(new Error('worker ' + k + ' failed'))));
    });
  }));
  const list = path.join(build, 'segs.txt');
  fs.writeFileSync(list, segs.sort().map(s => `file '${s}'`).join('\n'));
  const master = path.join(build, 'master_444.mkv');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master], { stdio: 'inherit' });
  // final: film grain + AAC, H.264 High / yuv420p
  const final = path.join(outDir, 'donggo-openlab-2026.mp4');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, '-i', path.join(build, 'audio.wav'),
    '-vf', 'noise=c0s=4:c0f=t+u:c1s=1:c1f=t+u:c2s=1:c2f=t+u,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'grain', '-profile:v', 'high', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', final], { stdio: 'inherit' });
  console.log('done', final, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

const [mode, ...args] = process.argv.slice(2);
(async () => {
  if (mode === 'still') await stills(args);
  else if (mode === 'sheet') {
    const times = args.length ? args.map(Number) : [0.9, 1.85, 3.2, 4.6, 6.8, 7.6, 9.3, 11.4, 13.3, 15.4, 17.3, 19.4, 21.3, 23.4, 24.8,
      26.9, 28.3, 29.6, 31.5, 32.6, 33.7, 34.6, 35.6, 36.4, 37.3, 38.9, 40.4, 41.2, 42.6, 43.8];
    await sheet(times, 'sheet.png');
  } else if (mode === 'worker') await worker(+args[0], +args[1], args[2]);
  else if (mode === 'full') await full(+(args[0] || 4));
  else console.log('usage: node render.js still|sheet|full');
})().catch(e => { console.error(e); process.exit(1); });
