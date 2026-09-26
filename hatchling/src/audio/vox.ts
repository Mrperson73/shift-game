// The vocal model every pet voice shares: a source (oscillators and breath) with life in it — jitter,
// rough and half-pitch wobbles like irregular vocal folds, grit — sung through a vocal tract (formant
// band-passes that drift a little) and coloured with flutter, rasp, trills, a tube resonance or a hollow
// ring. The notes of a phrase are automation on one set of nodes, so ten syllables cost what one does.
// Plus the extra layers some voices add: hisses, rattles, throat booms, snorts, clicks and air rumble.

import { clamp, glide, grains, type Grain, gritCurve, gritMakeup, lerp, line, type Patch, type Pts, type Wave } from './synth';

export type Vowel = 'a' | 'o' | 'u' | 'e' | 'i' | 'ae' | 'uh' | 'm' | 'n';
export type Vowels = Vowel | readonly (readonly [number, Vowel])[];

/** Formant frequencies (adult human; scaled by throat size) and their levels. */
const VOWELS: Record<Vowel, readonly [readonly number[], readonly number[]]> = {
  a: [[730, 1090, 2440], [1, 0.7, 0.3]],
  o: [[570, 840, 2410], [1, 0.55, 0.18]],
  u: [[320, 800, 2240], [1, 0.3, 0.08]],
  e: [[530, 1840, 2480], [0.9, 0.6, 0.32]],
  i: [[300, 2250, 3000], [0.7, 0.55, 0.42]],
  ae: [[660, 1720, 2410], [1, 0.65, 0.3]],
  uh: [[600, 1170, 2390], [1, 0.5, 0.2]],
  // Closed mouth: hums.
  m: [[260, 1150, 2300], [1, 0.1, 0.04]],
  n: [[280, 1650, 2600], [1, 0.14, 0.05]],
};
/** Formant sharpness: broad, like big animal throats (and pitch glides stay smooth). */
const FQ = [3.2, 4.5, 6];

export interface Vox {
  f: number; // base pitch, Hz
  wave: Wave;
  thick: number; // a second source a few cents sharp: beating makes it sound bigger
  sub: number; // sine an octave down (adult body)
  tract: number; // formant scale: 1 ≈ human, lower for big throats
  q: number; // formant sharpness multiplier ("wetter" when higher)
  fmt: number; // level of the formant bank
  body: number; // clean low path: the fundamental's weight
  noise: number; // breath / rasp
  grit: number; // waveshaper drive 0..1
  rough: number; // irregular amplitude wobble 0..1: hoarse, growly
  roughHz: number; // how fast it wobbles
  subh: number; // period doubling 0..1: every other cycle louder, a growl an octave down
  flutter: number; // rough amplitude flutter depth 0..1 ("rrr")
  flutterHz: number;
  rasp: number; // fast pitch modulation, cents (shrieks)
  raspHz: number;
  trill: number; // deep amplitude pulses 0..1 (bird trills)
  trillHz: number;
  vib: number; // vibrato, cents
  vibHz: number;
  vibDelay: number; // seconds before the vibrato fades in
  jitter: number; // slow random pitch wander, cents
  drift: number; // slow random formant wander, cents: a living throat
  comb: number; // tube resonance feedback 0..0.8 (a horn)
  ring: number; // resonant peak riding on the fundamental (hollow)
  lp: number; // low-pass cutoff in Hz (0 = none)
  brass: number; // 1 = the low-pass opens with loudness, like a horn
  level: number;
}

export type Mod = number | Pts;

export interface Note {
  /** Start, seconds from the phrase start. */
  at: number;
  dur: number;
  /** Pitch as multiples of the base pitch. */
  p: Pts;
  /** Loudness shape (0..1). */
  a?: Pts;
  v?: Vowels;
  lv?: number;
  /** Per-note flutter depth, trill depth, and noise and roughness multipliers. */
  fl?: Mod;
  tr?: Mod;
  nz?: Mod;
  ro?: Mod;
}

