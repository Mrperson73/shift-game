// Draws a rigged dinosaur (and its egg) to a 2D canvas in a flat cartoon style:
// one clean outline around the whole silhouette, lighter belly, species pattern, soft shading, big eyes.

import type { CustomColors } from '../shared/types';
import { at, clamp, dir, lerp, type V } from './math';
import type { LegOut, Rig } from './rig';
import type { Features, SpeciesDef, Variant } from './species';

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

function circle(path: Path2D, c: V, r: number) {
  path.moveTo(c.x + r, c.y);
  path.arc(c.x, c.y, r, 0, Math.PI * 2);
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

/** Points along the back, from near the tail tip forward to the neck, with the local "up" direction. */
function spinePoints(r: Rig, tailFrom = r.s.tail.length - 2, neck = false): { p: V; up: number; r: number; k: number }[] {
  const s = r.s;
  const out: { p: V; up: number; r: number; k: number }[] = [];
  for (let i = tailFrom; i >= 1; i--) {
    const a = Math.atan2(s.tail[i - 1].p.y - s.tail[i].p.y, s.tail[i - 1].p.x - s.tail[i].p.x);
    out.push({ p: s.tail[i].p, up: a + Math.PI / 2, r: s.tail[i].r, k: -i });
  }
  for (let t = 0; t <= 1.001; t += 0.25) out.push({ p: { x: lerp(s.hip.x, s.chest.x, t), y: lerp(s.hip.y, s.chest.y, t) }, up: s.pitch + Math.PI / 2, r: lerp(s.hipR, s.chestR, t), k: t });
  if (neck) {
    for (let i = 1; i < s.neck.length; i++) {
      const a = Math.atan2(s.neck[i].y - s.neck[i - 1].y, s.neck[i].x - s.neck[i - 1].x);
      out.push({ p: s.neck[i], up: a + Math.PI / 2, r: s.neckR, k: 1 + i });
    }
  }
  return out;
}

// ---------------- head geometry (head coordinates: origin = jaw joint, x toward snout, y up) ----------------

type HeadKind = 'default' | 'dome' | 'croc' | 'duck' | 'cera';

function headKind(f: Features): HeadKind {
  if (f.dome) return 'dome';
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
    ctx.ellipse(r.quad ? (p.bodyLen * 0.45 * sc * r.face) : 0, (opts.airborne ?? 0) + 1, w * k, Math.max(2, 3.2 * sc * 0.9) * k, 0, 0, Math.PI * 2);
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

  // ---- limbs ----
  const sharp = !!f.teeth;
  const legPath = (l: LegOut) => {
    const w = p.legW;
    const path = new Path2D();
    capsule(path, l.hip, w, l.knee, w * 0.56);
    capsule(path, l.knee, w * 0.5, l.heel, w * 0.3);
    capsule(path, l.heel, w * 0.32, l.ball, w * 0.28);
    capsule(path, l.ball, w * 0.3, l.toe, w * 0.16);
    const t2 = at(l.ball, Math.atan2(l.toe.y - l.ball.y, l.toe.x - l.ball.x) + 0.35, { x: p.toe * 0.8, y: 0 });
    capsule(path, l.ball, w * 0.26, t2, w * 0.14);
    return { path, t2 };
  };
  const frontPath = (l: LegOut) => {
    const w = p.fLegW;
    const path = new Path2D();
    capsule(path, l.hip, w, l.knee, w * 0.66);
    capsule(path, l.knee, w * 0.62, l.heel, w * 0.46);
    capsule(path, l.heel, w * 0.46, l.ball, w * 0.44);
    capsule(path, l.ball, w * 0.44, l.toe, w * 0.3);
    return path;
  };
  const claws = (l: LegOut, t2: V, w: number) => {
    const tips = [l.toe, t2];
    if (sharp) {
      ctx.fillStyle = pal.outline;
      for (const tip of tips) {
        const a = Math.atan2(tip.y - l.ball.y, tip.x - l.ball.x);
        const c = new Path2D();
        c.moveTo(tip.x + Math.cos(a + 1.6) * w * 0.14, tip.y + Math.sin(a + 1.6) * w * 0.14);
        c.lineTo(tip.x + Math.cos(a) * w * 0.34, tip.y + Math.sin(a) * w * 0.34 - w * 0.06);
        c.lineTo(tip.x + Math.cos(a - 1.6) * w * 0.14, tip.y + Math.sin(a - 1.6) * w * 0.14);
        ctx.fill(c);
      }
    } else nails(tips, l.ball, w);
    if (f.sickleClaw) {
      ctx.fillStyle = pal.outline;
      const base = { x: l.ball.x - w * 0.05, y: l.ball.y + w * 0.3 };
      const c = new Path2D();
      c.moveTo(base.x - w * 0.12, base.y);
      c.quadraticCurveTo(base.x + w * 0.1, base.y + w * 0.62, base.x + w * 0.48, base.y + w * 0.38);
      c.quadraticCurveTo(base.x + w * 0.12, base.y + w * 0.36, base.x + w * 0.12, base.y);
      ctx.fill(c);
    }
  };
  /** Blunt, rounded nails (plant-eaters). */
  const nails = (tips: V[], from: V, w: number) => {
    for (const tip of tips) {
      const a = Math.atan2(tip.y - from.y, tip.x - from.x);
      const c = new Path2D();
      c.ellipse(tip.x + Math.cos(a) * w * 0.05, tip.y + Math.sin(a) * w * 0.05, w * 0.2, w * 0.14, a, 0, Math.PI * 2);
      ctx.fillStyle = pal.horn;
      ctx.strokeStyle = pal.outline;
      ctx.lineWidth = o * 0.9;
      ctx.stroke(c);
      ctx.fill(c);
    }
  };
  const frontNails = (l: LegOut) => {
    const w = p.fLegW;
    const a = Math.atan2(l.toe.y - l.ball.y, l.toe.x - l.ball.x);
    nails([add2(l.toe, dir(a + 1.2, w * 0.12)), add2(l.toe, dir(a - 0.3, w * 0.08))], l.ball, w);
  };
  const armPath = (a: (typeof s.arms)[number]) => {
    const w = p.armW;
    const path = new Path2D();
    capsule(path, a.shoulder, w, a.elbow, w * 0.8);
    capsule(path, a.elbow, w * 0.8, a.hand, w * 0.6);
    const ang = Math.atan2(a.hand.y - a.elbow.y, a.hand.x - a.elbow.x);
    capsule(path, a.hand, w * 0.5, add2(a.hand, dir(ang + 0.5, w * 1.2)), w * 0.25);
    capsule(path, a.hand, w * 0.5, add2(a.hand, dir(ang - 0.3, w * 1.3)), w * 0.25);
    return path;
  };
  const armFeathers = (a: (typeof s.arms)[number], color: string) => {
    if (!f.feathers) return;
    const ang = Math.atan2(a.hand.y - a.elbow.y, a.hand.x - a.elbow.x);
    for (let i = 0; i < 5; i++) {
      const base = { x: lerp(a.elbow.x, a.hand.x, i / 4), y: lerp(a.elbow.y, a.hand.y, i / 4) };
      const tip = add2(base, dir(ang - 2.1 - i * 0.08, p.armFore * (0.55 + 0.12 * (4 - Math.abs(2 - i)))));
      const fe = new Path2D();
      capsule(fe, base, p.armW * 0.55, tip, p.armW * 0.18);
      part(fe, color);
    }
  };

  // Far limbs, behind everything.
  const farLeg = legPath(s.legs[1]);
  part(farLeg.path, pal.far);
  claws(s.legs[1], farLeg.t2, p.legW);
  if (s.fronts.length) {
    part(frontPath(s.fronts[1]), pal.far);
    frontNails(s.fronts[1]);
  }
  if (s.arms.length) {
    armFeathers(s.arms[1], darken(pal.accent, 0.2));
    part(armPath(s.arms[1]), pal.far);
  }

  // ---- features behind the body ----
  if (f.sail) drawSail(ctx, r, pal, o);
  if (f.plates) {
    drawPlates(ctx, r, pal, o, true);
    drawPlates(ctx, r, pal, o, false);
  }
  if (f.finTail) drawFin(ctx, r, pal, o);
  if (f.thagomizer) drawThagomizer(ctx, r, pal, o, true);
  if (f.spikes) part(spikePath(r), pal.accent);
  if (f.armor) part(armorSpikes(r), pal.horn);
  if (f.horns) part(hornPath(r), lighten(pal.accent, 0.35));

  // ---- main silhouette: outline everything first, then fill, so the outline only shows outside ----
  const tail = new Path2D();
  for (let i = 0; i + 1 < s.tail.length; i++) capsule(tail, s.tail[i].p, s.tail[i].r, s.tail[i + 1].p, s.tail[i + 1].r);
  const torso = new Path2D();
  capsule(torso, s.hip, s.hipR, s.chest, s.chestR);
  circle(torso, s.belly, s.bellyR);
  const neck = new Path2D();
  capsule(neck, s.neck[0], p.neckR * 1.15, s.neck[1], p.neckR);
  capsule(neck, s.neck[1], p.neckR, s.neck[2], p.neckR * 0.9);
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

  for (const path of [tail, torso, neck, skull, jaw]) outlineOf(path);
  if (mouth) outlineOf(mouth);
  for (const path of [tail, torso, neck]) fill(path, pal.body);
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
  const bodyUnion = new Path2D();
  bodyUnion.addPath(tail);
  bodyUnion.addPath(torso);
  bodyUnion.addPath(neck);
  ctx.save();
  ctx.clip(bodyUnion);
  ctx.fillStyle = pal.belly;
  const bellyPath = new Path2D();
  for (let i = 1; i < s.tail.length - 3; i++) circle(bellyPath, { x: s.tail[i].p.x, y: s.tail[i].p.y - s.tail[i].r * 0.8 }, s.tail[i].r * 0.62);
  circle(bellyPath, at(s.belly, s.pitch, { x: 0, y: -s.bellyR * 0.3 }), s.bellyR * 0.85);
  circle(bellyPath, at(s.chest, s.pitch, { x: s.chestR * 0.2, y: -s.chestR * 0.5 }), s.chestR * 0.7);
  circle(bellyPath, at(s.hip, s.pitch, { x: 0, y: -s.hipR * 0.62 }), s.hipR * 0.6);
  for (const n of s.neck) circle(bellyPath, at(n, s.headA - 0.4, { x: 0.3 * p.neckR, y: -p.neckR * 0.72 }), p.neckR * 0.6);
  ctx.fill(bellyPath);
  pattern(ctx, r, pal, o);
  if (f.armor) scutes(ctx, r, pal, o);
  shade(ctx, s.bounds);
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

  const headUnion = new Path2D();
  headUnion.addPath(skull);
  headUnion.addPath(jaw);

  ctx.save();
  ctx.clip(jaw);
  ctx.fillStyle = pal.belly;
  const jb = new Path2D();
  jb.ellipse(...xy(at(s.headO, jawA, { x: p.headLen * 0.45, y: -p.jawD * 1.0 })), p.headLen * 0.5, p.jawD * 0.62, jawA, 0, Math.PI * 2);
  ctx.fill(jb);
  ctx.restore();

  // Beaks: a horny tip on the snout and the lower jaw.
  if (f.beak || f.duckBill) {
    const kind = headKind(f);
    const b0 = kind === 'cera' ? 0.74 : kind === 'duck' ? 0.8 : 0.76;
    const L = p.headLen;
    ctx.save();
    ctx.clip(headUnion);
    ctx.fillStyle = pal.horn;
    const bk = new Path2D();
    const q1 = at(s.headO, s.headA, { x: (b0 + 0.06) * L, y: p.headH * 1.4 });
    const q2 = at(s.headO, s.headA, { x: b0 * L, y: p.snoutH * 0.4 });
    const q3 = at(s.headO, jawA, { x: (b0 - 0.04) * L, y: -p.jawD * 1.5 });
    const far1 = at(s.headO, s.headA, { x: 1.5 * L, y: p.headH * 1.4 });
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
    ctx.restore();
  }

  ctx.save();
  ctx.clip(headUnion);
  shade(ctx, { x1: s.bounds.x1, x2: s.bounds.x2, y1: Math.min(s.headO.y, s.top.y) - p.jawD * 1.5, y2: s.top.y + 2 });
  ctx.restore();

  if (f.dome) {
    ctx.save();
    ctx.clip(skull);
    ctx.fillStyle = pal.accent;
    const dc = at(s.headO, s.headA, { x: p.headLen * 0.24, y: p.headH * 1.02 });
    ctx.beginPath();
    ctx.ellipse(dc.x, dc.y, p.headLen * 0.46, p.headH * 0.5, s.headA - 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = darken(pal.accent, 0.35);
    ctx.lineWidth = o * 1.1;
    ctx.beginPath();
    ctx.ellipse(dc.x, dc.y, p.headLen * 0.46, p.headH * 0.5, s.headA - 0.1, Math.PI * 0.95, Math.PI * 2.05, true);
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
      const k = at(s.headO, s.headA, { x: q.x * p.headLen, y: q.y * p.headH });
      ctx.beginPath();
      ctx.arc(k.x, k.y, p.headH * 0.055 + o * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tooth tips peeking out on grown-ups.
  if (!open && f.teeth && r.growth > 0.45) teeth(ctx, r, jawA, false);

  // Face details.
  const L = p.headLen;
  const H = p.headH;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 1.1;
  if (!open) {
    const m = new Path2D();
    const smile = r.eyes === 'happy' ? 0.05 * H : 0;
    const a0 = at(s.headO, s.headA, { x: 0.3 * L, y: 0.08 * H + r.baby * 0.04 * H + smile });
    const a1 = at(s.headO, s.headA, { x: 0.62 * L, y: 0.01 * H - smile * 0.5 });
    const a2 = at(s.headO, s.headA, { x: (headKind(f) === 'croc' ? 0.97 : 0.93) * L, y: 0.02 * H });
    m.moveTo(a0.x, a0.y);
    m.quadraticCurveTo(a1.x, a1.y, a2.x, a2.y);
    ctx.stroke(m);
  }
  const noseX = headKind(f) === 'croc' ? 0.52 : headKind(f) === 'duck' ? 0.8 : 0.9;
  const nose = at(s.headO, s.headA, { x: noseX * L, y: p.snoutH * (headKind(f) === 'croc' ? 1.0 : 0.78) });
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  ctx.ellipse(nose.x, nose.y, L * 0.035 + o * 0.3, H * 0.03 + o * 0.25, s.headA - 0.3, 0, Math.PI * 2);
  ctx.fill();

  if (r.baby > 0.25 || r.eyes === 'happy') {
    const ch = at(s.headO, s.headA, { x: (p.eyeX + 0.1) * L, y: (p.eyeY - 0.34) * H });
    ctx.fillStyle = `rgba(255, 120, 140, ${0.32 * Math.max(Math.min(1, r.baby), r.eyes === 'happy' ? 0.7 : 0)})`;
    ctx.beginPath();
    ctx.ellipse(ch.x, ch.y, p.eyeR * 0.9, p.eyeR * 0.5, s.headA, 0, Math.PI * 2);
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

  // Near leg and arm on top.
  const near = s.legs[0];
  const nearLeg = legPath(near);
  part(nearLeg.path, pal.body);
  ctx.save();
  ctx.clip(nearLeg.path);
  ctx.fillStyle = mix(pal.body, pal.belly, 0.35);
  const thighShade = new Path2D();
  circle(thighShade, { x: lerp(near.hip.x, near.knee.x, 0.5) - p.legW * 0.1, y: lerp(near.hip.y, near.knee.y, 0.5) - p.legW * 0.55 }, p.legW * 0.55);
  ctx.globalAlpha = 0.5;
  ctx.fill(thighShade);
  ctx.globalAlpha = 1;
  if (pal.kind !== 'none') {
    ctx.fillStyle = pal.pattern;
    ctx.globalAlpha = 0.55;
    const st = new Path2D();
    capsule(st, { x: near.hip.x - p.legW * 0.6, y: near.hip.y + p.legW * 0.5 }, p.legW * 0.25, { x: near.hip.x + p.legW * 0.1, y: near.hip.y - p.legW * 0.2 }, p.legW * 0.14);
    ctx.fill(st);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  claws(near, nearLeg.t2, p.legW);
  if (s.fronts.length) {
    const fl = frontPath(s.fronts[0]);
    part(fl, pal.body);
    ctx.save();
    ctx.clip(fl);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = mix(pal.body, pal.belly, 0.35);
    const sh = new Path2D();
    circle(sh, { x: lerp(s.fronts[0].hip.x, s.fronts[0].knee.x, 0.5) + p.fLegW * 0.1, y: lerp(s.fronts[0].hip.y, s.fronts[0].knee.y, 0.5) - p.fLegW * 0.5 }, p.fLegW * 0.5);
    ctx.fill(sh);
    ctx.restore();
    frontNails(s.fronts[0]);
  }
  if (s.arms.length) {
    armFeathers(s.arms[0], pal.accent);
    part(armPath(s.arms[0]), pal.body);
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
  g.addColorStop(0, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(20,10,30,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(b.x1 - 5, b.y1 - 5, b.x2 - b.x1 + 10, b.y2 - b.y1 + 10);
}

function teeth(ctx: Ctx, r: Rig, jawA: number, open: boolean) {
  const s = r.s;
  const L = r.p.headLen;
  const tSize = Math.max(0.9, L * 0.045);
  ctx.fillStyle = '#fbf6e9';
  const n = open ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const x = open ? 0.36 + i * 0.1 : 0.5 + i * 0.16;
    const base = at(s.headO, s.headA, { x: x * L, y: 0.01 * r.p.headH });
    const tip = at(s.headO, s.headA, { x: x * L + tSize * 0.2, y: -tSize * (open ? 1.5 : 1.25) });
    const side = at(s.headO, s.headA, { x: x * L + tSize, y: 0.01 * r.p.headH });
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(side.x, side.y);
    ctx.closePath();
    ctx.fill();
  }
  if (!open) return;
  for (let i = 0; i < 5; i++) {
    const x = 0.4 + i * 0.1;
    const base = at(s.headO, jawA, { x: x * L, y: -0.02 * r.p.jawD });
    const tip = at(s.headO, jawA, { x: x * L + tSize * 0.4, y: tSize * 1.2 });
    const side = at(s.headO, jawA, { x: x * L + tSize, y: -0.02 * r.p.jawD });
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(side.x, side.y);
    ctx.closePath();
    ctx.fill();
  }
}

/** Deterministic pseudo-random 0..1 from an integer, for patterns that don't flicker. */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function pattern(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const kind = pal.kind;
  if (kind === 'none') return;
  ctx.fillStyle = pal.pattern;
  ctx.strokeStyle = pal.pattern;
  ctx.lineCap = 'round';
  const spine = spinePoints(r);
  if (kind === 'spots') {
    for (let i = 1; i < spine.length; i += 1) {
      const q = spine[i];
      const c = add2(q.p, dir(q.up, q.r * 0.55));
      const rr = Math.max(o * 1.2, q.r * 0.2);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rr * 1.2, rr, q.up, 0, Math.PI * 2);
      ctx.fill();
      if (i % 2 === 0) {
        const c2 = add2(q.p, dir(q.up + 0.5, q.r * 0.8));
        ctx.beginPath();
        ctx.arc(c2.x, c2.y, rr * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }
  if (kind === 'rosettes') {
    // Broken rings with a darker-than-body centre, like a leopard.
    const inner = mix(pal.body, pal.pattern, 0.35);
    for (let i = 1; i < spine.length; i++) {
      const q = spine[i];
      for (const [off, sz] of [
        [0.55, 0.24],
        [0.05, 0.18],
      ] as const) {
        if (off < 0.3 && i % 2) continue;
        const c = add2(q.p, dir(q.up + (i % 2 ? 0.25 : -0.2), q.r * off));
        const rr = Math.max(o * 1.6, q.r * sz);
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rr, rr * 0.8, q.up, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(o * 0.9, rr * 0.34);
        ctx.setLineDash([rr * 0.9, rr * 0.45]);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rr, rr * 0.8, q.up, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    return;
  }
  if (kind === 'speckles') {
    for (let i = 0; i < spine.length; i++) {
      const q = spine[i];
      for (let k = 0; k < 4; k++) {
        const h1 = hash(i * 7 + k);
        const h2 = hash(i * 13 + k * 3 + 1);
        const c = add2(q.p, dir(q.up + (h1 - 0.5) * 1.6, q.r * (0.25 + 0.65 * h2)));
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(o * 0.8, q.r * (0.06 + 0.06 * hash(i + k * 5))), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }
  if (kind === 'saddle') {
    // A dark saddle over the back, fading at the edges.
    const pts = spine.filter((q) => q.k > -5);
    for (const [w, alpha] of [
      [0.95, 0.35],
      [0.7, 1],
    ] as const) {
      ctx.globalAlpha = alpha;
      const path = new Path2D();
      pts.forEach((q, i) => {
        const c = add2(q.p, dir(q.up, q.r * 0.95));
        if (i === 0) path.moveTo(c.x, c.y);
        else path.lineTo(c.x, c.y);
      });
      ctx.lineWidth = Math.max(o * 2, (s.hipR + s.chestR) * 0.5 * w);
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    return;
  }
  const bands = kind === 'bands';
  for (let i = 0; i < spine.length; i++) {
    const q = spine[i];
    const w = Math.max(o * 1.4, q.r * (bands ? 0.32 : 0.26));
    ctx.lineWidth = w;
    const a = add2(q.p, dir(q.up, q.r * 1.1));
    const b = add2(q.p, dir(q.up - 0.2, q.r * (bands ? -0.1 : 0.35)));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
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

function spikePath(r: Rig): Path2D {
  const s = r.s;
  const path = new Path2D();
  const pts: { p: V; up: number; r: number }[] = [];
  for (let i = 1; i < s.tail.length - 2; i++) {
    const a = Math.atan2(s.tail[i - 1].p.y - s.tail[i].p.y, s.tail[i - 1].p.x - s.tail[i].p.x);
    pts.push({ p: s.tail[i].p, up: a + Math.PI / 2, r: s.tail[i].r });
  }
  for (let t = 0; t <= 1; t += 0.34) pts.push({ p: { x: lerp(s.hip.x, s.chest.x, t), y: lerp(s.hip.y, s.chest.y, t) }, up: s.pitch + Math.PI / 2, r: lerp(s.hipR, s.chestR, t) });
  for (const q of pts) {
    const base = add2(q.p, dir(q.up, q.r * 0.85));
    const tip = add2(q.p, dir(q.up + 0.35, q.r * 0.85 + Math.max(2.5, q.r * 0.55)));
    const side = q.r * 0.28 + 1;
    const b1 = add2(base, dir(q.up + Math.PI / 2, side));
    const b2 = add2(base, dir(q.up - Math.PI / 2, side));
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
function drawSail(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const p = r.p;
  const k = 0.3 + 0.7 * (1 - r.baby);
  const pts = spinePoints(r, 2).filter((q) => q.k >= -2);
  const n = pts.length;
  const top: V[] = [];
  const base: V[] = [];
  pts.forEach((q, i) => {
    const u = i / (n - 1);
    const h = (p.bodyLen * 0.95 * Math.pow(Math.sin(Math.PI * clamp(u * 0.95 + 0.03, 0, 1)), 0.8) + 1) * k;
    base.push(add2(q.p, dir(q.up, q.r * 0.6)));
    top.push(add2(q.p, dir(q.up - 0.08, q.r * 0.6 + h)));
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
  ctx.save();
  ctx.clip(sail);
  // Lighter skin near the top, darker spines.
  ctx.fillStyle = lighten(pal.accent, 0.18);
  const glow = new Path2D();
  for (let i = 0; i < n; i++) circle(glow, top[i], p.bodyLen * 0.18 * k);
  ctx.fill(glow);
  ctx.strokeStyle = darken(pal.accent, 0.25);
  ctx.lineWidth = o * 0.9;
  for (let i = 1; i < n - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(base[i].x, base[i].y);
    ctx.lineTo(top[i].x, top[i].y);
    ctx.stroke();
  }
  ctx.restore();
  void s;
}

/** Stegosaurus plates: two alternating rows along the back, biggest over the hips. */
function drawPlates(ctx: Ctx, r: Rig, pal: Palette, o: number, far: boolean) {
  const p = r.p;
  const k = 0.3 + 0.7 * (1 - r.baby);
  const pts = spinePoints(r, 6, true);
  const color = far ? darken(pal.accent, 0.2) : pal.accent;
  ctx.lineJoin = 'round';
  pts.forEach((q, i) => {
    if ((i % 2 === 0) !== far) return;
    // Height profile: small on the neck and tail, tallest just in front of the hips.
    const x = q.k; // -6..-1 tail, 0..1 torso, 2..3 neck
    const peak = x < 0 ? 1 - Math.min(1, -x / 7) * 0.75 : x <= 1 ? 1 - x * 0.35 : 0.5 - (x - 1) * 0.12;
    const h = Math.max(2, p.hipR * 1.05 * peak * k);
    const w = h * 0.62;
    const base = add2(q.p, dir(q.up, q.r * 0.7));
    const ang = q.up + (far ? 0.12 : 0.02);
    const tip = add2(base, dir(ang, h));
    const mid = add2(base, dir(ang, h * 0.42));
    const side = dir(ang + Math.PI / 2, w / 2);
    const plate = new Path2D();
    plate.moveTo(base.x + side.x * 0.45, base.y + side.y * 0.45);
    plate.quadraticCurveTo(mid.x + side.x * 1.3, mid.y + side.y * 1.3, tip.x, tip.y);
    plate.quadraticCurveTo(mid.x - side.x * 1.3, mid.y - side.y * 1.3, base.x - side.x * 0.45, base.y - side.y * 0.45);
    plate.closePath();
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(plate);
    ctx.fillStyle = color;
    ctx.fill(plate);
    ctx.save();
    ctx.clip(plate);
    ctx.fillStyle = lighten(color, 0.22);
    ctx.beginPath();
    ctx.ellipse(mid.x - side.x * 0.2, mid.y - side.y * 0.2, w * 0.26, h * 0.3, ang, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
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
function armorSpikes(r: Rig): Path2D {
  const path = new Path2D();
  const k = 0.35 + 0.65 * (1 - r.baby);
  for (const q of spinePoints(r, 5)) {
    const base = add2(q.p, dir(q.up + 0.25, q.r * 0.82));
    horn(path, base, q.up + 0.55, Math.max(1.5, q.r * 0.42 * k), q.r * 0.34, 0);
  }
  return path;
}

/** Ankylosaurus: bony plates (osteoderms) in rows over the back. */
function scutes(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const fillC = mix(pal.accent, pal.body, 0.35);
  ctx.strokeStyle = darken(pal.body, 0.35);
  ctx.lineWidth = o * 0.8;
  for (const q of spinePoints(r, 6)) {
    for (const [off, sz] of [
      [0.62, 0.2],
      [0.22, 0.16],
    ] as const) {
      const c = add2(q.p, dir(q.up, q.r * off));
      const rr = Math.max(o * 1.5, q.r * sz);
      ctx.fillStyle = fillC;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rr * 1.2, rr * 0.85, q.up - Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
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
