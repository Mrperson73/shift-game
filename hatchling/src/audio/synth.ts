// Synth core: every sound is a small graph of Web Audio nodes (a Patch) built from a few blocks —
// oscillators, noise, filters, envelopes, a waveshaper and bell partials. Patches render into any
// BaseAudioContext, so the same recipes play live (engine.ts) and render offline (render.ts).
// Nothing runs per sample while sounds play: buffers, waves and curves are built once and reused.

export type Rand = () => number;
/** Breakpoints over a note or sweep: [fraction of its duration 0..1, value]. */
export type Pts = readonly (readonly [number, number])[];
type Basic = 'sine' | 'square' | 'sawtooth' | 'triangle';
/** Custom waveforms: a softer saw, an ocarina-like hollow tone, a nasal pulse and a click train. */
export type Custom = 'glottal' | 'hollow' | 'nasal' | 'clicks';
export type Wave = Basic | Custom;

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const dB = (d: number) => 10 ** (d / 20);

/** Small seeded PRNG (mulberry32), for repeatable buffers and offline renders. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- shared resources (one set per context) ----------------

export interface Kit {
  /** 2 s of white noise; every use starts at a random offset. */
  white: AudioBuffer;
  /** 4 s of smooth random wander in -1..1 (about 12 turns a second at rate 1): jitter and wobble. */
  drift: AudioBuffer;
  wave(name: Custom): PeriodicWave;
}

const kits = new WeakMap<BaseAudioContext, Kit>();

export function kitFor(ctx: BaseAudioContext): Kit {
  let k = kits.get(ctx);
  if (!k) {
    k = makeKit(ctx);
    kits.set(ctx, k);
  }
  return k;
}

function makeKit(ctx: BaseAudioContext): Kit {
  const sr = ctx.sampleRate;
  const rnd = seeded(0x5eed);
  const white = ctx.createBuffer(1, Math.round(sr * 2), sr);
  const w = white.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = rnd() * 2 - 1;
  // Cosine-interpolated random points that loop seamlessly.
  const drift = ctx.createBuffer(1, Math.round(sr * 4), sr);
  const d = drift.getChannelData(0);
  const pts = Array.from({ length: 48 }, () => rnd() * 2 - 1);
  for (let i = 0; i < d.length; i++) {
    const x = (i / d.length) * pts.length;
    const j = Math.floor(x);
    const s = (1 - Math.cos(Math.PI * (x - j))) / 2;
    d[i] = pts[j % pts.length] * (1 - s) + pts[(j + 1) % pts.length] * s;
  }
  const waves = new Map<Custom, PeriodicWave>();
  return {
    white,
    drift,
    wave(name) {
      let pw = waves.get(name);
      if (!pw) waves.set(name, (pw = makeWave(ctx, name)));
      return pw;
    },
  };
}

function makeWave(ctx: BaseAudioContext, name: Custom): PeriodicWave {
  const n = 64;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    if (name === 'glottal') im[k] = 1 / (k * (1 + k / 9)); // a saw whose top rolls off like a voice
    else if (name === 'hollow') im[k] = k === 1 ? 1 : k % 2 ? 1.4 / (k * k * k) : 0.02 / k; // mostly odd: ocarina
    else if (name === 'nasal') re[k] = Math.sin(k * Math.PI * 0.27) / (k * (1 + k / 16)); // narrow pulse: comb-like gaps
    else re[k] = k < 48 ? 1 : 0; // clicks: band-limited impulse train
  }
  return ctx.createPeriodicWave(re, im);
}

// ---------------- waveshaper curves (context independent) ----------------

function curve(n: number, fn: (x: number) => number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
  return c;
}

let grit: Float32Array<ArrayBuffer> | null = null;
let clip: Float32Array<ArrayBuffer> | null = null;
const GRIT_K = 3;
const gritAt = (x: number) => Math.tanh(GRIT_K * (x + 0.12 * x * x)) / Math.tanh(GRIT_K * 1.12);

/** Warm asymmetric saturation (odd and even harmonics) for growls and rasp. */
export const gritCurve = () => (grit ??= curve(2048, gritAt));
/** Output gain that keeps a full-scale input at the same peak after driving the grit curve by `drive`. */
export const gritMakeup = (drive: number) => 1 / Math.max(0.05, gritAt(drive));