export const SWELL: Pts = [[0, 0], [0.12, 1], [0.7, 0.8], [1, 0]];
export const BLIP: Pts = [[0, 0], [0.12, 1], [0.6, 0.75], [1, 0]];
export const BARK: Pts = [[0, 0], [0.05, 1], [0.35, 0.7], [1, 0]];
export const HOOT: Pts = [[0, 0], [0.22, 1], [0.6, 0.8], [1, 0]];
export const GRUNT: Pts = [[0, 0], [0.1, 1], [0.45, 0.55], [1, 0]];
/** Very short syllables: clicks, chips and ticks. */
export const TICK: Pts = [[0, 0], [0.1, 1], [0.45, 0.45], [1, 0]];
/** A caw: a hard onset that fades. */
export const CAW: Pts = [[0, 0], [0.04, 1], [0.3, 0.85], [0.75, 0.45], [1, 0]];
/** A slow hum. */
export const HUM: Pts = [[0, 0], [0.3, 1], [0.7, 0.85], [1, 0]];

export const BASE: Omit<Vox, 'f'> = {
  wave: 'glottal',
  thick: 0,
  sub: 0,
  tract: 1,
  q: 1,
  fmt: 1,
  body: 0.3,
  noise: 0,
  grit: 0,
  rough: 0,
  roughHz: 90,
  subh: 0,
  flutter: 0,
  flutterHz: 25,
  rasp: 0,
  raspHz: 90,
  trill: 0,
  trillHz: 24,
  vib: 0,
  vibHz: 5,
  vibDelay: 0.2,
  jitter: 15,
  drift: 0,
  comb: 0,
  ring: 0,
  lp: 0,
  brass: 0,
  level: 1,
};

/** Changes some settings of a voice (typed, so typos are caught). */
export const set = (v: Vox, o: Partial<Vox>) => Object.assign(v, o);

/** Friendlier: less grit, noise, roughness, flutter and rasp for small noises (and no growly doubling). */
export const tame = (v: Vox, k: number): Vox => ({ ...v, grit: v.grit * k, noise: v.noise * k, rough: v.rough * k * k, subh: 0, flutter: v.flutter * k, rasp: v.rasp * k });

/** Applies a note's modulation (or the default) to `param`, mapped through `map`. */
function perNote(param: AudioParam, t0: number, notes: readonly Note[], pick: (n: Note) => Mod | undefined, def: number, map: (x: number) => number) {
  for (const n of notes) {
    const m = pick(n) ?? def;
    if (typeof m === 'number') param.setValueAtTime(map(m), t0 + n.at);
    else line(param, t0 + n.at, n.dur, m.map(([fr, x]) => [fr, map(x)] as const));
  }
}

/** Amplitude modulation: gain swings between 1 - depth and 1 at `hz` (flutter, trills, tremolo). */
function trem(p: Patch, input: AudioNode, hz: number, depth: number, t0: number, end: number, notes: readonly Note[], pick: (n: Note) => Mod | undefined, wobble: number) {
  const g = p.gain(1 - depth / 2);
  const d = p.gain(depth / 2);
  const lfo = p.osc('sine', hz, t0, end);
  lfo.connect(d).connect(g.gain);
  // A little randomness in the rate keeps it organic.
  if (wobble) p.noise(t0, end, p.kit.drift, 1.7).connect(p.gain(hz * wobble)).connect(lfo.frequency);
  perNote(g.gain, t0, notes, pick, depth, (x) => 1 - clamp(x) / 2);
  perNote(d.gain, t0, notes, pick, depth, (x) => clamp(x) / 2);
  input.connect(g);
  return g;
}

/** A tube resonance: a short feedback delay tuned to the pitch (a horn, Parasaurolophus' crest). */
function comb(p: Patch, input: AudioNode, f: number, fb: number) {
  const sum = p.gain(1);
  // Chromium adds one render quantum (128 frames) to a delay inside a feedback loop, so the loop is
  // tuned to a whole number of periods at least that long.
  const q = 128 / p.ctx.sampleRate;
  const n = Math.max(1, Math.ceil((q + 0.0005) * f));
  input.connect(sum);
  sum.connect(p.delay(n / f - q)).connect(p.filter('lowpass', Math.min(f * 6, 5000), 0.5)).connect(p.gain(fb)).connect(sum);
  return sum;
}

