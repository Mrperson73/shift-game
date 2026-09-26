// Offline rendering of any sound through the real master bus, for scripts/sounds.mjs (level table,
// WAVs, spectrograms). Runs in a browser page (OfflineAudioContext); not used by the app itself.

import { Mixer, SOFT } from './mixer';
import { Patch, seeded } from './synth';
import type { SoundName, UiSound, Voice } from './types';
import { uiSound } from './ui';
import { petSound } from './voices';

export interface Rendered {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  /** When the sound's last source stopped (s), before the reverb tail. */
  end: number;
  /** Nodes in the sound's graph. */
  nodes: number;
}

export type Job = { pet: SoundName; voice: Voice; growth: number; soft?: boolean } | { ui: UiSound };

/** Renders one sound at volume 1 (with its reverb tail) into stereo samples. */
export async function render(job: Job, seed = 1, sampleRate = 48000, seconds = 6): Promise<Rendered> {
  const ctx = new OfflineAudioContext(2, Math.round(sampleRate * seconds), sampleRate);
  const mix = new Mixer(ctx, ctx.destination, 1);
  const p = new Patch(ctx, 0.02, seeded(seed));
  if ('pet' in job) petSound(p, job.pet, job.voice, job.growth, job.soft ? SOFT : 1);
  else uiSound(p, job.ui);
  const nodes = p.size;
  mix.route(p, 0);
  const buf = await ctx.startRendering();
  return { sampleRate, left: buf.getChannelData(0), right: buf.getChannelData(1), end: p.end, nodes };
}

export interface Stats {
  /** Seconds from the start until the last source stopped. */
  dur: number;
  /** Seconds until the tail falls below -70 dBFS. */
  audible: number;
  /** dBFS. */
  peak: number;
  /** RMS over the sound's own duration, dBFS. */
  rms: number;
  /** Loudest 400 ms window, K-weighted (≈ LUFS momentary max). */
  lufs: number;
  /** Brightness: the power-weighted mean frequency (spectral centroid), Hz. */
  centroid: number;
  /** Mean sample value (DC offset). */
  dc: number;
  /** Largest sample before the sound starts and in the last 50 ms of the render (both should be ~0). */
  head: number;
  tail: number;
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200);

/** Two-stage K-weighting filter of ITU-R BS.1770 (coefficients for 48 kHz). */
function kWeight(x: Float32Array) {
  const stages = [
    [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1, -2, 1, -1.99004745483398, 0.99007225036621],
  ];
  let y = Float64Array.from(x);
  for (const [b0, b1, b2, a1, a2] of stages) {
    const out = new Float64Array(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i];
      y2 = y1;
      y1 = v;
      out[i] = v;
    }
    y = out;
  }
  return y;
}

/** Levels and sanity checks of a rendered sound (which started at `start` seconds). */
export function analyse(r: Rendered, start = 0.02): Stats {
  const { left: L, right: R, sampleRate: sr } = r;
  const n = L.length;
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    if (a > 3.2e-4) last = i;
    sum += L[i] + R[i];
  }
  const s0 = Math.round(start * sr);
  const s1 = Math.max(s0 + 1, Math.min(n, Math.round(r.end * sr)));
  let ss = 0;
  for (let i = s0; i < s1; i++) ss += (L[i] * L[i] + R[i] * R[i]) / 2;
  const kl = kWeight(L);
  const kr = kWeight(R);
  const win = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  let lufs = -200;
  for (let i = 0; i + win <= n; i += hop) {
    let a = 0;
    let b = 0;
    for (let j = i; j < i + win; j++) {
      a += kl[j] * kl[j];
      b += kr[j] * kr[j];
    }
    const z = (a + b) / win;
    if (z > 0) lufs = Math.max(lufs, -0.691 + 10 * Math.log10(z));
  }
  let head = 0;
  for (let i = 0; i < s0; i++) head = Math.max(head, Math.abs(L[i]), Math.abs(R[i]));
  let tail = 0;
  for (let i = n - Math.round(0.05 * sr); i < n; i++) tail = Math.max(tail, Math.abs(L[i]), Math.abs(R[i]));
  return { dur: r.end - start, audible: last / sr - start, peak: toDb(peak), rms: toDb(Math.sqrt(ss / (s1 - s0))), lufs, centroid: centroid(L, R, sr, s0, Math.min(n, Math.round((last / sr + 0.05) * sr))), dc: sum / (2 * n), head, tail };
}

/** Power-weighted mean frequency of samples a..b (Hann-windowed 2048-point frames, half overlapping). */
function centroid(L: Float32Array, R: Float32Array, sr: number, a: number, b: number) {
  const N = 2048;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let pw = 0;
  let fw = 0;
  for (let c = a; c + N <= Math.max(b, a + N); c += N / 2) {
    for (let i = 0; i < N; i++) {
      const j = c + i;
      re[i] = j < L.length ? ((L[j] + R[j]) / 2) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)) : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      pw += p;
      fw += (p * k * sr) / N;
    }
  }
  return pw > 0 ? fw / pw : 0;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
        const x = i + k;
        const y = x + len / 2;
        const xr = re[y] * c - im[y] * s;
        const xi = re[y] * s + im[y] * c;
        re[y] = re[x] - xr;
        im[y] = im[x] - xi;
        re[x] += xr;
        im[x] += xi;
      }
    }
  }
}

/** 16-bit PCM WAV of the first `seconds` of the sound. */
export function wav(r: Rendered, seconds: number): Uint8Array {
  const frames = Math.min(r.left.length, Math.max(1, Math.round(seconds * r.sampleRate)));
  const data = new DataView(new ArrayBuffer(44 + frames * 4));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + frames * 4, true);
  str(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, r.sampleRate, true);
  data.setUint32(28, r.sampleRate * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    data.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, r.left[i])) * 32767), true);
    data.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, r.right[i])) * 32767), true);
  }
  return new Uint8Array(data.buffer);
}
