// Shared geometry for drawing: smooth paths, tapered limbs, and the body's cross-sections.

import { clamp, dir, lerp, lerpV, type V } from './math';
import type { Rig } from './rig';

export type Ctx = CanvasRenderingContext2D;

// ---------------- path helpers ----------------

export const add2 = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const xy = (q: V): [number, number] => [q.x, q.y];

/** Adds the convex hull of two circles (a tapered capsule) to a path. */
export function capsule(path: Path2D, a: V, ra: number, b: V, rb: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3 || d <= Math.abs(ra - rb)) {
    const big = ra >= rb ? a : b;
    const r = Math.max(ra, rb);
    path.moveTo(big.x + r, big.y);
    path.arc(big.x, big.y, r, 0, Math.PI * 2);
    return;
  }
  const th = Math.atan2(dy, dx);
  const ph = Math.acos(clamp((ra - rb) / d, -1, 1));
  path.moveTo(a.x + Math.cos(th + ph) * ra, a.y + Math.sin(th + ph) * ra);
  path.arc(a.x, a.y, ra, th + ph, th - ph + Math.PI * 2);
  path.lineTo(b.x + Math.cos(th - ph) * rb, b.y + Math.sin(th - ph) * rb);
  path.arc(b.x, b.y, rb, th - ph, th + ph);
  path.closePath();
}


/** Smooth closed curve through points (Catmull-Rom converted to Béziers). */
export function smoothClosed(path: Path2D, pts: V[], tension = 1) {
  const n = pts.length;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const k = tension / 6;
    path.bezierCurveTo(p1.x + (p2.x - p0.x) * k, p1.y + (p2.y - p0.y) * k, p2.x - (p3.x - p1.x) * k, p2.y - (p3.y - p1.y) * k, p2.x, p2.y);
  }
  path.closePath();
}

/** A curved, tapering horn or spike from `base` towards angle `ang`. */
export function horn(path: Path2D, base: V, ang: number, len: number, w: number, curve = 0) {
  const n = dir(ang + Math.PI / 2, w / 2);
  const b1 = add2(base, n);
  const b2 = { x: base.x - n.x, y: base.y - n.y };
  const tip = add2(base, dir(ang + curve, len));
  const mid = add2(base, dir(ang + curve * 0.4, len * 0.5));
  path.moveTo(b1.x, b1.y);
  path.quadraticCurveTo(mid.x + n.x * 0.55, mid.y + n.y * 0.55, tip.x, tip.y);
  path.quadraticCurveTo(mid.x - n.x * 0.55, mid.y - n.y * 0.55, b2.x, b2.y);
  path.closePath();
}

/**
 * A cross-section of the body: a point on the spine, the direction towards the head, and how far
 * the back (`up`) and the belly (`dn`) reach from it. `k` says where it is: -9..-1 along the tail
 * (tip first), 0..1 from the hips to the chest, above 1 along the neck.
 */
export interface Station {
  p: V;
  a: number;
  up: number;
  dn: number;
  k: number;
}

/** Cross-sections from the tail tip to the head. The outline, belly and patterns all follow them. */
export function stations(r: Rig): Station[] {
  const s = r.s;
  const p = r.p;
  const out: Station[] = [];
  const n = s.tail.length;
  for (let i = n - 1; i >= 1; i--) {
    const q = s.tail[i];
    const prev = s.tail[i - 1];
    const f = i / (n - 1);
    // The tail is a little deeper underneath near its base (the big tail-leg muscle).
    out.push({ p: q.p, a: Math.atan2(prev.p.y - q.p.y, prev.p.x - q.p.x), up: q.r, dn: q.r * (1 + 0.3 * (1 - f)), k: -i });
  }
  const upN = dir(s.pitch + Math.PI / 2);
  for (const t of [0, 0.3, 0.6, 0.85, 1]) {
    const c = lerpV(s.hip, s.chest, t);
    const R = lerp(s.hipR, s.chestR, t);
    // How far the belly hangs below the body line here.
    const bellyBottom = (c.x - s.belly.x) * upN.x + (c.y - s.belly.y) * upN.y + s.bellyR;
    const w = clamp(1 - Math.abs(t - 0.45) / 0.55, 0, 1);
    out.push({ p: c, a: s.pitch, up: R * (t === 0 ? 0.97 : t === 1 ? 0.78 : 0.9), dn: Math.max(R * 0.95, lerp(R * 0.95, bellyBottom, w)), k: t });
  }
  // The neck (its base is hidden in the shoulders; its end in the head).
  const K = s.neck.length - 1;
  for (let j = 1; j <= K; j++) {
    const q = s.neck[j];
    const nx = s.neck[Math.min(K, j + 1)];
    const pv = s.neck[j - 1];
    const rr = p.neckR * (1.1 - p.neckTaper * (j / K));
    out.push({ p: q, a: Math.atan2(nx.y - pv.y, nx.x - pv.x), up: rr * 0.92, dn: rr * 1.08, k: 1 + j / K });
  }
  return out;
}

/** A point on the back at a station (plus `off` further out). */
export const dorsalAt = (q: Station, off = 0) => add2(q.p, dir(q.a + Math.PI / 2, q.up + off));
/** A point on the belly side at a station (plus `off` further out). */
export const ventralAt = (q: Station, off = 0) => add2(q.p, dir(q.a - Math.PI / 2, q.dn + off));

/** The whole body outline (tail, torso and neck) as one smooth shape. */
export function silhouette(r: Rig, st: Station[]): Path2D {
  const t = r.s.tail;
  const tip = t[t.length - 1];
  const tipOut = add2(tip.p, dir(Math.atan2(tip.p.y - t[t.length - 2].p.y, tip.p.x - t[t.length - 2].p.x), tip.r * 1.8));
  const last = st[st.length - 1];
  const end = add2(last.p, dir(last.a, (last.up + last.dn) * 0.35));
  const pts = [tipOut, ...st.map((q) => dorsalAt(q)), end, ...st.map((q) => ventralAt(q)).reverse()];
  const path = new Path2D();
  smoothClosed(path, pts, 0.9);
  return path;
}

/** Adds a smooth limb segment from a to b: tapered, with muscle bulges in front and behind. */
export function limb(path: Path2D, a: V, b: V, wa: number, wb: number, front = 0, back = 0, at = 0.4) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const n = dir(ang + Math.PI / 2);
  const m = lerpV(a, b, at);
  const wm = lerp(wa, wb, at);
  const off = (q: V, k: number): V => ({ x: q.x + n.x * k, y: q.y + n.y * k });
  const pts = [off(a, wa), off(m, wm + front), off(b, wb), add2(b, dir(ang, wb * 0.75)), off(b, -wb), off(m, -(wm + back)), off(a, -wa), add2(a, dir(ang, -wa * 0.7))];
  smoothClosed(path, pts, 1);
}

/** Deterministic pseudo-random 0..1 from an integer, for patterns that don't flicker. */
export const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

