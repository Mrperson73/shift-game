// The pet's sounds: every SoundName for every VoiceKind, scaled by growth — squeaky hatchlings,
// rumbling adults. Vocal sounds share one model ("vox"): a source (oscillators, breath noise, grit)
// sung through a vocal tract (formant band-passes) and coloured per kind with flutter, rasp, trill,
// a tube resonance or a hollow ring. Signature calls and roars are shaped by hand for each kind.

import type { SoundName, Voice, VoiceKind } from './types';
import { bell, burst, clamp, dB, glide, gritCurve, gritMakeup, lerp, line, type Patch, perc, type Pts, type Wave } from './synth';

// ---------------- the vocal model ----------------

type Vowel = 'a' | 'o' | 'u' | 'e' | 'i' | 'ae' | 'm';
type Vowels = Vowel | readonly (readonly [number, Vowel])[];

/** Formant frequencies (adult human; scaled by throat size) and their levels. */
const VOWELS: Record<Vowel, readonly [readonly number[], readonly number[]]> = {
  a: [[730, 1090, 2440], [1, 0.7, 0.3]],
  o: [[570, 840, 2410], [1, 0.55, 0.18]],
  u: [[320, 800, 2240], [1, 0.3, 0.08]],
  e: [[530, 1840, 2480], [0.9, 0.6, 0.32]],
  i: [[300, 2250, 3000], [0.7, 0.55, 0.42]],
  ae: [[660, 1720, 2410], [1, 0.65, 0.3]],
  m: [[260, 1150, 2300], [1, 0.1, 0.04]],
};
/** Formant sharpness: broad, like big animal throats (and pitch glides stay smooth). */
const FQ = [3.2, 4.5, 6];

interface Vox {
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
  comb: number; // tube resonance feedback 0..0.8 (a horn)
  ring: number; // resonant peak riding on the fundamental (hollow)
  lp: number; // low-pass cutoff in Hz (0 = none)
  brass: number; // 1 = the low-pass opens with loudness, like a horn
  level: number;
}

type Mod = number | Pts;

interface Note {
  /** Start, seconds from the phrase start. */
  at: number;
  dur: number;
  /** Pitch as multiples of the base pitch. */
  p: Pts;
  /** Loudness shape (0..1). */
  a?: Pts;
  v?: Vowels;
  lv?: number;
  /** Per-note flutter depth, trill depth and noise multiplier. */
  fl?: Mod;
  tr?: Mod;
  nz?: Mod;
}

const SWELL: Pts = [[0, 0], [0.12, 1], [0.7, 0.8], [1, 0]];
const BLIP: Pts = [[0, 0], [0.12, 1], [0.6, 0.75], [1, 0]];
const BARK: Pts = [[0, 0], [0.05, 1], [0.35, 0.7], [1, 0]];
const HOOT: Pts = [[0, 0], [0.22, 1], [0.6, 0.8], [1, 0]];
const GRUNT: Pts = [[0, 0], [0.1, 1], [0.45, 0.55], [1, 0]];

const BASE: Omit<Vox, 'f'> = {
  wave: 'glottal',
  thick: 0,
  sub: 0,
  tract: 1,
  q: 1,
  fmt: 1,
  body: 0.3,
  noise: 0,
  grit: 0,
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
  comb: 0,
  ring: 0,
  lp: 0,
  brass: 0,
  level: 1,
};

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