/** Morphs the formant bank through vowels over a note. */
function vowels(p: Patch, fs: readonly (readonly [BiquadFilterNode, GainNode])[], t: number, dur: number, v: Vowels, scale: number, level: number) {
  const pts = typeof v === 'string' ? ([[0, v]] as const) : v;
  fs.forEach(([bp, g], i) => {
    glide(bp.frequency, t, dur, pts.map(([fr, w]) => [fr, p.hz(VOWELS[w][0][i] * scale)] as const));
    line(g.gain, t, dur, pts.map(([fr, w]) => [fr, VOWELS[w][1][i] * level] as const));
  });
}

/**
 * Sings `notes` with one continuous voice: source → rough/half-pitch wobble → grit → (tube) → vocal
 * tract → loudness → flutter/trill. Returns when it ends.
 */
export function vox(p: Patch, v: Vox, notes: readonly Note[], t0 = p.t, to: AudioNode = p.out) {
  const end = t0 + Math.max(...notes.map((n) => n.at + n.dur)) + 0.02;
  const f = v.f;
  const sr = p.ctx.sampleRate;
  const nyq = sr * 0.45;
  const src = p.gain(1);
  const vca = p.gain(0);
  const main = p.osc(v.wave, f, t0, end);
  main.connect(src);
  const oscs: [OscillatorNode, number][] = [[main, 1]];
  if (v.thick > 0) {
    // Half a period late, so the two waves' edges interleave instead of stacking up.
    const o = p.osc(v.wave, f, t0 + 0.5 / f, end);
    o.detune.value = 13;
    o.connect(p.gain(v.thick)).connect(src);
    oscs.push([o, 1]);
  }
  // The octave below: a clean sub for an adult's weight (faded out below ~40 Hz, where it would only eat
  // headroom), and the beat of period doubling.
  const sub = v.sub * clamp((f / 2 - 38) / 15);
  // (Faint roughness or doubling isn't worth its nodes.)
  const subh = v.subh > 0.05 ? clamp(v.subh) : 0;
  const rough = v.rough > 0.05 ? clamp(v.rough) : 0;
  let half: OscillatorNode | null = null;
  if (sub > 0.01 || subh > 0) {
    half = p.osc('sine', f / 2, t0, end);
    if (sub > 0.01) half.connect(p.gain(sub)).connect(vca);
    oscs.push([half, 0.5]);
  }
  for (const n of notes) for (const [o, r] of oscs) glide(o.frequency, t0 + n.at, n.dur, n.p, f * r, nyq);

  // Pitch life, in cents: vibrato, a slow random wander, and fast rasp.
  const det = p.gain(1);
  for (const [o] of oscs) det.connect(o.detune);
  if (v.vib > 0) {
    const g = p.gain(0);
    p.osc('sine', v.vibHz, t0, end).connect(g).connect(det);
    g.gain.setValueAtTime(0, t0 + v.vibDelay);
    g.gain.linearRampToValueAtTime(v.vib, t0 + v.vibDelay + 0.3);
  }
  if (v.jitter > 0) p.noise(t0, end, p.kit.drift, 1.3).connect(p.gain(v.jitter)).connect(det);
  if (v.rasp > 0) {
    p.osc('sine', v.raspHz, t0, end).connect(p.gain(v.rasp)).connect(det);
    p.noise(t0, end, p.kit.drift, 7).connect(p.gain(v.rasp * 0.7)).connect(det);
  }

  // Irregular vocal folds: the source's loudness wobbles randomly (rough) and every other cycle is
  // louder (period doubling, an undertone an octave down). Both deepen with a note's `ro`.
  let x: AudioNode = src;
  if (rough > 0 || (half && subh > 0)) {
    const am = p.gain(1 - 0.25 * rough - 0.2 * subh);
    const depth: [GainNode, number][] = [];
    if (rough > 0) {
      // Low-passed white noise, scaled to a standard deviation of 0.35 * rough.
      const fc = clamp(v.roughHz, 20, 400);
      const k = 0.35 * rough * Math.sqrt((1.5 * sr) / fc);
      const g = p.gain(k);
      p.noise(t0, end).connect(p.filter('lowpass', fc, 0)).connect(g).connect(am.gain);
      depth.push([g, k]);
    }
    if (half && subh > 0) {
      const g = p.gain(0.4 * subh);
      half.connect(g).connect(am.gain);
      depth.push([g, 0.4 * subh]);
    }
    if (notes.some((n) => n.ro !== undefined)) for (const [g, k] of depth) perNote(g.gain, t0, notes, (n) => n.ro, 1, (m) => Math.max(0, m) * k);
    x = src.connect(am);
  }

  // Grit: drive a saturating curve, keeping the peak level. The clean paths (body, ring) take the source
  // before the wobbles, which would only add peaks there. Chromium's 2x oversampling delays the shaper's
  // output by 128 frames, so they are delayed to match (else they comb-filter).
  let clean: AudioNode = src;
  let y: AudioNode = x;
  if (v.grit > 0.02) {
    const drive = 0.05 + 0.95 * clamp(v.grit);
    const os = v.grit > 0.35;
    y = x.connect(p.gain(drive)).connect(p.shaper(gritCurve(), os ? '2x' : 'none')).connect(p.gain(gritMakeup(drive)));
    if (os && (v.body > 0 || v.ring > 0)) clean = src.connect(p.delay(128 / sr));
  }
  if (v.comb > 0) y = comb(p, y, f, v.comb);
  const tract = p.gain(1);
  y.connect(tract);
  if (v.noise > 0) {
    const ng = p.gain(v.noise);
    p.noise(t0, end).connect(p.filter('bandpass', 1500 * v.tract, 0.6)).connect(ng).connect(tract);
    perNote(ng.gain, t0, notes, (n) => n.nz, 1, (k) => k * v.noise);
  }

  // Vocal tract: three formants (wandering a little), plus the clean low body and the hollow ring.
  const mix = p.gain(1);
  if (v.fmt > 0) {
    const fs = FQ.map((q) => {
      const bp = p.filter('bandpass', 500, q * v.q);
      const g = p.gain(0);
      tract.connect(bp).connect(g).connect(mix);
      return [bp, g] as const;
    });
    for (const n of notes) vowels(p, fs, t0 + n.at, n.dur, n.v ?? 'a', v.tract, v.fmt);
    if (v.drift > 0) {
      const d = p.gain(v.drift);
      p.noise(t0, end, p.kit.drift, 2.3).connect(d);
      for (const [bp] of fs) d.connect(bp.detune);
    }
  }
  if (v.body > 0) {
    const lp = p.filter('lowpass', f * 2.2, 0.5);
    for (const n of notes) glide(lp.frequency, t0 + n.at, n.dur, n.p, f * 2.2, nyq);
    clean.connect(lp).connect(p.gain(v.body)).connect(mix);
  }
  if (v.ring > 0) {
    const bp = p.filter('bandpass', f, 8);
    for (const n of notes) glide(bp.frequency, t0 + n.at, n.dur, n.p, f, nyq);
    clean.connect(bp).connect(p.gain(v.ring)).connect(mix);
  }

  // Brightness: a low-pass; a horn's opens as it gets louder.
  let z: AudioNode = mix;
  if (v.lp > 0) {
    const lp = p.filter('lowpass', v.lp, 0.7);
    if (v.brass > 0) for (const n of notes) glide(lp.frequency, t0 + n.at, n.dur, (n.a ?? SWELL).map(([fr, a]) => [fr, p.hz(lerp(f * 1.6, v.lp, a))] as const));
    z = mix.connect(lp);
  }
  z.connect(vca);
  for (const n of notes) line(vca.gain, t0 + n.at, n.dur, n.a ?? SWELL, (n.lv ?? 1) * v.level);
  let out: AudioNode = vca;
  if (v.flutter > 0) out = trem(p, out, v.flutterHz, v.flutter, t0, end, notes, (n) => n.fl, 0.25);
  if (v.trill > 0) out = trem(p, out, v.trillHz, v.trill, t0, end, notes, (n) => n.tr, 0.05);
  out.connect(to);
  return end;
}

