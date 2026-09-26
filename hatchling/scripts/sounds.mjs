// Renders every pet sound (each voice kind as a hatchling and an adult, plus the other species' calls)
// and every UI sound offline in Chromium through the real master bus. Writes WAVs and a listening page
// to shots/sounds/ and prints duration, peak, RMS, loudness and brightness, flagging clipping, DC and
// clicks. Sounds vary between plays, so --seeds renders each row several times and reports the mean.
//   node scripts/sounds.mjs [--only <regex>] [--png] [--seed <n>] [--seeds <n>]
//   --only   render only rows whose id matches (e.g. "roar", "^rex-", "ui-")
//   --png    also draw spectrogram sheets (shots/sounds/sheet-*.png) for visual QA
//   --zoom   draw the rendered rows as large tiles in one sheet (shots/sounds/sheet-zoom.png)
//   --seeds  plays per row (seeds seed, seed+1, ...): levels are averaged, peaks are the highest
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const seed = Number(opt('--seed', 1));
const seeds = Math.max(1, Number(opt('--seeds', 1)));
const zoom = args.includes('--zoom');
const png = args.includes('--png') || zoom;

// The species' voices; the first of each kind is its reference voice.
const VOICES = {
  rex: { pitch: 110, growl: 0.75, kind: 'roar' },
  raptor: { pitch: 330, growl: 0.35, kind: 'screech' },
  pachy: { pitch: 180, growl: 0.45, kind: 'hoot' },
  trike: { pitch: 90, growl: 0.5, kind: 'bellow' },
  para: { pitch: 150, growl: 0.2, kind: 'honk' },
  galli: { pitch: 600, growl: 0.15, kind: 'trill' },
  compy: { pitch: 700, growl: 0.3, kind: 'chitter' },
  ptera: { pitch: 260, growl: 0.55, kind: 'croak' },
  diplo: { pitch: 55, growl: 0.3, kind: 'rumble' },
  styraco: { pitch: 115, growl: 0.5, kind: 'grunt' },
  theriz: { pitch: 140, growl: 0.3, kind: 'coo' },
  allo: { pitch: 125, growl: 0.7, kind: 'roar' },
  carno: { pitch: 140, growl: 0.8, kind: 'roar' },
  spino: { pitch: 95, growl: 0.6, kind: 'roar' },
  dilo: { pitch: 420, growl: 0.5, kind: 'screech' },
  stego: { pitch: 120, growl: 0.35, kind: 'bellow' },
  ankylo: { pitch: 100, growl: 0.6, kind: 'bellow' },
  brachio: { pitch: 60, growl: 0.3, kind: 'bellow' },
  cory: { pitch: 120, growl: 0.2, kind: 'honk' },
  micro: { pitch: 560, growl: 0.25, kind: 'chitter' },
  quetzal: { pitch: 150, growl: 0.65, kind: 'croak' },
  amarga: { pitch: 75, growl: 0.3, kind: 'rumble' },
  kentro: { pitch: 150, growl: 0.45, kind: 'grunt' },
  iguano: { pitch: 95, growl: 0.4, kind: 'grunt' },
  ovi: { pitch: 300, growl: 0.2, kind: 'coo' },
};
const REFERENCE = ['rex', 'raptor', 'pachy', 'trike', 'para', 'galli', 'compy', 'ptera', 'diplo', 'styraco', 'theriz'];
const EXTRA = ['allo', 'carno', 'spino', 'dilo', 'stego', 'ankylo', 'brachio', 'cory', 'micro', 'quetzal', 'amarga', 'kentro', 'iguano', 'ovi'];
const VOCAL = ['call', 'roar', 'chirp', 'growl', 'happy', 'purr', 'yawn', 'snore', 'sneeze', 'squeak', 'curious', 'yelp', 'whine', 'murmur', 'huff'];

const out = path.resolve('shots/sounds');
fs.mkdirSync(out, { recursive: true });