/** Sings `notes` with one continuous voice: source → grit → (tube) → vocal tract → loudness → flutter/trill. */
function vox(p: Patch, v: Vox, notes: readonly Note[], t0 = p.t, to: AudioNode = p.out) {
  const end = t0 + Math.max(...notes.map((n) => n.at + n.dur)) + 0.02;
  const f = v.f;
  const nyq = p.ctx.sampleRate * 0.45;
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
  // The sub fades out below ~40 Hz, where it would only eat headroom.
  const sub = v.sub * clamp((f / 2 - 38) / 15);
  if (sub > 0.01) {
    const s = p.osc('sine', f / 2, t0, end);
    s.connect(p.gain(sub)).connect(vca);
    oscs.push([s, 0.5]);
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

  // Grit: drive a saturating curve, keeping the peak level.
  let x: AudioNode = src;
  if (v.grit > 0.02) {
    const drive = 0.05 + 0.95 * clamp(v.grit);
    x = src.connect(p.gain(drive)).connect(p.shaper(gritCurve(), v.grit > 0.35 ? '2x' : 'none')).connect(p.gain(gritMakeup(drive)));
  }
  if (v.comb > 0) x = comb(p, x, f, v.comb);
  const tract = p.gain(1);
  x.connect(tract);
  if (v.noise > 0) {
    const ng = p.gain(v.noise);
    p.noise(t0, end).connect(p.filter('bandpass', 1500 * v.tract, 0.6)).connect(ng).connect(tract);
    perNote(ng.gain, t0, notes, (n) => n.nz, 1, (k) => k * v.noise);
  }

  // Vocal tract: three formants, plus the clean low body and the hollow ring.
  const mix = p.gain(1);
  if (v.fmt > 0) {
    const fs = FQ.map((q) => {
      const bp = p.filter('bandpass', 500, q * v.q);
      const g = p.gain(0);
      tract.connect(bp).connect(g).connect(mix);
      return [bp, g] as const;
    });
    for (const n of notes) vowels(p, fs, t0 + n.at, n.dur, n.v ?? 'a', v.tract, v.fmt);
  }
  if (v.body > 0) {
    const lp = p.filter('lowpass', f * 2.2, 0.5);
    for (const n of notes) glide(lp.frequency, t0 + n.at, n.dur, n.p, f * 2.2, nyq);
    src.connect(lp).connect(p.gain(v.body)).connect(mix);
  }
  if (v.ring > 0) {
    const bp = p.filter('bandpass', f, 8);
    for (const n of notes) glide(bp.frequency, t0 + n.at, n.dur, n.p, f, nyq);
    src.connect(bp).connect(p.gain(v.ring)).connect(mix);
  }

  // Brightness: a low-pass; a horn's opens as it gets louder.
  let y: AudioNode = mix;
  if (v.lp > 0) {
    const lp = p.filter('lowpass', v.lp, 0.7);
    if (v.brass > 0) for (const n of notes) glide(lp.frequency, t0 + n.at, n.dur, (n.a ?? SWELL).map(([fr, a]) => [fr, p.hz(lerp(f * 1.6, v.lp, a))] as const));
    y = mix.connect(lp);
  }
  y.connect(vca);
  for (const n of notes) line(vca.gain, t0 + n.at, n.dur, n.a ?? SWELL, (n.lv ?? 1) * v.level);
  let out: AudioNode = vca;
  if (v.flutter > 0) out = trem(p, out, v.flutterHz, v.flutter, t0, end, notes, (n) => n.fl, 0.25);
  if (v.trill > 0) out = trem(p, out, v.trillHz, v.trill, t0, end, notes, (n) => n.tr, 0.05);
  out.connect(to);
  return end;
}

// ---------------- who is calling ----------------

interface Who {
  kind: VoiceKind;
  v: Vox;
  /** 1 for a hatchling .. 0 for an adult, and its opposite. */
  baby: number;
  big: number;
  /** Duration scale: hatchlings are quicker. */
  len: number;
  /** Species colour within a kind, from its pitch and growl (0..1 each): */
  bark: number; // Carnotaurus: gruff, barking roars
  rumble: number; // Spinosaurus: croc-like rumble and a hiss
  rattle: number; // Dilophosaurus: clicking rattle
  grunt: number; // Ankylosaurus: grunts before its bellow
  gentle: number; // Stegosaurus: a softer bellow
}

/** Changes some settings of a voice (typed, so typos are caught). */
const set = (v: Vox, o: Partial<Vox>) => Object.assign(v, o);

/** Loudness of each kind as [hatchling, adult] in dB, balanced with scripts/sounds.mjs. */
const KIND_DB: Record<VoiceKind, readonly [number, number]> = {
  roar: [3.1, -0.2],
  screech: [6.3, 4.8],
  hoot: [-8, -9.3],
  bellow: [0.5, -0.8],
  honk: [4.1, 5.1],
  trill: [-3.8, -2.2],
};

/** The voice for one play, with a little random variation (`vary` is the pitch spread). */
function who(p: Patch, voice: Voice, growth: number, vary = 0.06): Who {
  const g = clamp(voice.growl);
  const baby = (1 - clamp(growth)) ** 1.6;
  const big = 1 - baby;
  const pitch = clamp(voice.pitch, 30, 1200);
  const f = p.vary(pitch * 2 ** (1.25 * baby), vary);
  // Small throats resonate higher.
  const ts = 2 ** (0.8 * baby) * p.vary(1, 0.05);
  const [lb, la] = KIND_DB[voice.kind] ?? [0, 0];
  const w: Who = {
    kind: voice.kind,
    v: { ...BASE, f, tract: ts, level: dB(lerp(lb, la, big)) },
    baby,
    big,
    len: p.vary(0.55 + 0.45 * big, 0.07),
    bark: voice.kind === 'roar' ? clamp((pitch - 118) / 22) : 0,
    rumble: voice.kind === 'roar' ? clamp((108 - pitch) / 12) : 0,
    rattle: voice.kind === 'screech' ? clamp((g - 0.4) / 0.08) : 0,
    grunt: voice.kind === 'bellow' ? clamp((g - 0.53) / 0.06) : 0,
    gentle: voice.kind === 'bellow' ? clamp((0.45 - g) / 0.08) : 0,
  };
  const v = w.v;
  switch (voice.kind) {
    case 'roar':
      // Deep and gritty: a saw through low formants, sub-bass body, flutter and rasp.
      set(v, {
        wave: 'sawtooth',
        thick: 0.7,
        sub: 0.45 * big,
        tract: (0.6 + 0.06 * w.bark) * ts,
        q: 1 + 0.6 * w.rumble,
        body: 0.5,
        noise: 0.12 + 0.6 * g,
        grit: (0.2 + 0.75 * g) * (0.4 + 0.6 * big),
        flutter: 0.1 + 0.35 * g,
        flutterHz: lerp(38, 24, big),
        jitter: 45,
      });
      break;
    case 'screech':
      // Raspy and high: a bright saw with fast pitch rasp, like a bird of prey.
      set(v, {
        wave: 'sawtooth',
        tract: 1.15 * ts,
        q: 1.2,
        body: 0.15,
        noise: 0.06 + 0.3 * g,
        grit: 0.2 + 0.5 * g,
        rasp: 40 + 90 * g,
        raspHz: lerp(120, 85, big),
        jitter: 25,
        lp: 7500,
      });
      break;
    case 'hoot':
      // Hollow and round: an ocarina-like tone with a ringing fundamental and a breathy "hoo".
      set(v, {
        wave: 'hollow',
        tract: 0.85 * ts,
        q: 1.3,
        fmt: 0.8,
        body: 0.7,
        ring: 0.6,
        noise: 0.05 + 0.25 * g,
        grit: 0.12 * g,
        vib: 10,
        vibHz: 4.5,
        vibDelay: 0.15,
        jitter: 10,
        lp: 3200,
      });
      break;
    case 'bellow':
      // Low and nasal like a cow or elephant: a narrow pulse through "mmoo" formants, slow swell.
      set(v, {
        wave: 'nasal',
        thick: 0.5,
        sub: 0.4 * big,
        tract: 0.6 * ts,
        body: 0.55,
        noise: 0.06 + 0.3 * g,
        grit: (0.08 + 0.5 * g) * (0.5 + 0.5 * big),
        flutter: 0.06 + 0.2 * g,
        flutterHz: lerp(18, 13, big),
        vib: 9,
        vibHz: 4,
        vibDelay: 0.35,
        jitter: 18,
        lp: 3000,
      });
      v.level *= 1 - 0.2 * w.gentle;
      break;
    case 'honk':
      // Brassy: a saw into a tuned tube, the tone opening as it swells, vibrato on long notes.
      set(v, {
        wave: 'sawtooth',
        tract: 0.72 * ts,
        fmt: 0.7,
        body: 0.35,
        noise: 0.03 + 0.1 * g,
        grit: 0.08 + 0.2 * g,
        comb: 0.55,
        vib: 22,
        vibHz: 5.3,
        vibDelay: 0.3,
        jitter: 8,
        lp: Math.min(f * 9, 7000),
        brass: 1,
      });
      break;
    case 'trill':
      // Bright and birdlike: nearly pure tones with fast trills and quick chirps.
      set(v, {
        wave: 'triangle',
        tract: 1.6 * ts,
        fmt: 0.35,
        body: 0.9,
        noise: 0.02 + 0.15 * g,
        grit: 0.1 * g,
        trill: 0.9,
        trillHz: lerp(34, 24, big),
        jitter: 15,
        lp: 9000,
      });
      break;
  }
  return w;
}

/** Friendlier: less grit, noise, flutter and rasp for small noises. */
const tame = (v: Vox, k: number): Vox => ({ ...v, grit: v.grit * k, noise: v.noise * k, flutter: v.flutter * k, rasp: v.rasp * k });

/** Mouth shapes for small noises per kind: [start, end]. */
const MOUTH: Record<VoiceKind, readonly [Vowel, Vowel]> = {
  roar: ['o', 'a'],
  screech: ['e', 'i'],
  hoot: ['u', 'u'],
  bellow: ['m', 'o'],
  honk: ['o', 'a'],
  trill: ['e', 'i'],
};

// ---------------- extra layers ----------------

/** Spinosaurus: a crocodile-like rumble, a low saw pulsing ~10 times a second. */
function croc(p: Patch, t: number, dur: number, f: number, level: number) {
  const end = t + dur;
  const vca = p.gain(0);
  line(vca.gain, t, dur, [[0, 0], [0.25, 1], [0.7, 0.8], [1, 0]], level);
  const pulse = p.gain(0.5);
  p.osc('sine', p.r(9, 12), t, end).connect(p.gain(0.5)).connect(pulse.gain);
  p.osc('sawtooth', f * 0.5, t, end).connect(p.filter('lowpass', Math.max(140, f * 2.2), 0.9)).connect(vca).connect(pulse).connect(p.out);
}

/** A breathy hiss. */
function hiss(p: Patch, t: number, dur: number, level: number, f = 3200) {
  const g = p.gain(0);
  line(g.gain, t, dur, [[0, 0], [0.3, 1], [0.6, 0.7], [1, 0]], level);
  p.noise(t, t + dur).connect(p.filter('highpass', f, 0.7)).connect(p.filter('lowpass', 9000, 0.7)).connect(g).connect(p.out);
}

/** Dilophosaurus: a dry clicking rattle — noise gated by a fast click train. */
function rattle(p: Patch, t: number, dur: number, hz: number, level: number, f = 3800) {
  const end = t + dur;
  const gate = p.gain(0);
  const clicks = p.osc('clicks', hz, t, end);
  glide(clicks.frequency, t, dur, [[0, 0.8], [0.3, 1.1], [1, 0.9]], hz);
  clicks.connect(gate.gain);
  const env = p.gain(0);
  line(env.gain, t, dur, [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], level);
  p.noise(t, end).connect(p.filter('bandpass', f, 1.1)).connect(gate).connect(env).connect(p.out);
}

/** A low sine "thoom" under a hoot (a resonating throat pouch). */
function boom(p: Patch, t: number, dur: number, f: number, level: number) {
  const g = p.gain(0);
  line(g.gain, t, dur, HOOT, level);
  const o = p.osc('sine', f, t, t + dur);
  glide(o.frequency, t, dur, [[0, 0.95], [0.3, 1], [1, 0.9]], f);
  o.connect(g).connect(p.out);
}

// ---------------- signature calls ----------------

/** The short signature call of each kind. */
function call(p: Patch, w: Who, t = p.t, lv = 1) {
  const { v, len } = w;
  switch (w.kind) {
    case 'roar': {
      if (w.bark > 0.5) {
        // A gruff double bark.
        const b = { ...v, grit: clamp(v.grit * 1.15), flutter: clamp(v.flutter * 1.2) };
        vox(p, b, [
          { at: 0, dur: 0.24 * len, p: [[0, 0.95], [0.2, 1.15], [1, 0.85]], a: BARK, v: [[0, 'a'], [1, 'o']], lv },
          { at: 0.32 * len, dur: 0.38 * len, p: [[0, 1], [0.15, 1.1], [1, 0.7]], a: BARK, v: [[0, 'a'], [0.6, 'o'], [1, 'u']], lv },
        ], t);
        break;
      }
      const d = 0.85 * len;
      vox(p, v, [{ at: 0, dur: d, p: [[0, 0.82], [0.2, 1.08], [0.5, 1], [1, 0.72]], a: [[0, 0], [0.12, 1], [0.5, 0.85], [0.85, 0.45], [1, 0]], v: [[0, 'o'], [0.2, 'a'], [0.7, 'o'], [1, 'u']], fl: [[0, v.flutter * 0.6], [1, v.flutter * 1.4]], lv }], t);
      if (w.rumble > 0) {
        croc(p, t, d * 1.05, v.f, 0.5 * w.rumble * lv);
        hiss(p, t + 0.6 * d, 0.55 * d, 0.1 * w.rumble * lv);
      }
      break;
    }
    case 'screech':
      // "kee-YAHH": a quick rising note, then a shriek that bends up and slides down.
      vox(p, v, [
        { at: 0, dur: 0.11 * len, p: [[0, 1.05], [0.4, 1.4], [1, 1.3]], a: BLIP, v: 'i', lv: 0.75 * lv },
        { at: 0.15 * len, dur: 0.42 * len, p: [[0, 1.3], [0.12, 1.5], [0.45, 1.25], [1, 0.85]], a: [[0, 0], [0.06, 1], [0.5, 0.75], [1, 0]], v: [[0, 'e'], [0.3, 'ae'], [1, 'a']], lv },
      ], t);
      if (w.rattle > 0) rattle(p, t + 0.2 * len, 0.55 * len, lerp(55, 38, w.big), 1.6 * w.rattle * lv);
      break;
    case 'hoot':
      // "hoo-HOO".
      vox(p, v, [
        { at: 0, dur: 0.24 * len, p: [[0, 0.94], [0.3, 1], [1, 0.97]], a: HOOT, v: 'u', lv: 0.85 * lv },
        { at: 0.36 * len, dur: 0.38 * len, p: [[0, 1.06], [0.25, 1.13], [1, 1.04]], a: HOOT, v: 'u', lv },
      ], t);
      break;
    case 'bellow': {
      // "mmMOOoo" (a calf's "mweh" when small); Ankylosaurus grunts first.
      let at = 0;
      const notes: Note[] = [];
      if (w.grunt > 0.5) {
        for (let i = 0; i < 2; i++) notes.push({ at: i * 0.17 * len, dur: 0.1 * len, p: [[0, 0.88], [1, 0.72]], a: GRUNT, v: 'u', nz: 2.5, lv: 0.7 * lv });
        at = 0.36 * len;
      }
      const d = 1.0 * len;
      if (w.baby > 0.6) notes.push({ at, dur: 0.6 * d, p: [[0, 1], [0.3, 1.15], [1, 0.92]], a: [[0, 0], [0.2, 1], [0.7, 0.8], [1, 0]], v: [[0, 'm'], [0.3, 'a'], [1, 'e']], lv });
      else notes.push({ at, dur: d, p: [[0, 0.9], [0.3, 1.04], [0.7, 1], [1, 0.82]], a: [[0, 0], [0.3 + 0.1 * w.gentle, 1], [0.7, 0.85], [1, 0]], v: [[0, 'm'], [0.22, 'u'], [0.5, 'o'], [0.8, 'u'], [1, 'm']], lv });
      vox(p, v, notes, t);
      break;
    }
    case 'honk':
      // One brassy "HWONK" with a scoop up into the note.
      vox(p, { ...v, vibDelay: 0.35 * len }, [{ at: 0, dur: 0.95 * len, p: [[0, 0.93], [0.07, 1], [0.85, 1], [1, 0.9]], a: [[0, 0], [0.06, 1], [0.3, 0.85], [0.85, 0.75], [1, 0]], v: 'o', lv }], t);
      break;
    case 'trill':
      // "prrrree-EET".
      vox(p, v, [
        { at: 0, dur: 0.32 * len, p: [[0, 0.92], [1, 1.06]], a: [[0, 0], [0.1, 1], [0.85, 0.9], [1, 0]], tr: 0.95, v: 'e', lv: 0.85 * lv },
        { at: 0.37 * len, dur: Math.max(0.07, 0.1 * len), p: [[0, 1.15], [1, 1.6]], a: BLIP, tr: 0, v: 'i', lv },
      ], t);
      break;
  }
}

/** The big signature call: game starts, growing up, showing off. */
function roar(p: Patch, w: Who, t = p.t) {
  const { v, len } = w;
  switch (w.kind) {
    case 'roar': {
      const d = 2.2 * len;
      const notes: Note[] = [];
      let at = 0;
      if (w.bark > 0.5) {
        notes.push({ at: 0, dur: 0.3 * len, p: [[0, 0.95], [0.2, 1.15], [1, 0.85]], a: BARK, v: [[0, 'a'], [1, 'o']], lv: 0.85 });
        at = 0.38 * len;
      }
      const main = w.bark > 0.5 ? d * 0.8 : d;
      notes.push({
        at,
        dur: main,
        p: [[0, 0.7], [0.1, 0.92], [0.25, 1.12], [0.5, 1.04], [0.75, 0.9], [1, 0.6]],
        a: [[0, 0], [0.12, 0.75], [0.25, 1], [0.6, 0.9], [0.85, 0.5], [1, 0]],
        v: [[0, 'u'], [0.18, 'a'], [0.6, 'a'], [0.85, 'o'], [1, 'u']],
        fl: [[0, v.flutter * 0.7], [0.6, v.flutter], [1, clamp(v.flutter * 1.6, 0, 0.9)]],
      });
      vox(p, { ...v, grit: clamp(v.grit * 1.1) }, notes, t);
      if (w.rumble > 0) {
        croc(p, t, d * 1.05, v.f, 0.55 * w.rumble);
        hiss(p, t + 0.7 * d, 0.5 * d, 0.13 * w.rumble);
      }
      break;
    }
    case 'screech':
      // "ki-SKREEEE-ahh", with a rattle before and after for Dilophosaurus.
      vox(p, { ...v, rasp: v.rasp * 1.3, grit: clamp(v.grit + 0.1) }, [
        { at: 0, dur: 0.14 * len, p: [[0, 0.95], [1, 1.35]], a: BLIP, v: 'e', lv: 0.7 },
        { at: 0.2 * len, dur: 1.2 * len, p: [[0, 1.3], [0.08, 1.55], [0.3, 1.45], [0.6, 1.2], [1, 0.75]], a: [[0, 0], [0.04, 1], [0.4, 0.85], [0.8, 0.5], [1, 0]], v: [[0, 'i'], [0.2, 'ae'], [0.7, 'a'], [1, 'o']] },
      ], t);
      if (w.rattle > 0) {
        rattle(p, t + 0.2 * len, 1.1 * len, lerp(58, 40, w.big), 1.2 * w.rattle);
        rattle(p, t + 1.35 * len, 0.5 * len, lerp(50, 34, w.big), 1.8 * w.rattle);
      }
      break;
    case 'hoot': {
      // "hoo-hoo-HOOOOO-hoo", rising, with a low throat boom under the long one.
      const seq = [[1, 0.22], [1.06, 0.22], [1.2, 0.75], [0.96, 0.3]] as const;
      let at = 0;
      const notes: Note[] = seq.map(([s, d], i) => {
        const n: Note = { at, dur: d * len, p: [[0, s * 0.95], [0.25, s], [1, s * 0.96]], a: HOOT, v: 'u', lv: [0.75, 0.85, 1, 0.8][i] };
        at += (d + 0.12) * len;
        return n;
      });
      vox(p, { ...v, vibDelay: notes[2].at + 0.2 }, notes, t);
      boom(p, t + notes[2].at, notes[2].dur, v.f * 0.5, 0.5 * w.big);
      break;
    }
    case 'bellow': {
      const d = 2.2 * len;
      const notes: Note[] = [];
      let at = 0;
      if (w.grunt > 0.5) {
        for (let i = 0; i < 2; i++) notes.push({ at: i * 0.18 * len, dur: 0.11 * len, p: [[0, 0.88], [1, 0.72]], a: GRUNT, v: 'u', nz: 2.5, lv: 0.75 });
        at = 0.4 * len;
      }
      notes.push({
        at,
        dur: d,
        p: [[0, 0.8], [0.2, 1], [0.45, 1.12], [0.7, 1.05], [1, 0.72]],
        a: [[0, 0], [0.3 + 0.1 * w.gentle, 1], [0.75, 0.85], [1, 0]],
        v: [[0, 'm'], [0.15, 'u'], [0.4, 'o'], [0.6, 'a'], [0.85, 'o'], [1, 'u']],
      });
      vox(p, { ...v, grit: clamp(v.grit * 1.3), vibDelay: at + 0.5 * d }, notes, t);
      break;
    }
    case 'honk': {
      // "hon-HOOOONK": a pickup a fourth below, then a long vibrato honk that falls off at the end.
      const at = 0.3 * len;
      vox(p, { ...v, vibDelay: at + 0.35 }, [
        { at: 0, dur: 0.24 * len, p: [[0, 0.72], [0.15, 0.75], [1, 0.75]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], v: 'o', lv: 0.7 },
        { at, dur: 1.9 * len, p: [[0, 0.95], [0.04, 1], [0.85, 1], [1, 0.88]], a: [[0, 0], [0.04, 1], [0.2, 0.88], [0.8, 0.8], [1, 0]], v: [[0, 'o'], [0.5, 'a'], [1, 'o']] },
      ], t);
      break;
    }
    case 'trill':
      // "chirr-chirr-CHEE-rrrrr".
      vox(p, v, [
        { at: 0, dur: 0.2 * len, p: [[0, 0.95], [1, 1.05]], tr: 0.9, v: 'e', lv: 0.7 },
        { at: 0.26 * len, dur: 0.2 * len, p: [[0, 1.05], [1, 1.15]], tr: 0.9, v: 'e', lv: 0.8 },
        { at: 0.52 * len, dur: 0.14 * len, p: [[0, 1.1], [1, 1.7]], a: BLIP, tr: 0, v: 'i', lv: 0.9 },
        { at: 0.72 * len, dur: 0.65 * len, p: [[0, 1.55], [0.3, 1.45], [1, 0.95]], tr: [[0, 0.5], [1, 1]], v: [[0, 'i'], [1, 'e']] },
      ], t);
      break;
  }
}

// ---------------- small vocal noises ----------------

function chirp(p: Patch, w: Who, t = p.t, lv = 1) {
  const [m0, m1] = w.baby > 0.5 ? (['e', 'i'] as const) : MOUTH[w.kind];
  const d = lerp(0.1, 0.14, w.big) * p.vary(1, 0.1);
  const up = p.vary(1.3, 0.08);
  const tr = w.kind === 'trill' ? 0.6 : 0;
  const notes: Note[] = [{ at: 0, dur: d, p: [[0, 1.12], [1, 1.12 * up]], a: BLIP, v: [[0, m0], [1, m1]], tr, lv }];
  if (w.kind === 'trill' || w.kind === 'screech' || p.rand() < 0.35) notes.push({ at: d + 0.04, dur: d * 0.8, p: [[0, 1.2], [1, 1.3 * up]], a: BLIP, v: m1, tr, lv: 0.8 * lv });
  vox(p, tame(w.v, 0.45), notes, t);
}

function happy(p: Patch, w: Who) {
  const [, m1] = MOUTH[w.kind];
  const slow = w.kind === 'hoot' || w.kind === 'bellow' || w.kind === 'honk';
  const d = (slow ? 0.13 : 0.09) * lerp(0.85, 1.1, w.big) * p.vary(1, 0.08);
  const steps = slow ? [1.05, 1.3] : [1.05, 1.25, 1.55];
  const notes: Note[] = steps.map((s, i) => ({ at: i * (d + 0.035), dur: d * (i === steps.length - 1 ? 1.4 : 1), p: [[0, s], [1, s * 1.08]], a: BLIP, v: m1, tr: w.kind === 'trill' ? 0.7 : 0, lv: 0.8 + 0.1 * i }));
  vox(p, tame(w.v, 0.4), notes);
}

function squeak(p: Patch, w: Who) {
  const d = lerp(0.13, 0.2, w.big) * p.vary(1, 0.1);
  vox(p, tame(w.v, 0.35), [{ at: 0, dur: d, p: [[0, 1.4], [0.55, 2], [1, 1.85]], a: [[0, 0], [0.08, 1], [0.6, 0.8], [1, 0]], v: [[0, 'e'], [0.5, 'i']], tr: 0 }]);
}

function growl(p: Patch, w: Who) {
  const b = w.v;
  const v: Vox = { ...b, grit: clamp(b.grit * 1.3 + 0.15), noise: b.noise * 1.3 + 0.05, flutter: clamp(b.flutter + 0.3, 0, 0.85), trill: 0 };
  let pitch = 0.72;
  let mouth: Vowels = [[0, 'u'], [0.3, 'o'], [0.8, 'o'], [1, 'u']];
  if (w.kind === 'trill') {
    // A raspy "chrrr".
    set(v, { flutter: 0.8, flutterHz: 42, noise: b.noise + 0.2 });
    pitch = 1;
    mouth = 'e';
  } else if (w.kind === 'hoot') set(v, { flutter: 0.45, flutterHz: 18, ring: 0.3, level: v.level * 1.5 });
  else if (w.kind === 'screech') set(v, { rasp: b.rasp * 1.5 });
  const d = lerp(0.5, 0.85, w.big) * p.vary(1, 0.1);
  vox(p, v, [{ at: 0, dur: d, p: [[0, pitch], [0.3, pitch * 1.1], [0.7, pitch * 1.05], [1, pitch * 0.92]], a: [[0, 0], [0.15, 0.85], [0.45, 1], [0.8, 0.75], [1, 0]], v: mouth }]);
  if (w.rattle > 0) rattle(p, p.t + 0.1 * d, 0.9 * d, lerp(55, 40, w.big), 0.8 * w.rattle);
  if (w.rumble > 0) hiss(p, p.t + 0.4 * d, 0.7 * d, 0.12 * w.rumble);
}

function purr(p: Patch, w: Who) {
  const b = w.v;
  const v: Vox = { ...b, grit: 0, rasp: 0, trill: 0, vib: 0, noise: b.noise * 0.5 + 0.04, flutter: 0.65, flutterHz: lerp(32, 24, w.big) };
  let pitch = 0.55;
  let mouth: Vowels = 'u';
  switch (w.kind) {
    case 'trill':
      set(v, { flutter: 0.7, flutterHz: 30 });
      pitch = 0.85;
      mouth = 'e';
      break;
    case 'hoot':
      set(v, { flutter: 0.35, flutterHz: 14 });
      pitch = 0.75;
      break;
    case 'bellow':
    case 'honk':
      set(v, { flutter: 0.4, flutterHz: 17 });
      pitch = 0.7;
      mouth = 'm';
      break;
    case 'screech':
      pitch = 0.5;
      break;
  }
  // Symmetric fades, so purrs repeated every second cross-fade seamlessly.
  // Not below ~80 Hz, so small speakers can still play it.
  pitch = Math.max(pitch, 80 / v.f);
  const d = lerp(1.1, 1.35, w.big);
  vox(p, v, [{ at: 0, dur: d, p: [[0, pitch], [0.5, pitch * 1.06], [1, pitch]], a: [[0, 0], [0.28, 1], [0.72, 1], [1, 0]], v: mouth }]);
}

function yawn(p: Patch, w: Who) {
  const b = w.v;
  const v: Vox = { ...b, grit: b.grit * 0.25, noise: b.noise * 1.5 + 0.15, flutter: b.flutter * 0.3, rasp: b.rasp * 0.3, trill: 0 };
  const d = lerp(0.8, 1.35, w.big) * p.vary(1, 0.08);
  vox(p, v, [{ at: 0, dur: d, p: [[0, 1.15], [0.25, 1.28], [0.7, 0.92], [1, 0.72]], a: [[0, 0], [0.22, 0.8], [0.5, 1], [0.82, 0.5], [1, 0]], v: [[0, 'e'], [0.2, 'a'], [0.6, 'a'], [0.85, 'o'], [1, 'm']], nz: [[0, 1.6], [0.5, 1], [1, 1.3]] }]);
  // A sleepy lip smack.
  const f = lerp(2400, 1300, w.big);
  burst(p, p.out, p.t + d + 0.06, 'bandpass', f, 1.5, 0.12, 0.002, 0.02);
  burst(p, p.out, p.t + d + 0.11, 'bandpass', f * 1.2, 1.5, 0.08, 0.002, 0.018);
}

function sneeze(p: Patch, w: Who) {
  const v: Vox = { ...w.v, grit: w.v.grit * 0.3, noise: w.v.noise + 0.25, flutter: 0, trill: 0, rasp: 0 };
  const d = lerp(0.6, 1, w.big) * p.vary(1, 0.08);
  const choo = 0.52 * d;
  vox(p, v, [
    { at: 0, dur: 0.17 * d, p: [[0, 1.1], [1, 1.3]], a: [[0, 0], [0.5, 1], [1, 0]], v: [[0, 'a'], [1, 'e']], lv: 0.35, nz: 2.2 },
    { at: 0.27 * d, dur: 0.15 * d, p: [[0, 1.25], [1, 1.5]], a: [[0, 0], [0.5, 1], [1, 0]], v: [[0, 'a'], [1, 'e']], lv: 0.45, nz: 2.2 },
    { at: choo + 0.015, dur: 0.24 * d, p: [[0, 1.45], [0.3, 1.3], [1, 0.9]], a: [[0, 0], [0.06, 1], [0.3, 0.6], [1, 0]], v: [[0, 'i'], [0.3, 'u'], [1, 'u']], lv: 0.9, nz: 3 },
  ]);
  // The "tch": an explosive burst of air.
  burst(p, p.out, p.t + choo, 'bandpass', lerp(4200, 3000, w.big), 1.1, 0.8, 0.003, 0.1);
  hiss(p, p.t + choo, 0.3 * d, 0.2, lerp(3500, 2200, w.big));
}

function snore(p: Patch, w: Who) {
  const t = p.t;
  const d = lerp(1.1, 1.8, w.big) * p.vary(1, 0.08);
  // In: a fluttering soft palate over a low hum.
  const inhale = 0.55 * d;
  const fl = lerp(38, 26, w.big) * p.vary(1, 0.1);
  const vca = p.gain(0);
  line(vca.gain, t, inhale, [[0, 0], [0.6, 1], [0.9, 0.8], [1, 0]], 0.9);
  const flap = p.gain(0.575);
  p.osc('sine', fl, t, t + inhale).connect(p.gain(0.425)).connect(flap.gain);
  p.noise(t, t + inhale).connect(p.filter('bandpass', lerp(900, 380, w.big), 1.8)).connect(vca).connect(flap).connect(p.out);
  vox(p, { ...tame(w.v, 0.3), flutter: 0.8, flutterHz: fl, trill: 0, sub: 0 }, [{ at: 0, dur: inhale, p: [[0, 0.5], [1, 0.55]], a: [[0, 0], [0.6, 1], [0.9, 0.8], [1, 0]], v: 'u', lv: 0.3 }]);
  // Out: a breathy sigh; hatchlings add a tiny whistle.
  const out = t + inhale + 0.12 * d;
  const ex = 0.33 * d;
  const g = p.gain(0);
  line(g.gain, out, ex, [[0, 0], [0.2, 1], [1, 0]], 0.35);
  p.noise(out, out + ex).connect(p.filter('bandpass', lerp(2200, 1100, w.big), 0.7)).connect(g).connect(p.out);
  if (w.baby > 0.3) {
    const wg = p.gain(0);
    line(wg.gain, out, ex, [[0, 0], [0.3, 1], [1, 0]], 0.05 * w.baby);
    const wf = p.vary(2200, 0.1);
    const o = p.osc('sine', wf, out, out + ex);
    glide(o.frequency, out, ex, [[0, 1], [1, 0.8]], wf);
    o.connect(wg).connect(p.out);
  }
}

// ---------------- body noises ----------------

function crunch(p: Patch, w: Who) {
  const t = p.t;
  const bp = p.filter('bandpass', 2500, 1.4);
  const g = p.gain(0);
  let at = 0;
  const n = 2 + Math.floor(p.r(0, 2.99));
  for (let i = 0; i < n; i++) {
    const decay = p.r(0.016, 0.034);
    bp.frequency.setValueAtTime(p.hz(p.r(1500, 4200) * lerp(1.15, 0.8, w.big)), t + at);
    perc(g.gain, t + at, 0.0015, p.r(0.55, 1), decay);
    at += decay + p.r(0.012, 0.03);
  }
  p.noise(t, t + at + 0.02).connect(bp).connect(g).connect(p.out);
  // The jaw closing.
  const f = lerp(260, 130, w.big) * p.vary(1, 0.1);
  const jg = p.gain(0);
  const e = perc(jg.gain, t, 0.002, 0.45, 0.05);
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.05, [[0, 1], [1, 0.6]], f);
  o.connect(jg).connect(p.out);
}

