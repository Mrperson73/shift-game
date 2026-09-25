// Draws a rigged dinosaur (and its egg) to a 2D canvas in a flat cartoon style:
// one clean outline around the whole silhouette, lighter belly, species pattern, soft shading, big eyes.

import type { CustomColors } from '../shared/types';
import { at, clamp, dir, lerp, lerpV, type V } from './math';
import type { ArmOut, LegOut, Rig } from './rig';
import type { BodyParams, Features, SpeciesDef, Variant } from './species';

type Ctx = CanvasRenderingContext2D;

// ---------------- colour ----------------

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(r: number, g: number, b: number) {
  const c = (x: number) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return rgbHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
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

/** A species colour variant; -1 is the shiny colours. */
export function variantOf(sp: SpeciesDef, variant: number): Variant {
  if (variant < 0) return sp.shiny;
  return sp.variants[variant % sp.variants.length] ?? sp.variants[0];
}

/** The palette a pet is drawn with: hand-picked colours, or its species variant. */
export function paletteFor(sp: SpeciesDef, variant: number, colors?: CustomColors | null): Palette {
  if (colors) return palette({ id: 'custom', name: 'Custom', ...colors });
  return palette(variantOf(sp, variant));
}

// ---------------- path helpers ----------------

const add2 = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const xy = (q: V): [number, number] => [q.x, q.y];

/** Adds the convex hull of two circles (a tapered capsule) to a path. */
function capsule(path: Path2D, a: V, ra: number, b: V, rb: number) {
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
function smoothClosed(path: Path2D, pts: V[], tension = 1) {
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
function horn(path: Path2D, base: V, ang: number, len: number, w: number, curve = 0) {
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
function stations(r: Rig): Station[] {
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
const dorsalAt = (q: Station, off = 0) => add2(q.p, dir(q.a + Math.PI / 2, q.up + off));
/** A point on the belly side at a station (plus `off` further out). */
const ventralAt = (q: Station, off = 0) => add2(q.p, dir(q.a - Math.PI / 2, q.dn + off));

/** The whole body outline (tail, torso and neck) as one smooth shape. */
function silhouette(r: Rig, st: Station[]): Path2D {
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
function limb(path: Path2D, a: V, b: V, wa: number, wb: number, front = 0, back = 0, at = 0.4) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const n = dir(ang + Math.PI / 2);
  const m = lerpV(a, b, at);
  const wm = lerp(wa, wb, at);
  const off = (q: V, k: number): V => ({ x: q.x + n.x * k, y: q.y + n.y * k });
  const pts = [off(a, wa), off(m, wm + front), off(b, wb), add2(b, dir(ang, wb * 0.75)), off(b, -wb), off(m, -(wm + back)), off(a, -wa), add2(a, dir(ang, -wa * 0.7))];
  smoothClosed(path, pts, 1);
}

// ---------------- head geometry (head coordinates: origin = jaw joint, x toward snout, y up) ----------------

type HeadKind = 'default' | 'dome' | 'croc' | 'duck' | 'cera' | 'sauro';

function headKind(f: Features): HeadKind {
  if (f.dome) return 'dome';
  if (f.nasalArch) return 'sauro';
  if (f.crocSnout) return 'croc';
  if (f.duckBill) return 'duck';
  if (f.frill) return 'cera';
  return 'default';
}

function skullPoints(r: Rig, f: Features): V[] {
  const L = r.p.headLen;
  const H = r.p.headH;
  const S = r.p.snoutH;
  const b = r.baby;
  const round = b * 0.45;
  switch (headKind(f)) {
    case 'dome':
      return [
        { x: 0, y: 0 },
        { x: -0.14 * L, y: 0.42 * H },
        { x: -0.04 * L, y: (0.98 + 0.08 * b) * H },
        { x: 0.3 * L, y: (1.16 + 0.04 * b) * H },
        { x: 0.62 * L, y: 0.88 * H },
        { x: 0.86 * L, y: S * 1.05 },
        { x: 1.0 * L, y: S * 0.5 },
        { x: 0.93 * L, y: 0 },
        { x: 0.5 * L, y: -0.03 * H },
      ];
    case 'croc':
      // Long, low snout with a rosette of teeth at the tip; eyes and nostrils set far back.
      return [
        { x: 0, y: 0 },
        { x: (-0.08 - round * 0.05) * L, y: 0.5 * H },
        { x: (0.04 - round * 0.04) * L, y: (0.95 + round * 0.12) * H },
        { x: (0.24 - round * 0.06) * L, y: (1.0 + round * 0.12) * H },
        { x: (0.4 - round * 0.08) * L, y: (0.72 + round * 0.22) * H },
        { x: (0.66 - round * 0.1) * L, y: S * (0.9 + round * 0.3) },
        { x: (0.88 - round * 0.08) * L, y: S * (0.86 + round * 0.25) },
        { x: (0.99 - round * 0.06) * L, y: S * (1.02 + round * 0.2) },
        { x: (1.04 - round * 0.06) * L, y: S * 0.45 },
        { x: (0.98 - round * 0.06) * L, y: 0 },
        { x: 0.5 * L, y: -0.02 * H },
      ];
    case 'duck':
      // A long face ending in a broad, blunt bill.
      return [
        { x: 0, y: 0 },
        { x: (-0.1 - round * 0.05) * L, y: 0.46 * H },
        { x: (0.04 - round * 0.04) * L, y: (0.93 + round * 0.12) * H },
        { x: (0.3 - round * 0.08) * L, y: (0.92 + round * 0.12) * H },
        { x: (0.6 - round * 0.1) * L, y: S * (0.98 + round * 0.3) },
        { x: (0.86 - round * 0.08) * L, y: S * (0.8 + round * 0.2) },
        { x: (1.03 - round * 0.06) * L, y: S * (0.68 + round * 0.15) },
        { x: (1.07 - round * 0.06) * L, y: S * 0.2 },
        { x: (0.98 - round * 0.06) * L, y: -0.02 * H },
        { x: 0.5 * L, y: -0.02 * H },
      ];
    case 'sauro': {
      // Brachiosaurus: a small head with a tall arch over the nose.
      const arch = 0.45 + 0.55 * (1 - b);
      return [
        { x: 0, y: 0 },
        { x: (-0.1 - round * 0.05) * L, y: 0.5 * H },
        { x: (0.04 - round * 0.04) * L, y: (0.92 + round * 0.1) * H },
        { x: (0.26 - round * 0.06) * L, y: (1.0 + round * 0.1) * H },
        { x: 0.42 * L, y: (1 + 0.3 * arch) * H },
        { x: 0.58 * L, y: (1 + 0.34 * arch) * H },
        { x: 0.73 * L, y: (0.95 + 0.1 * arch) * H },
        { x: (0.92 - round * 0.06) * L, y: S * (0.95 + round * 0.2) },
        { x: (1.03 - round * 0.05) * L, y: S * 0.45 },
        { x: (0.97 - round * 0.05) * L, y: -0.02 * H },
        { x: 0.5 * L, y: -0.02 * H },
      ];
    }
    case 'cera':
      // A deep skull ending in a parrot-like hooked beak.
      return [
        { x: 0, y: 0 },
        { x: (-0.08 - round * 0.05) * L, y: 0.5 * H },
        { x: (0.08 - round * 0.04) * L, y: (0.95 + round * 0.1) * H },
        { x: (0.42 - round * 0.08) * L, y: (1.0 + round * 0.1) * H },
        { x: (0.74 - round * 0.1) * L, y: S * (1.12 + round * 0.25) },
        { x: (0.95 - round * 0.06) * L, y: S * (0.84 + round * 0.15) },
        { x: (1.04 - round * 0.05) * L, y: S * 0.28 },
        { x: (0.99 - round * 0.05) * L, y: -S * 0.14 },
        { x: (0.9 - round * 0.05) * L, y: 0 },
        { x: 0.5 * L, y: -0.02 * H },
      ];
    default:
      return [
        { x: 0, y: 0 },
        { x: (-0.1 - round * 0.05) * L, y: 0.45 * H },
        { x: (0.06 - round * 0.04) * L, y: (0.95 + round * 0.12) * H },
        { x: (0.36 - round * 0.08) * L, y: (0.97 + round * 0.12) * H },
        { x: (0.74 - round * 0.1) * L, y: S * (1.04 + round * 0.3) },
        { x: (1.0 - round * 0.06) * L, y: S * (0.58 + round * 0.18) },
        { x: (0.96 - round * 0.06) * L, y: 0 },
        { x: 0.5 * L, y: -0.02 * H },
      ];
  }
}

function jawPoints(r: Rig, f: Features): V[] {
  const L = r.p.headLen;
  const D = r.p.jawD;
  switch (headKind(f)) {
    case 'croc':
      return [
        { x: -0.02 * L, y: 0.02 * D },
        { x: 0.5 * L, y: 0 },
        { x: 0.97 * L, y: 0 },
        { x: 0.99 * L, y: -D * 0.62 },
        { x: 0.9 * L, y: -D * 0.66 },
        { x: 0.8 * L, y: -D * 0.52 },
        { x: 0.45 * L, y: -D * 0.72 },
        { x: 0.08 * L, y: -D * 0.85 },
      ];
    case 'duck':
      return [
        { x: -0.02 * L, y: 0.02 * D },
        { x: 0.5 * L, y: 0 },
        { x: 0.98 * L, y: 0 },
        { x: 0.95 * L, y: -D * 0.5 },
        { x: 0.55 * L, y: -D * 0.88 },
        { x: 0.08 * L, y: -D * 0.85 },
      ];
    case 'cera':
      return [
        { x: -0.02 * L, y: 0.02 * D },
        { x: 0.5 * L, y: 0 },
        { x: 0.87 * L, y: 0 },
        { x: 0.84 * L, y: -D * 0.6 },
        { x: 0.5 * L, y: -D * 1.0 },
        { x: 0.08 * L, y: -D * 0.9 },
      ];
    default:
      return [
        { x: -0.02 * L, y: 0.02 * D },
        { x: 0.5 * L, y: 0 },
        { x: 0.9 * L, y: 0 },
        { x: 0.86 * L, y: -D * 0.55 },
        { x: 0.5 * L, y: -D * 0.95 },
        { x: 0.08 * L, y: -D * 0.85 },
      ];
  }
}

function headPath(o: V, a: number, pts: V[]): Path2D {
  const path = new Path2D();
  smoothClosed(path, pts.map((q) => at(o, a, q)), 0.95);
  return path;
}

// ---------------- the pet ----------------

export interface DrawOpts {
  /** Screen pixels per rig unit (includes growth size). */
  scale: number;
  /** Outline width in screen pixels. */
  outline: number;
  /** Draw the ground shadow. */
  shadow?: boolean;
  /** Height of the feet above the platform, in screen pixels (shrinks the shadow). */
  airborne?: number;
}

/**
 * Draws the pet with its feet at the current origin of `ctx` (screen space, y down).
 */
export function drawPet(ctx: Ctx, r: Rig, pal: Palette, features: Features, opts: DrawOpts) {
  const s = r.s;
  const p = r.p;
  const sc = opts.scale;
  const o = opts.outline / sc;
  const f = features;
  const grown = 1 - r.baby;

  if (opts.shadow) {
    const len = r.quad ? p.bodyLen + p.hipR + p.chestR : p.bodyLen + p.hipR * 2;
    const w = len * sc * 0.62;
    const k = clamp(1 - (opts.airborne ?? 0) / 160, 0.25, 1);
    ctx.save();
    ctx.fillStyle = `rgba(20, 16, 30, ${0.16 * k})`;
    ctx.beginPath();
    ctx.ellipse(r.quad ? p.bodyLen * 0.45 * sc * r.face : 0, (opts.airborne ?? 0) + 1, w * k, Math.max(2, 3.2 * sc * 0.9) * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  const fx = Math.abs(r.face) < 0.08 ? 0.08 * Math.sign(r.face || 1) : r.face;
  ctx.scale(sc * fx, -sc);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const fill = (path: Path2D, color: string) => {
    ctx.fillStyle = color;
    ctx.fill(path);
  };
  const outlineOf = (path: Path2D) => {
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(path);
  };
  const part = (path: Path2D, color: string) => {
    outlineOf(path);
    fill(path, color);
  };

  const st = stations(r);
  const body = silhouette(r, st);

  // ---- limbs ----
  const sharp = !!f.teeth;
  /** A hind leg: muscular thigh, slim shin with a calf, long foot and toes (or a round foot for big four-legged ones). */
  const hindLeg = (l: LegOut) => {
    const w = p.legW;
    const thigh = new Path2D();
    const rest = new Path2D();
    const toes: V[] = [];
    if (r.quad) {
      limb(thigh, l.hip, l.knee, w * 1.12, w * 0.74, w * 0.1, w * 0.22, 0.4);
      limb(rest, l.knee, l.heel, w * 0.72, w * 0.58, 0, w * 0.12, 0.3);
      limb(rest, l.heel, l.ball, w * 0.58, w * 0.54);
      limb(rest, l.ball, l.toe, w * 0.54, w * 0.36);
      toes.push(l.toe);
    } else {
      // The thigh starts inside the hips, so its top melts into the body.
      const top = add2(l.hip, dir(Math.atan2(l.hip.y - l.knee.y, l.hip.x - l.knee.x), w * 0.45));
      limb(thigh, top, l.knee, w * 0.9, w * 0.48, w * 0.22, w * 0.34, 0.42);
      limb(rest, l.knee, l.heel, w * 0.5, w * 0.27, 0, w * 0.2, 0.28);
      limb(rest, l.heel, l.ball, w * 0.27, w * 0.23);
      const t2 = at(l.ball, Math.atan2(l.toe.y - l.ball.y, l.toe.x - l.ball.x) + 0.35, { x: p.toe * 0.8, y: 0 });
      limb(rest, l.ball, l.toe, w * 0.23, w * 0.1);
      limb(rest, l.ball, t2, w * 0.2, w * 0.09);
      // The small inner toe (dewclaw) at the back of the foot.
      const dw = lerpV(l.heel, l.ball, 0.55);
      limb(rest, dw, add2(dw, dir(-2.3, p.toe * 0.45)), w * 0.12, w * 0.06);
      toes.push(l.toe, t2);
    }
    const all = new Path2D();
    all.addPath(thigh);
    all.addPath(rest);
    return { thigh, all, toes };
  };
  const frontLeg = (l: LegOut) => {
    const w = p.fLegW;
    const upper = new Path2D();
    const all = new Path2D();
    limb(upper, l.hip, l.knee, w * 1.05, w * 0.7, w * 0.15, w * 0.1, 0.35);
    all.addPath(upper);
    limb(all, l.knee, l.heel, w * 0.68, w * 0.52, w * 0.1, 0, 0.3);
    limb(all, l.heel, l.ball, w * 0.52, w * 0.5);
    limb(all, l.ball, l.toe, w * 0.5, w * 0.32);
    return { thigh: upper, all, toes: [l.toe] };
  };
  const arm = (a: ArmOut) => {
    const w = p.armW;
    const upper = new Path2D();
    const all = new Path2D();
    limb(upper, a.shoulder, a.elbow, w * 1.05, w * 0.72, w * 0.18, w * 0.1, 0.35);
    all.addPath(upper);
    limb(all, a.elbow, a.hand, w * 0.72, w * 0.5, w * 0.08, 0, 0.35);
    const ang = Math.atan2(a.hand.y - a.elbow.y, a.hand.x - a.elbow.x);
    const f1 = add2(a.hand, dir(ang + 0.5, w * 1.3));
    const f2 = add2(a.hand, dir(ang - 0.3, w * 1.4));
    limb(all, a.hand, f1, w * 0.42, w * 0.16);
    limb(all, a.hand, f2, w * 0.42, w * 0.16);
    return { thigh: upper, all, toes: [f1, f2] };
  };
  const claws = (tips: V[], from: V, w: number) => {
    for (const tip of tips) {
      const a = Math.atan2(tip.y - from.y, tip.x - from.x);
      const c = new Path2D();
      if (sharp) {
        c.moveTo(tip.x + Math.cos(a + 1.6) * w * 0.12, tip.y + Math.sin(a + 1.6) * w * 0.12);
        c.quadraticCurveTo(tip.x + Math.cos(a) * w * 0.3, tip.y + Math.sin(a) * w * 0.3, tip.x + Math.cos(a - 0.5) * w * 0.34, tip.y + Math.sin(a - 0.5) * w * 0.34 - w * 0.05);
        c.lineTo(tip.x + Math.cos(a - 1.6) * w * 0.12, tip.y + Math.sin(a - 1.6) * w * 0.12);
        ctx.fillStyle = pal.outline;
        ctx.fill(c);
      } else {
        c.ellipse(tip.x + Math.cos(a) * w * 0.05, tip.y + Math.sin(a) * w * 0.05, w * 0.2, w * 0.14, a, 0, Math.PI * 2);
        ctx.fillStyle = pal.horn;
        ctx.strokeStyle = pal.outline;
        ctx.lineWidth = o * 0.9;
        ctx.stroke(c);
        ctx.fill(c);
      }
    }
  };
  const sickle = (l: LegOut) => {
    if (!f.sickleClaw) return;
    const w = p.legW;
    const base = { x: l.ball.x - w * 0.05, y: l.ball.y + w * 0.3 };
    const c = new Path2D();
    c.moveTo(base.x - w * 0.12, base.y);
    c.quadraticCurveTo(base.x + w * 0.1, base.y + w * 0.62, base.x + w * 0.48, base.y + w * 0.38);
    c.quadraticCurveTo(base.x + w * 0.12, base.y + w * 0.36, base.x + w * 0.12, base.y);
    ctx.fillStyle = pal.outline;
    ctx.fill(c);
  };
  const armFeathers = (a: ArmOut, color: string) => {
    if (!f.feathers) return;
    const ang = Math.atan2(a.hand.y - a.elbow.y, a.hand.x - a.elbow.x);
    const fe = new Path2D();
    for (let i = 0; i < 5; i++) {
      const base = { x: lerp(a.elbow.x, a.hand.x, i / 4), y: lerp(a.elbow.y, a.hand.y, i / 4) };
      const tip = add2(base, dir(ang - 2.1 - i * 0.08, p.armFore * (0.55 + 0.12 * (4 - Math.abs(2 - i)))));
      limb(fe, base, tip, p.armW * 0.5, p.armW * 0.12);
    }
    part(fe, color);
  };
  // Where a limb is in front of the body it has no outline, just a soft muscle line, so it looks
  // like part of the animal rather than stuck on.
  const outside = new Path2D();
  const bb = s.bounds;
  outside.rect(bb.x1 - 60, bb.y1 - 60, bb.x2 - bb.x1 + 120, bb.y2 - bb.y1 + 120);
  outside.addPath(body);
  const nearLimb = (lm: { thigh: Path2D; all: Path2D }, color: string, joint: V, w: number) => {
    ctx.save();
    ctx.clip(outside, 'evenodd');
    outlineOf(lm.all);
    ctx.restore();
    fill(lm.all, color);
    // The muscle line: only on the lower part, fading into the body above the joint.
    ctx.save();
    ctx.clip(body);
    ctx.beginPath();
    ctx.rect(bb.x1 - 60, bb.y1 - 60, bb.x2 - bb.x1 + 120, joint.y - w * 0.2 - (bb.y1 - 60));
    ctx.clip();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 1.1;
    ctx.stroke(lm.thigh);
    ctx.restore();
  };

  // Far limbs, behind everything.
  const farLeg = hindLeg(s.legs[1]);
  part(farLeg.all, pal.far);
  claws(farLeg.toes, s.legs[1].ball, p.legW);
  sickle(s.legs[1]);
  if (s.fronts.length) {
    const fl = frontLeg(s.fronts[1]);
    part(fl.all, pal.far);
    claws(fl.toes, s.fronts[1].ball, p.fLegW);
  }
  if (s.arms.length) {
    armFeathers(s.arms[1], darken(pal.accent, 0.2));
    const fa = arm(s.arms[1]);
    part(fa.all, pal.far);
    claws(fa.toes, s.arms[1].hand, p.armW * 2.2);
  }

  // ---- features behind the body ----
  if (f.sail) drawSail(ctx, pal, o, st, p, grown);
  if (f.plates) {
    drawPlates(ctx, pal, o, st, p, grown, true);
    drawPlates(ctx, pal, o, st, p, grown, false);
  }
  if (f.finTail) drawFin(ctx, r, pal, o);
  if (f.thagomizer) drawThagomizer(ctx, r, pal, o, true);
  if (f.spikes) part(spikePath(st), pal.accent);
  if (f.armor) part(armorSpikes(st, grown), pal.horn);
  if (f.horns) part(hornPath(r), lighten(pal.accent, 0.35));

  // ---- head shapes ----
  const skull = headPath(s.headO, s.headA, skullPoints(r, f));
  const jawA = s.headA + s.jawA;
  const jaw = headPath(s.headO, jawA, jawPoints(r, f));
  const open = s.jawA < -0.05;
  let mouth: Path2D | null = null;
  if (open) {
    mouth = new Path2D();
    const L = p.headLen;
    const pts = [at(s.headO, s.headA, { x: 0.02 * L, y: 0.05 * p.headH }), at(s.headO, s.headA, { x: 0.94 * L, y: 0 }), at(s.headO, jawA, { x: 0.88 * L, y: 0 }), at(s.headO, jawA, { x: 0.1 * L, y: -0.1 * p.jawD })];
    mouth.moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) mouth.lineTo(q.x, q.y);
    mouth.closePath();
  }

  // ---- main silhouette: outline everything first, then fill, so the outline only shows outside ----
  outlineOf(body);
  outlineOf(skull);
  outlineOf(jaw);
  if (mouth) outlineOf(mouth);
  fill(body, pal.body);
  if (mouth) fill(mouth, pal.mouth);
  if (open) {
    // Tongue.
    const tg = new Path2D();
    const c = at(s.headO, jawA, { x: p.headLen * 0.42, y: p.jawD * 0.05 });
    tg.ellipse(c.x, c.y, p.headLen * 0.24, p.jawD * 0.28, jawA, 0, Math.PI * 2);
    fill(tg, '#d86a7a');
    if (f.teeth) teeth(ctx, r, jawA, open);
  }

  // Belly, pattern and shading, clipped to the body.
  ctx.save();
  ctx.clip(body);
  bellyBand(ctx, st, pal);
  pattern(ctx, st, pal, o);
  if (f.armor) scutes(ctx, st, pal, o);
  shade(ctx, s.bounds);
  // A soft sheen along the back.
  ctx.strokeStyle = lighten(pal.body, 0.35);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = o * 1.3;
  ctx.beginPath();
  st.forEach((q, i) => {
    if (q.k < -6) return;
    const d = dorsalAt(q, -o * 2.2);
    if (i === 0 || st[i - 1].k < -6) ctx.moveTo(d.x, d.y);
    else ctx.lineTo(d.x, d.y);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Head crests and frills sit behind the skull but in front of the neck.
  const behindHead = !!(f.frill || f.tubeCrest || f.twinCrests || f.browHorns);
  if (f.frill) drawFrill(ctx, r, pal, o);
  if (f.tubeCrest) drawTubeCrest(ctx, r, pal, o);
  if (f.twinCrests) {
    drawTwinCrest(ctx, r, pal, o, true);
    drawTwinCrest(ctx, r, pal, o, false);
  }
  if (f.browHorns) browHorn(ctx, r, pal, o, true);
  if (behindHead) {
    outlineOf(skull);
    outlineOf(jaw);
  }
  fill(jaw, pal.body);
  fill(skull, pal.body);

  // Head details, clipped to the head.
  const L = p.headLen;
  const H = p.headH;
  const kind = headKind(f);
  const headUnion = new Path2D();
  headUnion.addPath(skull);
  headUnion.addPath(jaw);
  ctx.save();
  ctx.clip(headUnion);
  // Pale throat and lower jaw.
  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.ellipse(...xy(at(s.headO, jawA, { x: L * 0.45, y: -p.jawD * 1.0 })), L * 0.5, p.jawD * 0.62, jawA, 0, Math.PI * 2);
  ctx.fill();
  // Beaks: a horny tip on the snout and the lower jaw.
  if (f.beak || f.duckBill) {
    const b0 = kind === 'cera' ? 0.74 : kind === 'duck' ? 0.8 : 0.76;
    ctx.fillStyle = pal.horn;
    const bk = new Path2D();
    const q1 = at(s.headO, s.headA, { x: (b0 + 0.06) * L, y: H * 1.4 });
    const q2 = at(s.headO, s.headA, { x: b0 * L, y: p.snoutH * 0.4 });
    const q3 = at(s.headO, jawA, { x: (b0 - 0.04) * L, y: -p.jawD * 1.5 });
    const far1 = at(s.headO, s.headA, { x: 1.5 * L, y: H * 1.4 });
    const far2 = at(s.headO, jawA, { x: 1.5 * L, y: -p.jawD * 1.5 });
    bk.moveTo(q1.x, q1.y);
    bk.quadraticCurveTo(q2.x - 1, q2.y, q3.x, q3.y);
    bk.lineTo(far2.x, far2.y);
    bk.lineTo(far1.x, far1.y);
    bk.closePath();
    ctx.fill(bk);
    ctx.strokeStyle = pal.hornDark;
    ctx.lineWidth = o * 0.9;
    ctx.beginPath();
    ctx.moveTo(q1.x, q1.y);
    ctx.quadraticCurveTo(q2.x - 1, q2.y, q3.x, q3.y);
    ctx.stroke();
  }
  // Meat-eaters' skulls have a big hollow in front of the eye; a hint of it reads as "dinosaur".
  if (f.teeth && grown > 0.3 && kind !== 'croc') {
    ctx.fillStyle = darken(pal.body, 0.3);
    ctx.globalAlpha = 0.28 * grown;
    ctx.beginPath();
    ctx.ellipse(...xy(at(s.headO, s.headA, { x: L * 0.55, y: H * 0.5 })), L * 0.13, H * 0.14, s.headA - 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  shade(ctx, { x1: s.bounds.x1, x2: s.bounds.x2, y1: Math.min(s.headO.y, s.top.y) - p.jawD * 1.5, y2: s.top.y + 2 });
  ctx.restore();

  if (f.dome) {
    ctx.save();
    ctx.clip(skull);
    ctx.fillStyle = pal.accent;
    const dc = at(s.headO, s.headA, { x: L * 0.24, y: H * 1.02 });
    ctx.beginPath();
    ctx.ellipse(dc.x, dc.y, L * 0.46, H * 0.5, s.headA - 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = darken(pal.accent, 0.35);
    ctx.lineWidth = o * 1.1;
    ctx.beginPath();
    ctx.ellipse(dc.x, dc.y, L * 0.46, H * 0.5, s.headA - 0.1, Math.PI * 0.95, Math.PI * 2.05, true);
    ctx.stroke();
    ctx.restore();
    // Knobs around the dome and snout.
    ctx.fillStyle = darken(pal.accent, 0.12);
    for (const q of [
      { x: -0.12, y: 0.62 },
      { x: -0.08, y: 0.8 },
      { x: 0.6, y: 0.78 },
      { x: 0.7, y: 0.66 },
      { x: 0.84, y: 0.55 },
    ]) {
      const k = at(s.headO, s.headA, { x: q.x * L, y: q.y * H });
      ctx.beginPath();
      ctx.arc(k.x, k.y, H * 0.055 + o * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tooth tips peeking out on grown-ups.
  if (!open && f.teeth && r.growth > 0.45) teeth(ctx, r, jawA, false);

  // Face details: mouth line, nostril, blush.
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 1.1;
  if (!open) {
    const m = new Path2D();
    const smile = r.eyes === 'happy' ? 0.05 * H : 0;
    const a0 = at(s.headO, s.headA, { x: 0.3 * L, y: 0.08 * H + r.baby * 0.04 * H + smile });
    const a1 = at(s.headO, s.headA, { x: 0.62 * L, y: 0.01 * H - smile * 0.5 });
    const a2 = at(s.headO, s.headA, { x: (kind === 'croc' ? 0.97 : 0.93) * L, y: 0.02 * H });
    m.moveTo(a0.x, a0.y);
    m.quadraticCurveTo(a1.x, a1.y, a2.x, a2.y);
    ctx.stroke(m);
  }
  const noseAt = kind === 'croc' ? { x: 0.52, y: p.snoutH * 1.0 } : kind === 'duck' ? { x: 0.8, y: p.snoutH * 0.78 } : kind === 'sauro' ? { x: 0.84, y: p.snoutH * 0.95 } : { x: 0.9, y: p.snoutH * 0.78 };
  const nose = at(s.headO, s.headA, { x: noseAt.x * L, y: noseAt.y });
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  ctx.ellipse(nose.x, nose.y, L * 0.035 + o * 0.3, H * 0.03 + o * 0.25, s.headA - 0.3, 0, Math.PI * 2);
  ctx.fill();

  if (r.baby > 0.25 || r.eyes === 'happy') {
    const ch = at(s.headO, s.headA, { x: (p.eyeX + 0.1) * L, y: (p.eyeY - 0.34) * H });
    ctx.fillStyle = `rgba(255, 120, 140, ${0.32 * Math.max(Math.min(1, r.baby), r.eyes === 'happy' ? 0.7 : 0)})`;
    ctx.beginPath();
    ctx.ellipse(ch.x, ch.y, p.eyeR * 0.9 + 1, p.eyeR * 0.5 + 0.6, s.headA, 0, Math.PI * 2);
    ctx.fill();
  }

  eye(ctx, r, pal, f, o);

  if (f.crest || (f.feathers && !f.beak)) crest(ctx, r, pal, o);
  if (f.browHorns) browHorn(ctx, r, pal, o, false);
  if (f.noseHorn) {
    const nh = new Path2D();
    horn(nh, at(s.headO, s.headA, { x: 0.8 * L, y: p.snoutH * 0.95 }), s.headA + 1.05, H * (0.12 + 0.32 * grown), L * (0.08 + 0.04 * grown), -0.15);
    part(nh, pal.horn);
  }
  if (f.armor) {
    // Little horns at the back of the head and on the cheeks.
    const hh = new Path2D();
    horn(hh, at(s.headO, s.headA, { x: 0.02 * L, y: 0.86 * H }), s.headA + 2.5, H * (0.18 + 0.2 * grown), L * 0.12, 0.2);
    horn(hh, at(s.headO, s.headA, { x: 0.1 * L, y: 0.2 * H }), s.headA - 2.3, H * (0.14 + 0.18 * grown), L * 0.11, -0.2);
    part(hh, pal.horn);
  }

  // Near legs and arm on top, blending into the body.
  const near = hindLeg(s.legs[0]);
  nearLimb(near, pal.body, s.legs[0].hip, p.legW);
  // A little highlight on the thigh.
  const nl = s.legs[0];
  const ta = Math.atan2(nl.knee.y - nl.hip.y, nl.knee.x - nl.hip.x);
  ctx.fillStyle = lighten(pal.body, 0.25);
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(...xy(add2(lerpV(nl.hip, nl.knee, 0.42), dir(ta + Math.PI / 2, p.legW * 0.28))), p.legW * 0.62, p.legW * 0.34, ta, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  claws(near.toes, nl.ball, p.legW);
  sickle(nl);
  if (s.fronts.length) {
    const fl = frontLeg(s.fronts[0]);
    nearLimb(fl, pal.body, s.fronts[0].hip, p.fLegW);
    claws(fl.toes, s.fronts[0].ball, p.fLegW);
  }
  if (s.arms.length) {
    armFeathers(s.arms[0], pal.accent);
    const na = arm(s.arms[0]);
    nearLimb(na, pal.body, s.arms[0].shoulder, p.armW);
    claws(na.toes, s.arms[0].hand, p.armW * 2.2);
  }

  // Tail ends.
  if (f.thagomizer) drawThagomizer(ctx, r, pal, o, false);
  if (f.club) drawClub(ctx, r, pal, o);
  if (f.feathers) tailFeathers(ctx, r, pal, o);

  ctx.restore();
}

/** Soft light from above: a highlight on the back and a shadow underneath. */
function shade(ctx: Ctx, b: { x1: number; y1: number; x2: number; y2: number }) {
  const g = ctx.createLinearGradient(0, b.y2, 0, b.y1);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.addColorStop(0.65, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(20,10,30,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(b.x1 - 5, b.y1 - 5, b.x2 - b.x1 + 10, b.y2 - b.y1 + 10);
}

/** The pale underside (counter-shading) following the belly line from tail to throat. */
function bellyBand(ctx: Ctx, st: Station[], pal: Palette) {
  const band = (widen: number) => {
    const outer = st.map((q) => ventralAt(q, 2));
    const inner = st.map((q) => {
      const tail = q.k < 0 ? clamp((q.k + 9) / 7, 0, 1) : 1; // fades out towards the tail tip
      const w = q.dn * (q.k < 0 ? 0.62 : q.k <= 1 ? 0.66 : 0.8) * tail * widen;
      return ventralAt(q, -w);
    });
    const path = new Path2D();
    smoothClosed(path, [...outer, ...inner.reverse()], 0.9);
    return path;
  };
  ctx.fillStyle = pal.belly;
  ctx.globalAlpha = 0.45;
  ctx.fill(band(1.25));
  ctx.globalAlpha = 1;
  ctx.fill(band(1));
}

function teeth(ctx: Ctx, r: Rig, jawA: number, open: boolean) {
  const s = r.s;
  const L = r.p.headLen;
  const tSize = Math.max(0.9, L * 0.045);
  ctx.fillStyle = '#fbf6e9';
  const n = open ? 6 : 3;
  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = open ? 0.36 + i * 0.1 : 0.5 + i * 0.16;
    const base = at(s.headO, s.headA, { x: x * L, y: 0.01 * r.p.headH });
    const tip = at(s.headO, s.headA, { x: x * L + tSize * 0.2, y: -tSize * (open ? 1.5 : 1.25) });
    const side = at(s.headO, s.headA, { x: x * L + tSize, y: 0.01 * r.p.headH });
    path.moveTo(base.x, base.y);
    path.lineTo(tip.x, tip.y);
    path.lineTo(side.x, side.y);
    path.closePath();
  }
  if (open) {
    for (let i = 0; i < 5; i++) {
      const x = 0.4 + i * 0.1;
      const base = at(s.headO, jawA, { x: x * L, y: -0.02 * r.p.jawD });
      const tip = at(s.headO, jawA, { x: x * L + tSize * 0.4, y: tSize * 1.2 });
      const side = at(s.headO, jawA, { x: x * L + tSize, y: -0.02 * r.p.jawD });
      path.moveTo(base.x, base.y);
      path.lineTo(tip.x, tip.y);
      path.lineTo(side.x, side.y);
      path.closePath();
    }
  }
  ctx.fill(path);
}

/** Deterministic pseudo-random 0..1 from an integer, for patterns that don't flicker. */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Body pattern over the back and flanks. Each kind is drawn as a single path, so it's cheap. */
function pattern(ctx: Ctx, st: Station[], pal: Palette, o: number) {
  const kind = pal.kind;
  if (kind === 'none') return;
  const path = new Path2D();
  const on = st.filter((q) => q.k >= -7 && q.k <= 1.6);
  if (kind === 'stripes' || kind === 'bands') {
    const bands = kind === 'bands';
    on.forEach((q, i) => {
      if (!bands && i % 1) return;
      const depth = (q.up + q.dn) * (bands ? 0.62 : 0.42);
      const w = Math.max(o * 1.5, q.up * (bands ? 0.34 : 0.22));
      const t = dir(q.a, w / 2);
      const top = dorsalAt(q, 1);
      const tip = add2(dorsalAt(q, -depth), dir(q.a, -w * 0.5));
      path.moveTo(top.x + t.x, top.y + t.y);
      path.quadraticCurveTo(tip.x + t.x * 0.6, tip.y + t.y * 0.6, tip.x, tip.y);
      path.quadraticCurveTo(tip.x - t.x * 0.6, tip.y - t.y * 0.6, top.x - t.x, top.y - t.y);
      path.closePath();
    });
  } else if (kind === 'spots') {
    on.forEach((q, i) => {
      const c = dorsalAt(q, -q.up * 0.45);
      const rr = Math.max(o * 1.2, q.up * 0.2);
      path.moveTo(c.x + rr * 1.2, c.y);
      path.ellipse(c.x, c.y, rr * 1.2, rr, q.a, 0, Math.PI * 2);
      if (i % 2 === 0) {
        const c2 = dorsalAt(q, -q.up * 1.1);
        path.moveTo(c2.x + rr * 0.6, c2.y);
        path.arc(c2.x, c2.y, rr * 0.6, 0, Math.PI * 2);
      }
    });
  } else if (kind === 'speckles') {
    on.forEach((q, i) => {
      for (let k = 0; k < 4; k++) {
        const c = dorsalAt(q, -(q.up + q.dn) * (0.08 + 0.5 * hash(i * 13 + k * 3 + 1)));
        const d = add2(c, dir(q.a, (hash(i * 7 + k) - 0.5) * q.up * 0.8));
        const rr = Math.max(o * 0.8, q.up * (0.05 + 0.06 * hash(i + k * 5)));
        path.moveTo(d.x + rr, d.y);
        path.arc(d.x, d.y, rr, 0, Math.PI * 2);
      }
    });
  } else if (kind === 'saddle') {
    // A dark saddle over the back, softer at its edge.
    const sad = on.filter((q) => q.k > -5 && q.k <= 1);
    const edge = (w: number) => {
      const p2 = new Path2D();
      smoothClosed(p2, [...sad.map((q) => dorsalAt(q, 2)), ...sad.map((q) => dorsalAt(q, -(q.up + q.dn) * w)).reverse()], 0.9);
      return p2;
    };
    ctx.fillStyle = pal.pattern;
    ctx.globalAlpha = 0.4;
    ctx.fill(edge(0.62));
    ctx.globalAlpha = 1;
    ctx.fill(edge(0.48));
    return;
  } else if (kind === 'rosettes') {
    const ring = new Path2D();
    on.forEach((q, i) => {
      for (const [off, sz] of [
        [0.5, 0.26],
        [1.05, 0.2],
      ] as const) {
        if (off > 1 && i % 2) continue;
        const c = add2(dorsalAt(q, -q.up * off), dir(q.a, (i % 2 ? 0.2 : -0.15) * q.up));
        const rr = Math.max(o * 1.6, q.up * sz);
        path.moveTo(c.x + rr, c.y);
        path.ellipse(c.x, c.y, rr, rr * 0.8, q.a, 0, Math.PI * 2);
        ring.moveTo(c.x + rr, c.y);
        ring.ellipse(c.x, c.y, rr, rr * 0.8, q.a, 0, Math.PI * 2);
      }
    });
    ctx.fillStyle = mix(pal.body, pal.pattern, 0.35);
    ctx.fill(path);
    ctx.strokeStyle = pal.pattern;
    ctx.lineWidth = Math.max(o * 1.1, 1.2);
    ctx.setLineDash([2.2, 1.2]);
    ctx.stroke(ring);
    ctx.setLineDash([]);
    return;
  }
  ctx.fillStyle = pal.pattern;
  ctx.fill(path);
}

function eye(ctx: Ctx, r: Rig, pal: Palette, f: Features, o: number) {
  const s = r.s;
  const e = s.eye;
  const er = r.p.eyeR;
  const a = s.headA;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(a);
  ctx.lineCap = 'round';
  const state = r.eyes;
  if (state === 'closed' || state === 'happy') {
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = Math.max(o * 1.3, er * 0.35);
    ctx.beginPath();
    if (state === 'closed') ctx.arc(0, er * 0.2, er * 0.85, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(0, -er * 0.5, er * 0.85, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.restore();
    browAndHorns();
    return;
  }
  if (state === 'dizzy') {
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = Math.max(o, er * 0.25);
    ctx.beginPath();
    for (let t = 0; t < 12; t += 0.25) {
      const rr = (t / 12) * er;
      const ang = t * 1.4 - r.time * 8;
      if (t === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.stroke();
    ctx.restore();
    browAndHorns();
    return;
  }
  const wide = state === 'wide' ? 1.18 : 1;
  const R = er * wide;
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  ctx.arc(0, 0, R + o, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fffdf6';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  const px = s.pupil.x * R * 0.28;
  const py = s.pupil.y * R * 0.28;
  const irisR = R * (0.72 + 0.1 * r.baby);
  const ig = ctx.createRadialGradient(px, py + irisR * 0.3, irisR * 0.1, px, py, irisR);
  ig.addColorStop(0, lighten(pal.iris, 0.35));
  ig.addColorStop(1, pal.iris);
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(px, py, irisR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#17121c';
  ctx.beginPath();
  if (r.baby < 0.3 && state !== 'wide') ctx.ellipse(px, py, irisR * (state === 'angry' ? 0.24 : 0.32), irisR * 0.62, 0, 0, Math.PI * 2);
  else ctx.arc(px, py, irisR * (state === 'wide' ? 0.42 : state === 'angry' ? 0.45 : 0.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px - irisR * 0.32, py + irisR * 0.34, irisR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px + irisR * 0.3, py - irisR * 0.3, irisR * 0.13, 0, Math.PI * 2);
  ctx.fill();
  // Eyelid (blinking, sleepy) or an angry brow slanting down to the snout.
  if (s.lid > 0.02 || state === 'angry') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R + o * 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = pal.body;
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 1.2;
    if (s.lid > 0.02) {
      const lidY = R - s.lid * 2 * R;
      ctx.fillRect(-R - o, lidY, 2 * R + 2 * o, 2 * R + 2 * o);
      ctx.beginPath();
      ctx.moveTo(-R - o, lidY);
      ctx.lineTo(R + o, lidY);
      ctx.stroke();
    }
    if (state === 'angry') {
      ctx.beginPath();
      ctx.moveTo(-R - o, R * 1.2);
      ctx.lineTo(-R - o, R * 0.75);
      ctx.lineTo(R + o, R * 0.05);
      ctx.lineTo(R + o, R * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-R - o, R * 0.75);
      ctx.lineTo(R + o, R * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
  browAndHorns();

  function browAndHorns() {
    if (!f.brow || r.baby > 0.7) return;
    const k = 1 - r.baby;
    ctx.save();
    ctx.strokeStyle = pal.outline;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(o * 1.4, er * 0.45) * (0.6 + 0.4 * k);
    const b0 = at(s.eye, a, { x: -er * 1.1, y: er * 1.35 });
    const b1 = at(s.eye, a, { x: er * 1.3, y: er * (1.05 - 0.2 * k) });
    ctx.beginPath();
    ctx.moveTo(b0.x, b0.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.stroke();
    ctx.restore();
  }
}

function crest(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  // A swept-back crest of feathers from the back of the skull.
  for (let i = 0; i < 4; i++) {
    const base = at(s.headO, s.headA, { x: (0.14 - i * 0.09) * L, y: (0.9 - i * 0.09) * H });
    const ang = s.headA + Math.PI - 0.55 - i * 0.12 + Math.sin(r.time * 2 + i) * 0.04;
    const k = 1 - 0.55 * r.baby;
    const tip = add2(base, dir(ang + r.baby * 0.5, L * (0.3 + 0.06 * (i % 2)) * k));
    const fe = new Path2D();
    capsule(fe, base, H * 0.11 * (1 - 0.35 * r.baby), tip, H * 0.04);
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(fe);
    ctx.fillStyle = i % 2 ? darken(pal.accent, 0.15) : pal.accent;
    ctx.fill(fe);
  }
}

function tailFeathers(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const t = r.s.tail;
  const n = t.length;
  const tip = t[n - 1].p;
  const prev = t[n - 2].p;
  const a = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  for (let i = -2; i <= 2; i++) {
    const fe = new Path2D();
    const end = add2(tip, dir(a + i * 0.28, r.p.tailLen * 0.16));
    capsule(fe, tip, r.p.tailR * 0.22, end, r.p.tailR * 0.1);
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(fe);
    ctx.fillStyle = i % 2 ? pal.accent : darken(pal.accent, 0.18);
    ctx.fill(fe);
  }
}

/** Back spikes along the torso and tail. */
function spikePath(st: Station[]): Path2D {
  const path = new Path2D();
  for (const q of st) {
    if (q.k < -7 || q.k > 1) continue;
    const base = dorsalAt(q, -q.up * 0.15);
    const up = q.a + Math.PI / 2;
    const tip = add2(base, dir(up - 0.35, Math.max(2.5, q.up * 0.55)));
    const side = q.up * 0.28 + 1;
    const b1 = add2(base, dir(q.a, side));
    const b2 = add2(base, dir(q.a, -side));
    path.moveTo(b1.x, b1.y);
    path.lineTo(tip.x, tip.y);
    path.lineTo(b2.x, b2.y);
    path.closePath();
  }
  return path;
}

function hornPath(r: Rig): Path2D {
  const s = r.s;
  const path = new Path2D();
  const L = r.p.headLen;
  const H = r.p.headH;
  const base = at(s.headO, s.headA, { x: (r.p.eyeX + 0.02) * L, y: 0.92 * H });
  const tip = at(s.headO, s.headA, { x: (r.p.eyeX - 0.08) * L, y: 0.92 * H + Math.max(3, H * 0.5) });
  const b1 = at(s.headO, s.headA, { x: (r.p.eyeX - 0.1) * L, y: 0.9 * H });
  const b2 = at(s.headO, s.headA, { x: (r.p.eyeX + 0.14) * L, y: 0.9 * H });
  path.moveTo(b1.x, b1.y);
  path.quadraticCurveTo(base.x - 1, tip.y - 1, tip.x, tip.y);
  path.quadraticCurveTo(base.x + 2, base.y + 1, b2.x, b2.y);
  path.closePath();
  return path;
}

// ---------------- species features ----------------

/** Spinosaurus sail: tall spines joined by skin, highest over the middle of the back. */
function drawSail(ctx: Ctx, pal: Palette, o: number, st: Station[], p: BodyParams, grown: number) {
  const k = 0.3 + 0.7 * grown;
  const pts = st.filter((q) => q.k >= -2 && q.k <= 1);
  const n = pts.length;
  const top: V[] = [];
  const base: V[] = [];
  pts.forEach((q, i) => {
    const u = i / (n - 1);
    const h = (p.bodyLen * 0.95 * Math.pow(Math.sin(Math.PI * clamp(u * 0.95 + 0.03, 0, 1)), 0.8) + 1) * k;
    base.push(dorsalAt(q, -q.up * 0.35));
    top.push(add2(dorsalAt(q), dir(q.a + Math.PI / 2 - 0.08, h)));
  });
  const sail = new Path2D();
  sail.moveTo(base[0].x, base[0].y);
  for (let i = 0; i < n; i++) {
    const a = top[i];
    if (i === 0) sail.lineTo(a.x, a.y);
    else {
      const prev = top[i - 1];
      sail.quadraticCurveTo(prev.x, prev.y, (prev.x + a.x) / 2, (prev.y + a.y) / 2);
    }
  }
  sail.lineTo(top[n - 1].x, top[n - 1].y);
  sail.lineTo(base[n - 1].x, base[n - 1].y);
  sail.closePath();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(sail);
  ctx.fillStyle = pal.accent;
  ctx.fill(sail);
  // Darker spines through the skin.
  ctx.strokeStyle = darken(pal.accent, 0.25);
  ctx.lineWidth = o * 0.9;
  ctx.beginPath();
  for (let i = 1; i < n - 1; i++) {
    const t = lerpV(base[i], top[i], 0.93);
    ctx.moveTo(base[i].x, base[i].y);
    ctx.lineTo(t.x, t.y);
  }
  ctx.stroke();
}

/** Stegosaurus plates: two alternating rows along the back, biggest over the hips. */
function drawPlates(ctx: Ctx, pal: Palette, o: number, st: Station[], p: BodyParams, grown: number, far: boolean) {
  const k = 0.3 + 0.7 * grown;
  const pts = st.filter((q) => q.k >= -6);
  const color = far ? darken(pal.accent, 0.2) : pal.accent;
  const plates = new Path2D();
  const glints = new Path2D();
  pts.forEach((q, i) => {
    if ((i % 2 === 0) !== far) return;
    // Small on the neck and tail, tallest just in front of the hips.
    const x = q.k;
    const peak = x < 0 ? 1 - Math.min(1, -x / 7) * 0.75 : x <= 1 ? 1 - x * 0.35 : 0.5 - (x - 1) * 0.35;
    const h = Math.max(2, p.hipR * 1.05 * peak * k);
    const w = h * 0.62;
    const base = dorsalAt(q, -q.up * 0.25);
    const ang = q.a + Math.PI / 2 + (far ? 0.12 : 0.02);
    const tip = add2(base, dir(ang, h));
    const mid = add2(base, dir(ang, h * 0.42));
    const side = dir(ang + Math.PI / 2, w / 2);
    plates.moveTo(base.x + side.x * 0.45, base.y + side.y * 0.45);
    plates.quadraticCurveTo(mid.x + side.x * 1.3, mid.y + side.y * 1.3, tip.x, tip.y);
    plates.quadraticCurveTo(mid.x - side.x * 1.3, mid.y - side.y * 1.3, base.x - side.x * 0.45, base.y - side.y * 0.45);
    plates.closePath();
    const g = add2(mid, dir(ang, h * 0.05));
    glints.moveTo(g.x + w * 0.22, g.y);
    glints.ellipse(g.x - side.x * 0.2, g.y - side.y * 0.2, w * 0.22, h * 0.26, ang, 0, Math.PI * 2);
  });
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(plates);
  ctx.fillStyle = color;
  ctx.fill(plates);
  ctx.fillStyle = lighten(color, 0.22);
  ctx.fill(glints);
}

/** Stegosaurus tail spikes; the far pair is drawn behind the tail, the near pair in front. */
function drawThagomizer(ctx: Ctx, r: Rig, pal: Palette, o: number, far: boolean) {
  const t = r.s.tail;
  const n = t.length;
  const k = 0.25 + 0.75 * (1 - r.baby);
  const path = new Path2D();
  for (const [i, lean] of [
    [n - 3, 0.45],
    [n - 2, 0.75],
  ] as const) {
    const a = Math.atan2(t[i + 1].p.y - t[i].p.y, t[i + 1].p.x - t[i].p.x); // toward the tip
    const up = a - Math.PI / 2 + (far ? -0.25 : 0);
    const base = add2(t[i].p, dir(up, t[i].r * 0.4));
    horn(path, base, up + (a - up) * lean, r.p.tailR * 1.7 * k, r.p.tailR * 0.42, 0.1);
  }
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(path);
  ctx.fillStyle = far ? pal.hornDark : pal.horn;
  ctx.fill(path);
}

/** Ankylosaurus tail club. */
function drawClub(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const t = r.s.tail;
  const n = t.length;
  const tip = t[n - 1].p;
  const a = Math.atan2(tip.y - t[n - 2].p.y, tip.x - t[n - 2].p.x);
  const k = 0.45 + 0.55 * (1 - r.baby);
  const R = r.p.tailR * 0.95 * k;
  const c = add2(tip, dir(a, R * 0.3));
  const club = new Path2D();
  club.ellipse(c.x, c.y, R * 1.2, R * 0.85, a, 0, Math.PI * 2);
  const l1 = add2(c, dir(a + 1.9, R * 0.45));
  const l2 = add2(c, dir(a - 1.9, R * 0.45));
  club.moveTo(l1.x + R * 0.7, l1.y);
  club.ellipse(l1.x, l1.y, R * 0.7, R * 0.55, a, 0, Math.PI * 2);
  club.moveTo(l2.x + R * 0.7, l2.y);
  club.ellipse(l2.x, l2.y, R * 0.7, R * 0.55, a, 0, Math.PI * 2);
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(club);
  ctx.fillStyle = mix(pal.accent, pal.body, 0.3);
  ctx.fill(club);
  ctx.save();
  ctx.clip(club);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(c.x - R * 0.2, c.y + R * 0.3, R * 0.5, R * 0.22, a, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Ankylosaurus: short blunt spikes along the back. */
function armorSpikes(st: Station[], grown: number): Path2D {
  const path = new Path2D();
  const k = 0.35 + 0.65 * grown;
  for (const q of st) {
    if (q.k < -5 || q.k > 1) continue;
    const up = q.a + Math.PI / 2;
    horn(path, dorsalAt(q, -q.up * 0.18), up - 0.55, Math.max(1.5, q.up * 0.42 * k), q.up * 0.34, 0);
  }
  return path;
}

/** Ankylosaurus: bony plates (osteoderms) in rows over the back. */
function scutes(ctx: Ctx, st: Station[], pal: Palette, o: number) {
  const path = new Path2D();
  for (const q of st) {
    if (q.k < -6 || q.k > 1) continue;
    for (const [off, sz] of [
      [0.38, 0.2],
      [0.78, 0.16],
    ] as const) {
      const c = dorsalAt(q, -q.up * off);
      const rr = Math.max(o * 1.5, q.up * sz);
      path.moveTo(c.x + rr * 1.2, c.y);
      path.ellipse(c.x, c.y, rr * 1.2, rr * 0.85, q.a, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = mix(pal.accent, pal.body, 0.35);
  ctx.fill(path);
  ctx.strokeStyle = darken(pal.body, 0.35);
  ctx.lineWidth = o * 0.8;
  ctx.stroke(path);
}

/** Spinosaurus: a fin along the top and bottom of the tail. */
function drawFin(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const t = r.s.tail;
  const n = t.length;
  const k = 0.3 + 0.7 * (1 - r.baby);
  const topE: V[] = [];
  const botE: V[] = [];
  for (let i = 2; i < n; i++) {
    const a = Math.atan2(t[i].p.y - t[i - 1].p.y, t[i].p.x - t[i - 1].p.x);
    const up = a - Math.PI / 2;
    const u = (i - 2) / (n - 3);
    const h = Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1)) * r.p.tailR * 1.25 * k;
    topE.push(add2(t[i].p, dir(up, t[i].r * 0.5 + h)));
    botE.push(add2(t[i].p, dir(up + Math.PI, t[i].r * 0.5 + h * 0.45)));
  }
  const fin = new Path2D();
  smoothClosed(fin, [...topE, ...botE.reverse()], 0.9);
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(fin);
  ctx.fillStyle = pal.accent;
  ctx.fill(fin);
}

/** Ceratopsian frill: a big scalloped shield from the back of the skull. */
function drawFrill(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 1 - 0.45 * r.baby;
  const c = { x: 0.02 * L, y: 0.6 * H };
  const R1 = L * 0.5 * k;
  const R2 = H * 0.86 * k;
  const pts: V[] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const th = ((38 + (i / N) * 180) * Math.PI) / 180;
    const bump = i % 2 ? 1 : 0.92;
    pts.push(at(s.headO, s.headA, { x: c.x + Math.cos(th) * R1 * bump, y: c.y + Math.sin(th) * R2 * bump }));
  }
  pts.push(at(s.headO, s.headA, { x: 0.05 * L, y: 0.12 * H }), at(s.headO, s.headA, { x: 0.32 * L, y: 0.7 * H }));
  const frill = new Path2D();
  smoothClosed(frill, pts, 0.8);
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(frill);
  ctx.fillStyle = pal.accent;
  ctx.fill(frill);
  ctx.save();
  ctx.clip(frill);
  // A lighter centre and bony knobs along the rim.
  const inner = new Path2D();
  const ic = at(s.headO, s.headA, { x: c.x - 0.04 * L, y: c.y + 0.05 * H });
  inner.ellipse(ic.x, ic.y, R1 * 0.64, R2 * 0.62, s.headA, 0, Math.PI * 2);
  ctx.fillStyle = mix(pal.accent, pal.belly, 0.4);
  ctx.fill(inner);
  ctx.fillStyle = darken(pal.accent, 0.22);
  for (let i = 1; i < N; i += 2) {
    const th = ((38 + (i / N) * 180) * Math.PI) / 180;
    const q = at(s.headO, s.headA, { x: c.x + Math.cos(th) * R1 * 0.9, y: c.y + Math.sin(th) * R2 * 0.9 });
    ctx.beginPath();
    ctx.arc(q.x, q.y, H * 0.07 * k + o * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Triceratops brow horns: the far one behind the skull, the near one in front. */
function browHorn(ctx: Ctx, r: Rig, pal: Palette, o: number, far: boolean) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const grown = 1 - r.baby;
  const path = new Path2D();
  const base = at(s.headO, s.headA, { x: (r.p.eyeX - (far ? 0.1 : 0.02)) * L, y: (0.9 + (far ? 0.06 : 0)) * H });
  horn(path, base, s.headA + 0.78 + (far ? 0.08 : 0), H * (0.18 + 1.05 * grown) * (far ? 0.92 : 1), L * (0.1 + 0.05 * grown), 0.2);
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(path);
  ctx.fillStyle = far ? pal.hornDark : pal.horn;
  ctx.fill(path);
}

/** Parasaurolophus: a long hollow crest curving back from the skull. */
function drawTubeCrest(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 0.22 + 0.78 * (1 - r.baby);
  const p0 = { x: 0.3 * L, y: 0.85 * H };
  const p1 = { x: (0.3 - 0.55 * k) * L, y: (0.9 + 0.85 * k) * H };
  const p2 = { x: (0.3 - 1.2 * k) * L, y: (0.9 + 0.62 * k) * H };
  const path = new Path2D();
  const N = 10;
  let prev: V | null = null;
  let prevR = 0;
  const line: V[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const q = {
      x: (1 - u) * (1 - u) * p0.x + 2 * u * (1 - u) * p1.x + u * u * p2.x,
      y: (1 - u) * (1 - u) * p0.y + 2 * u * (1 - u) * p1.y + u * u * p2.y,
    };
    const w = at(s.headO, s.headA, q);
    const rad = H * (0.2 - 0.04 * u) * (0.8 + 0.2 * k);
    if (prev) capsule(path, prev, prevR, w, rad);
    line.push(w);
    prev = w;
    prevR = rad;
  }
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(path);
  ctx.fillStyle = pal.accent;
  ctx.fill(path);
  // A lighter stripe along its top.
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = lighten(pal.accent, 0.3);
  ctx.lineWidth = H * 0.1;
  ctx.beginPath();
  line.forEach((q, i) => {
    const up = at(q, s.headA, { x: 0, y: H * 0.1 });
    if (i === 0) ctx.moveTo(up.x, up.y);
    else ctx.lineTo(up.x, up.y);
  });
  ctx.stroke();
  ctx.restore();
}

/** Dilophosaurus: two thin crests along the top of the head. */
function drawTwinCrest(ctx: Ctx, r: Rig, pal: Palette, o: number, far: boolean) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 0.3 + 0.7 * (1 - r.baby);
  const shift = far ? { x: -0.07 * L, y: 0.06 * H } : { x: 0, y: 0 };
  const pts: V[] = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = lerp(0.04, 0.84, u) * L + shift.x;
    const y = lerp(0.9 * H, r.p.snoutH * 0.95, Math.pow(u, 1.3)) + shift.y;
    pts.push(at(s.headO, s.headA, { x, y: y + Math.pow(Math.sin(Math.PI * u), 0.6) * H * 0.95 * k * (1 - 0.25 * u) }));
  }
  for (let i = N; i >= 0; i--) {
    const u = i / N;
    const x = lerp(0.04, 0.84, u) * L + shift.x;
    const y = lerp(0.9 * H, r.p.snoutH * 0.95, Math.pow(u, 1.3)) + shift.y - H * 0.12;
    pts.push(at(s.headO, s.headA, { x, y }));
  }
  const crestP = new Path2D();
  smoothClosed(crestP, pts, 0.7);
  const color = far ? darken(pal.accent, 0.22) : pal.accent;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(crestP);
  ctx.fillStyle = color;
  ctx.fill(crestP);
  ctx.save();
  ctx.clip(crestP);
  ctx.strokeStyle = far ? darken(pal.pattern, 0.1) : pal.pattern;
  ctx.lineWidth = H * 0.08;
  for (let i = 1; i < 4; i++) {
    const a = at(s.headO, s.headA, { x: (0.08 + i * 0.18) * L + shift.x, y: 0.7 * H });
    const b = at(s.headO, s.headA, { x: (0.14 + i * 0.18) * L + shift.x, y: 1.8 * H });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------- egg ----------------

/**
 * Draws an egg standing on the origin. `crack` 0..1 adds cracks; `wobble` is the tilt in radians.
 * `open` 0..1 lifts the top shell off as it hatches.
 */
export function drawEgg(ctx: Ctx, size: number, pal: Palette, wobble: number, crack: number, open = 0) {
  const w = size * 0.74;
  const h = size;
  const o = Math.max(1.4, size * 0.035);
  const egg = (path: Path2D, top: boolean, bottom: boolean) => {
    // Egg outline: wider at the bottom, pointier at the top.
    const pts: V[] = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const y = -Math.sin(t) * h * 0.5 - h * 0.5;
      const k = y < -h * 0.5 ? 0.88 : 1;
      pts.push({ x: Math.cos(t) * w * 0.5 * k, y });
    }
    const cut = -h * 0.62;
    const sel = pts.filter((q) => (top ? q.y <= cut + 1 : true) && (bottom ? q.y >= cut - 1 : true));
    if (!sel.length) return;
    path.moveTo(sel[0].x, sel[0].y);
    for (const q of sel) path.lineTo(q.x, q.y);
    if (top !== bottom) {
      // Zig-zag crack edge.
      const n = 7;
      for (let i = 0; i <= n; i++) path.lineTo(w * 0.45 - (i / n) * w * 0.9, cut + (i % 2 ? h * 0.05 : -h * 0.03));
    }
    path.closePath();
  };
  ctx.save();
  ctx.rotate(wobble);
  ctx.lineJoin = 'round';
  const shell = lighten(pal.belly, 0.25);
  const drawShell = (path: Path2D) => {
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(path);
    ctx.fillStyle = shell;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = pal.body;
    for (const [sx, sy, sr] of [
      [-0.18, -0.3, 0.1],
      [0.16, -0.5, 0.08],
      [-0.06, -0.72, 0.07],
      [0.22, -0.2, 0.06],
      [-0.25, -0.58, 0.05],
      [0.05, -0.12, 0.05],
    ]) {
      ctx.beginPath();
      ctx.arc(sx * w * 1.2, sy * h, sr * h, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.18, -h * 0.66, w * 0.08, h * 0.14, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  if (open <= 0) {
    const path = new Path2D();
    egg(path, false, false);
    drawShell(path);
    if (crack > 0) {
      ctx.strokeStyle = pal.outline;
      ctx.lineWidth = o;
      ctx.beginPath();
      const n = Math.ceil(crack * 6);
      let x = -w * 0.05;
      let y = -h * 0.95;
      ctx.moveTo(x, y);
      for (let i = 0; i < n; i++) {
        x += (i % 2 ? -1 : 1) * w * 0.09;
        y += h * 0.07;
        ctx.lineTo(x, y);
      }
      if (crack > 0.6) {
        ctx.moveTo(-w * 0.05, -h * 0.95);
        ctx.lineTo(-w * 0.2, -h * 0.82);
        ctx.lineTo(-w * 0.14, -h * 0.72);
      }
      ctx.stroke();
    }
  } else {
    const bottom = new Path2D();
    egg(bottom, false, true);
    drawShell(bottom);
    ctx.save();
    ctx.translate(open * w * 0.6, -open * h * 0.9);
    ctx.rotate(open * 1.4);
    const top = new Path2D();
    egg(top, true, false);
    ctx.globalAlpha = clamp(1.6 - open * 1.6, 0, 1);
    drawShell(top);
    ctx.restore();
  }
  ctx.restore();
}