// The page: the synth plus analysis and spectrogram drawing.
const entry = `
import { analyse, render, wav } from './src/audio/render';
import { SOUND_NAMES, UI_SOUNDS } from './src/audio/types';
const sheets = new Map();
let TW = 380, TH = 124;
const SECS = 3.4;
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k);
      const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
      re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi;
    }
  }
}
function color(v) {
  const t = Math.max(0, Math.min(1, v));
  return [255 * Math.min(1, t * 1.8), 255 * Math.max(0, t * 1.6 - 0.45), 255 * Math.max(0, Math.min(1, t < 0.4 ? t * 1.8 : 1.6 - t * 1.6 + (t > 0.85 ? (t - 0.85) * 6 : 0)))];
}
function tile(r, g, x0, y0, label) {
  const N = 2048, sr = r.sampleRate, fMin = 40, fMax = 14000, specH = TH - 34;
  const img = g.createImageData(TW, specH);
  const mono = r.left.map((v, i) => (v + r.right[i]) / 2);
  for (let x = 0; x < TW; x++) {
    const c = Math.round((x / TW) * SECS * sr);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const j = c + i - N / 2; if (j >= 0 && j < mono.length) re[i] = mono[j] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); }
    fft(re, im);
    for (let y = 0; y < specH; y++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - y / specH);
      const b = Math.round((f / sr) * N);
      const m = Math.hypot(re[b], im[b]) / (N / 4);
      const [cr, cg, cb] = color((20 * Math.log10(m + 1e-9) + 100) / 95);
      const k = (y * TW + x) * 4;
      img.data[k] = cr; img.data[k + 1] = cg; img.data[k + 2] = cb; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, x0, y0 + 14);
  // Envelope strip (peak per column, -60..0 dB) and a label.
  g.fillStyle = '#111'; g.fillRect(x0, y0 + 14 + specH, TW, 20);
  g.fillStyle = '#7fd1c9';
  const per = Math.round((SECS * sr) / TW);
  for (let x = 0; x < TW; x++) {
    let pk = 0;
    for (let i = x * per; i < (x + 1) * per && i < mono.length; i++) pk = Math.max(pk, Math.abs(r.left[i]), Math.abs(r.right[i]));
    const h = Math.max(0, (20 * Math.log10(pk + 1e-9) + 60) / 60) * 18;
    g.fillRect(x0 + x, y0 + 14 + specH + 19 - h, 1, h);
  }
  g.fillStyle = '#222'; g.fillRect(x0, y0, TW, 14);
  g.fillStyle = '#eee'; g.font = '11px monospace'; g.fillText(label, x0 + 3, y0 + 11);
}
window.names = { pets: SOUND_NAMES, ui: UI_SOUNDS };
window.run = async (job, seed, at, keep) => {
  const r = await render(job, seed);
  const s = analyse(r);
  let bin = '';
  if (keep) {
    const bytes = wav(r, Math.min(r.left.length / r.sampleRate, s.audible + 0.1));
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  if (at) {
    [TW, TH] = at.big ? [1100, 330] : [380, 124];
    let c = sheets.get(at.sheet);
    if (!c) { c = document.createElement('canvas'); c.width = at.cols * (TW + 4); c.height = at.rows * (TH + 4); c.getContext('2d').fillStyle = '#000'; c.getContext('2d').fillRect(0, 0, c.width, c.height); sheets.set(at.sheet, c); }
    tile(r, c.getContext('2d'), at.col * (TW + 4), at.row * (TH + 4), at.label + '  ' + s.peak.toFixed(1) + ' dBFS  ' + s.dur.toFixed(2) + ' s');
  }
  return { stats: s, nodes: r.nodes, wav: btoa(bin) };
};
window.sheets = () => Object.fromEntries([...sheets].map(([k, c]) => [k, c.toDataURL('image/png')]));
`;
const js = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', target: 'es2022' });
const html = path.join(out, 'render.html');
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${js.outputFiles[0].text}</script>`);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(`file://${html}`);
const { pets, ui } = await page.evaluate(() => window.names);

// Every pet sound for each kind's reference species, then the other species' vocal signatures.
const jobs = [];
for (const sp of REFERENCE) {
  pets.forEach((name) => {
    for (const g of [0, 1]) {
      const vocal = VOCAL.includes(name);
      const at = vocal ? { sheet: `vocal-${sp}`, rows: VOCAL.length, cols: 2, row: VOCAL.indexOf(name), col: g } : sp === 'rex' ? { sheet: 'body-rex', rows: pets.length - VOCAL.length, cols: 2, row: pets.filter((n) => !VOCAL.includes(n)).indexOf(name), col: g } : null;
      jobs.push({ id: `${sp}-${name}-g${g}`, name, who: sp, g, job: { pet: name, voice: VOICES[sp], growth: g }, at });
    }
  });
}
EXTRA.forEach((sp, row) =>
  ['call', 'roar', 'growl'].forEach((name, col) => {
    for (const g of [0, 1]) jobs.push({ id: `${sp}-${name}-g${g}`, name, who: sp, g, job: { pet: name, voice: VOICES[sp], growth: g }, at: g ? { sheet: 'species', rows: EXTRA.length, cols: 3, row, col } : null });
  }),
);
ui.forEach((name, i) => jobs.push({ id: `ui-${name}`, name, who: 'ui', g: '', job: { ui: name }, at: { sheet: 'ui', rows: 4, cols: 2, row: Math.floor(i / 2), col: i % 2 } }));