// ---------------- extra layers ----------------

/** A breathy hiss. */
export function hiss(p: Patch, t: number, dur: number, level: number, f = 3200) {
  const g = p.gain(0);
  line(g.gain, t, dur, [[0, 0], [0.3, 1], [0.6, 0.7], [1, 0]], level);
  p.noise(t, t + dur).connect(p.filter('highpass', f, 0.7)).connect(p.filter('lowpass', 9000, 0.7)).connect(g).connect(p.out);
}

/** A dry clicking rattle — noise gated by a fast click train (Dilophosaurus, a stork's bill clatter). */
export function rattle(p: Patch, t: number, dur: number, hz: number, level: number, f = 3800, q = 1.1) {
  const end = t + dur;
  const gate = p.gain(0);
  const clicks = p.osc('clicks', hz, t, end);
  glide(clicks.frequency, t, dur, [[0, 0.8], [0.3, 1.1], [1, 0.9]], hz);
  clicks.connect(gate.gain);
  const env = p.gain(0);
  line(env.gain, t, dur, [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], level);
  p.noise(t, end).connect(p.filter('bandpass', f, q)).connect(gate).connect(env).connect(p.out);
}

/** A low sine "thoom" (a resonating throat pouch or a chest). */
export function boom(p: Patch, t: number, dur: number, f: number, level: number, shape: Pts = HOOT, bend: Pts = [[0, 0.95], [0.3, 1], [1, 0.9]]) {
  const g = p.gain(0);
  line(g.gain, t, dur, shape, level);
  const o = p.osc('sine', f, t, t + dur);
  glide(o.frequency, t, dur, bend, f);
  o.connect(g).connect(p.out);
}

