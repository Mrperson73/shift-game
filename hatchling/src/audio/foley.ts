// The pet's body and world noises: bites and gnawing, gulps, sniffs and snorts, footsteps and stomps,
// thuds and bonks, wing beats, tail swishes and cracks, digging, splashes, bubbles, rustling leaves,
// toys. Shaped noise and a few sines, scaled by size (hatchlings patter, adults thump) and varied on
// every play. The frequent ones (steps, bites, wing beats...) stay around ten nodes.

import { bell, burst, glide, type Grain, grains, lerp, line, type Patch, perc, pings } from './synth';
import type { Who } from './voices';
import { GRUNT, nose, tame, ticks, vox } from './vox';

// ---------------- eating ----------------

export function crunch(p: Patch, w: Who) {
  const t = p.t;
  // A cluster of small cracks as the food breaks (brighter for small jaws), and the jaw closing.
  const s = lerp(1.15, 0.8, w.big);
  const gs: Grain[] = [];
  let at = 0;
  const n = 3 + Math.floor(p.r(0, 3.99));
  for (let i = 0; i < n; i++) {
    const decay = p.r(0.008, 0.032);
    gs.push([at, p.r(0.5, 1), decay, p.r(1400, 4600) * s]);
    at += decay + p.r(0.008, 0.026);
  }
  grains(p, p.out, t, gs, 'bandpass', 1.4, 0.0015);
  const f = lerp(260, 130, w.big) * p.vary(1, 0.1);
  const jg = p.gain(0);
  const e = perc(jg.gain, t, 0.002, 0.45, 0.05);
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.05, [[0, 1], [1, 0.6]], f);
  o.connect(jg).connect(p.out);
}

export function chew(p: Patch, w: Who) {
  const t = p.t;
  // Gnawing a bone: creaky scrapes — noise chopped by the teeth's stick-slip — each with a bony tock.
  const s = lerp(1.25, 0.85, w.big) * p.vary(1, 0.08);
  const n = p.chance(0.45) ? 3 : 2;
  const env = p.gain(0);
  const bp = p.filter('bandpass', 1900 * s, 2.4);
  const starts: number[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const d = p.r(0.06, 0.085);
    starts.push(at);
    line(env.gain, t + at, d, [[0, 0], [0.15, 1], [0.75, 0.8], [1, 0]], 3 * p.r(0.7, 1));
    glide(bp.frequency, t + at, d, [[0, p.r(1500, 2300) * s], [1, p.r(1700, 2800) * s]]);
    at += d + p.r(0.02, 0.04);
  }
  const end = t + at;
  const gate = p.gain(0);
  p.osc('clicks', p.r(38, 60) / Math.sqrt(s), t, end).connect(gate.gain);
  p.noise(t, end).connect(bp).connect(gate).connect(env).connect(p.out);
  ticks(p, t, starts, 2600 * s, 2.7, 4, 0.012);
}

export function gulp(p: Patch, w: Who) {
  const t = p.t;
  const s = lerp(1.8, 1, w.big) * p.vary(1, 0.06);
  burst(p, p.out, t, 'bandpass', 900 * s, 2, 0.3, 0.002, 0.02);
  // A gloop that drops, then a little bubble.
  const g1 = p.gain(0);
  const e1 = perc(g1.gain, t + 0.02, 0.006, 0.8, 0.1);
  const o1 = p.osc('sine', 300 * s, t + 0.02, e1);
  glide(o1.frequency, t + 0.02, 0.1, [[0, 1], [1, p.r(0.4, 0.5)]], 300 * s);
  o1.connect(g1).connect(p.out);
  const tb = t + p.r(0.12, 0.16);
  const g2 = p.gain(0);
  const e2 = perc(g2.gain, tb, 0.003, 0.45, 0.06);
  const o2 = p.osc('sine', 180 * s, tb, e2);
  glide(o2.frequency, tb, 0.05, [[0, 1], [1, p.r(1.9, 2.5)]], 180 * s);
  o2.connect(g2).connect(p.out);
  // A contented "mm" (or an "ahh").
  const ah = p.chance(0.3);
  vox(p, tame(w.v, 0.2), [{ at: 0, dur: 0.3 * w.len + 0.05, p: [[0, 0.95], [1, 0.88]], a: [[0, 0], [0.3, 1], [1, 0]], v: ah ? [[0, 'a'], [1, 'uh']] : 'm', nz: ah ? 2 : 1, lv: 0.45, tr: 0 }], t + 0.3);
}

