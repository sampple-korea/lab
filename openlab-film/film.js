'use strict';
/*
 * 동고오래~ㅂ — 제7회 부산동고 오픈랩 · 44초 모션 필름
 *
 * Every scene is a pure function of time t (seconds). render.js samples this
 * several times per frame for motion blur, then runs postProcess() on the
 * average. All graphics are paths and type — the only bitmap is the school
 * emblem, extracted from the brochure as an alpha mask.
 *
 * Timeline (120 BPM, one bar = 2 s) is shared with music.py.
 */
const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const W = 1920, H = 1080, FPS = 60, DUR = 44;
const TAU = Math.PI * 2;
const ROOT = __dirname;

for (const f of fs.readdirSync(path.join(ROOT, 'fonts'))) GlobalFonts.registerFromPath(path.join(ROOT, 'fonts', f));
const FK = 'Pretendard';
const FM = '"JetBrains Mono", Pretendard';

const AF = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'audio_features.json'), 'utf8'));

// Muted, print-like palette: warm paper + deep ink, four quiet accents.
const C = {
  ink: '#151B2C', ink2: '#1D2539', navy: '#24345E', deep: '#0E1322',
  paper: '#F2EEE6', paper2: '#E8E2D6', warm: '#EFE7D6', sagePaper: '#E4E9E1', card: '#FBF9F5',
  mustard: '#D5A43C', rose: '#C57B6F', blue: '#6F8EBE', sage: '#7EA08A',
  white: '#FFFFFF', slate: '#8B92A3',
};

// ------------------------------------------------------------------ math
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const P = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inCubic: x => x * x * x,
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
};
// damped spring 0 -> 1 with overshoot, for physical landings
const spring = (x, k = 7, z = 0.32) => (x <= 0 ? 0 : 1 - Math.exp(-z * k * x * 3) * Math.cos(k * x * 3.2));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ canvas + primitives
const cv = createCanvas(W, H);
let ctx = cv.getContext('2d');

function F(size, w = 900, fam = FK) { return `${w} ${size}px ${fam}`; }

function rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function measure(s, font, ls = 0) {
  ctx.save(); ctx.font = font; ctx.letterSpacing = ls + 'px';
  const w = ctx.measureText(s).width - (s.length ? ls : 0);
  ctx.restore();
  return w;
}

function text(s, x, y, o = {}) {
  ctx.save();
  ctx.font = o.font || F(40);
  ctx.letterSpacing = (o.ls || 0) + 'px';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(s).width - (s.length ? (o.ls || 0) : 0);
  if (o.align === 'center') x -= w / 2; else if (o.align === 'right') x -= w;
  if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
  if (o.stroke) { ctx.lineWidth = o.lw || 2; ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  if (!o.noFill) { ctx.fillStyle = o.color || C.white; ctx.fillText(s, x, y); }
  ctx.restore();
  return w;
}

/** Per-glyph animated text. fn(i, n, ch) -> {dx, dy, s, rot, a, color, hide} */
function chars(s, x, y, o, fn) {
  ctx.save();
  ctx.font = o.font; ctx.letterSpacing = '0px';
  const arr = [...s];
  const ls = o.ls || 0;
  const ws = arr.map(c => ctx.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + ls * (arr.length - 1);
  let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
  const xs = [];
  arr.forEach((c, i) => {
    xs.push(cx + ws[i] / 2);
    const st = (fn && fn(i, arr.length, c)) || {};
    if (!st.hide && c !== ' ') {
      ctx.save();
      ctx.translate(cx + ws[i] / 2 + (st.dx || 0), y + (st.dy || 0));
      if (st.rot) ctx.rotate(st.rot);
      const sc = st.s ?? 1;
      if (sc !== 1) ctx.scale(sc, sc);
      ctx.globalAlpha *= clamp(st.a ?? 1);
      ctx.textAlign = 'center';
      if (o.stroke) { ctx.lineWidth = o.lw || 2; ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round'; ctx.strokeText(c, 0, 0); }
      if (!o.noFill) { ctx.fillStyle = st.color || o.color || C.white; ctx.fillText(c, 0, 0); }
      ctx.restore();
    }
    cx += ws[i] + ls;
  });
  ctx.restore();
  return { total, xs, ws };
}

/** Line of type rising out of a slot. */
function riseText(s, x, y, t, t0, o) {
  const size = o.size;
  const stag = o.stagger ?? 0.03, dur = o.dur ?? 0.5;
  ctx.save();
  ctx.beginPath(); ctx.rect(-50, y - size * 1.05, W + 100, size * 1.4); ctx.clip();
  const r = chars(s, x, y, { font: o.font || F(size), color: o.color, align: o.align, ls: o.ls }, (i, n, ch) => {
    const p = E.outExpo(P(t, t0 + i * stag, t0 + i * stag + dur));
    return { dy: (1 - p) * size * 1.2, rot: (1 - p) * 0.1, color: o.colorFn ? o.colorFn(i, ch) : undefined };
  });
  ctx.restore();
  return r;
}

function typeOn(s, x, y, t, t0, t1, o) {
  const arr = [...s];
  const n = Math.floor(arr.length * P(t, t0, t1));
  if (n <= 0) return;
  const w = text(arr.slice(0, n).join(''), x, y, o);
  if (n < arr.length && Math.floor(t * 20) % 2 === 0) {
    const sz = parseInt(String(o.font).match(/(\d+)px/)[1], 10);
    ctx.fillStyle = o.cursor || o.color || C.white;
    const left = o.align === 'center' ? x - w / 2 : x;
    ctx.fillRect(left + w + 4, y - sz * 0.8, sz * 0.45, sz * 0.95);
  }
}

function wedgePath(cx, cy, r, a0, a1) {
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1, a1 < a0); ctx.closePath();
}

function star4(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

function lineGrid(color, alpha, step = 120, lw = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  for (let x = (W / 2) % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = (H / 2) % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke(); ctx.restore();
}

function pin(x, y, s, color, hole) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, -16, 11, Math.PI * 0.8, Math.PI * 2.2); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = hole; ctx.beginPath(); ctx.arc(0, -16, 4.2, 0, TAU); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ logo (alpha masks)
const LOGO = {};
function tint(img, color) {
  const c = createCanvas(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
async function init() {
  for (const k of ['core', 'text', 'outer']) {
    const img = await loadImage(path.join(ROOT, 'assets', `logo_${k}.png`));
    LOGO[k] = { white: tint(img, C.paper), mustard: tint(img, C.mustard), rose: tint(img, C.rose), blue: tint(img, C.blue) };
  }
  buildStatic();
}
function logoPart(part, color, cx, cy, D, rot = 0) {
  ctx.save(); ctx.translate(cx, cy); if (rot) ctx.rotate(rot);
  ctx.drawImage(LOGO[part][color], -D / 2, -D / 2, D, D); ctx.restore();
}

// ------------------------------------------------------------------ precomputed geometry
let TRACKS, MOL, CELLS, CONFETTI, RAYS, BUBBLES, CODE_LINES, SPARKS, ICE;
function buildStatic() {
  // physics: cloud-chamber tracks (alpha = short & thick, beta = spirals, muon = long lines)
  let r = mulberry32(11);
  TRACKS = [];
  for (let i = 0; i < 40; i++) {
    const type = i < 12 ? 'a' : i < 32 ? 'b' : 'm';
    const pts = [];
    if (type === 'a') {
      const ang = r() * TAU, r0 = 50 + r() * 30, len = 110 + r() * 190;
      for (let k = 0; k <= 12; k++) pts.push([Math.cos(ang) * (r0 + len * k / 12), Math.sin(ang) * (r0 + len * k / 12)]);
    } else if (type === 'b') {
      let x = (r() - 0.5) * 520, y = (r() - 0.5) * 520, a = r() * TAU;
      const k0 = (r() < 0.5 ? -1 : 1) * (0.006 + r() * 0.012);
      for (let j = 0; j < 110; j++) { pts.push([x, y]); a += k0 * 5 * (1 + j * 0.035); x += Math.cos(a) * 5; y += Math.sin(a) * 5; }
    } else {
      const ang = r() * Math.PI, off = (r() - 0.5) * 500, nx = -Math.sin(ang), ny = Math.cos(ang);
      for (let k = 0; k <= 20; k++) { const d = -520 + 1040 * k / 20; pts.push([Math.cos(ang) * d + nx * off, Math.sin(ang) * d + ny * off]); }
    }
    TRACKS.push({ type, pts, b: r() * 1.3, w: type === 'a' ? 7 : type === 'b' ? 2.4 : 1.5 });
  }
  // chemistry: caffeine C8H10N4O2 (skeleton + methyl hydrogens in 3D)
  const A = [
    ['N', -0.866, 0.5], ['C', -0.866, -0.5], ['N', 0, -1], ['C', 0.866, -0.5], ['C', 0.866, 0.5], ['C', 0, 1],
    ['N', 1.817, 0.809], ['C', 2.405, 0], ['N', 1.817, -0.809],
    ['O', 0, 2.05], ['O', -1.75, -1.02], ['C', -1.75, 1.02], ['C', 0, -2.05], ['C', 2.15, 1.78], ['H', 3.3, 0],
  ].map(([el, x, y]) => ({ el, x, y, z: 0 }));
  const B = [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 2], [4, 5, 1], [5, 0, 1], [4, 6, 1], [6, 7, 1], [7, 8, 2], [8, 3, 1],
    [5, 9, 2], [1, 10, 2], [0, 11, 1], [2, 12, 1], [6, 13, 1], [7, 14, 1]];
  for (const [ci, ni] of [[11, 0], [12, 2], [13, 6]]) {
    const c = A[ci], n = A[ni];
    let dx = c.x - n.x, dy = c.y - n.y; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
    for (let k = 0; k < 3; k++) {
      const ph = k * TAU / 3 + 0.4, ca = Math.cos(1.2), sa = Math.sin(1.2);
      A.push({ el: 'H', x: c.x + 0.62 * (dx * ca - Math.cos(ph) * dy * sa), y: c.y + 0.62 * (dy * ca + Math.cos(ph) * dx * sa), z: 0.62 * Math.sin(ph) * sa });
      B.push([ci, A.length - 1, 1]);
    }
  }
  const heavy = A.filter(a => a.el !== 'H');
  const mx = heavy.reduce((s, a) => s + a.x, 0) / heavy.length, my = heavy.reduce((s, a) => s + a.y, 0) / heavy.length;
  A.forEach(a => { a.x -= mx; a.y -= my; });
  MOL = { A, B };
  // life: voronoi plant cells
  r = mulberry32(5);
  const sites = [];
  const SP = 108;
  for (let gy = -7; gy <= 7; gy++) for (let gx = -7; gx <= 7; gx++) sites.push([gx * SP + (gy % 2 ? SP / 2 : 0) + (r() - 0.5) * 60, gy * SP * 0.92 + (r() - 0.5) * 50]);
  CELLS = [];
  for (const p of sites) {
    let poly = [[p[0] - 200, p[1] - 200], [p[0] + 200, p[1] - 200], [p[0] + 200, p[1] + 200], [p[0] - 200, p[1] + 200]];
    for (const q of sites) {
      if (q === p) continue;
      const nx = q[0] - p[0], ny = q[1] - p[1];
      if (nx * nx + ny * ny > 300 * 300) continue;
      const c = ((p[0] + q[0]) / 2) * nx + ((p[1] + q[1]) / 2) * ny;
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const da = a[0] * nx + a[1] * ny - c, db = b[0] * nx + b[1] * ny - c;
        if (da <= 0) out.push(a);
        if ((da <= 0) !== (db <= 0)) { const k = da / (da - db); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
      }
      poly = out;
    }
    const cx = poly.reduce((s, v) => s + v[0], 0) / poly.length, cy = poly.reduce((s, v) => s + v[1], 0) / poly.length;
    const chl = [];
    for (let k = 0; k < 7; k++) { const a = r() * TAU, d = 18 + r() * 22; chl.push([Math.cos(a) * d, Math.sin(a) * d, r() * Math.PI]); }
    CELLS.push({ poly, cx, cy, nx: (r() - 0.5) * 24, ny: (r() - 0.5) * 24, chl, hue: r() });
  }
  r = mulberry32(21);
  CONFETTI = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU, sp = 700 + r() * 1300;
    CONFETTI.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75 - 250, kind: Math.floor(r() * 4), size: 12 + r() * 16,
      col: [C.mustard, C.rose, C.blue, C.ink][Math.floor(r() * 4)], rot: r() * TAU, w: (r() - 0.5) * 10, sway: r() * TAU });
  }
  r = mulberry32(3);
  RAYS = Array.from({ length: 90 }, () => ({ a: r() * TAU, sp: 0.8 + r() * 1.8, ph: r(), len: 60 + r() * 200, w: 1 + r() * 2 }));
  BUBBLES = Array.from({ length: 16 }, () => ({ x: (r() - 0.5) * 220, sp: 0.25 + r() * 0.4, ph: r(), rad: 3 + r() * 7 }));
  SPARKS = Array.from({ length: 12 }, () => ({ a: r() * TAU, d: 0.7 + r() * 0.6, s: 3 + r() * 6 }));
  ICE = Array.from({ length: 4 }, (_, i) => ({ x: -70 + i * 48 + (r() - 0.5) * 20, y: (r() - 0.5) * 40, rot: r() * 1.5, s: 52 + r() * 16, ph: r() * TAU }));
  CODE_LINES = [
    'from sense_hat import SenseHat', 'hat = SenseHat()', 'ON = (213, 164, 60)', '',
    'def heart(t):', '    for y in range(8):', '        for x in range(8):', '            on = HEART[y][x]',
    '            hat.set_pixel(x, y, ON if on else OFF)', '', '# 할 수 있다! 바이브 코딩', 'while True:',
    '    heart(time.time())', '    vibe.code(prompt="동고오래~ㅂ")', 'print("OPEN LAB 07")',
  ];
}

// ------------------------------------------------------------------ timeline
const T = {
  school: 2.0, tag1: 6.0, booths: 8.0, grid: 24.0, tag2: 26.0, results: 28.0, stamps: 32.0,
  build: 34.0, title: 36.0, info: 38.0, end: 40.0, credit: 41.4,
};
const CARD_DUR = 2.0;

const CARDS = [
  { en: 'PHYSICS', club: '물리연구부', room: '5F · 물리실', head: ['보인다..', '방사능의 궤적이..!'],
    list: ['보인다.. 방사능의 궤적이..!', '우리 동네는 밤마다 울려 전자총성', '에이씨, 선 없이도 잘만 되네'], feat: 0,
    bg: C.ink2, fg: C.paper, ac: C.mustard, dark: true, il: ilPhysics },
  { en: 'CHEMISTRY', club: '화학연구부', room: '5F · 화학실', head: ['달고나 커피', '만들기'],
    list: ['철판 아이스크림 만들기', '핑크 팝 캐모마일 만들기', '달고나 커피 만들기', '분자요리 만들기'], feat: 2,
    bg: C.paper, fg: C.ink, ac: C.rose, dark: false, il: ilChem },
  { en: 'LIFE SCIENCE', club: '의학연구부 · 생물연구부', room: '5F · 생명과학실', head: ['다양한', '식물세포의 관찰'],
    list: ['30초의 기적, 올바른 손씻기 교실', '한 땀 한 땀 배우는 상처 봉합', '가상 환자 진단 및 치료 보드게임', '다양한 식물세포의 관찰'], feat: 3,
    bg: C.sagePaper, fg: C.ink, ac: C.sage, dark: false, il: ilLife },
  { en: 'EARTH SCIENCE', club: '지구과학부', room: '5F · 지구과학실', head: ['바다 속', '보이지 않는 경계'],
    list: ['바다 속 보이지 않는 경계', '파호이호이, 아아!', '화산폭발 · 창의탐구부'], feat: 0,
    bg: C.navy, fg: C.paper, ac: C.mustard, dark: true, il: ilEarth },
  { en: 'MAKER', club: '메이커부', room: '4F · 무한상상실', head: ['3D프린터의', '이해와 제작'],
    list: ['너도 날려볼 수 있어', '3D프린터의 이해와 제작', '피노키오 공작소', '1대1 드래그 레이스 · 수동 기어의 비밀', '당신의 휴대폰은 안전하십니까?'], feat: 1,
    bg: C.warm, fg: C.ink, ac: C.rose, dark: false, il: ilMaker },
  { en: 'CODING', club: '디지로거부', room: '컴퓨터실', head: ['할 수 있다!', '바이브 코딩'],
    list: ['할 수 있다! 바이브 코딩', 'SenseHAT으로 배우는 피지컬 컴퓨팅'], feat: 0,
    bg: C.ink, fg: C.paper, ac: C.sage, dark: true, il: ilCode },
  { en: 'MATH', club: '수리연구부 · 수리과학부', room: '4F · 수학실', head: ['스트링 아트'],
    list: ['문제적 남자', '스트링 아트', '슈링클스 · 오븐 입체 키링', '하노이의 탑', '2048 챌린지'], feat: 1,
    bg: C.paper, fg: C.ink, ac: C.blue, dark: false, il: ilMath },
  { en: 'SOUND & MORE', club: '실용음악부 · 융합예술탐구부', room: '5F · 음악실', head: ['소리를', '그리다!'],
    list: ['소리를 그리다!', '책 안읽으니까 들어와 · 도서부 1-3', '동고!! 야~호 · 방송부 복도 TV'], feat: 0,
    bg: C.navy, fg: C.paper, ac: C.rose, dark: true, il: ilSound },
];
CARDS.forEach((c, i) => { c.i = i; c.t0 = T.booths + i * CARD_DUR; c.t1 = c.t0 + CARD_DUR; c.idx = String(i + 1).padStart(2, '0'); });

// camera hits: [time, shake px, zoom punch]
const HITS = [
  [0.02, 3, 0.01], [2.0, 4, 0.012], [2.5, 3, 0.008], [3.0, 3, 0.008], [3.5, 3, 0.008], [4.0, 3, 0.008],
  [6.0, 6, 0.02], [8.0, 7, 0.022],
  ...CARDS.slice(1).map(c => [c.t0, 4, 0.014]),
  [24.0, 5, 0.018], [26.0, 6, 0.02], [28.0, 5, 0.015], [28.5, 3, 0.01], [29.0, 3, 0.01], [29.5, 3, 0.01],
  [32.25, 5, 0.01], [32.5, 5, 0.01], [32.75, 5, 0.01], [33.0, 5, 0.01], [33.25, 6, 0.01], [33.5, 7, 0.015],
  [34.0, 13, 0.04], [35.0, 6, 0.018], [36.0, 22, 0.06], [36.75, 6, 0.015], [38.0, 7, 0.018], [40.0, 11, 0.03],
];
function camera(t) {
  let sx = 0, sy = 0, rot = 0, z = 1.03; // 3% overscan so shakes never reveal the edge
  for (const [t0, amp, zp] of HITS) {
    if (t < t0) continue;
    const d = t - t0;
    const e = Math.exp(-d / 0.09);
    if (e > 0.002) {
      sx += amp * e * (Math.sin(d * 83 + t0 * 7) + 0.5 * Math.sin(d * 151 + t0));
      sy += amp * e * (Math.cos(d * 97 + t0 * 3) + 0.5 * Math.sin(d * 131 + 2 * t0));
      rot += amp * e * 0.0008 * Math.sin(d * 61 + t0);
    }
    z += zp * Math.exp(-d / 0.13);
  }
  sx += Math.sin(t * 0.9) * 3; sy += Math.cos(t * 0.7) * 2.5;
  return { sx, sy, rot, z };
}

// ------------------------------------------------------------------ transition masks
function circleR(t, a, b, R = 1250) { return E.inCubic(P(t, a, b)) * R; }
function maskCircle(cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.1, r), 0, TAU); ctx.clip(); }
function maskSlices(t, t0) {
  ctx.beginPath();
  const n = 6, hh = H / n;
  for (let i = 0; i < n; i++) {
    const p = E.inOutCubic(P(t, t0 + i * 0.018, t0 + i * 0.018 + 0.13));
    const xl = W + 200 - (W + 520) * p;
    ctx.moveTo(xl + 70, i * hh); ctx.lineTo(W + 400, i * hh); ctx.lineTo(W + 400, (i + 1) * hh + 1); ctx.lineTo(xl, (i + 1) * hh + 1); ctx.closePath();
  }
  ctx.clip();
}
function wipeX(t, t0, d = 0.14) { return W + 300 - (W + 700) * E.inOutCubic(P(t, t0, t0 + d)); }
function maskWipe(t, t0) {
  const xl = wipeX(t, t0);
  ctx.beginPath(); ctx.moveTo(xl + 220, 0); ctx.lineTo(W + 40, 0); ctx.lineTo(W + 40, H); ctx.lineTo(xl, H); ctx.closePath(); ctx.clip();
}
function maskBlinds(t, t0, n = 10) {
  ctx.beginPath();
  const w = W / n;
  for (let i = 0; i < n; i++) {
    const p = E.inOutCubic(P(t, t0 + i * 0.012, t0 + i * 0.012 + 0.14));
    ctx.rect(i * w - 1, -10, w + 2, (H + 20) * p);
  }
  ctx.clip();
}
function maskRise(t, t0) {
  const p = E.inOutCubic(P(t, t0, t0 + 0.16));
  ctx.beginPath(); ctx.rect(-20, H + 20 - (H + 40) * p, W + 40, H + 40); ctx.clip();
}
function maskCurtain(t, t0) {
  const p = E.inOutCubic(P(t, t0, t0 + 0.21));
  const top = H + 120 - (H + 360) * p;
  ctx.beginPath(); ctx.moveTo(-20, top + 120); ctx.bezierCurveTo(W * 0.3, top - 60, W * 0.7, top - 60, W + 20, top + 120);
  ctx.lineTo(W + 20, H + 20); ctx.lineTo(-20, H + 20); ctx.closePath(); ctx.clip();
}