function gulp(p: Patch, w: Who) {
  const t = p.t;
  const s = lerp(1.8, 1, w.big) * p.vary(1, 0.06);
  burst(p, p.out, t, 'bandpass', 900 * s, 2, 0.3, 0.002, 0.02);
  // A gloop that drops, then a little bubble.
  const g1 = p.gain(0);
  const e1 = perc(g1.gain, t + 0.02, 0.006, 0.8, 0.1);
  const o1 = p.osc('sine', 300 * s, t + 0.02, e1);
  glide(o1.frequency, t + 0.02, 0.1, [[0, 1], [1, 0.45]], 300 * s);
  o1.connect(g1).connect(p.out);
  const tb = t + 0.14;
  const g2 = p.gain(0);
  const e2 = perc(g2.gain, tb, 0.003, 0.45, 0.06);
  const o2 = p.osc('sine', 180 * s, tb, e2);
  glide(o2.frequency, tb, 0.05, [[0, 1], [1, 2.2]], 180 * s);
  o2.connect(g2).connect(p.out);
  // A contented "mm".
  vox(p, tame(w.v, 0.2), [{ at: 0, dur: 0.3 * w.len + 0.05, p: [[0, 0.95], [1, 0.9]], a: [[0, 0], [0.3, 1], [1, 0]], v: 'm', lv: 0.45, tr: 0 }], t + 0.3);
}

