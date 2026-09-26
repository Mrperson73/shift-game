// Colours: mixing helpers and the palette a pet is drawn with.

import { clamp, lerp } from './math';
import type { Variant } from './species';


function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(r: number, g: number, b: number) {
  const c = (x: number) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
const mixed = new Map<string, string>();
export function mix(a: string, b: string, t: number) {
  const key = a + b + t;
  let c = mixed.get(key);
  if (c === undefined) {
    const [r1, g1, b1] = hexRgb(a);
    const [r2, g2, b2] = hexRgb(b);
    c = rgbHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
    // Every frame asks for the same few colours; keep the cache from growing without bound.
    if (mixed.size > 4000) mixed.clear();
    mixed.set(key, c);
  }
  return c;
}
export const darken = (c: string, t: number) => mix(c, '#000000', t);
export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);

export interface Palette {
  body: string;
  far: string;
  belly: string;
  pattern: string;
  accent: string;
  outline: string;
  iris: string;
  mouth: string;
  /** Beaks, horns and nails. */
  horn: string;
  hornDark: string;
  kind: Variant['pattern_kind'];
}

export function palette(v: Variant): Palette {
  const horn = mix('#efe4c9', v.belly, 0.25);
  return {
    kind: v.pattern_kind,
    body: v.body,
    far: darken(v.body, 0.2),
    belly: v.belly,
    pattern: v.pattern,
    accent: v.accent,
    outline: mix(darken(v.body, 0.72), '#1a1420', 0.35),
    iris: v.iris,
    mouth: '#5b2230',
    horn,
    hornDark: darken(horn, 0.3),
  };
}