const rows = [];
const picked = jobs.filter((j) => !only || only.test(j.id));
for (const [i, j] of picked.entries()) {
  const at = zoom ? { sheet: 'zoom', rows: picked.length, cols: 1, row: i, col: 0, big: true, label: j.id } : png && j.at ? { ...j.at, label: j.id } : null;
  // The first play is kept (WAV, spectrogram); levels are averaged over all of them.
  const runs = [];
  for (let k = 0; k < seeds; k++) runs.push(await page.evaluate(([job, s, a, keep]) => window.run(job, s, a, keep), [j.job, seed + k, k ? null : at, !k]));
  fs.writeFileSync(path.join(out, `${j.id}.wav`), Buffer.from(runs[0].wav, 'base64'));
  const mean = (f) => runs.reduce((s, r) => s + r.stats[f], 0) / runs.length;
  const most = (f) => runs.reduce((m, r) => Math.max(m, Math.abs(r.stats[f])), 0);
  const stats = { dur: mean('dur'), audible: most('audible'), peak: Math.max(...runs.map((r) => r.stats.peak)), rms: mean('rms'), lufs: mean('lufs'), centroid: mean('centroid'), dc: most('dc'), head: most('head'), tail: most('tail') };
  rows.push({ ...j, ...stats, nodes: Math.max(...runs.map((r) => r.nodes)) });
}
if (png) {
  const sheets = await page.evaluate(() => window.sheets());
  for (const [name, url] of Object.entries(sheets)) fs.writeFileSync(path.join(out, `sheet-${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}
await browser.close();

// ---- the table ----
const isUi = (r) => r.who === 'ui';
// Pet sounds should peak around -6..-1 dBFS; these frequent background ones are deliberately softer.
const QUIET = { step: [-22, -8], sniff: [-16, -6], snore: [-16, -5], purr: [-16, -3], yawn: [-14, -3], crunch: [-12, -4], huff: [-22, -6], murmur: [-16, -2], whine: [-16, -2], curious: [-12, -1], dig: [-10, -2], rustle: [-12, -4], flap: [-12, -2], bubble: [-12, -4], toy: [-12, -3] };
// Short transients (clicks, gnawing, stomps, the whip crack) peak high for their loudness; the crack
// meets the safety clipper's soft knee on purpose, and hatchlings' stomps are only pats.
const SHARP = { chew: [-8, -1], click: [-10, -1], stomp: [-10, -1], whip: [-6, -0.5] };
const flags = (r) => {
  const f = [];
  if (r.peak > -0.3) f.push('CLIP');
  if (Math.abs(r.dc) > 1e-3) f.push(`DC(${r.dc.toExponential(1)})`);
  if (r.head > 1e-4) f.push('CLICK-START');
  if (r.tail > 1e-4) f.push('CUT-TAIL');
  const [lo, hi] = isUi(r) ? [-18, -10] : (QUIET[r.name] ?? SHARP[r.name] ?? [-6, -1]);
  if (r.peak > hi || r.peak < lo) f.push('LEVEL');
  return f.join(' ');
};
const pad = (s, n) => String(s).padEnd(n);
const num = (x, n, d = 1) => x.toFixed(d).padStart(n);
const lines = [`${pad('sound', 8)} ${pad('voice', 7)} ${pad('g', 2)} ${'dur s'.padStart(6)} ${'tail s'.padStart(7)} ${'peak'.padStart(6)} ${'rms'.padStart(6)} ${'lufsM'.padStart(6)} ${'cent'.padStart(5)} ${'nodes'.padStart(5)}  flags`];
let last = '';
for (const r of [...rows].sort((a, b) => (isUi(a) === isUi(b) ? 0 : isUi(a) ? 1 : -1) || (isUi(a) ? 0 : pets.indexOf(a.name) - pets.indexOf(b.name)))) {
  if (last && r.name !== last) lines.push('');
  last = r.name;
  lines.push(`${pad(r.name, 8)} ${pad(r.who, 7)} ${pad(r.g, 2)} ${num(r.dur, 6, 2)} ${num(r.audible, 7, 2)} ${num(r.peak, 6)} ${num(r.rms, 6)} ${num(r.lufs, 6)} ${num(r.centroid, 5, 0)} ${String(r.nodes).padStart(5)}  ${flags(r)}`);
}
const bad = rows.filter((r) => /CLIP|DC|CLICK|CUT/.test(flags(r)));
const played = seeds > 1 ? `seeds ${seed}..${seed + seeds - 1}, levels averaged` : `seed ${seed}`;
lines.push('', `${rows.length} sounds rendered to ${path.relative(process.cwd(), out)}/ (48 kHz, volume 1, ${played}); ${bad.length} with clipping, DC or clicks.`);
console.log(lines.join('\n'));
fs.writeFileSync(path.join(out, 'levels.txt'), lines.join('\n') + '\n');

// A listening page: one button per WAV.
const cell = (id) => (rows.some((r) => r.id === id) ? `<button onclick="new Audio('${id}.wav').play()">${id.split('-').pop()}</button>` : '');
const body = [
  ...[...REFERENCE, ...EXTRA].map((sp) => `<h3>${sp} (${VOICES[sp].kind})</h3><p>${pets.map((n) => (cell(`${sp}-${n}-g0`) || cell(`${sp}-${n}-g1`) ? `<span>${n} ${cell(`${sp}-${n}-g0`)}${cell(`${sp}-${n}-g1`)}</span>` : '')).join(' ')}</p>`),
  `<h3>UI</h3><p>${ui.map((n) => cell(`ui-${n}`)).join(' ')}</p>`,
].join('\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Hatchling sounds</title><style>body{font:14px system-ui;margin:16px}span{display:inline-block;margin:2px 10px 2px 0}button{margin-left:2px}</style><h2>Hatchling sounds (g0 = hatchling, g1 = adult)</h2>${body}`);