function sniff(p: Patch, w: Who) {
  const t = p.t;
  const bp = p.filter('bandpass', 2000, 1.6);
  const g = p.gain(0);
  const n = p.rand() < 0.5 ? 2 : 3;
  const gap = lerp(0.1, 0.14, w.big) * p.vary(1, 0.1);
  let f = p.vary(lerp(3200, 1500, w.big), 0.1);
  for (let i = 0; i < n; i++) {
    bp.frequency.setValueAtTime(p.hz(f), t + i * gap);
    bp.frequency.linearRampToValueAtTime(p.hz(f * 1.15), t + i * gap + 0.05);
    perc(g.gain, t + i * gap, 0.015, p.r(0.6, 1), Math.min(0.05, gap - 0.025));
    f *= 1.08;
  }
  p.noise(t, t + n * gap + 0.02).connect(bp).connect(g).connect(p.out);
}

function step(p: Patch, w: Who) {
  const t = p.t;
  // Adults: a soft low thump; hatchlings: a light pat.
  const f = p.vary(lerp(210, 72, w.big), 0.1);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.004, lerp(0.35, 0.9, w.big), lerp(0.05, 0.11, w.big));
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.09, [[0, 1], [1, 0.62]], f);
  o.connect(g).connect(p.out);
  burst(p, p.out, t, 'lowpass', p.vary(lerp(2600, 520, w.big), 0.15), 0.8, lerp(0.22, 0.3, w.big), 0.002, 0.03);
}