// ------------------------------------------------------------------ SCENE: intro (0-2)
const LX = 960, LY = 505;
function sIntro(t) {
  const g = ctx.createRadialGradient(LX, LY, 40, LX, LY, 1250);
  g.addColorStop(0, '#26314D'); g.addColorStop(0.55, C.ink); g.addColorStop(1, '#0A0E19');
  ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80);

  const gp = E.outCubic(P(t, 0.08, 1.3));
  ctx.save(); ctx.strokeStyle = C.paper; ctx.lineWidth = 1; ctx.globalAlpha = 0.05;
  ctx.beginPath();
  for (let x = LX % 60; x < W; x += 60) { const pp = clamp(gp * 1.7 - Math.abs(x - LX) / 960); if (pp > 0) { ctx.moveTo(x, LY - 600 * pp); ctx.lineTo(x, LY + 600 * pp); } }
  for (let y = LY % 60; y < H; y += 60) { const pp = clamp(gp * 1.7 - Math.abs(y - LY) / 600); if (pp > 0) { ctx.moveTo(LX - 1000 * pp, y); ctx.lineTo(LX + 1000 * pp, y); } }
  ctx.stroke(); ctx.restore();

  const ch = E.outExpo(P(t, 0.05, 0.5));
  ctx.save();
  ctx.strokeStyle = C.mustard; ctx.globalAlpha = lerp(0.8, 0.14, P(t, 0.5, 1.2)); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(LX - 1000 * ch, LY); ctx.lineTo(LX + 1000 * ch, LY); ctx.moveTo(LX, LY - 600 * ch); ctx.lineTo(LX, LY + 600 * ch); ctx.stroke();
  ctx.beginPath();
  for (let k = -15; k <= 15; k++) { if (!k) continue; const d = k * 30 * ch; const L = k % 5 ? 5 : 12; ctx.moveTo(LX + d, LY - L); ctx.lineTo(LX + d, LY + L); ctx.moveTo(LX - L, LY + d); ctx.lineTo(LX + L, LY + d); }
  ctx.stroke(); ctx.restore();

  const dp = E.outBack(P(t, 0, 0.18), 3);
  ctx.save(); ctx.globalAlpha = 1 - P(t, 0.5, 0.8);
  ctx.fillStyle = C.mustard; ctx.beginPath(); ctx.arc(LX, LY, 8 * dp, 0, TAU); ctx.fill();
  for (let k = 0; k < 3; k++) {
    const p = P(t, 0.02 + k * 0.1, 0.6 + k * 0.1);
    if (p <= 0 || p >= 1) continue;
    ctx.strokeStyle = C.mustard; ctx.globalAlpha = (1 - p) * 0.6; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(LX, LY, 12 + 320 * E.outCubic(p), 0, TAU); ctx.stroke();
  }
  ctx.restore();

  const D = 520 * (1 + 0.05 * E.inOutCubic(P(t, 0.9, 2.0)));
  drawOrbits(t, D, 'back');
  const discP = E.inOutCubic(P(t, 0.22, 0.85));
  if (discP > 0) {
    ctx.save(); wedgePath(LX, LY, D * 0.49, -Math.PI / 2, -Math.PI / 2 + TAU * discP); ctx.clip();
    ctx.fillStyle = '#1F2842'; ctx.beginPath(); ctx.arc(LX, LY, D * 0.487, 0, TAU); ctx.fill();
    logoPart('outer', 'white', LX, LY, D);
    ctx.restore();
    if (discP < 1) {
      const a = -Math.PI / 2 + TAU * discP;
      ctx.fillStyle = C.mustard; ctx.beginPath(); ctx.arc(LX + Math.cos(a) * D * 0.485, LY + Math.sin(a) * D * 0.485, 7, 0, TAU); ctx.fill();
    }
  }
  const tp = E.inOutCubic(P(t, 0.34, 1.0));
  if (tp > 0) {
    ctx.save(); wedgePath(LX, LY, D, Math.PI / 2, Math.PI / 2 - TAU * tp); ctx.clip();
    logoPart('text', 'white', LX, LY, D, lerp(-1.1, 0, E.outCubic(P(t, 0.34, 1.15))));
    ctx.restore();
  }
  const cp = P(t, 0.55, 1.05);
  if (cp > 0) {
    const s = spring(cp * 0.9, 6, 0.35);
    ctx.save(); ctx.beginPath(); ctx.rect(0, LY + D * 0.33 - D * 0.7 * E.outExpo(cp), W, H); ctx.clip();
    logoPart('core', 'mustard', LX, LY, D * lerp(0.7, 1, s));
    ctx.restore();
  }
  drawOrbits(t, D, 'front');

  const ty = LY + D / 2 + 95;
  chars('BUSANDONG HIGH SCHOOL', LX, ty, { font: F(28, 700), color: C.paper, align: 'center', ls: 16 }, i => {
    const p = E.outExpo(P(t, 1.0 + i * 0.016, 1.4 + i * 0.016));
    return { dy: (1 - p) * 26, a: p };
  });
  typeOn('SCIENCE-FOCUSED SCHOOL  ·  OPEN LAB NO.07', LX, ty + 44, t, 1.15, 1.55, { font: F(16, 700, FM), color: C.mustard, align: 'center', ls: 5, alpha: 0.85 });

  if (t > 1.7) {
    const r = circleR(t, 1.72, 2.0);
    ctx.strokeStyle = C.mustard; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(LX, LY, r + 12, 0, TAU); ctx.stroke();
  }
}