/**
 * Master safety clipper. Its input is pre-scaled by 0.5, so the curve covers ±2 (+6 dB over full scale):
 * clean up to 0.6, then a smooth knee that never exceeds ~0.98.
 */
export const clipCurve = () =>
  (clip ??= curve(4096, (u) => {
    const s = Math.abs(2 * u);
    const y = s <= 0.6 ? s : 0.6 + 0.38 * Math.tanh((s - 0.6) / 0.38);
    return Math.sign(u) * y;
  }));

// ---------------- envelopes and sweeps ----------------

/** Moves `param` through `pts` (fractions of `dur` from `t`) along straight lines, values times `k`. */
export function line(param: AudioParam, t: number, dur: number, pts: Pts, k = 1) {
  param.setValueAtTime(pts[0][1] * k, t + pts[0][0] * dur);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1] * k, t + pts[i][0] * dur);
}

/** Like `line` with exponential segments: natural for pitch and filter sweeps. Values stay above 0. */
export function glide(param: AudioParam, t: number, dur: number, pts: Pts, k = 1, max = 20000) {
  const v = (x: number) => clamp(x * k, 1e-4, max);
  param.setValueAtTime(v(pts[0][1]), t + pts[0][0] * dur);
  for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(v(pts[i][1]), t + pts[i][0] * dur);
}

/** Percussive envelope: a linear attack to `peak`, then an exponential decay to silence. Returns its end. */
export function perc(param: AudioParam, t: number, attack: number, peak: number, decay: number) {
  const end = t + attack + decay + 0.006;
  param.setValueAtTime(0, t);
  if (peak > 0) {
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(peak * 1e-3, t + attack + decay);
  }
  param.linearRampToValueAtTime(0, end);
  return end;
}

// ---------------- the per-sound graph ----------------

/**
 * One playing sound. Recipes add nodes to it and connect them to `out`; every source is started and
 * stopped here, and once the last one has ended the whole graph is disconnected so it can be collected.
 */
export class Patch {
  readonly kit: Kit;
  readonly out: GainNode;
  /** Reverb send level; recipes set it, the mixer routes it. */
  send = 0;
  /** When the last source stops (context seconds). */
  end: number;
  onDone: (() => void) | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private playing = 0;
  private disposed = false;

  /** `t` is when the sound starts (context seconds). */
  constructor(
    readonly ctx: BaseAudioContext,
    readonly t: number,
    readonly rand: Rand = Math.random,
  ) {
    this.kit = kitFor(ctx);
    this.out = this.gain(1);
    this.end = t;
  }

  /** Uniform random number in lo..hi. */
  r(lo: number, hi: number) {
    return lo + (hi - lo) * this.rand();
  }