function thud(p: Patch, w: Who) {
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
  p.osc('triangle', f * 2.3, t, ke).connect(kg).connect(p.out);
  burst(p, p.out, t, 'lowpass', lerp(1500, 480, w.big), 0.9, 0.55, 0.002, 0.09);
  p.send = 0.06 + 0.1 * w.big;
}

function boing(p: Patch, w: Who) {
  const t = p.t;
  const f = p.vary(lerp(460, 330, w.big), 0.08);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.004, 0.6, 0.42);
  const wob = p.gain(0);
  line(wob.gain, t, 0.45, [[0, 0], [0.12, 170], [1, 0]]);
  p.osc('sine', p.vary(14, 0.1), t, e).connect(wob);
  for (const [r, lv] of [[1, 1], [2.02, 0.18]] as const) {
    const o = p.osc(r === 1 ? 'sine' : 'triangle', f * r, t, e);
    glide(o.frequency, t, 0.07, [[0, 0.55], [1, 1]], f * r);
    wob.connect(o.detune);
    o.connect(p.gain(lv)).connect(g);
  }
  g.connect(p.out);
  p.send = 0.08;
}

function whoosh(p: Patch, w: Who) {
  const t = p.t;
  const d = lerp(0.26, 0.4, w.big) * p.vary(1, 0.1);
  const k = lerp(1.25, 0.8, w.big) * p.vary(1, 0.1);
  const bp = p.filter('bandpass', 800, 1.3);
  glide(bp.frequency, t, d, [[0, 450 * k], [0.45, 1900 * k], [1, 650 * k]]);
  const g = p.gain(0);
  line(g.gain, t, d, [[0, 0], [0.45, 1], [1, 0]]);
  const n = p.noise(t, t + d);
  n.connect(bp).connect(g).connect(p.out);
  n.connect(p.filter('highpass', 4500, 0.7)).connect(p.gain(0.2)).connect(g);
}

