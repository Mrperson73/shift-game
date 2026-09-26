// Procedural reverb: a short, soft "room" impulse response, generated once per context. A few early
// reflections, then decaying noise that darkens as it fades (walls and air eat the highs), slightly
// different in each ear so the tail feels wide.

import { seeded } from './synth';

/** A stereo impulse response `seconds` long that decays by 60 dB in `rt60` seconds. */
export function impulse(ctx: BaseAudioContext, seconds = 1.2, rt60 = 0.95): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.round(sr * seconds));
  const buf = ctx.createBuffer(2, n, sr);
  const rnd = seeded(0x7e7b);
  const pre = Math.round(sr * 0.011);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Early reflections: short, softened clicks within the first ~45 ms.
    for (let k = 0; k < 7; k++) {
      const at = pre + Math.round(sr * (0.002 + 0.042 * rnd()));
      const amp = (rnd() < 0.5 ? -1 : 1) * 0.5 * (1 - k / 9);
      for (let j = 0; j < 24 && at + j < n; j++) d[at + j] += amp * Math.exp(-j / 5) * (rnd() * 0.6 + 0.4);
    }
    // Diffuse tail: noise, exponentially decaying and increasingly low-passed.
    let lp = 0;
    const fadeOut = Math.round(sr * 0.08);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const k = 0.75 - 0.62 * Math.min(1, t / (rt60 * 0.8));
      lp += k * (rnd() * 2 - 1 - lp);
      const env = Math.exp((-6.91 * t) / rt60) * Math.min(1, t / 0.015) * Math.min(1, (n - i) / fadeOut);
      d[i] += lp * env * 0.35;
    }
  }
  return buf;
}