// ---------------- nose ----------------

export function sniff(p: Patch, w: Who) {
  const t = p.t;
  // Quick nasal intakes, each a band of noise rising as the nostrils narrow.
  const bp = p.filter('bandpass', 2000, 1.6);
  const g = p.gain(0);
  const n = p.pick([2, 2, 3, 3, 4]);
  const gap = lerp(0.09, 0.13, w.big) * p.vary(1, 0.12);
  let f = p.vary(lerp(3200, 1500, w.big), 0.1);
  const step = p.r(1.02, 1.12);
  for (let i = 0; i < n; i++) {
    bp.frequency.setValueAtTime(p.hz(f), t + i * gap);
    bp.frequency.linearRampToValueAtTime(p.hz(f * 1.15), t + i * gap + 0.05);
    perc(g.gain, t + i * gap, 0.015, p.r(0.55, 1), Math.min(0.05, gap - 0.025));
    f *= step;
  }
  p.noise(t, t + n * gap + 0.02).connect(bp).connect(g).connect(p.out);
}

export function snort(p: Patch, w: Who) {
  const t = p.t;
  // A blast of air through the nose: a sharp "hff!", a fluttering "brrff", or two in a row. Big
  // grunting and bellowing voices put a short grunt under it.
  const size = w.size * p.vary(1, 0.08);
  const k = p.choose([1, 1, 0.7]);
  const len = lerp(0.75, 1, w.big);
  const puffs: [number, number, number][] = k === 2 ? [[0, 0.1 * len, 0.75], [0.17 * len, 0.14 * len, 1]] : [[0, (k ? 0.26 : 0.16) * len, 1]];
  nose(p, t, puffs, size, [0, 0.85, 0.2][k]);
  if (w.kind === 'grunt' || w.kind === 'bellow' || w.kind === 'rumble' || w.kind === 'roar') {
    // A short, dark voiced "hnf" under the last puff.
    const s0 = t + puffs[puffs.length - 1][0] + 0.01;
    const dur = 0.12 * len + 0.03;
    const f = w.v.f * 0.8;
    const o = p.osc('glottal', f, s0, s0 + dur);
    glide(o.frequency, s0, dur, [[0, 1], [1, 0.85]], f);
    const g = p.gain(0);
    line(g.gain, s0, dur, GRUNT, 0.45 * w.v.level);
    o.connect(p.filter('lowpass', Math.min(f * 3, 1500), 0)).connect(g).connect(p.out);
  }
}

// ---------------- feet ----------------

export function step(p: Patch, w: Who) {
  const t = p.t;
  // Adults: a soft low thump; hatchlings: a light pat. Now and then a scuff of grit.
  const f = p.vary(lerp(210, 72, w.big), 0.1);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.004, lerp(0.35, 0.9, w.big) * p.r(0.8, 1), lerp(0.05, 0.11, w.big));
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.09, [[0, 1], [1, 0.62]], f);
  o.connect(g).connect(p.out);
  burst(p, p.out, t, 'lowpass', p.vary(lerp(2600, 520, w.big), 0.15), 0.8, lerp(0.22, 0.3, w.big), 0.002, 0.03);
  if (p.chance(0.3)) burst(p, p.out, t + p.r(0.01, 0.03), 'bandpass', p.r(2500, 4500), 1, 0.05, 0.004, 0.025);
}