function pop(p: Patch) {
  const t = p.t;
  const f = p.vary(520, 0.1);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.8, 0.07);
  const o = p.osc('sine', f, t, e);
  glide(o.frequency, t, 0.035, [[0, 0.6], [1, 2.2]], f);
  o.connect(g).connect(p.out);
  burst(p, p.out, t, 'highpass', 3000, 0.7, 0.25, 0.001, 0.012);
  p.send = 0.05;
}

/** Shell crackles: a quick run of bright clicks and a tiny tink. */
function crackle(p: Patch, t: number, n: number, span: number, level: number) {
  const bp = p.filter('bandpass', 4000, 3);
  const g = p.gain(0);
  let at = 0;
  for (let i = 0; i < n && at < span; i++) {
    const decay = p.r(0.006, 0.02);
    bp.frequency.setValueAtTime(p.hz(p.r(2500, 6500)), t + at);
    perc(g.gain, t + at, 0.001, level * p.r(0.5, 1), decay);
    at += decay + p.r(0.008, 0.03);
  }
  p.noise(t, t + at + 0.01).connect(bp).connect(g).connect(p.out);
}

function crack(p: Patch) {
  const t = p.t;
  crackle(p, t, 3 + Math.floor(p.r(0, 2.99)), 0.12, 0.9);
  bell(p, p.out, t + 0.008, p.r(2800, 3800), 0.1, 0.08, [[1, 1, 1], [2.4, 0.3, 0.5]]);
  // The egg's hollow body.
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.3, 0.04);
  p.osc('sine', p.vary(560, 0.1), t, e).connect(g).connect(p.out);
  p.send = 0.05;
}