function drawOrbits(t, D, half) {
  const rx = D * 0.78, ry = D * 0.2;
  for (let k = 0; k < 3; k++) {
    const rot = [-0.45, 0.45, Math.PI / 2][k];
    const p = E.inOutCubic(P(t, 0.45 + k * 0.09, 1.25 + k * 0.09));
    if (p <= 0) continue;
    const pt = th => {
      const x = rx * Math.cos(th), y = ry * Math.sin(th);
      return [LX + x * Math.cos(rot) - y * Math.sin(rot), LY + x * Math.sin(rot) + y * Math.cos(rot)];
    };
    ctx.save(); ctx.strokeStyle = C.paper; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.4;
    ctx.beginPath();
    const s0 = -Math.PI / 2, end = s0 + TAU * p;
    let pen = false;
    for (let i = 0; i <= 90; i++) {
      const th = s0 + (end - s0) * i / 90;
      const inHalf = half === 'back' ? Math.sin(th) < 0 : Math.sin(th) >= 0;
      const [X, Y] = pt(th);
      if (inHalf) { if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y); } else pen = false;
    }
    ctx.stroke(); ctx.restore();
    const th = end + Math.max(0, t - 1.25 - k * 0.09) * 3.2;
    if ((half === 'back') !== (Math.sin(th) >= 0)) {
      const [X, Y] = pt(th);
      ctx.save(); ctx.fillStyle = C.mustard; ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.arc(X, Y, 15, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X, Y, 6, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
}

// ------------------------------------------------------------------ bento card helper
function bento(x, y, w, h, t0, t, fill, fn, shadow = true) {
  const p = spring(P(t, t0, t0 + 0.45), 6, 0.42);
  if (p <= 0) return;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2 + 50 * (1 - E.outExpo(P(t, t0, t0 + 0.35))));
  const s = lerp(0.88, 1, p);
  ctx.scale(s, s);
  ctx.globalAlpha *= clamp(P(t, t0, t0 + 0.08));
  ctx.translate(-w / 2, -h / 2);
  if (shadow) { ctx.fillStyle = 'rgba(21,27,44,0.07)'; rrect(0, 10, w, h, 26); ctx.fill(); }
  ctx.fillStyle = fill; rrect(0, 0, w, h, 26); ctx.fill();
  ctx.save(); rrect(0, 0, w, h, 26); ctx.clip();
  fn(t - t0, w, h);
  ctx.restore();
  ctx.restore();
}
function countUp(v, u, d = 0.45) { return Math.round(v * E.outCubic(P(u, 0.02, d))); }

/** Big stat: number + unit, baseline at y. */
function stat(x, y, u, value, unit, color, size = 150) {
  text(String(countUp(value, u)), x, y, { font: F(size, 900), color, ls: -2 });
  text(unit, x + measure(String(value), F(size, 900), -2) + 10, y, { font: F(size * 0.34, 800), color });
}

// ------------------------------------------------------------------ SCENE: school bento (2-6)
function sSchool(t) {
  ctx.fillStyle = C.paper; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(C.ink, 0.045, 60);
  const hp = E.outExpo(P(t, 2.0, 2.35));
  text('ABOUT BUSANDONG H.S.', 96, 138, { font: F(17, 700, FM), color: C.slate, ls: 5, alpha: hp });
  riseText('탐구가 일상인 학교, 부산동고', 96, 206, t, 2.02, { size: 54, font: F(54, 800), color: C.ink, stagger: 0.012 });

  bento(96, 250, 600, 730, 2.0, t, C.ink2, (u, w, h) => {
    text('SCIENCE-FOCUSED SCHOOL', 44, 64, { font: F(16, 700, FM), color: C.mustard, ls: 4 });
    text('과학중점학교', 44, 124, { font: F(44, 800), color: C.paper });
    stat(44, 330, u, 6, '년째', C.paper, 190);
    text('2020년부터 지속 운영', 44, 386, { font: F(24, 500), color: C.paper, alpha: 0.6 });
    const bx = 44, by = h - 90, bw = 56, gap = (w - 88 - bw * 7) / 6;
    for (let i = 0; i < 7; i++) {
      const p = spring(P(u, 0.1 + i * 0.05, 0.6 + i * 0.05), 5, 0.45);
      const hh = (70 + i * 30) * p;
      ctx.fillStyle = i === 6 ? C.mustard : 'rgba(242,238,230,0.22)';
      rrect(bx + i * (bw + gap), by - hh, bw, hh, 8); ctx.fill();
      text(`'${20 + i}`, bx + i * (bw + gap) + bw / 2, by + 40, { font: F(18, 700, FM), color: C.paper, align: 'center', alpha: i === 6 ? 1 : 0.5 });
    }
  });
  const small = [
    [716, 250, 540, 355, 2.5, C.card, '수학·과학 영재학급', 'GIFTED CLASS', 11, '년', '2015년부터 운영', C.ink, C.blue],
    [1276, 250, 548, 355, 3.0, C.mustard, '영재교육 프로그램', 'PER YEAR', 100, '시간+', '과학중점학교 연계 운영', C.ink, C.ink],
    [716, 625, 540, 355, 3.5, C.card, '개방 무한상상실', 'MAKER SPACE', 40, '종+', '메이커 장비 · 자격 인증제로 자유 이용', C.ink, C.rose],
    [1276, 625, 548, 355, 4.0, C.card, '수학·과학 체험 프로그램', 'PROGRAMS', 10, '여 종', '매년 자체 개발 · 운영', C.ink, C.sage],
  ];
  for (const [x, y, w, h, t0, fill, ko, en, v, unit, foot, fg, ac] of small) {
    bento(x, y, w, h, t0, t, fill, (u, bw) => {
      ctx.fillStyle = ac; ctx.fillRect(0, 0, bw, 6);
      text(ko, 40, 74, { font: F(30, 800), color: fg });
      text(en, bw - 40, 72, { font: F(15, 700, FM), color: fg, align: 'right', ls: 3, alpha: 0.5 });
      stat(40, 238, u, v, unit, fg, 140);
      text(foot, 40, 300, { font: F(22, 500), color: fg, alpha: 0.6 });
    });
  }
}

// ------------------------------------------------------------------ SCENE: "오늘의 탐구가" (6-8)
function sTag1(t) {
  ctx.fillStyle = C.ink; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(C.paper, 0.035, 60);
  const y = 590, size = 230;
  const res = riseText('오늘의 탐구가', 960, y, t, 6.02, { size, color: C.paper, align: 'center', stagger: 0.045, dur: 0.55,
    colorFn: i => (i === 4 || i === 5 ? C.mustard : C.paper) });
  const mx = (res.xs[4] + res.xs[5]) / 2, my = y - 85, mr = 200;
  const rp = E.inOutCubic(P(t, 6.25, 6.65));
  if (rp > 0) {
    ctx.save(); ctx.strokeStyle = C.rose; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(mx, my, mr, -2.3, -2.3 + TAU * rp); ctx.stroke();
    const hp = E.outCubic(P(t, 6.55, 6.75));
    if (hp > 0) {
      const a = Math.PI / 4, x0 = mx + Math.cos(a) * (mr + 6), y0 = my + Math.sin(a) * (mr + 6);
      ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + 100 * hp, y0 + 100 * hp); ctx.stroke();
    }
    ctx.restore();
  }
  const sp = E.outExpo(P(t, 6.9, 7.3));
  text('12개 동아리가 준비한 32가지 체험', 960, 760 + 20 * (1 - sp), { font: F(40, 600), color: C.paper, align: 'center', alpha: 0.75 * sp });
  typeOn("TODAY'S CURIOSITY", 960, 820, t, 7.0, 7.3, { font: F(17, 700, FM), color: C.mustard, align: 'center', ls: 8 });
}

// ------------------------------------------------------------------ booth card system (8-24)
function fitHeadSize(lines, maxW) {
  let size = 96;
  for (const l of lines) size = Math.min(size, Math.floor(96 * maxW / measure(l, F(96, 800))));
  return size;
}
function card(t, S, opts = {}) {
  const u = t - S.t0;
  ctx.fillStyle = S.bg; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(S.dark ? C.paper : C.ink, S.dark ? 0.035 : 0.045, 60);

  ctx.save();
  const z = 1 + 0.05 * P(u, 0, CARD_DUR) + 0.1 * (1 - E.outExpo(P(u, -0.1, 0.45)));
  S.il(u, 1390, 540, z, t, S);
  ctx.restore();

  const x0 = 120;
  ctx.save(); ctx.translate(-26 * P(u, 0, CARD_DUR), 0);
  const lp = E.outExpo(P(u, -0.02, 0.35));
  ctx.save(); ctx.globalAlpha = lp; ctx.translate(-40 * (1 - lp), 0);
  const iw = text(`${S.idx} / 08`, x0, 196, { font: F(18, 800, FM), color: S.ac, ls: 3 });
  text(S.en, x0 + iw + 26, 196, { font: F(18, 700, FM), color: S.fg, ls: 5, alpha: 0.55 });
  text(S.club, x0, 248, { font: F(30, 700), color: S.fg, alpha: 0.72 });
  ctx.restore();
  // headline: the featured booth, verbatim
  const hs = fitHeadSize(S.head, 780);
  S.head.forEach((line, li) => riseText(line, x0, 364 + li * hs * 1.12, u, 0.05 + li * 0.08, { size: hs, font: F(hs, 800), color: S.fg, stagger: 0.016 }));
  const yAfter = 364 + (S.head.length - 1) * hs * 1.12;
  // location chip
  const cy = yAfter + 48;
  const chipP = spring(P(u, 0.25, 0.7), 6, 0.4);
  if (chipP > 0) {
    const f = F(26, 800), cw = measure(S.room, f) + 78;
    ctx.save(); ctx.translate(x0, cy); ctx.scale(chipP, chipP);
    rrect(0, 0, cw, 54, 27); ctx.fillStyle = S.ac; ctx.fill();
    pin(30, 38, 1.05, S.dark ? C.ink : C.paper, S.ac);
    text(S.room, 52, 36, { font: f, color: S.dark ? C.ink : C.paper });
    ctx.restore();
  }
  // program list
  const ly = cy + 106;
  const dp = E.outExpo(P(u, 0.3, 0.7));
  ctx.fillStyle = S.fg; ctx.globalAlpha = 0.2; ctx.fillRect(x0, ly - 38, 700 * dp, 1.5); ctx.globalAlpha = 1;
  text('PROGRAM', x0 + 700 * dp - 90, ly - 50, { font: F(13, 700, FM), color: S.fg, ls: 3, alpha: 0.45 * dp });
  S.list.forEach((item, i) => {
    const p = E.outExpo(P(u, 0.36 + i * 0.07, 0.8 + i * 0.07));
    if (p <= 0) return;
    const yy = ly + i * 48;
    const feat = i === S.feat;
    ctx.save(); ctx.globalAlpha = p; ctx.translate(30 * (1 - p), 0);
    text(String(i + 1).padStart(2, '0'), x0, yy, { font: F(17, 800, FM), color: S.ac });
    text(item, x0 + 46, yy, { font: F(25, feat ? 800 : 500), color: S.fg, alpha: feat ? 1 : 0.62 });
    if (feat) { ctx.fillStyle = S.ac; ctx.beginPath(); ctx.arc(x0 + 56 + measure(item, F(25, 800)) + 8, yy - 9, 5, 0, TAU); ctx.fill(); }
    ctx.restore();
  });
  ctx.restore();

  if (!opts.noEdge && u < 0.05) {
    const xl = wipeX(t, S.t0 - 0.1);
    ctx.fillStyle = S.ac;
    ctx.beginPath(); ctx.moveTo(xl + 220, 0); ctx.lineTo(xl + 236, 0); ctx.lineTo(xl + 16, H); ctx.lineTo(xl, H); ctx.closePath(); ctx.fill();
  }
}

// ------------------------------------------------------------------ illustrations
function ilPhysics(u, cx, cy, s) {
  const R = 420 * s;
  ctx.save(); ctx.translate(cx, cy);
  ctx.strokeStyle = C.paper; ctx.globalAlpha = 0.2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 72; k++) { const a = k * TAU / 72 + u * 0.12; const L = k % 6 ? 7 : 18; ctx.moveTo(Math.cos(a) * (R + 6), Math.sin(a) * (R + 6)); ctx.lineTo(Math.cos(a) * (R + 6 + L), Math.sin(a) * (R + 6 + L)); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
  ctx.fillStyle = 'rgba(242,238,230,0.03)'; ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const tr of TRACKS) {
    const f = E.outCubic(P(u, tr.b - 0.05, tr.b + 0.4));
    if (f <= 0) continue;
    const fade = 1 - 0.7 * P(u, tr.b + 0.5, tr.b + 1.4);
    const n = Math.max(2, Math.floor(tr.pts.length * f));
    const col = tr.type === 'a' ? C.mustard : tr.type === 'b' ? C.paper : C.blue;
    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = tr.pts[i]; if (i) ctx.lineTo(x * s, y * s); else ctx.moveTo(x * s, y * s); }
      ctx.strokeStyle = col; ctx.globalAlpha = fade * (pass ? 0.9 : 0.12);
      ctx.lineWidth = tr.w * s * (pass ? 1 : 3.4); ctx.stroke();
    }
  }
  ctx.restore();
  const sp = E.outBack(P(u, 0, 0.3), 2);
  ctx.save(); ctx.rotate(u * 0.8); ctx.scale(sp * s, sp * s);
  ctx.fillStyle = C.mustard; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + k * TAU / 3;
    ctx.beginPath(); ctx.arc(0, 0, 62, a - 0.52, a + 0.52); ctx.arc(0, 0, 24, a + 0.52, a - 0.52, true); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  text('CLOUD CHAMBER · α β μ', 0, R + 58 * s, { font: F(16 * s, 700, FM), color: C.paper, align: 'center', ls: 4, alpha: 0.55 });
  ctx.restore();
}