export function stomp(p: Patch, w: Who) {
  const t = p.t;
  // A big deliberate stomp: a sub-bass thump you feel, the dull thud of the foot, the ground crunching
  // and grit flying. Hatchlings make a determined little pat.
  const f = p.vary(lerp(150, 58, w.big), 0.06);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.004, lerp(0.5, 1, w.big), lerp(0.12, 0.34, w.big));
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, lerp(0.1, 0.28, w.big), [[0, 1.45], [0.12, 1], [1, 0.72]], f);
  o.connect(g).connect(p.out);
  burst(p, p.out, t, 'lowpass', lerp(1500, 400, w.big), 1, lerp(0.4, 0.7, w.big), 0.003, lerp(0.05, 0.13, w.big));
  burst(p, p.out, t + 0.004, 'bandpass', lerp(2800, 1600, w.big) * p.vary(1, 0.1), 0.8, lerp(0.14, 0.3, w.big), 0.002, lerp(0.04, 0.08, w.big));
  const gs: Grain[] = [];
  let at = 0.02;
  for (let i = 0; i < 2 + Math.round(3 * w.big); i++) {
    at += p.r(0.015, 0.05);
    gs.push([at, p.r(0.15, 0.4), p.r(0.004, 0.012), p.r(2500, 6000)]);
  }
  grains(p, p.out, t, gs, 'bandpass', 2);
  p.send = 0.05 + 0.12 * w.big;
}

export function thud(p: Patch, w: Who) {
  const t = p.t;
  const f = p.vary(lerp(190, 78, w.big), 0.08);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.003, 1, lerp(0.14, 0.3, w.big));
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, lerp(0.12, 0.22, w.big), [[0, 1], [1, 0.45]], f);
  o.connect(g).connect(p.out);
  // A duller knock and a puff of dust.
  const kg = p.gain(0);
  const ke = perc(kg.gain, t, 0.002, 0.3, 0.06);
  p.osc('triangle', f * p.r(2.1, 2.5), t, ke).connect(kg).connect(p.out);
  burst(p, p.out, t, 'lowpass', lerp(1500, 480, w.big), 0.9, 0.55, 0.002, 0.09);
  p.send = 0.06 + 0.1 * w.big;
}

export function dig(p: Patch, w: Who) {
  const t = p.t;
  // Claws raking soil: two to four gritty scratches (noise crackling against noise), pebbles ticking.
  const s = lerp(1.3, 0.85, w.big) * p.vary(1, 0.08);
  const env = p.gain(0);
  const bp = p.filter('bandpass', 1800 * s, 0.9);
  const n = 2 + Math.floor(p.r(0, 2.99));
  const pebbles: number[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const d = p.r(0.07, 0.12) * lerp(0.8, 1.1, w.big);
    line(env.gain, t + at, d, [[0, 0], [0.12, 1], [0.6, 0.65], [1, 0]], p.r(0.6, 1));
    glide(bp.frequency, t + at, d, [[0, p.r(2000, 2600) * s], [1, p.r(1200, 1600) * s]]);
    if (p.chance(0.7)) pebbles.push(at + d * p.r(0.3, 0.9));
    at += d + p.r(0.04, 0.09);
  }
  const end = t + at;
  // Grit: the scratch's noise multiplied by a slower noise.
  const crackle = p.gain(0);
  p.noise(t, end).connect(p.filter('lowpass', 350, 0)).connect(p.gain(5.5)).connect(crackle.gain);
  p.noise(t, end).connect(bp).connect(crackle).connect(env).connect(p.out);
  if (pebbles.length) ticks(p, t, pebbles, 4200 * s, 0.35, 3, 0.008);
}

// ---------------- through the air ----------------