function hatch(p: Patch, voice: Voice) {
  const t = p.t;
  crackle(p, t, 10, 0.3, 0.3);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.35, 0.05);
  p.osc('sine', p.vary(500, 0.1), t, e).connect(g).connect(p.out);
  // Bits of shell landing.
  for (let i = 0; i < 7; i++) bell(p, p.out, t + p.r(0.28, 0.8), p.r(3000, 6500), p.r(0.03, 0.08), p.r(0.03, 0.06), [[1, 1, 1]]);
  // The baby's first squeak.
  chirp(p, who(p, voice, 0), t + 0.6, 1.25);
  p.send = 0.12;
}

function grow(p: Patch, w: Who) {
  const t = p.t;
  // A magic chime: a rising major arpeggio of bells with sparkles, then a proud call.
  const root = p.pick([523.25, 587.33, 659.25]);
  [1, 1.25, 1.5, 2, 2.5].forEach((r, i) => bell(p, p.out, t + i * 0.075, root * r, 0.2, 0.9));
  for (let i = 0; i < 6; i++) bell(p, p.out, t + p.r(0.3, 1.1), p.r(2500, 5200), 0.04, 0.12, [[1, 1, 1]]);
  call(p, w, t + 0.55, 0.9);
  p.send = 0.3;
}

