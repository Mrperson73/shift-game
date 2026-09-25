// The panel's UI sounds: short, soft and well below the pet's voice, so clicking around never grates.

import type { UiSound } from './types';
import { bell, burst, glide, line, type Partials, type Patch, perc, type Wave } from './synth';

/** Soft marimba-like partials for plucks and blips. */
const WOOD: Partials = [
  [1, 1, 1],
  [3.99, 0.12, 0.25],
];
const GLASS: Partials = [
  [1, 1, 1],
  [2.76, 0.18, 0.4],
  [5.4, 0.06, 0.2],
];
/** A major pentatonic scale from C5, for picks that vary pleasantly. */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880];

/** A short pitched blip that slides from `f0` to `f1`. */
function blip(p: Patch, t: number, type: Wave, f0: number, f1: number, level: number, decay: number) {
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.003, level, decay);
  const o = p.osc(type, f0, t, e);
  glide(o.frequency, t, Math.min(0.03, decay), [[0, 1], [1, f1 / f0]], f0);
  o.connect(g).connect(p.out);
  return e;
}

/** Builds UI sound `name` into the patch. */
export function uiSound(p: Patch, name: UiSound) {
  const t = p.t;
  switch (name) {
    case 'click':
      // A tiny bubble: a quick upward blip with a hint of tick.
      blip(p, t, 'sine', p.vary(1250, 0.05), 1750, 0.5, 0.035);
      burst(p, p.out, t, 'highpass', 5000, 0.7, 0.05, 0.001, 0.006);
      break;
    case 'toggle':
      // Two-tone blip, up a fourth.
      blip(p, t, 'triangle', 660, 680, 0.25, 0.05);
      blip(p, t + 0.06, 'triangle', 880, 900, 0.28, 0.07);
      break;
    case 'tab': {
      // A soft swoosh ending in a tick.
      const bp = p.filter('bandpass', 1400, 1.5);
      glide(bp.frequency, t, 0.07, [[0, 1100], [1, 3200]]);
      const g = p.gain(0);
      line(g.gain, t, 0.08, [[0, 0], [0.6, 0.35], [1, 0]]);
      p.noise(t, t + 0.08).connect(bp).connect(g).connect(p.out);
      blip(p, t + 0.06, 'sine', 2100, 2200, 0.2, 0.02);
      break;
    }
    case 'select': {
      // A gentle pluck on a random pentatonic note.
      const f = p.pick(PENTA) * p.vary(1, 0.005);
      const lp = p.filter('lowpass', 3000, 0.8);
      glide(lp.frequency, t, 0.15, [[0, 3200], [1, 700]]);
      const g = p.gain(0);
      const e = perc(g.gain, t, 0.002, 0.5, 0.28);
      p.osc('triangle', f, t, e).connect(lp).connect(g).connect(p.out);
      bell(p, p.out, t, f * 2, 0.08, 0.15, WOOD);
      p.send = 0.12;
      break;
    }
    case 'hatch': {
      // A celebratory sparkly arpeggio.
      const notes = [1046.5, 1318.5, 1568, 2093, 2637];
      notes.forEach((f, i) => bell(p, p.out, t + i * 0.06, f, 0.16 - i * 0.015, 0.55, GLASS));
      for (let i = 0; i < 5; i++) bell(p, p.out, t + p.r(0.2, 0.7), p.r(3200, 6000), 0.02, 0.1, [[1, 1, 1]]);
      p.send = 0.3;
      break;
    }
    case 'open':
      // A soft two-note chime.
      bell(p, p.out, t, 783.99, 0.18, 0.6, GLASS, 0.008);
      bell(p, p.out, t + 0.05, 1174.66, 0.13, 0.55, GLASS, 0.008);
      p.send = 0.25;
      break;
    case 'error': {
      // A low, dull double buzz (felt more than heard).
      const lp = p.filter('lowpass', 520, 1);
      const g = p.gain(0);
      for (const at of [0, 0.13]) line(g.gain, t + at, 0.09, [[0, 0], [0.1, 1], [0.8, 0.8], [1, 0]], 0.14);
      p.osc('square', p.vary(150, 0.02), t, t + 0.23).connect(lp).connect(g).connect(p.out);
      break;
    }
    case 'coin':
      // A bright "ding-ding" up a fourth.
      bell(p, p.out, t, 987.77, 0.18, 0.12, GLASS);
      bell(p, p.out, t + 0.075, 1318.51, 0.22, 0.45, GLASS);
      p.send = 0.2;
      break;
  }
}