function drawMolecule(u, s, ry0) {
  const ry = ry0 + u * 1.6, rx = 0.3 + 0.3 * Math.sin(u * 1.8);
  const cy_ = Math.cos(ry), sy_ = Math.sin(ry), cx_ = Math.cos(rx), sx_ = Math.sin(rx);
  const U = 118 * s;
  const proj = MOL.A.map(a => {
    const x = a.x * cy_ + a.z * sy_; let z = -a.x * sy_ + a.z * cy_;
    const y = a.y * cx_ - z * sx_; z = a.y * sx_ + z * cx_;
    const per = 6 / (6 - z);
    return { x: x * U * per, y: -y * U * per, z, per, el: a.el };
  });
  const items = [];
  MOL.B.forEach(([i, j, o]) => items.push({ z: (proj[i].z + proj[j].z) / 2 - 0.01, bond: [i, j, o] }));
  proj.forEach((p, i) => items.push({ z: p.z, atom: i }));
  items.sort((a, b) => a.z - b.z);
  const RAD = { C: 0.3, N: 0.3, O: 0.33, H: 0.19 };
  const COL = { C: ['#4A5470', C.ink], N: ['#A9BDDC', C.blue], O: ['#E9B2A9', C.rose], H: ['#FFFFFF', '#E4E0D8'] };
  for (const it of items) {
    if (it.bond) {
      const [i, j, o] = it.bond;
      const a = proj[i], b = proj[j];
      const k = Math.min(E.outBack(P(u, 0.1 + i * 0.015, 0.4 + i * 0.015)), E.outBack(P(u, 0.1 + j * 0.015, 0.4 + j * 0.015)));
      if (k <= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      for (const of of (o === 2 ? [-6 * s, 6 * s] : [0])) {
        ctx.strokeStyle = C.ink; ctx.lineWidth = (o === 2 ? 5 : 8) * s * a.per; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.x + nx * of, a.y + ny * of); ctx.lineTo(a.x + dx * k + nx * of, a.y + dy * k + ny * of); ctx.stroke();
      }
    } else {
      const p = proj[it.atom];
      const sc = E.outBack(P(u, 0.1 + it.atom * 0.015, 0.4 + it.atom * 0.015), 2);
      if (sc <= 0) continue;
      const r = RAD[p.el] * U * p.per * sc;
      const gr = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      gr.addColorStop(0, COL[p.el][0]); gr.addColorStop(1, COL[p.el][1]);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    }
  }
}