// ---------------- the table ----------------

/** Loudness trim per sound in dB, balanced with scripts/sounds.mjs. */
const TRIM: Record<SoundName, number> = {
  call: -2.7,
  roar: -3.4,
  chirp: -1.1,
  growl: -4.5,
  happy: -1.1,
  purr: -11.3,
  crunch: 1.2,
  gulp: 0.3,
  yawn: -8.5,
  snore: -3.2,
  sneeze: -0.9,
  squeak: -0.1,
  boing: 4.7,
  thud: 1.3,
  step: -6.2,
  crack: 8.2,
  hatch: -2.5,
  grow: -0.8,
  whoosh: -2.1,
  pop: 2.4,
  sniff: -1.9,
};

/** Reverb send per sound (bigger for adults' big calls). */
function sendOf(name: SoundName, w: Who) {
  switch (name) {
    case 'roar':
      return 0.14 + 0.16 * w.big + (w.kind === 'honk' ? 0.1 : 0);
    case 'call':
      return 0.08 + 0.1 * w.big + (w.kind === 'honk' ? 0.08 : 0);
    case 'chirp':
    case 'happy':
    case 'squeak':
    case 'growl':
    case 'yawn':
    case 'sneeze':
      return 0.05 + 0.05 * w.big;
    default:
      return 0;
  }
}

/** Frequent, unimportant sounds: dropped first when many are playing. */
export const DROPPABLE: ReadonlySet<SoundName> = new Set<SoundName>(['step', 'crunch', 'sniff', 'boing', 'pop', 'whoosh']);

/** The recipe of each sound. */
const RECIPES: Record<SoundName, (p: Patch, w: Who, voice: Voice) => void> = {
  call: (p, w) => call(p, w),
  roar: (p, w) => roar(p, w),
  chirp: (p, w) => chirp(p, w),
  growl,
  happy,
  purr,
  crunch,
  gulp,
  yawn,
  snore,
  sneeze,
  squeak,
  boing,
  thud,
  step,
  crack: (p) => crack(p),
  hatch: (p, _w, voice) => hatch(p, voice),
  grow,
  whoosh,
  pop: (p) => pop(p),
  sniff,
};

/** Builds pet sound `name` for `voice` at `growth` (0 hatchling .. 1 adult) into the patch, `level` times its trim. */
export function petSound(p: Patch, name: SoundName, voice: Voice, growth: number, level = 1) {
  const w = who(p, voice, growth, name === 'purr' ? 0.02 : 0.06);
  p.send = sendOf(name, w);
  RECIPES[name](p, w, voice);
  p.out.gain.value = dB(TRIM[name]) * level;
}