  /** `x` varied by up to ±`k` (a fraction), so repeats never sound the same. */
  vary(x: number, k = 0.06) {
    return x * (1 + k * (2 * this.rand() - 1));
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.min(xs.length - 1, Math.floor(this.rand() * xs.length))];
  }

  /** True with probability `k`. */
  chance(k: number) {
    return this.rand() < k;
  }

  /** An index into `weights`, picked in proportion to them (variants a species favours weigh more). */
  choose(weights: readonly number[]) {
    const total = weights.reduce((s, x) => s + Math.max(0, x), 0);
    let r = this.rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** A frequency kept inside the audible, representable range. */
  hz(f: number) {
    return clamp(f, 8, this.ctx.sampleRate * 0.45);
  }

  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  gain(v = 1) {
    const g = this.add(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, f: number, q = 0.707) {
    const b = this.add(this.ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = this.hz(f);
    b.Q.value = q;
    return b;
  }

  shaper(c: Float32Array<ArrayBuffer>, oversample: OverSampleType = 'none') {
    const s = this.add(this.ctx.createWaveShaper());
    s.curve = c;
    s.oversample = oversample;
    return s;
  }

  delay(seconds: number) {
    const d = this.add(this.ctx.createDelay(Math.max(0.05, seconds * 2)));
    d.delayTime.value = seconds;
    return d;
  }

  osc(type: Wave, f: number, t0: number, t1: number) {
    const o = this.ctx.createOscillator();
    if (type === 'sine' || type === 'square' || type === 'sawtooth' || type === 'triangle') o.type = type;
    else o.setPeriodicWave(this.kit.wave(type));
    o.frequency.value = this.hz(f);
    return this.run(o, t0, t1);
  }

  /** Looping noise (white by default) from a random point in the buffer. */
  noise(t0: number, t1: number, buf = this.kit.white, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    return this.run(s, t0, t1, this.rand() * buf.duration * 0.95);
  }

  private run<T extends AudioScheduledSourceNode>(s: T, t0: number, t1: number, offset?: number): T {
    this.add(s);
    if (offset === undefined) s.start(t0);
    else (s as unknown as AudioBufferSourceNode).start(t0, offset);
    s.stop(Math.max(t0 + 0.001, t1));
    this.srcs.push(s);
    this.playing++;
    s.onended = () => {
      if (--this.playing <= 0) this.dispose();
    };
    this.end = Math.max(this.end, t1);
    return s;
  }

  /** Disconnects the whole graph (after the last source ended, or when cut). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.onDone?.();
  }

  /** Stops everything right now (e.g. the pet was hidden) and frees the graph. */
  cut() {
    const now = this.ctx.currentTime;
    for (const s of this.srcs) {
      try {
        s.stop(now);
      } catch {
        /* never started */
      }
    }
    this.dispose();
  }

  get size() {
    return this.nodes.length;
  }
}

// ---------------- shared blocks ----------------

/** [frequency ratio, level, decay factor] of each partial of a bell. */
export type Partials = readonly (readonly [number, number, number])[];
export const BELL: Partials = [
  [1, 1, 1],
  [2.01, 0.3, 0.55],
  [3.03, 0.11, 0.35],
  [4.27, 0.06, 0.22],
];

/** A soft bell or chime: a few sine partials, each fading on its own. Returns when it ends. */
export function bell(p: Patch, to: AudioNode, t: number, f: number, level: number, decay: number, parts: Partials = BELL, attack = 0.003) {
  let end = t;
  for (const [ratio, lv, dk] of parts) {
    if (f * ratio > p.ctx.sampleRate * 0.45) continue;
    const g = p.gain(0);
    const e = perc(g.gain, t, attack, level * lv, decay * dk);
    p.osc('sine', f * ratio, t, e).connect(g).connect(to);
    end = Math.max(end, e);
  }
  return end;
}

/** Noise through a filter with a percussive envelope: ticks, clicks, crackles and puffs. */
export function burst(p: Patch, to: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, level: number, attack: number, decay: number) {
  const g = p.gain(0);
  const end = perc(g.gain, t, attack, level, decay);
  p.noise(t, end).connect(p.filter(type, f, q)).connect(g).connect(to);
  return end;
}

/** One grain: [start (s after t), level, decay (s), filter or pitch frequency (Hz), pitch at its end (pings)]. */
export type Grain = readonly [number, number, number, number, number?];

/**
 * Many short noise grains through one filter and one envelope — crackles, rustles, scrapes, ticks — in
 * three nodes however many there are. A grain waits for the one before it to end. Returns the end.
 */
export function grains(p: Patch, to: AudioNode, t: number, gs: readonly Grain[], type: BiquadFilterType = 'bandpass', q = 1, attack = 0.001) {
  const bp = p.filter(type, gs.length ? gs[0][3] : 1000, q);
  const g = p.gain(0);
  let end = t;
  for (const [at, lv, decay, f] of gs) {
    const s = Math.max(t + at, end);
    bp.frequency.setValueAtTime(p.hz(f), s);
    end = perc(g.gain, s, attack, lv, decay);
  }
  p.noise(t, end + 0.002).connect(bp).connect(g).connect(to);
  return end;
}

/** Short pitched pings on one oscillator — droplets, twinkles, chirps — each gliding to its end pitch. */
export function pings(p: Patch, to: AudioNode, t: number, gs: readonly Grain[], type: Wave = 'sine', attack = 0.002) {
  const g = p.gain(0);
  const times: number[] = [];
  let end = t;
  for (const [at, lv, decay] of gs) {
    const s = Math.max(t + at, end);
    times.push(s);
    end = perc(g.gain, s, attack, lv, decay);
  }
  const o = p.osc(type, gs.length ? gs[0][3] : 1000, t, end + 0.002);
  gs.forEach(([, , decay, f0, f1], i) => {
    o.frequency.setValueAtTime(p.hz(f0), times[i]);
    if (f1 !== undefined && f1 !== f0) o.frequency.exponentialRampToValueAtTime(p.hz(f1), times[i] + attack + decay * 0.6);
  });
  o.connect(g).connect(to);
  return end;
}