/** Spinosaurus: a crocodile-like rumble, a low saw pulsing ~10 times a second. */
export function croc(p: Patch, t: number, dur: number, f: number, level: number) {
  const end = t + dur;
  const vca = p.gain(0);
  line(vca.gain, t, dur, [[0, 0], [0.25, 1], [0.7, 0.8], [1, 0]], level);
  const pulse = p.gain(0.5);
  p.osc('sine', p.r(9, 12), t, end).connect(p.gain(0.5)).connect(pulse.gain);
  p.osc('sawtooth', f * 0.5, t, end).connect(p.filter('lowpass', Math.max(140, f * 2.2), 0.9)).connect(vca).connect(pulse).connect(p.out);
}

/** Air rumbling through a huge chest: low-passed noise, felt more than heard. */
export function air(p: Patch, t: number, dur: number, level: number, f = 120, shape: Pts = HUM) {
  const g = p.gain(0);
  line(g.gain, t, dur, shape, level);
  // Scaled to a standard deviation of about 0.5 whatever the cutoff.
  p.noise(t, t + dur).connect(p.filter('lowpass', f, 3)).connect(p.gain(0.5 * Math.sqrt((1.5 * p.ctx.sampleRate) / f))).connect(g).connect(p.out);
}

/**
 * Snorts and huffs: bursts of air through the nostrils — noise through two nasal resonances, the
 * nostrils fluttering (`flap` 0..1). `puffs` are [start (s after t), duration, level]; `size` is 1 for
 * an adult of a big species, higher for small ones. Returns the end.
 */
export function nose(p: Patch, t: number, puffs: readonly (readonly [number, number, number])[], size: number, flap = 0.5) {
  const g = p.gain(0);
  let end = t;
  for (const [at, dur, lv] of puffs) {
    const s = Math.max(t + at, end);
    line(g.gain, s, dur, [[0, 0], [0.08, 1], [0.35, 0.6], [1, 0]], lv);
    end = s + dur;
  }
  const n = p.noise(t, end);
  const mix = p.gain(1);
  // Band-passed noise is faint; these gains bring a puff near full scale.
  n.connect(p.filter('bandpass', p.vary(750, 0.1) * size, 2.2)).connect(p.gain(3)).connect(mix);
  n.connect(p.filter('bandpass', p.vary(2300, 0.1) * Math.sqrt(size), 1.4)).connect(p.gain(1)).connect(mix);
  let out: AudioNode = mix;
  if (flap > 0.02) {
    // The nostrils flapping: a fast wobble of the airflow.
    const fl = p.gain(1 - flap / 2);
    p.osc('triangle', p.r(28, 40) * Math.sqrt(size), t, end).connect(p.gain(flap / 2)).connect(fl.gain);
    out = mix.connect(fl);
  }
  out.connect(g).connect(p.out);
  return end;
}

/** Beak, tongue or claw clicks: short resonant ticks at `times` (s after `t`) around `f` Hz. */
export function ticks(p: Patch, t: number, times: readonly number[], f: number, level: number, q = 2.5, decay = 0.006) {
  const gs: Grain[] = times.map((at) => [at, level * p.r(0.7, 1), decay * p.r(0.8, 1.25), f * p.r(0.88, 1.12)]);
  return grains(p, p.out, t, gs, 'bandpass', q, 0.0006);
}