export function whoosh(p: Patch, w: Who) {
  const t = p.t;
  const d = lerp(0.26, 0.4, w.big) * p.vary(1, 0.1);
  const k = lerp(1.25, 0.8, w.big) * p.vary(1, 0.1);
  const peak = p.r(0.38, 0.52);
  const bp = p.filter('bandpass', 800, 1.3);
  glide(bp.frequency, t, d, [[0, 450 * k], [peak, 1900 * k], [1, 650 * k]]);
  const g = p.gain(0);
  line(g.gain, t, d, [[0, 0], [peak, 1], [1, 0]]);
  const n = p.noise(t, t + d);
  n.connect(bp).connect(g).connect(p.out);
  n.connect(p.filter('highpass', 4500, 0.7)).connect(p.gain(0.2)).connect(g);
}

export function swish(p: Patch, w: Who) {
  const t = p.t;
  // A tail cutting the air: a quicker, whistling sweep that peaks as it passes; heavy tails whump.
  const d = lerp(0.2, 0.34, w.big) * p.vary(1, 0.1);
  const k = lerp(1.3, 0.75, w.big) * p.vary(1, 0.1);
  const n = p.noise(t, t + d);
  const g = p.gain(0);
  line(g.gain, t, d, [[0, 0], [0.5, 1], [0.62, 0.75], [1, 0]]);
  const bp = p.filter('bandpass', 700 * k, 1.1);
  glide(bp.frequency, t, d, [[0, 500 * k], [0.55, 2600 * k], [1, 800 * k]]);
  n.connect(bp).connect(g);
  const whistle = p.filter('bandpass', 1800 * k, 9);
  glide(whistle.frequency, t, d, [[0, 900 * k], [0.55, 3300 * k], [1, 1150 * k]]);
  n.connect(whistle).connect(p.gain(1.6)).connect(g);
  if (w.big > 0.3) n.connect(p.filter('lowpass', 200, 0)).connect(p.gain(5 * w.big)).connect(g);
  g.connect(p.out);
}

export function whip(p: Patch, w: Who) {
  const t = p.t;
  // A sauropod's tail cracking like a whip: a short swish speeding up, then the tip breaks the sound
  // barrier — a few milliseconds of sharp, bright crack — and the slap comes back off the surroundings.
  const s = lerp(1.6, 1, w.big);
  const d = lerp(0.12, 0.2, w.big) * p.vary(1, 0.08);
  const g = p.gain(0);
  line(g.gain, t, d, [[0, 0], [0.75, 0.35], [1, 0.55]]);
  g.gain.linearRampToValueAtTime(0, t + d + 0.01);
  const bp = p.filter('bandpass', 900, 1.2);
  glide(bp.frequency, t, d, [[0, 380 * s], [1, 3400 * s]]);
  p.noise(t, t + d + 0.012).connect(bp).connect(g).connect(p.out);
  const tc = t + d;
  burst(p, p.out, tc, 'highpass', 1400 * s, 0.7, 0.75, 0.001, 0.016);
  burst(p, p.out, tc + 0.0012, 'bandpass', 3000 * s * p.vary(1, 0.1), 1.3, 0.5, 0.001, 0.03);
  const lg = p.gain(0);
  const le = perc(lg.gain, tc, 0.001, 0.45 * (0.3 + 0.7 * w.big), 0.05);
  const o = p.osc('sine', 150 * Math.sqrt(s), tc, le);
  glide(o.frequency, tc, 0.05, [[0, 1], [1, 0.4]], 150 * Math.sqrt(s));
  o.connect(lg).connect(p.out);
  burst(p, p.out, tc + p.r(0.045, 0.07), 'bandpass', 2400 * s, 1, 0.16, 0.001, 0.035);
  p.send = 0.14;
}

