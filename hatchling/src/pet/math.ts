export interface V {
  x: number;
  y: number;
}

export const v = (x: number, y: number): V => ({ x, y });
export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
export const len = (a: V) => Math.hypot(a.x, a.y);
export const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpV = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const dir = (a: number, l = 1): V => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });
/** Rotate a vector by angle a (counter-clockwise, y up). */
export const rot = (p: V, a: number): V => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
/** Point at `local` in a frame with origin o rotated by a. */
export const at = (o: V, a: number, local: V): V => add(o, rot(local, a));
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential approach factor for a time constant tau (seconds). */
export const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two-bone inverse kinematics: joint positions for a limb from `a` towards `c` with bone lengths
 * l1 and l2. `bend` picks which side the middle joint goes (+1 = counter-clockwise of a->c).
 * Unreachable targets are pulled in along the same direction.
 */
export function ik2(a: V, c: V, l1: number, l2: number, bend: 1 | -1): { mid: V; end: V } {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  let d = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx);
  const min = Math.abs(l1 - l2) + 1e-3;
  const max = l1 + l2 - 1e-3;
  d = clamp(d, min, max);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = base + bend * Math.acos(cosA);
  const mid = { x: a.x + Math.cos(ang) * l1, y: a.y + Math.sin(ang) * l1 };
  const end = { x: a.x + Math.cos(base) * d, y: a.y + Math.sin(base) * d };
  return { mid, end };
}
