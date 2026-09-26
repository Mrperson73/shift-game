// Constants and small helpers shared by the pet's behaviour modules.

/** Something it could do, for choosing: weight, a name (it never does the same thing twice in a
 * row) and how to start it. */
export type Option = readonly [number, string, () => void];

/** Gravity, px/s². */
export const G = 2100;
export const TAU = Math.PI * 2;

/** Weighted random choice; null when nothing has a positive weight. */
export function pickWeighted<T>(rand: () => number, items: readonly (readonly [number, T])[]): T | null {
  let total = 0;
  for (const [w] of items) if (w > 0) total += w;
  if (total <= 0) return null;
  let x = rand() * total;
  let last: T | null = null;
  for (const [w, v] of items) {
    if (w <= 0) continue;
    last = v;
    x -= w;
    if (x <= 0) return v;
  }
  return last;
}

export const sgn = (x: number): 1 | -1 => (x < 0 ? -1 : 1);

/** A random number between lo and hi. */
export const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);

/** Crossed a multiple of `period` between t - dt and t (for things that happen every `period` seconds). */
export const every = (t: number, dt: number, period: number) => Math.floor(t / period) !== Math.floor((t - dt) / period);