export function flap(p: Patch, w: Who) {
  const t = p.t;
  // One wing beat. Skin wings (pterosaurs) push a deep "whump" of air and snap taut at the bottom of
  // the stroke; feathered wings "fwup" and flutter. Big wings are slower and deeper.
  const d = lerp(0.14, 0.3, w.big) * p.vary(1, 0.1);
  const s = w.size * p.vary(1, 0.08);
  const n = p.noise(t, t + d + 0.03);
  if (w.kind === 'croak') {
    const g = p.gain(0);
    line(g.gain, t, d, [[0, 0], [0.35, 1], [0.6, 0.55], [1, 0]]);
    n.connect(p.filter('lowpass', 260 * s, 3)).connect(p.gain(2.8)).connect(g).connect(p.out);
    burst(p, p.out, t + 0.45 * d, 'bandpass', 800 * Math.sqrt(s), 1.3, 0.22, 0.002, 0.035);
  } else {
    const g = p.gain(0);
    line(g.gain, t, d, [[0, 0], [0.3, 1], [0.55, 0.6], [1, 0]]);
    const bp = p.filter('bandpass', 1400 * s, 0.8);
    glide(bp.frequency, t, d, [[0, 900 * s], [0.4, 2600 * s], [1, 1300 * s]]);
    // Feathers fluttering: a fast wobble of the rush of air.
    const fl = p.gain(0.6);
    p.osc('triangle', p.r(45, 70), t, t + d).connect(p.gain(0.4)).connect(fl.gain);
    n.connect(bp).connect(fl).connect(g).connect(p.out);
  }
}

// ---------------- knocks ----------------

export function bonk(p: Patch, w: Who) {
  const t = p.t;
  // A hard head meeting something: a hollow, woody knock of bone that drops in pitch, a click, and
  // for big heads a low thump.
  const f = p.vary(lerp(430, 190, w.big), 0.08);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.8, lerp(0.12, 0.2, w.big));
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.1, [[0, 1.3], [0.2, 1], [1, 0.88]], f);
  o.connect(g).connect(p.out);
  bell(p, p.out, t, f * p.r(2.35, 2.55), 0.3, 0.06, [[1, 1, 1], [1.68, 0.4, 0.6]], 0.001);
  burst(p, p.out, t, 'bandpass', 2400, 1.2, 0.5, 0.0005, 0.008);
  if (w.big > 0.4) burst(p, p.out, t, 'lowpass', 300, 1, 0.5 * w.big, 0.002, 0.07);
  p.send = 0.06;
}

export function boing(p: Patch, w: Who) {
  const t = p.t;
  const f = p.vary(lerp(460, 330, w.big), 0.08);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.004, 0.6, 0.42);
  const wob = p.gain(0);
  line(wob.gain, t, 0.45, [[0, 0], [0.12, p.r(140, 200)], [1, 0]]);
  p.osc('sine', p.vary(14, 0.12), t, e).connect(wob);
  for (const [r, lv] of [[1, 1], [2.02, 0.18]] as const) {
    const o = p.osc(r === 1 ? 'sine' : 'triangle', f * r, t, e);
    glide(o.frequency, t, 0.07, [[0, 0.55], [1, 1]], f * r);
    wob.connect(o.detune);
    o.connect(p.gain(lv)).connect(g);
  }
  g.connect(p.out);
  p.send = 0.08;
}

// ---------------- water, bubbles, toys ----------------

export function pop(p: Patch) {
  const t = p.t;
  const f = p.vary(520, 0.1);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.8, 0.07);
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.035, [[0, 0.6], [1, p.r(2, 2.4)]], f);
  o.connect(g).connect(p.out);
  burst(p, p.out, t, 'highpass', 3000, 0.7, 0.25, 0.001, 0.012);
  p.send = 0.05;
}