function ilChem(u, cx, cy, s) {
  ctx.save(); ctx.translate(cx - 60 * s, cy + 30 * s); ctx.scale(s, s);
  const topW = 300, botW = 240, gh = 520, gy = -gh / 2;
  const glass = () => { ctx.beginPath(); ctx.moveTo(-topW / 2, gy); ctx.lineTo(topW / 2, gy); ctx.lineTo(botW / 2, gy + gh); ctx.lineTo(-botW / 2, gy + gh); ctx.closePath(); };
  ctx.fillStyle = 'rgba(21,27,44,0.06)'; ctx.beginPath(); ctx.ellipse(0, gy + gh + 14, 190, 22, 0, 0, TAU); ctx.fill();
  ctx.save(); glass(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-topW, gy, topW * 2, gh);
  const fill = E.outCubic(P(u, 0.0, 0.5));
  const milkTop = gy + gh - gh * 0.62 * fill;
  const wave = x => 5 * Math.sin(x * 0.04 + u * 5);
  ctx.beginPath(); ctx.moveTo(-topW, milkTop + wave(-topW));
  for (let x = -topW / 2; x <= topW / 2; x += 10) ctx.lineTo(x, milkTop + wave(x));
  ctx.lineTo(topW, gy + gh); ctx.lineTo(-topW, gy + gh); ctx.closePath();
  const mg = ctx.createLinearGradient(0, milkTop, 0, gy + gh);
  mg.addColorStop(0, '#E9D7C0'); mg.addColorStop(0.25, '#F8F3EA'); mg.addColorStop(1, '#FBF8F2');
  ctx.fillStyle = mg; ctx.fill();
  if (fill > 0.3) {
    for (const ic of ICE) {
      const iy = milkTop + 40 + ic.y + 6 * Math.sin(u * 3 + ic.ph);
      ctx.save(); ctx.translate(ic.x, iy); ctx.rotate(ic.rot + 0.1 * Math.sin(u * 2 + ic.ph));
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; rrect(-ic.s / 2, -ic.s / 2, ic.s, ic.s, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(111,142,190,0.35)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    }
  }
  // dalgona foam lands on top
  const fp = spring(P(u, 0.35, 0.95), 6, 0.45);
  if (fp > 0) {
    const fh = 120, fTop = milkTop - fh * clamp(fp, 0, 1.2) + 10;
    ctx.beginPath(); ctx.moveTo(-topW, milkTop + 12);
    for (let x = -topW / 2; x <= topW / 2; x += 10) ctx.lineTo(x, fTop + 10 * Math.sin(x * 0.05) + 6 * Math.cos(x * 0.11));
    ctx.lineTo(topW, milkTop + 12); ctx.closePath();
    const fg = ctx.createLinearGradient(0, fTop, 0, milkTop);
    fg.addColorStop(0, '#D39A55'); fg.addColorStop(1, '#B97B3E');
    ctx.fillStyle = fg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k < 60; k++) { const a = k * 0.35 + u * 1.5, rr = k * 1.6; const px = Math.cos(a) * rr, py = fTop + 36 + Math.sin(a) * rr * 0.25; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (const b of BUBBLES) { const yy = gy + gh - ((u * b.sp + b.ph) % 1) * (gy + gh - milkTop) - 10; if (yy > milkTop + 20) { ctx.beginPath(); ctx.arc(b.x, yy, b.rad * 0.6, 0, TAU); ctx.fill(); } }
  ctx.restore();
  ctx.strokeStyle = C.rose; ctx.lineWidth = 16; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(60, gy + gh - 60); ctx.lineTo(120, gy - 90); ctx.lineTo(190, gy - 130); ctx.stroke();
  glass(); ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(-topW / 2 + 26, gy + 40); ctx.lineTo(-botW / 2 + 30, gy + gh - 60); ctx.stroke();
  // caffeine inset
  const mp = E.outExpo(P(u, 0.55, 0.9));
  if (mp > 0) {
    ctx.save(); ctx.translate(330, -190); ctx.globalAlpha = mp;
    ctx.fillStyle = C.card; ctx.beginPath(); ctx.arc(0, 0, 150, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.globalAlpha = mp * 0.15; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = mp;
    drawMolecule(u, 0.42, -0.6);
    let fx = -62;
    for (const [tx, sub] of [['C', '8'], ['H', '10'], ['N', '4'], ['O', '2']]) {
      fx += text(tx, fx, 196, { font: F(24, 800, FM), color: C.ink });
      fx += text(sub, fx, 204, { font: F(15, 800, FM), color: C.ink }) + 3;
    }
    text('CAFFEINE', 0, 228, { font: F(14, 700, FM), color: C.slate, align: 'center', ls: 4 });
    ctx.restore();
  }
  text('DALGONA COFFEE', 0, gy + gh + 76, { font: F(16, 700, FM), color: C.ink, align: 'center', ls: 5, alpha: 0.55 });
  ctx.restore();
}

function ilLife(u, cx, cy, s) {
  const R = 390 * s;
  ctx.save(); ctx.translate(cx, cy);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
  ctx.fillStyle = '#EEF3EC'; ctx.fillRect(-R, -R, 2 * R, 2 * R);
  const zoom = lerp(1.5, 1.0, E.outCubic(P(u, -0.05, 0.6))) * s;
  const blur = 7 * (1 - P(u, -0.05, 0.3));
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.save(); ctx.rotate(0.15 + u * 0.08); ctx.scale(zoom, zoom);
  for (const c of CELLS) {
    if (Math.hypot(c.cx, c.cy) * zoom > R + 130 * s) continue;
    ctx.beginPath();
    c.poly.forEach((v, i) => { const x = c.cx + (v[0] - c.cx) * 0.9, y = c.cy + (v[1] - c.cy) * 0.9; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = c.hue > 0.5 ? '#D3E3D6' : '#DCE9DE'; ctx.fill();
    ctx.strokeStyle = '#6E957E'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = '#8DB29A';
    for (const [x, y, a] of c.chl) { ctx.beginPath(); ctx.ellipse(c.cx + x * 0.8, c.cy + y * 0.8, 7, 4, a + u * 0.6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = C.ink; ctx.globalAlpha = 0.72;
    ctx.beginPath(); ctx.arc(c.cx + c.nx, c.cy + c.ny, 12, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.filter = 'none';
  ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.stroke();
  ctx.beginPath(); for (let k = -8; k <= 8; k++) { ctx.moveTo(k * 40 * s, -7); ctx.lineTo(k * 40 * s, 7); } ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 18 * s; ctx.beginPath(); ctx.arc(0, 0, R + 9 * s, 0, TAU); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(0, 0, R + 40 * s, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  rrect(R * 0.55, R * 0.74, 140 * s, 58 * s, 29 * s); ctx.fillStyle = C.sage; ctx.fill();
  text('×400', R * 0.55 + 70 * s, R * 0.74 + 40 * s, { font: F(28 * s, 900), color: C.paper, align: 'center' });
  text('PLANT CELL · 식물세포', -R * 0.95, R + 70 * s, { font: F(16 * s, 700, FM), color: C.ink, ls: 3, alpha: 0.55 });
  ctx.restore();
}

function ilEarth(u, cx, cy, s) {
  const w = 680 * s, h = 740 * s;
  ctx.save(); ctx.translate(cx, cy);
  const x0 = -w / 2, y0 = -h / 2;
  ctx.save(); rrect(x0, y0, w, h, 34 * s); ctx.clip();
  ctx.fillStyle = 'rgba(242,238,230,0.04)'; ctx.fillRect(x0, y0, w, h);
  const lvl = E.outCubic(P(u, -0.05, 0.45));
  const surf = y0 + h - h * 0.9 * lvl;
  const bY = x => 70 * s + 24 * s * Math.sin(x * 0.011 / s + u * 3) + 10 * s * Math.sin(x * 0.029 / s - u * 4.5);
  const sY = x => surf + 10 * s * Math.sin(x * 0.02 / s + u * 6);
  ctx.beginPath(); ctx.moveTo(x0, sY(x0));
  for (let x = x0; x <= -x0; x += 10) ctx.lineTo(x, sY(x));
  ctx.lineTo(-x0, h); ctx.lineTo(x0, h); ctx.closePath();
  ctx.fillStyle = 'rgba(169,189,220,0.28)'; ctx.fill();
  const bl = Math.max(surf, 0);
  ctx.beginPath(); ctx.moveTo(x0, Math.max(bl, bY(x0)));
  for (let x = x0; x <= -x0; x += 10) ctx.lineTo(x, Math.max(bl, bY(x)));
  ctx.lineTo(-x0, h); ctx.lineTo(x0, h); ctx.closePath();
  ctx.fillStyle = 'rgba(14,19,34,0.62)'; ctx.fill();
  ctx.strokeStyle = C.paper; ctx.lineWidth = 1.6 * s; ctx.globalAlpha = 0.28;
  for (let k = 0; k < 4; k++) {
    const yy = lerp(surf + 40 * s, 30 * s, (k + 0.5) / 4);
    if (yy < surf) continue;
    ctx.beginPath();
    for (let x = x0; x <= -x0; x += 12) { const y = yy + 7 * s * Math.sin(x * 0.02 / s + u * 5 + k); if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.6; ctx.fillStyle = C.mustard;
  const rr = mulberry32(9);
  for (let k = 0; k < 40; k++) {
    const x = x0 + ((rr() * w - u * 50 * s + w * 4) % w), y = 110 * s + rr() * (h / 2 - 140 * s);
    if (y > bY(x) + 6 * s) { ctx.beginPath(); ctx.arc(x, y, (1.5 + rr() * 2.5) * s, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  if (lvl > 0.6) {
    const bp = E.outCubic(P(u, 0.3, 0.75));
    for (const [lw, a] of [[14, 0.18], [4, 1]]) {
      ctx.beginPath();
      for (let x = x0; x <= x0 + w * bp; x += 8) { if (x === x0) ctx.moveTo(x, bY(x)); else ctx.lineTo(x, bY(x)); }
      ctx.strokeStyle = C.mustard; ctx.globalAlpha = a; ctx.lineWidth = lw * s; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.strokeStyle = C.paper; ctx.lineWidth = 4 * s; ctx.globalAlpha = 0.85; rrect(x0, y0, w, h, 34 * s); ctx.stroke();
  ctx.fillStyle = C.paper; rrect(x0 - 30 * s, y0 + h + 12 * s, w + 60 * s, 14 * s, 7 * s); ctx.fill();
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6; ctx.beginPath();
  for (let k = 0; k <= 10; k++) { const y = y0 + 40 * s + k * (h - 80 * s) / 10; ctx.moveTo(x0 - 20 * s, y); ctx.lineTo(x0 - (k % 5 ? 32 : 46) * s, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  for (let k = 0; k <= 10; k += 5) text(`${k * 10}m`, x0 - 56 * s, y0 + 46 * s + k * (h - 80 * s) / 10, { font: F(15 * s, 700, FM), color: C.paper, align: 'right', alpha: 0.6 });
  const cp = E.outExpo(P(u, 0.6, 0.9));
  if (cp > 0) {
    const bx = -x0 - 20 * s, by = bY(-x0 - 20 * s);
    ctx.strokeStyle = C.mustard; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 60 * s * cp, by - 70 * s * cp); ctx.lineTo(bx + 60 * s * cp + 40 * s, by - 70 * s * cp); ctx.stroke();
    text('HALOCLINE', bx + 110 * s, by - 76 * s, { font: F(18 * s, 800, FM), color: C.mustard, alpha: cp, ls: 3 });
    text('염분 경계', bx + 110 * s, by - 46 * s, { font: F(22 * s, 800), color: C.paper, alpha: cp });
  }
  ctx.restore();
}

function ilMaker(u, cx, cy, s) {
  ctx.save(); ctx.translate(cx, cy);
  const base = 270 * s, step = 7.2 * s, LMAX = 64;
  const prog = 10 + 52 * P(u, -0.02, 1.8);
  const Ln = Math.floor(prog), frac = prog - Ln;
  const Rf = h => s * (140 + 55 * Math.sin(h / LMAX * Math.PI * 1.15) - 25 * (h / LMAX));
  const layer = h => {
    const R = Rf(h), th = h * 0.045, y = base - h * step, pts = [];
    for (let k = 0; k < 6; k++) { const a = th + k * Math.PI / 3; pts.push([R * Math.cos(a), y + R * Math.sin(a) * 0.33]); }
    return pts;
  };
  ctx.fillStyle = 'rgba(21,27,44,0.06)'; ctx.strokeStyle = C.ink; ctx.lineWidth = 3 * s;
  ctx.beginPath(); ctx.ellipse(0, base + 10 * s, 300 * s, 92 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1; ctx.globalAlpha = 0.2; ctx.beginPath();
  for (let k = -5; k <= 5; k++) { const hh = 88 * s * Math.sqrt(1 - (k / 6) ** 2); ctx.moveTo(k * 50 * s, base + 10 * s - hh); ctx.lineTo(k * 50 * s, base + 10 * s + hh); }
  ctx.stroke(); ctx.globalAlpha = 1;
  for (let h = 0; h < Ln; h++) {
    const pts = layer(h);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = h % 2 ? '#CD887D' : C.rose; ctx.fill();
    ctx.strokeStyle = '#9E5D53'; ctx.lineWidth = 1.2 * s; ctx.stroke();
  }
  if (Ln > 0) {
    const pts = layer(Ln - 1);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = '#DDA79E'; ctx.fill();
  }
  const cur = layer(Ln);
  const perim = 6 * frac, seg = Math.floor(perim), sf = perim - seg;
  ctx.beginPath(); ctx.moveTo(cur[0][0], cur[0][1]);
  for (let k = 1; k <= seg; k++) ctx.lineTo(cur[k % 6][0], cur[k % 6][1]);
  const a = cur[seg % 6], b = cur[(seg + 1) % 6];
  const nx = lerp(a[0], b[0], sf), ny = lerp(a[1], b[1], sf);
  ctx.lineTo(nx, ny); ctx.strokeStyle = C.card; ctx.lineWidth = 3.5 * s; ctx.stroke();
  const top = -420 * s;
  ctx.strokeStyle = C.ink; ctx.lineCap = 'round';
  ctx.lineWidth = 10 * s; ctx.beginPath(); ctx.moveTo(-360 * s, base + 40 * s); ctx.lineTo(-360 * s, top); ctx.lineTo(360 * s, top); ctx.lineTo(360 * s, base + 40 * s); ctx.stroke();
  ctx.lineWidth = 6 * s; ctx.beginPath(); ctx.moveTo(-360 * s, ny - 96 * s); ctx.lineTo(360 * s, ny - 96 * s); ctx.stroke();
  ctx.fillStyle = C.ink; rrect(nx - 46 * s, ny - 128 * s, 92 * s, 66 * s, 12 * s); ctx.fill();
  ctx.beginPath(); ctx.moveTo(nx - 18 * s, ny - 62 * s); ctx.lineTo(nx + 18 * s, ny - 62 * s); ctx.lineTo(nx, ny - 8 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.mustard; ctx.fillRect(nx - 28 * s, ny - 110 * s, 16 * s, 5 * s);
  ctx.fillStyle = '#F6E7C4'; ctx.beginPath(); ctx.arc(nx, ny - 4 * s, 6 * s, 0, TAU); ctx.fill();
  text(`LAYER ${String(Ln * 2).padStart(3, '0')}/128  ·  PLA 210°C`, 0, base + 150 * s, { font: F(18 * s, 700, FM), color: C.ink, align: 'center', ls: 3, alpha: 0.7 });
  ctx.restore();
}

const HEART = ['.XX..XX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...', '........'];
function ilCode(u, cx, cy, s, tg) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.save(); ctx.beginPath(); ctx.rect(-470 * s, -470 * s, 940 * s, 940 * s); ctx.clip();
  const lh = 34 * s, off = (u * 120 * s) % (lh * CODE_LINES.length);
  for (let k = -1; k < 32; k++) {
    const line = CODE_LINES[((k % CODE_LINES.length) + CODE_LINES.length) % CODE_LINES.length];
    const y = -470 * s + k * lh - off + lh * CODE_LINES.length;
    if (y < -480 * s || y > 480 * s) continue;
    text(String(k % 99 + 1).padStart(2, '0'), -450 * s, y, { font: F(17 * s, 500, FM), color: C.sage, alpha: 0.2 });
    text(line, -400 * s, y, { font: F(19 * s, 500, FM), color: line.startsWith('#') ? C.mustard : C.sage, alpha: 0.3 });
  }
  ctx.restore();
  const B = 600 * s;
  const bp = E.outBack(P(u, -0.05, 0.35), 1.4);
  ctx.save(); ctx.scale(bp, bp); ctx.rotate(-0.04 + 0.015 * Math.sin(u * 2));
  ctx.fillStyle = '#1B2336'; rrect(-B / 2, -B / 2, B, B, 28 * s); ctx.fill();
  ctx.strokeStyle = C.sage; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
  text('SENSE HAT', -B / 2 + 26 * s, -B / 2 + 40 * s, { font: F(15 * s, 800, FM), color: C.sage, ls: 4, alpha: 0.7 });
  const pitch = 62 * s;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * pitch, y = (j - 3.5) * pitch + 16 * s;
    let col = null, br = 0;
    const tt = u - (i + j) * 0.018;
    if (tt < 0.6) {
      const d = ((tt * 16 + ((i * 7) % 5) * 1.7) % 11) - j;
      if (d >= 0 && d < 4) { col = C.sage; br = 1 - d / 4; }
    } else if (HEART[j][i] === 'X') { col = (i + j) % 5 === 0 ? C.mustard : C.rose; br = 0.85 + 0.15 * Math.sin(tg * 12.566); }
    ctx.fillStyle = '#263048'; ctx.beginPath(); ctx.arc(x, y, 22 * s, 0, TAU); ctx.fill();
    if (col && br > 0.05) {
      ctx.fillStyle = col; ctx.globalAlpha = 0.22 * br; ctx.beginPath(); ctx.arc(x, y, 32 * s, 0, TAU); ctx.fill();
      ctx.globalAlpha = br; ctx.beginPath(); ctx.arc(x, y, 21 * s, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  ctx.restore();
}

function ilMath(u, cx, cy, s) {
  ctx.save(); ctx.translate(cx, cy);
  const N = 200, R = 380 * s;
  const k = 2 + 1.5 * E.inOutCubic(P(u, 0.2, 1.9));
  const cnt = Math.floor(N * E.outCubic(P(u, -0.05, 0.5)));
  const pt = i => { const a = -Math.PI / 2 + (i / N) * TAU; return [Math.cos(a) * R, Math.sin(a) * R]; };
  ctx.lineWidth = 1.3 * s; ctx.strokeStyle = C.blue; ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (let i = 0; i < cnt; i++) { const [x1, y1] = pt(i), [x2, y2] = pt(i * k); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();
  ctx.strokeStyle = C.rose; ctx.globalAlpha = 0.85; ctx.lineWidth = 2 * s; ctx.beginPath();
  for (let i = 0; i < cnt; i += 10) { const [x1, y1] = pt(i), [x2, y2] = pt(i * k); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke(); ctx.globalAlpha = 1;
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.fillStyle = C.ink; ctx.beginPath();
  for (let i = 0; i < N; i += 2) { const [x, y] = pt(i); ctx.moveTo(x + 2.6 * s, y); ctx.arc(x, y, 2.6 * s, 0, TAU); }
  ctx.fill();
  text(`k = ${k.toFixed(2)}`, 0, R + 66 * s, { font: F(28 * s, 800, FM), color: C.ink, align: 'center' });
  text('n = 200 · STRING ART', 0, R + 98 * s, { font: F(15 * s, 700, FM), color: C.ink, align: 'center', ls: 3, alpha: 0.5 });
  ctx.restore();
}

function afBands(t) { return AF.bands[clamp(Math.round(t * AF.fps), 0, AF.bands.length - 1)]; }
function ilSound(u, cx, cy, s, tg, S) {
  ctx.save(); ctx.translate(cx, cy);
  const L = 24, w = 860 * s;
  const amp = E.outCubic(P(u, -0.05, 0.3));
  for (let k = 0; k < L; k++) {
    const vis = P(u, (L - 1 - k) * 0.012 - 0.05, (L - 1 - k) * 0.012 + 0.15);
    if (vis <= 0) continue;
    const base = -300 * s + k * 27 * s;
    const bands = afBands(tg - (L - 1 - k) * 0.035);
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const x = i / 72, bi = x * (bands.length - 1), b0 = Math.floor(bi), bf = bi - b0;
      const v = lerp(bands[b0], bands[Math.min(b0 + 1, bands.length - 1)], bf);
      const win = Math.exp(-Math.pow((x - 0.5) / 0.23, 2));
      pts.push([-w / 2 + x * w, base - Math.pow(v, 1.7) * win * 220 * s * amp * vis - win * 5 * s * Math.sin(i * 1.3 + k)]);
    }
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(w / 2, base + 60 * s); ctx.lineTo(-w / 2, base + 60 * s); ctx.closePath();
    ctx.fillStyle = S ? S.bg : C.navy; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = k === L - 1 ? C.rose : C.paper; ctx.lineWidth = (k === L - 1 ? 3.5 : 1.8) * s; ctx.globalAlpha = vis * (k === L - 1 ? 1 : 0.85); ctx.stroke(); ctx.globalAlpha = 1;
  }
  text('FFT · 48 BANDS · LIVE', 0, 420 * s, { font: F(16 * s, 700, FM), color: C.paper, align: 'center', ls: 4, alpha: 0.5 });
  ctx.restore();
}

// ------------------------------------------------------------------ SCENE: every booth (24-26)
const GR = (() => {
  const mx = 64, top = 150, gap = 16, pw = (W - mx * 2 - gap * 3) / 4, ph = (H - top - 150 - gap) / 2;
  return CARDS.map((c, i) => ({ x: mx + (i % 4) * (pw + gap), y: top + Math.floor(i / 4) * (ph + gap), w: pw, h: ph }));
})();
function sGrid(t) {
  ctx.fillStyle = C.paper2; ctx.fillRect(-40, -40, W + 80, H + 80);
  const t0 = T.grid;
  const shrink = E.inOutCubic(P(t, t0, t0 + 0.22));
  CARDS.forEach((S, i) => {
    if (i === 7 && shrink < 1) return;
    const st = t0 + 0.02 + [3, 4, 2, 5, 1, 6, 0, 7][i] * 0.02;
    const p = spring(P(t, st, st + 0.4), 6, 0.42);
    if (p <= 0) return;
    const R = GR[i];
    ctx.save(); ctx.translate(R.x + R.w / 2, R.y + R.h / 2); ctx.scale(p, p); ctx.translate(-R.w / 2, -R.h / 2);
    rrect(0, 0, R.w, R.h, 20); ctx.fillStyle = S.bg; ctx.fill();
    ctx.save(); rrect(0, 0, R.w, R.h, 20); ctx.clip();
    S.il(CARD_DUR * 0.8 + (t - t0), R.w / 2 + 10, R.h / 2 + 26, 0.36, t, S);
    ctx.restore();
    text(S.idx, 22, 42, { font: F(17, 800, FM), color: S.ac });
    text(S.club.split(' · ')[0], 62, 43, { font: F(24, 800), color: S.fg });
    text(S.room, R.w - 20, R.h - 20, { font: F(18, 700), color: S.fg, align: 'right', alpha: 0.65 });
    ctx.restore();
  });
  if (shrink < 1) {
    const R = GR[7];
    const x = lerp(0, R.x, shrink), y = lerp(0, R.y, shrink), w = lerp(W, R.w, shrink), h = lerp(H, R.h, shrink);
    ctx.save(); rrect(x, y, w, h, 20 * shrink); ctx.clip();
    ctx.translate(x, y); ctx.scale(w / W, h / H);
    card(t, CARDS[7], { noEdge: true });
    ctx.restore();
  }
  const hp = E.outExpo(P(t, t0 + 0.1, t0 + 0.45));
  ctx.save(); ctx.globalAlpha = hp; ctx.translate(0, -20 * (1 - hp));
  const f = F(46, 800);
  let x = 64;
  x += text(String(countUp(12, t - t0 - 0.1, 0.5)), x, 110, { font: F(46, 900), color: C.ink });
  x += text('개 동아리 · ', x, 110, { font: f, color: C.ink });
  x += text(String(countUp(32, t - t0 - 0.1, 0.5)), x, 110, { font: F(46, 900), color: C.rose });
  text('가지 체험', x, 110, { font: f, color: C.ink });
  text('12 CLUBS · 32 PROGRAMS', W - 64, 104, { font: F(16, 700, FM), color: C.slate, align: 'right', ls: 4 });
  ctx.restore();
  const fp = E.outExpo(P(t, t0 + 0.35, t0 + 0.7));
  ctx.save(); ctx.globalAlpha = fp; ctx.translate(0, 20 * (1 - fp));
  rrect(64, H - 112, 150, 44, 22); ctx.fillStyle = C.mustard; ctx.fill();
  text('창의탐구부', 139, H - 81, { font: F(21, 800), color: C.ink, align: 'center' });
  text('수학 방탈출 야호~ 오이데 (4F 모둠학습실)  ·  은하수 에이드  ·  머리가 빛나기 전에.. (1-6)  ·  화산폭발 (지구과학실)', 236, H - 82,
    { font: F(22, 600), color: C.ink, alpha: 0.8 });
  ctx.restore();
}

// ------------------------------------------------------------------ SCENE: "내일의 가능성이 되는 곳" (26-28)
function sTag2(t) {
  ctx.fillStyle = C.ink2; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(C.paper, 0.035, 60);
  const f1 = F(176, 800), y1 = 470, y2 = 685;
  const full = measure('내일의 가능성이', f1);
  const x0 = 960 - full / 2 + measure('내일의 ', f1), wv = measure('가능성', f1);
  const mp = E.inOutCubic(P(t, 26.35, 26.7));
  ctx.fillStyle = C.mustard; ctx.globalAlpha = 0.9;
  ctx.fillRect(x0 - 8, y1 + 8, (wv + 16) * mp, 22); ctx.globalAlpha = 1;
  riseText('내일의 가능성이', 960, y1, t, 26.02, { size: 176, font: f1, color: C.paper, align: 'center', stagger: 0.035,
    colorFn: i => (i >= 4 && i <= 6 ? C.mustard : C.paper) });
  riseText('되는 곳', 960, y2, t, 26.22, { size: 176, font: f1, color: C.paper, align: 'center', stagger: 0.035 });
  typeOn("TOMORROW'S POSSIBILITY", 960, 830, t, 26.7, 27.0, { font: F(17, 700, FM), color: C.mustard, align: 'center', ls: 8 });
  const sp = E.outExpo(P(t, 27.0, 27.4));
  text('탐구는 진학으로 이어집니다', 960, 900 + 20 * (1 - sp), { font: F(34, 600), color: C.paper, align: 'center', alpha: 0.7 * sp });
}

// ------------------------------------------------------------------ SCENE: 2026 admissions (28-32)
const RESULTS = [
  { cat: '의·치·수의예 계열', en: 'MEDICAL', ac: C.rose, rows: [['경북대', 2], ['동아대', 1], ['고신대', 1], ['경상국립대', 1]] },
  { cat: '서울 주요 대학', en: 'SEOUL', ac: C.blue, rows: [['고려대', 2], ['서울대', 1], ['연세대', 1], ['서강대', 1], ['성균관대', 1], ['한양대', 1], ['건국대', 1]] },
  { cat: '이공계 특성화 대학', en: 'SCI-TECH', ac: C.sage, rows: [['대구경북과학기술원', 1], ['울산과학기술원', 1]] },
  { cat: '주요 국공립 대학', en: 'NATIONAL', ac: C.mustard, rows: [['부산대', 9], ['경상국립대', 9], ['국립부경대', 8], ['국립한국해양대', 5], ['경북대', 2]] },
];
function sResults(t) {
  ctx.fillStyle = C.paper; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(C.ink, 0.045, 60);
  const t0 = T.results;
  const hp = E.outExpo(P(t, t0, t0 + 0.35));
  text('2026 COLLEGE ADMISSIONS', 96, 128, { font: F(17, 700, FM), color: C.slate, ls: 5, alpha: hp });
  riseText('2026 주요 대학 대입 결과', 96, 200, t, t0 + 0.02, { size: 58, font: F(58, 800), color: C.ink, stagger: 0.014 });
  text('오늘의 탐구 → 내일의 진학', W - 96, 196, { font: F(26, 700), color: C.ink, align: 'right', alpha: 0.55 * E.outExpo(P(t, t0 + 0.3, t0 + 0.6)) });
  const cw = (W - 192 - 3 * 24) / 4;
  RESULTS.forEach((R, i) => {
    const total = R.rows.reduce((a, [, v]) => a + v, 0);
    const maxV = Math.max(...R.rows.map(([, v]) => v));
    bento(96 + i * (cw + 24), 250, cw, 730, t0 + i * 0.5, t, C.card, (u, w) => {
      ctx.fillStyle = R.ac; ctx.fillRect(0, 0, w, 7);
      text(R.en, 36, 58, { font: F(15, 700, FM), color: C.slate, ls: 4 });
      text(R.cat, 36, 104, { font: F(30, 800), color: C.ink });
      stat(36, 262, u, total, '명', C.ink, 150);
      ctx.fillStyle = C.ink; ctx.globalAlpha = 0.12; ctx.fillRect(36, 300, w - 72, 1.5); ctx.globalAlpha = 1;
      R.rows.forEach(([name, v], j) => {
        const p = E.outExpo(P(u, 0.2 + j * 0.06, 0.6 + j * 0.06));
        if (p <= 0) return;
        const y = 356 + j * 50;
        ctx.save(); ctx.globalAlpha = p;
        text(name, 36, y, { font: F(24, 700), color: C.ink });
        text(String(v), w - 36, y, { font: F(22, 800, FM), color: C.ink, align: 'right' });
        const bw = (w - 72 - 40) * (v / Math.max(maxV, 3)) * E.outCubic(p);
        rrect(36, y + 12, w - 72 - 40, 6, 3); ctx.fillStyle = 'rgba(21,27,44,0.07)'; ctx.fill();
        rrect(36, y + 12, Math.max(6, bw), 6, 3); ctx.fillStyle = R.ac; ctx.fill();
        ctx.restore();
      });
    });
  });
}

// ------------------------------------------------------------------ SCENE: stamp rally (32-34)
const STAMP_T = [32.25, 32.5, 32.75, 33.0, 33.25];
const CARD_R = { x: 880, y: 290, w: 920, h: 400 };
function slotXY(i) { return [CARD_R.x + 110 + i * 175, CARD_R.y + 236]; }
function sStamps(t) {
  ctx.fillStyle = C.navy; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(C.paper, 0.035, 60);
  const t0 = T.stamps, x0 = 120;
  text('HOW TO JOIN', x0, 250, { font: F(18, 800, FM), color: C.mustard, ls: 8, alpha: E.outExpo(P(t, t0 - 0.02, t0 + 0.2)) });
  riseText('STAMP', x0, 378, t, t0, { size: 128, color: C.paper, stagger: 0.03 });
  riseText('RALLY', x0, 506, t, t0 + 0.06, { size: 128, color: C.paper, stagger: 0.03 });
  const kp = E.outExpo(P(t, t0 + 0.1, t0 + 0.35));
  text('부스 체험하고 스탬프 받기', x0 + 30 * (1 - kp), 586, { font: F(40, 700), color: C.paper, alpha: kp * 0.9 });
  const n = STAMP_T.filter(s => t >= s).length;
  const bump = n ? 1 + 0.2 * Math.exp(-(t - STAMP_T[n - 1]) / 0.07) : 1;
  ctx.save(); ctx.translate(x0, 720);
  text('STAMPS', 0, -20, { font: F(16, 800, FM), color: C.paper, alpha: 0.5 * kp, ls: 4 });
  ctx.save(); ctx.translate(36, 60); ctx.scale(bump, bump);
  text(String(n), 0, 30, { font: F(104, 900), color: C.mustard, align: 'center', alpha: kp });
  ctx.restore();
  text('/ 5', 92, 90, { font: F(104, 900), color: C.paper, alpha: kp });
  ctx.restore();

  const cp = E.outExpo(P(t, t0 - 0.04, t0 + 0.3));
  ctx.save();
  ctx.translate(CARD_R.x + CARD_R.w / 2 + 500 * (1 - cp), CARD_R.y + CARD_R.h / 2);
  ctx.rotate(lerp(-0.1, -0.02, cp));
  ctx.translate(-CARD_R.x - CARD_R.w / 2, -CARD_R.y - CARD_R.h / 2);
  const { x, y, w, h } = CARD_R;
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; rrect(x + 10, y + 16, w, h, 26); ctx.fill();
  ctx.fillStyle = C.card; rrect(x, y, w, h, 26); ctx.fill();
  text('BUSANDONG OPEN LAB · STAMP CARD', x + 44, y + 62, { font: F(18, 800, FM), color: C.ink, ls: 2 });
  text('NO.07', x + w - 44, y + 62, { font: F(18, 800, FM), color: C.rose, align: 'right', ls: 2 });
  ctx.save(); ctx.setLineDash([8, 8]); ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.25; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + 44, y + 92); ctx.lineTo(x + w - 44, y + 92); ctx.stroke(); ctx.restore();
  for (let i = 0; i < 5; i++) {
    const [sx, sy] = slotXY(i);
    ctx.save(); ctx.setLineDash([7, 8]); ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.22; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, 70, 0, TAU); ctx.stroke(); ctx.restore();
    text(String(i + 1).padStart(2, '0'), sx, sy + 11, { font: F(28, 800, FM), color: C.ink, align: 'center', alpha: 0.15 });
  }
  text('5개 이상 모아 도서관(5층)으로!', x + 44, y + h - 30, { font: F(20, 700), color: C.ink, alpha: 0.5 });
  const rr = mulberry32(77);
  for (let i = 0; i < 5; i++) {
    const rot = (rr() - 0.5) * 0.5;
    const ti = STAMP_T[i];
    if (t < ti - 0.07) continue;
    const [sx, sy] = slotXY(i);
    const q = P(t, ti - 0.07, ti), d = Math.max(0, t - ti);
    const sc = t < ti ? lerp(2.2, 1, E.inCubic(q)) : 1 + 0.08 * Math.sin(d * 45) * Math.exp(-d * 18);
    const col = i % 2 ? 'blue' : 'rose', colHex = i % 2 ? C.blue : C.rose;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot); ctx.scale(sc, sc);
    ctx.globalAlpha = t < ti ? q * 0.5 : 0.9;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = colHex; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 64, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 54, 0, TAU); ctx.stroke();
    logoPart('core', col, 0, -4, 146);
    text('OPEN LAB', 0, 43, { font: F(11, 800, FM), color: colHex, align: 'center', ls: 2 });
    ctx.restore();
    if (d > 0 && d < 0.3) {
      ctx.save(); ctx.fillStyle = colHex; ctx.globalAlpha = (1 - d / 0.3) * 0.8;
      for (const sp of SPARKS) { const r = 76 + 60 * E.outCubic(d / 0.3) * sp.d; ctx.beginPath(); ctx.arc(sx + Math.cos(sp.a + i) * r, sy + Math.sin(sp.a + i) * r, sp.s * (1 - d / 0.3), 0, TAU); ctx.fill(); }
      ctx.restore();
    }
  }
  if (t > 33.44) {
    const q = P(t, 33.44, 33.5), d = Math.max(0, t - 33.5);
    const sc = t < 33.5 ? lerp(2.4, 1, E.inCubic(q)) : 1 + 0.07 * Math.sin(d * 40) * Math.exp(-d * 16);
    ctx.save(); ctx.translate(x + w - 150, y + 128); ctx.rotate(-0.2); ctx.scale(sc, sc);
    ctx.globalAlpha = t < 33.5 ? q : 0.95; ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = C.rose; ctx.lineWidth = 5; rrect(-146, -44, 292, 88, 10); ctx.stroke();
    ctx.lineWidth = 1.5; rrect(-135, -33, 270, 66, 7); ctx.stroke();
    text('COMPLETE!', 0, 15, { font: F(42, 900), color: C.rose, align: 'center', ls: 2 });
    ctx.restore();
  }
  ctx.restore();

  const rp = E.outExpo(P(t, 33.35, 33.7));
  if (rp > 0) {
    const f = F(44, 800);
    const parts = [['스탬프 5개', C.mustard], [' 모으면  →  ', C.paper], ['친환경 기념품', C.sage], [' 증정', C.paper]];
    const total = parts.reduce((s, [p]) => s + measure(p, f), 0) + 80;
    let px = 1340 - total / 2 + 80;
    ctx.save(); ctx.translate(0, 50 * (1 - rp)); ctx.globalAlpha = rp;
    const lp = E.outBack(P(t, 33.45, 33.75), 2.4);
    ctx.save(); ctx.translate(px - 52, 862); ctx.rotate(-0.6); ctx.scale(lp, lp);
    ctx.fillStyle = C.sage; ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(26, -18, 26, 18, 0, 30); ctx.bezierCurveTo(-26, 18, -26, -18, 0, -30); ctx.fill();
    ctx.strokeStyle = C.navy; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 26); ctx.stroke(); ctx.restore();
    for (const [p, c] of parts) px += text(p, px, 878, { font: f, color: c });
    ctx.restore();
  }
}

// ------------------------------------------------------------------ SCENE: build-up (34-36)
function sBuild(t) {
  const t0 = T.build;
  const g = ctx.createRadialGradient(960, 540, 60, 960, 540, 1150);
  g.addColorStop(0, '#222C47'); g.addColorStop(1, '#080B14');
  ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80);
  const I = 0.25 + 0.75 * P(t, t0, t0 + 1.85);
  ctx.save(); ctx.translate(960, 540); ctx.strokeStyle = C.paper; ctx.lineCap = 'round';
  for (const r of RAYS) {
    const ph = (t * r.sp * (0.6 + I * 1.6) + r.ph) % 1;
    const r0 = 140 + ph * 1100, r1 = r0 + r.len * (0.4 + I * 1.4) * ph;
    ctx.globalAlpha = (0.04 + 0.22 * I) * ph; ctx.lineWidth = r.w;
    ctx.beginPath(); ctx.moveTo(Math.cos(r.a) * r0, Math.sin(r.a) * r0); ctx.lineTo(Math.cos(r.a) * r1, Math.sin(r.a) * r1); ctx.stroke();
  }
  ctx.restore();
  const zoom = 1 + 0.5 * E.inExpo(P(t, t0 + 1.4, t0 + 1.875));
  ctx.save(); ctx.translate(960, 540); ctx.scale(zoom, zoom); ctx.translate(-960, -540);
  const gp = E.inOutCubic(P(t, t0 + 0.95, t0 + 1.22));
  ctx.save(); ctx.translate(960, 540 - 250 * gp); ctx.scale(lerp(1, 0.36, gp), lerp(1, 0.36, gp)); ctx.translate(-960, -540);
  const cols = [C.rose, C.blue, C.paper, C.mustard, C.rose, C.blue, C.paper];
  for (let k = 7; k >= 0; k--) {
    const p = P(t - k * 0.03, t0, t0 + 0.42);
    if (p <= 0) continue;
    const sc = lerp(3.2, 1, E.outExpo(p)), rot = lerp(-0.55, 0, spring(p, 5, 0.4));
    ctx.save(); ctx.translate(960, 540); ctx.rotate(rot); ctx.scale(sc, sc);
    if (k === 0) text('7', 0, 270, { font: F(740, 900), color: C.mustard, align: 'center' });
    else text('7', 0, 270, { font: F(740, 900), noFill: true, stroke: cols[k - 1], lw: 3, align: 'center', alpha: (1 - k / 8) * 0.6 });
    ctx.restore();
  }
  for (const [s, x, ts] of [['제', 960 - 470, t0 + 0.12], ['회', 960 + 470, t0 + 0.24]]) {
    const p = spring(P(t, ts, ts + 0.45), 6, 0.4);
    if (p <= 0) continue;
    ctx.save(); ctx.translate(x, 470); ctx.scale(p, p);
    text(s, 0, 70, { font: F(200, 800), color: C.paper, align: 'center' });
    ctx.restore();
  }
  ctx.restore();
  if (t >= t0 + 1.0) {
    chars('부산동고 오픈랩', 960, 660, { font: F(164, 800), color: C.paper, align: 'center' }, i => {
      const p = P(t, t0 + 1.02 + i * 0.045, t0 + 1.3 + i * 0.045);
      return { s: lerp(3.2, 1, E.outExpo(p)), a: p * 1.6, color: i >= 5 ? C.mustard : C.paper, hide: p <= 0 };
    });
    typeOn('BUSANDONG HIGH SCHOOL  OPEN LAB  2026', 960, 752, t, t0 + 1.2, t0 + 1.5, { font: F(20, 700, FM), color: C.paper, align: 'center', ls: 8, alpha: 0.65 });
  }
  ctx.restore();
  if (t >= t0 + 1.875) { ctx.fillStyle = '#05070D'; ctx.fillRect(-40, -40, W + 80, H + 80); }
}

// ------------------------------------------------------------------ SCENE: title drop + info (36-40)
const TITLE_GLYPHS = [['동', 0], ['고', 0.125], ['오', 0.25], ['래', 0.375], ['~', 0.5], ['ㅂ', 0.75]];
function sTitle(t) {
  const t0 = T.title;
  ctx.fillStyle = C.paper; ctx.fillRect(-40, -40, W + 80, H + 80);
  lineGrid(C.ink, 0.045, 60);
  const bp = E.outExpo(P(t, t0, t0 + 0.55));
  if (bp < 1) {
    ctx.save(); ctx.translate(960, 470); ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.globalAlpha = (1 - bp) * 0.6;
    for (let k = 0; k < 32; k++) { const a = k * TAU / 32 + 0.05; const r0 = 280 + 900 * bp, r1 = r0 + 140 * (1 - bp); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.8); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.8); ctx.stroke(); }
    ctx.restore();
  }
  confetti(t, t0);

  const gp = E.inOutCubic(P(t, T.info, T.info + 0.35));
  ctx.save(); ctx.translate(960, 480 - 175 * gp); ctx.scale(lerp(1, 0.72, gp), lerp(1, 0.72, gp)); ctx.translate(-960, -480);
  const pp = E.outExpo(P(t, t0 + 0.05, t0 + 0.4));
  ctx.save(); ctx.globalAlpha = pp; ctx.translate(0, -30 * (1 - pp));
  const pw = text('제7회 부산동고 오픈랩', 960, 262, { font: F(54, 700), color: C.ink, align: 'center', ls: 2 });
  ctx.fillStyle = C.ink; ctx.fillRect(960 - pw / 2 - 100, 243, 70 * pp, 3); ctx.fillRect(960 + pw / 2 + 30 + 70 * (1 - pp), 243, 70 * pp, 3);
  ctx.restore();
  const size = 280, f = F(size, 900), base = 590, TW = 180;
  const widths = TITLE_GLYPHS.map(([g]) => (g === '~' ? TW : measure(g, f)));
  const kern = -4;
  const total = widths.reduce((a, b) => a + b, 0) + kern * (widths.length - 1);
  let x = 960 - total / 2;
  TITLE_GLYPHS.forEach(([g, dt], i) => {
    const cxg = x + widths[i] / 2; x += widths[i] + kern;
    const ts = t0 + dt;
    if (t < ts) return;
    const d = t - ts, p = P(t, ts, ts + 0.45);
    const s = g === '~' ? 1 : spring(p, 6.5, 0.32);
    let rot = (1 - E.outCubic(p)) * (i % 2 ? 0.4 : -0.4) + 0.02 * Math.sin(d * 4 + i);
    let dy = (1 - E.outCubic(p)) * 80;
    if (g === 'ㅂ') { dy -= 40 * Math.abs(Math.sin(d * 8.5)) * Math.exp(-d * 2.4); rot *= 2.2; }
    ctx.save(); ctx.translate(cxg, base - size * 0.36 + dy); ctx.rotate(rot); ctx.scale(s, s); ctx.translate(0, size * 0.36);
    if (g === '~') drawTilde(P(t, ts, ts + 0.22), TW, size);
    else {
      ctx.font = f; ctx.textAlign = 'center';
      ctx.fillStyle = C.mustard; ctx.fillText(g, 9, 9);
      ctx.fillStyle = C.ink; ctx.fillText(g, 0, 0);
    }
    ctx.restore();
  });
  const sp = E.outCubic(P(t, t0 + 0.55, t0 + 0.85));
  if (sp > 0) {
    const xa = 960 - total / 2, xb = 960 + total / 2;
    ctx.save(); ctx.strokeStyle = C.rose; ctx.lineCap = 'round'; ctx.lineWidth = 12;
    ctx.setLineDash([1600 * sp, 3000]);
    ctx.beginPath(); ctx.moveTo(xa, base + 66); ctx.bezierCurveTo(xa + total * 0.35, base + 86, xa + total * 0.7, base + 50, xb + 20, base + 30); ctx.stroke();
    ctx.restore();
    const kp = E.outBack(P(t, t0 + 0.82, t0 + 1.0), 2.4);
    if (kp > 0) { star4(xb + 60, base - 30, 26 * kp, C.mustard); star4(xb + 96, base + 14, 14 * kp, C.rose); star4(xa - 50, base - 250, 20 * kp, C.blue); }
  }
  ctx.restore();

  const ip = E.outExpo(P(t, T.info, T.info + 0.4));
  if (ip > 0) {
    const px = 190, py = 745 + 420 * (1 - ip), pw2 = 1540, ph = 214;
    ctx.save();
    ctx.fillStyle = 'rgba(21,27,44,0.1)'; rrect(px, py + 12, pw2, ph, ph / 2); ctx.fill();
    ctx.fillStyle = C.ink; rrect(px, py, pw2, ph, ph / 2); ctx.fill();
    const dw = text('2026.10.30', px + 100, py + 130, { font: F(92, 800), color: C.mustard, ls: -1 });
    text('FRI', px + 100 + dw + 20, py + 96, { font: F(24, 800, FM), color: C.paper, ls: 3 });
    text('금요일', px + 100 + dw + 20, py + 132, { font: F(22, 600), color: C.paper, alpha: 0.6 });
    ctx.fillStyle = C.paper; ctx.globalAlpha = 0.18; ctx.fillRect(px + 780, py + 44, 1.5, ph - 88); ctx.globalAlpha = 1;
    const ax = px + 860, ay = py + 88, bx2 = px + 1400;
    const lp = E.inOutCubic(P(t, T.info + 0.25, T.info + 0.8));
    ctx.save(); ctx.setLineDash([3, 14]); ctx.lineCap = 'round'; ctx.strokeStyle = C.paper; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lerp(ax, bx2 - 30, lp), ay); ctx.stroke(); ctx.restore();
    if (lp > 0 && lp < 1) { ctx.fillStyle = C.mustard; ctx.beginPath(); ctx.arc(lerp(ax, bx2 - 30, lp), ay, 10, 0, TAU); ctx.fill(); }
    ctx.fillStyle = C.blue; ctx.beginPath(); ctx.arc(ax, ay, 25, 0, TAU); ctx.fill();
    text('6', ax, ay + 10, { font: F(28, 900), color: C.paper, align: 'center' });
    text('전포역 6번 출구', ax - 26, py + 164, { font: F(28, 700), color: C.paper });
    const mp = E.outBack(P(t, T.info + 0.55, T.info + 0.8), 2.4);
    text('500m', (ax + bx2) / 2, ay - 24, { font: F(30, 800), color: C.mustard, align: 'center', alpha: clamp(mp) });
    const pinP = spring(P(t, T.info + 0.7, T.info + 1.1), 7, 0.35);
    if (pinP > 0) {
      ctx.save(); ctx.translate(bx2, ay + 20 - 30 * (1 - pinP)); ctx.scale(pinP, pinP);
      pin(0, 0, 2.6, C.rose, C.ink);
      ctx.restore();
    }
    text('부산동고등학교', bx2 + 40, py + 164, { font: F(28, 800), color: C.paper, align: 'right', alpha: clamp(P(t, T.info + 0.7, T.info + 0.9)) });
    ctx.restore();
  }
  const fl = 1 - P(t, t0, t0 + 0.14);
  if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl * 0.9})`; ctx.fillRect(-40, -40, W + 80, H + 80); }
}

function drawTilde(p, TW, size) {
  const y = -size * 0.34;
  const pathT = () => { ctx.beginPath(); ctx.moveTo(-TW / 2 + 16, y + 16); ctx.bezierCurveTo(-TW / 6, y - 56, TW / 6, y + 66, TW / 2 - 16, y - 14); };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([320 * p, 1000]); ctx.lineWidth = 38;
  ctx.save(); ctx.translate(9, 9); ctx.strokeStyle = C.mustard; pathT(); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = C.ink; pathT(); ctx.stroke();
  ctx.restore();
}

function confetti(t, t0) {
  const tau = t - t0;
  if (tau < 0) return;
  for (const c of CONFETTI) {
    const k = 3.2;
    const x = 960 + c.vx * (1 - Math.exp(-k * tau)) / k + Math.sin(tau * 3 + c.sway) * 26 * P(tau, 0.3, 1);
    const y = 470 + c.vy * (1 - Math.exp(-k * tau)) / k + 120 * tau * tau;
    if (x < -60 || x > W + 60 || y > H + 60) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(c.rot + c.w * tau);
    ctx.fillStyle = c.col; ctx.strokeStyle = c.col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const s = c.size;
    switch (c.kind) {
      case 0: ctx.beginPath(); ctx.arc(0, 0, s * 0.4, 0, TAU); ctx.fill(); break;
      case 1: ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.45, s * 0.36); ctx.lineTo(-s * 0.45, s * 0.36); ctx.closePath(); ctx.fill(); break;
      case 2: ctx.fillRect(-s * 0.45, -s * 0.1, s * 0.9, s * 0.2); break;
      default: ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ SCENE: end card + credit (40-44)
function sEnd(t) {
  const t0 = T.end;
  const g = ctx.createRadialGradient(560, 470, 50, 760, 540, 1400);
  g.addColorStop(0, '#26314D'); g.addColorStop(1, '#0B0F1B');
  ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80);
  const sh = E.inOutCubic(P(t, T.credit - 0.1, T.credit + 0.3));
  ctx.save(); ctx.translate(0, -70 * sh);
  for (let k = 0; k < 3; k++) {
    const p = P(t, t0 + k * 0.14, t0 + 1.4 + k * 0.14);
    if (p <= 0 || p >= 1) continue;
    ctx.strokeStyle = k ? C.paper : C.mustard; ctx.globalAlpha = (1 - p) * 0.25; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(560, 470, 220 + 700 * E.outCubic(p), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  }
  const lp = spring(P(t, t0, t0 + 0.5), 6, 0.4);
  const D = 430 * lerp(0.6, 1, lp);
  ctx.save(); ctx.globalAlpha = clamp(P(t, t0, t0 + 0.12));
  ctx.fillStyle = '#1F2842'; ctx.beginPath(); ctx.arc(560, 470, D * 0.487, 0, TAU); ctx.fill();
  logoPart('outer', 'white', 560, 470, D);
  logoPart('text', 'white', 560, 470, D, lerp(-0.8, 0, E.outCubic(P(t, t0, t0 + 0.7))) + (t - t0) * 0.03);
  logoPart('core', 'mustard', 560, 470, D);
  ctx.restore();
  const x0 = 900;
  typeOn('BUSANDONG HIGH SCHOOL · OPEN LAB NO.07', x0, 300, t, t0 + 0.1, t0 + 0.45, { font: F(17, 700, FM), color: C.mustard, ls: 4 });
  riseText('제7회 부산동고 오픈랩', x0, 380, t, t0 + 0.12, { size: 50, font: F(50, 700), color: C.paper, stagger: 0.018 });
  riseText('동고오래~ㅂ', x0, 525, t, t0 + 0.18, { size: 128, font: F(128, 900), color: C.mustard, stagger: 0.035 });
  const dp = E.outExpo(P(t, t0 + 0.3, t0 + 0.65));
  ctx.fillStyle = C.paper; ctx.globalAlpha = 0.2; ctx.fillRect(x0, 572, 760 * dp, 1.5); ctx.globalAlpha = 1;
  const ip = E.outExpo(P(t, t0 + 0.34, t0 + 0.65));
  text('2026. 10. 30 (금)  ·  부산동고등학교', x0 + 30 * (1 - ip), 636, { font: F(34, 700), color: C.paper, alpha: ip });
  text('전포역 6번 출구에서 500m', x0 + 30 * (1 - ip), 688, { font: F(27, 500), color: C.paper, alpha: 0.6 * ip });
  ctx.restore();

  const c0 = T.credit;
  const lw = E.outExpo(P(t, c0, c0 + 0.3));
  ctx.fillStyle = C.mustard; ctx.fillRect(960 - 60 * lw, 812, 120 * lw, 2);
  typeOn('A FILM BY', 960, 862, t, c0 + 0.05, c0 + 0.3, { font: F(17, 700, FM), color: C.paper, align: 'center', ls: 10, alpha: 0.7 });
  riseText('이동혁', 960, 950, t, c0 + 0.12, { size: 68, font: F(68, 800), color: C.paper, align: 'center', ls: 14, stagger: 0.06, dur: 0.6 });
  const cp = E.outExpo(P(t, c0 + 0.35, c0 + 0.7));
  text('영상 제작 · 모션 디자인 · 사운드', 960, 996, { font: F(21, 500), color: C.paper, align: 'center', alpha: 0.55 * cp, ls: 2 });
  const fo = P(t, DUR - 0.4, DUR);
  if (fo > 0) { ctx.fillStyle = `rgba(0,0,0,${E.inCubic(fo)})`; ctx.fillRect(-40, -40, W + 80, H + 80); }
}

// ------------------------------------------------------------------ scene table
const SCENES = [
  { a: 0, b: 2.0, draw: sIntro, dark: true, name: 'BOOT SEQUENCE' },
  { a: 1.72, b: 6.08, draw: sSchool, dark: false, name: 'ABOUT', mask: t => maskCircle(LX, LY, circleR(t, 1.72, 2.0)) },
  { a: 5.86, b: 8.08, draw: sTag1, dark: true, name: "TODAY'S CURIOSITY", mask: t => maskWipe(t, 5.86) },
  ...CARDS.map((S, i) => ({
    a: S.t0 - (i === 0 ? 0.18 : 0.1), b: S.t1 + (i === 7 ? 0.3 : 0.05), draw: t => card(t, S), dark: S.dark,
    name: `${S.idx} ${S.en}`, mask: i === 0 ? t => maskSlices(t, S.t0 - 0.18) : t => maskWipe(t, S.t0 - 0.1),
  })),
  { a: T.grid, b: T.tag2 + 0.12, draw: sGrid, dark: false, name: 'ALL BOOTHS' },
  { a: T.tag2 - 0.14, b: T.results + 0.18, draw: sTag2, dark: true, name: "TOMORROW'S POSSIBILITY", mask: t => maskBlinds(t, T.tag2 - 0.14) },
  { a: T.results - 0.14, b: T.stamps + 0.12, draw: sResults, dark: false, name: '2026 ADMISSIONS', mask: t => maskRise(t, T.results - 0.14) },
  { a: T.stamps - 0.14, b: T.build + 0.05, draw: sStamps, dark: true, name: 'STAMP RALLY', mask: t => maskBlinds(t, T.stamps - 0.14) },
  { a: T.build - 0.14, b: T.title, draw: sBuild, dark: true, name: 'COUNTDOWN', mask: t => maskCircle(960, 540, circleR(t, T.build - 0.14, T.build + 0.02, 1150)) },
  { a: T.title, b: T.end + 0.25, draw: sTitle, dark: false, name: 'TITLE' },
  { a: T.end - 0.05, b: DUR + 1, draw: sEnd, dark: true, name: 'END CARD', mask: t => maskCurtain(t, T.end - 0.05) },
];
function activeScene(t) { let s = SCENES[0]; for (const sc of SCENES) if (t >= sc.a && t < sc.b) s = sc; return s; }

// ------------------------------------------------------------------ HUD
function hud(t) {
  const gridOff = P(t, T.grid - 0.05, T.grid + 0.1) * (1 - P(t, T.tag2 - 0.1, T.tag2 + 0.05));
  const on = E.outCubic(P(t, 0.12, 0.4)) * (1 - P(t, T.end - 0.05, T.end + 0.1)) * (1 - gridOff);
  if (on <= 0) return;
  const sc = activeScene(t);
  const col = sc.dark ? C.paper : C.ink;
  ctx.save(); ctx.globalAlpha = 0.6 * on;
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  const m = 40, L = 26;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { ctx.moveTo(x, y + dy * L); ctx.lineTo(x, y); ctx.lineTo(x + dx * L, y); }
  ctx.stroke();
  const f = F(14, 700, FM);
  if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = C.rose; ctx.beginPath(); ctx.arc(m + 32, m + 31, 5, 0, TAU); ctx.fill(); }
  typeOn('BUSANDONG H.S. — OPEN LAB NO.07', m + 48, m + 36, t, 0.15, 0.5, { font: f, color: col, ls: 3 });
  const ss = Math.floor(t), ff = Math.floor((t - ss) * FPS);
  text(`TC 00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`, W - m - 12, m + 36, { font: f, color: col, align: 'right', ls: 3 });
  text(`SCN — ${sc.name}`, m + 12, H - m - 16, { font: f, color: col, ls: 3 });
  text('2026.10.30 FRI', W - m - 12, H - m - 16, { font: f, color: col, align: 'right', ls: 3 });
  ctx.globalAlpha = 0.2 * on; ctx.fillStyle = col; ctx.fillRect(760, H - m - 21, 400, 1.5);
  ctx.globalAlpha = 0.8 * on; ctx.fillRect(760, H - m - 21, 400 * (t / DUR), 1.5);
  ctx.restore();
}

// ------------------------------------------------------------------ frame render
function renderScene(t) {
  ctx = cv.getContext('2d');
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cam = camera(t);
  ctx.translate(W / 2 + cam.sx, H / 2 + cam.sy); ctx.rotate(cam.rot); ctx.scale(cam.z, cam.z); ctx.translate(-W / 2, -H / 2);
  for (const sc of SCENES) {
    if (t < sc.a || t >= sc.b) continue;
    ctx.save();
    if (sc.mask) sc.mask(t);
    sc.draw(t);
    ctx.restore();
  }
  ctx.restore();
  hud(t);
  return cv;
}

// motion blur: sub-samples per frame (12 on fast moves, 4 otherwise)
const FAST = [
  [1.66, 2.1], [2.0, 2.2], [2.5, 2.7], [3.0, 3.2], [3.5, 3.7], [4.0, 4.2], [5.8, 6.2], [7.76, 8.14],
  [23.94, 24.35], [25.82, 26.2], [27.82, 28.2], [28.5, 28.7], [29.0, 29.2], [29.5, 29.7], [31.82, 32.2],
  ...STAMP_T.map(s => [s - 0.08, s + 0.06]), [33.42, 33.56], [33.82, 34.5], [34.95, 36.25], [36.3, 36.9], [37.98, 38.45], [39.9, 40.3],
];
function samplesAt(t) {
  for (const [a, b] of FAST) if (t >= a && t <= b) return 12;
  for (const c of CARDS) if (t >= c.t0 - 0.13 && t <= c.t0 + 0.12) return 12;
  return 4;
}

// ------------------------------------------------------------------ post-processing
const post = { tmp: createCanvas(W, H), layer: createCanvas(W, H), small: createCanvas(480, 270), vig: null };
function buildVignette() {
  const c = createCanvas(W, H), x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#A4A4AE');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  post.vig = c;
}
function boxBlur(src, w, h, r) {
  const out = new Float32Array(src.length), tmp = new Float32Array(src.length);
  const pass = (a, b, horiz) => {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let j = 0; j < m; j++) for (let c = 0; c < 3; c++) {
      const idx = i => (horiz ? (j * w + i) : (i * w + j)) * 4 + c;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[idx(clamp(i, 0, n - 1))];
      for (let i = 0; i < n; i++) {
        b[idx(i)] = acc / (2 * r + 1);
        acc += a[idx(Math.min(n - 1, i + r + 1))] - a[idx(Math.max(0, i - r))];
      }
    }
  };
  pass(src, tmp, true); pass(tmp, out, false);
  return out;
}
function hitAmount(t, list, tau) { let v = 0; for (const [t0, a] of list) if (t >= t0) v += a * Math.exp(-(t - t0) / tau); return v; }
const CA_HITS = [[2.0, 2], [6.0, 2.5], [8.0, 4], [24.0, 3.5], [26.0, 2.5], [28.0, 2], [34.0, 6], [35.0, 2.5], [36.0, 8], [38.0, 2.5], [40.0, 4]];
const GLITCH = [[5.84, 5.92], [7.8, 7.9], [23.95, 24.05], [35.86, 35.9], [39.9, 39.98]];
const FLASH = [
  ...STAMP_T.map((s, i) => [s, ...slotXY(i), 240, 0.3]), [33.5, CARD_R.x + CARD_R.w - 150, CARD_R.y + 128, 320, 0.35],
  [34.0, 960, 540, 900, 0.45], [36.0, 960, 470, 1300, 0.35], [40.0, 560, 470, 800, 0.35], [0.02, LX, LY, 500, 0.4],
];
const BLOOM = t => (activeScene(t).dark ? 0.24 : 0.06) + 0.3 * hitAmount(t, [[34.0, 1], [36.0, 0.6], [40.0, 0.6], [0.0, 0.6]], 0.25);

function postProcess(acc, t, frame) {
  const x = acc.getContext('2d');
  const tctx = post.tmp.getContext('2d');
  const g = GLITCH.find(([a, b]) => t >= a && t <= b);
  if (g) {
    const r = mulberry32(frame * 131 + 7);
    tctx.drawImage(acc, 0, 0);
    const bands = 5 + Math.floor(r() * 5);
    for (let i = 0; i < bands; i++) {
      const y = Math.floor(r() * H), h = 6 + Math.floor(r() * 70), dx = (r() - 0.5) * 160;
      x.drawImage(post.tmp, 0, y, W, h, dx, y, W, h);
    }
    for (let i = 0; i < 2; i++) { x.fillStyle = C.mustard; x.globalAlpha = 0.6; x.fillRect(r() * W, r() * H, 40 + r() * 300, 2 + r() * 4); }
    x.globalAlpha = 1;
  }
  const b = BLOOM(t);
  if (b > 0.02) {
    const sctx = post.small.getContext('2d');
    sctx.drawImage(acc, 0, 0, 480, 270);
    const img = sctx.getImageData(0, 0, 480, 270);
    const d = img.data, f = new Float32Array(d.length);
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const k = Math.max(0, l - 165) / (255 - 165);
      f[i] = d[i] * k; f[i + 1] = d[i + 1] * k; f[i + 2] = d[i + 2] * k;
    }
    let bl = boxBlur(f, 480, 270, 7); bl = boxBlur(bl, 480, 270, 7);
    for (let i = 0; i < d.length; i += 4) { d[i] = bl[i]; d[i + 1] = bl[i + 1]; d[i + 2] = bl[i + 2]; d[i + 3] = 255; }
    sctx.putImageData(img, 0, 0);
    x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = clamp(b); x.imageSmoothingQuality = 'high';
    x.drawImage(post.small, 0, 0, W, H); x.restore();
  }
  const ca = hitAmount(t, CA_HITS, 0.07) + (g ? 3 : 0);
  if (ca > 0.4) {
    tctx.globalCompositeOperation = 'source-over'; tctx.drawImage(acc, 0, 0);
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    const lctx = post.layer.getContext('2d');
    for (const [col, e] of [['#FF0000', ca * 2], ['#00FF00', ca], ['#0000FF', 0]]) {
      lctx.globalCompositeOperation = 'source-over'; lctx.drawImage(post.tmp, 0, 0);
      lctx.globalCompositeOperation = 'multiply'; lctx.fillStyle = col; lctx.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'lighter';
      x.drawImage(post.layer, -e, -e * H / W, W + 2 * e, H + 2 * e * H / W);
    }
    x.globalCompositeOperation = 'source-over';
  }
  for (const [t0, fx, fy, R, a] of FLASH) {
    if (t < t0 || t > t0 + 0.4) continue;
    const k = Math.exp(-(t - t0) / 0.08) * a;
    const gr = x.createRadialGradient(fx, fy, 0, fx, fy, R * (1 + (t - t0) * 2));
    gr.addColorStop(0, `rgba(255,250,240,${k})`); gr.addColorStop(0.4, `rgba(255,245,225,${k * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.save(); x.globalCompositeOperation = 'screen'; x.fillStyle = gr; x.fillRect(0, 0, W, H); x.restore();
  }
  if (!post.vig) buildVignette();
  x.save(); x.globalCompositeOperation = 'multiply'; x.globalAlpha = activeScene(t).dark ? 0.6 : 0.28; x.drawImage(post.vig, 0, 0); x.restore();
  return acc;
}

module.exports = { init, renderScene, postProcess, samplesAt, W, H, FPS, DUR };