export function splash(p: Patch, w: Who) {
  const t = p.t;
  // Water: the slap on the surface, a "bloop" as the air pocket closes, then droplets pattering back.
  const s = lerp(1.4, 0.85, w.big) * p.vary(1, 0.1);
  burst(p, p.out, t, 'bandpass', 1700 * s, 0.6, 0.8, 0.002, 0.09 * lerp(0.8, 1.3, w.big));
  if (w.big > 0.3) burst(p, p.out, t + 0.005, 'lowpass', 500, 1, 0.5 * w.big, 0.01, 0.12);
  const f = p.r(280, 420) * s;
  const tb = t + p.r(0.015, 0.03);
  const g = p.gain(0);
  const e = perc(g.gain, tb, 0.003, 0.5, 0.06);
  const o = p.osc('sine', f, tb, e);
  glide(o.frequency, tb, 0.05, [[0, 1], [1, p.r(2.5, 3.5)]], f);
  o.connect(g).connect(p.out);
  const drops: Grain[] = [];
  let at = 0.06;
  const n = 3 + Math.floor(p.r(0, 3.99) * (0.5 + 0.5 * w.big));
  for (let i = 0; i < n; i++) {
    at += p.r(0.03, 0.08);
    const fd = p.r(1300, 3400) * Math.sqrt(s);
    drops.push([at, p.r(0.12, 0.35) * (1 - (0.5 * i) / n), p.r(0.012, 0.025), fd, fd * p.r(1.3, 1.8)]);
  }
  pings(p, p.out, t, drops);
  p.send = 0.06;
}

export function bubble(p: Patch) {
  const t = p.t;
  // A soap bubble popping: a tiny bright "plip" — a quick rising ping and a whisper of a click.
  const f = p.r(900, 1700);
  const ps: Grain[] = [[0, 0.8, p.r(0.025, 0.045), f, f * p.r(2.2, 3.2)]];
  if (p.chance(0.3)) ps.push([p.r(0.05, 0.09), 0.3, 0.02, f * 1.4, f * 3.4]);
  pings(p, p.out, t, ps);
  burst(p, p.out, t, 'highpass', 5500, 0.7, 0.18, 0.0005, 0.005);
}

export function toy(p: Patch) {
  const t = p.t;
  // A squeaky rubber toy: a reedy whistle that jumps up as it's squeezed and wavers, then a lower,
  // shorter squeak as the air rushes back in (or one long squeal).
  const f = p.r(1000, 1500);
  const k = p.choose([1.2, 0.8, 0.6]);
  const d1 = k === 2 ? p.r(0.26, 0.34) : p.r(0.1, 0.15);
  const gap = p.r(0.05, 0.09);
  const d2 = k === 0 ? p.r(0.07, 0.11) : 0;
  const end = t + d1 + (d2 ? gap + d2 : 0) + 0.01;
  const o = p.osc('square', f, t, end);
  glide(o.frequency, t, d1, [[0, 0.8], [0.25, 1.1], [1, 1.02]], f);
  const vca = p.gain(0);
  line(vca.gain, t, d1, [[0, 0], [0.08, 1], [0.85, 0.85], [1, 0]], 0.5);
  if (d2) {
    glide(o.frequency, t + d1 + gap, d2, [[0, 0.92], [1, 0.78]], f);
    line(vca.gain, t + d1 + gap, d2, [[0, 0], [0.12, 1], [0.7, 0.8], [1, 0]], 0.35);
  }
  // Wobbly rubber: an uneven vibrato.
  const wob = p.gain(p.r(30, 60));
  p.osc('sine', p.r(11, 17), t, end).connect(wob).connect(o.detune);
  p.noise(t, end, p.kit.drift, 9).connect(p.gain(25)).connect(o.detune);
  o.connect(p.filter('bandpass', f * 2, 2.5)).connect(p.gain(2)).connect(vca).connect(p.out);
  o.connect(p.filter('lowpass', f * 1.3, 0)).connect(p.gain(0.5)).connect(vca);
  p.send = 0.05;
}

// ---------------- leaves ----------------

export function rustle(p: Patch, w: Who) {
  const t = p.t;
  // Leaves: a soft "shh" swelling once or twice, with dense dry crackles on top (two chains of grains
  // so they can overlap).
  const d = p.r(0.35, 0.6) * lerp(0.85, 1.1, w.big);
  const twice = p.chance(0.5);
  const shape: [number, number][] = twice ? [[0, 0], [0.2, 1], [0.45, 0.45], [0.65, 0.9], [1, 0]] : [[0, 0], [0.3, 1], [0.7, 0.6], [1, 0]];
  const g = p.gain(0);
  line(g.gain, t, d, shape, 0.3);
  p.noise(t, t + d).connect(p.filter('bandpass', p.r(3500, 5000), 0.7)).connect(g).connect(p.out);
  // Crackle density follows the swell.
  const loud = (x: number) => {
    for (let i = 1; i < shape.length; i++) if (x <= shape[i][0]) return lerp(shape[i - 1][1], shape[i][1], (x - shape[i - 1][0]) / (shape[i][0] - shape[i - 1][0]));
    return 0;
  };
  for (const [type, q] of [['bandpass', 1.6], ['highpass', 0.7]] as const) {
    const gs: Grain[] = [];
    for (let at = p.r(0, 0.02); at < d - 0.02; ) {
      const k = loud(at / d);
      const decay = p.r(0.002, 0.009);
      if (p.chance(0.25 + 0.75 * k)) gs.push([at, p.r(0.25, 1) * (0.3 + 0.7 * k), decay, p.r(2200, 7500)]);
      at += decay + p.r(0.008, 0.035);
    }
    if (gs.length) grains(p, p.out, t, gs, type, q, 0.0005);
  }
}

// ---------------- eggs ----------------

/** Shell crackles: a quick run of bright clicks. */
export function crackle(p: Patch, t: number, n: number, span: number, level: number) {
  const gs: Grain[] = [];
  let at = 0;
  for (let i = 0; i < n && at < span; i++) {
    const decay = p.r(0.006, 0.02);
    gs.push([at, level * p.r(0.5, 1), decay, p.r(2500, 6500)]);
    at += decay + p.r(0.008, 0.03);
  }
  grains(p, p.out, t, gs, 'bandpass', 3);
}

export function crack(p: Patch) {
  const t = p.t;
  crackle(p, t, 3 + Math.floor(p.r(0, 2.99)), 0.12, 0.9);
  bell(p, p.out, t + 0.008, p.r(2800, 3800), 0.1, 0.08, [[1, 1, 1], [2.4, 0.3, 0.5]]);
  // The egg's hollow body.
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.3, 0.04);
  p.osc('sine', p.vary(560, 0.1), t, e).connect(g).connect(p.out);
  p.send = 0.05;
}

/** Bits of shell landing after a hatch: tiny glassy tinks. */
export function shellBits(p: Patch, t: number, n: number) {
  const gs: Grain[] = [];
  let at = 0.28;
  for (let i = 0; i < n; i++) {
    at += p.r(0.02, 0.09);
    const f = p.r(3000, 6500);
    gs.push([at, p.r(0.03, 0.08), p.r(0.03, 0.06), f, f]);
  }
  pings(p, p.out, t, gs, 'sine', 0.001);
}

/** A soft pad swelling under a sparkle: two detuned sines. */
export function glow(p: Patch, t: number, f: number, dur: number, level: number) {
  const g = p.gain(0);
  line(g.gain, t, dur, [[0, 0], [0.35, 1], [0.7, 0.7], [1, 0]], level);
  for (const det of [-7, 7]) {
    const o = p.osc('triangle', f, t, t + dur);
    o.detune.value = det;
    o.connect(g);
  }
  g.connect(p.filter('lowpass', f * 3, 0)).connect(p.out);
  return t + dur;
}

/** Glitter: many tiny high pings scattered over `span` seconds. */
export function glitter(p: Patch, t: number, span: number, n: number, level: number) {
  const gs: Grain[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    at += p.r(0.3, 1.7) * (span / n);
    const f = p.r(2600, 6800);
    gs.push([at, level * p.r(0.4, 1), p.r(0.02, 0.05), f, f * p.r(1, 1.06)]);
  }
  return pings(p, p.out, t, gs, 'sine', 0.001);
}
