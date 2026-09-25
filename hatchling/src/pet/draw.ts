// Draws a rigged dinosaur (and its egg) to a 2D canvas in a flat cartoon style:
// one clean outline around the whole silhouette, lighter belly, species pattern, big eyes.

import { at, clamp, dir, lerp, type V } from './math';
import type { CustomColors } from '../shared/types';
import type { Rig } from './rig';
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
  kind: Variant['pattern_kind'];
}

export function palette(v: Variant): Palette {
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

// ---------------- head geometry (head coordinates: origin = jaw joint, x toward snout, y up) ----------------

function skullPoints(r: Rig, f: Features): V[] {
  const L = r.p.headLen;
  const H = r.p.headH;
  const S = r.p.snoutH;
  const b = r.baby;
  if (f.dome) {
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
  }
  const round = b * 0.45;
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

function jawPoints(r: Rig): V[] {
  const L = r.p.headLen;
  const D = r.p.jawD;
  return [
    { x: -0.02 * L, y: 0.02 * D },
    { x: 0.5 * L, y: 0 },
    { x: 0.9 * L, y: 0 },
    { x: 0.86 * L, y: -D * 0.55 },
    { x: 0.5 * L, y: -D * 0.95 },
    { x: 0.08 * L, y: -D * 0.85 },
  ];
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

  if (opts.shadow) {
    const w = (p.bodyLen + p.hipR * 2) * sc * 0.62;
    const k = clamp(1 - (opts.airborne ?? 0) / 160, 0.25, 1);
    ctx.save();
    ctx.fillStyle = `rgba(20, 16, 30, ${0.16 * k})`;
    ctx.beginPath();
    ctx.ellipse(0, (opts.airborne ?? 0) + 1, w * k, Math.max(2, 3.2 * sc * 0.9) * k, 0, 0, Math.PI * 2);
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

  // Far limbs, behind everything.
  const legPath = (l: (typeof s.legs)[number]) => {
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
  const claws = (l: (typeof s.legs)[number], t2: V) => {
    ctx.fillStyle = pal.outline;
    for (const tip of [l.toe, t2]) {
      const a = Math.atan2(tip.y - l.ball.y, tip.x - l.ball.x);
      const c = new Path2D();
      c.moveTo(tip.x + Math.cos(a + 1.6) * p.legW * 0.14, tip.y + Math.sin(a + 1.6) * p.legW * 0.14);
      c.lineTo(tip.x + Math.cos(a) * p.legW * 0.34, tip.y + Math.sin(a) * p.legW * 0.34 - p.legW * 0.06);
      c.lineTo(tip.x + Math.cos(a - 1.6) * p.legW * 0.14, tip.y + Math.sin(a - 1.6) * p.legW * 0.14);
      ctx.fill(c);
    }
    if (features.sickleClaw) {
      const base = { x: l.ball.x - p.legW * 0.05, y: l.ball.y + p.legW * 0.3 };
      const c = new Path2D();
      c.moveTo(base.x - p.legW * 0.12, base.y);
      c.quadraticCurveTo(base.x + p.legW * 0.1, base.y + p.legW * 0.62, base.x + p.legW * 0.48, base.y + p.legW * 0.38);
      c.quadraticCurveTo(base.x + p.legW * 0.12, base.y + p.legW * 0.36, base.x + p.legW * 0.12, base.y);
      ctx.fill(c);
    }
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
    if (!features.feathers) return;
    const ang = Math.atan2(a.hand.y - a.elbow.y, a.hand.x - a.elbow.x);
    for (let i = 0; i < 5; i++) {
      const base = { x: lerp(a.elbow.x, a.hand.x, i / 4), y: lerp(a.elbow.y, a.hand.y, i / 4) };
      const tip = add2(base, dir(ang - 2.1 - i * 0.08, p.armFore * (0.55 + 0.12 * (4 - Math.abs(2 - i)))));
      const f = new Path2D();
      capsule(f, base, p.armW * 0.55, tip, p.armW * 0.18);
      part(f, color);
    }
  };

  const far = s.legs[1];
  const farLeg = legPath(far);
  part(farLeg.path, pal.far);
  claws(far, farLeg.t2);
  armFeathers(s.arms[1], darken(pal.accent, 0.2));
  part(armPath(s.arms[1]), pal.far);

  // Sail sits behind the body.
  if (features.sail) {
    const sail = new Path2D();
    const a0 = at(s.hip, s.pitch, { x: -p.hipR * 0.4, y: p.hipR * 0.6 });
    const a1 = at(s.chest, s.pitch, { x: p.chestR * 0.2, y: p.chestR * 0.6 });
    const peak = at(s.hip, s.pitch, { x: p.bodyLen * 0.45, y: p.hipR + p.bodyLen * 0.7 });
    sail.moveTo(a0.x, a0.y);
    sail.quadraticCurveTo(peak.x - p.bodyLen * 0.5, peak.y, peak.x, peak.y);
    sail.quadraticCurveTo(peak.x + p.bodyLen * 0.4, peak.y, a1.x, a1.y);
    sail.closePath();
    part(sail, pal.accent);
    ctx.save();
    ctx.clip(sail);
    ctx.strokeStyle = darken(pal.accent, 0.25);
    ctx.lineWidth = o * 0.9;
    for (let i = 1; i < 6; i++) {
      const b = { x: lerp(a0.x, a1.x, i / 6), y: lerp(a0.y, a1.y, i / 6) };
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + (i - 3) * 2, b.y + p.bodyLen);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Main silhouette: tail, torso, neck, head, jaw. Outline everything first, then fill, so
  // the outline only shows around the outside.
  const tail = new Path2D();
  for (let i = 0; i + 1 < s.tail.length; i++) capsule(tail, s.tail[i].p, s.tail[i].r, s.tail[i + 1].p, s.tail[i + 1].r);
  const torso = new Path2D();
  capsule(torso, s.hip, s.hipR, s.chest, s.chestR);
  circle(torso, s.belly, s.bellyR);
  const neck = new Path2D();
  capsule(neck, s.neck[0], p.neckR * 1.15, s.neck[1], p.neckR);
  capsule(neck, s.neck[1], p.neckR, s.neck[2], p.neckR * 0.9);
  const skull = headPath(s.headO, s.headA, skullPoints(r, features));
  const jawA = s.headA + s.jawA;
  const jaw = headPath(s.headO, jawA, jawPoints(r));
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

  const spikes = features.spikes ? spikePath(r) : null;
  const horns = features.horns ? hornPath(r) : null;
  if (spikes) part(spikes, pal.accent);
  if (horns) part(horns, lighten(pal.accent, 0.35));

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
    if (features.teeth) teeth(ctx, r, jawA, open);
  }
  fill(jaw, pal.body);
  fill(skull, pal.body);

  // Belly and pattern, clipped to the silhouette.
  const bodyUnion = new Path2D();
  bodyUnion.addPath(tail);
  bodyUnion.addPath(torso);
  bodyUnion.addPath(neck);
  const headUnion = new Path2D();
  headUnion.addPath(skull);
  headUnion.addPath(jaw);

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
  ctx.restore();

  ctx.save();
  ctx.clip(jaw);
  ctx.fillStyle = pal.belly;
  const jb = new Path2D();
  jb.ellipse(...xy(at(s.headO, jawA, { x: p.headLen * 0.45, y: -p.jawD * 1.0 })), p.headLen * 0.5, p.jawD * 0.62, jawA, 0, Math.PI * 2);
  ctx.fill(jb);
  ctx.restore();

  if (features.dome) {
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
  if (!open && features.teeth && r.growth > 0.45) teeth(ctx, r, jawA, false);

  // Face details.
  const L = p.headLen;
  const H = p.headH;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 1.1;
  if (!open) {
    const m = new Path2D();
    const a0 = at(s.headO, s.headA, { x: 0.3 * L, y: 0.08 * H + r.baby * 0.04 * H });
    const a1 = at(s.headO, s.headA, { x: 0.62 * L, y: 0.01 * H });
    const a2 = at(s.headO, s.headA, { x: 0.93 * L, y: 0.02 * H });
    m.moveTo(a0.x, a0.y);
    m.quadraticCurveTo(a1.x, a1.y, a2.x, a2.y);
    ctx.stroke(m);
  }
  const nose = at(s.headO, s.headA, { x: 0.9 * L, y: p.snoutH * 0.78 });
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  ctx.ellipse(nose.x, nose.y, L * 0.035 + o * 0.3, H * 0.03 + o * 0.25, s.headA - 0.3, 0, Math.PI * 2);
  ctx.fill();

  if (r.baby > 0.25) {
    const ch = at(s.headO, s.headA, { x: (p.eyeX + 0.1) * L, y: (p.eyeY - 0.34) * H });
    ctx.fillStyle = `rgba(255, 120, 140, ${0.3 * Math.min(1, r.baby)})`;
    ctx.beginPath();
    ctx.ellipse(ch.x, ch.y, p.eyeR * 0.9, p.eyeR * 0.5, s.headA, 0, Math.PI * 2);
    ctx.fill();
  }

  eye(ctx, r, pal, features, o);

  if (features.crest || features.feathers) crest(ctx, r, pal, o);

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
  claws(near, nearLeg.t2);
  armFeathers(s.arms[0], pal.accent);
  part(armPath(s.arms[0]), pal.body);

  if (features.feathers) tailFeathers(ctx, r, pal, o);

  ctx.restore();
}

const add2 = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const xy = (q: V): [number, number] => [q.x, q.y];

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

function pattern(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const kind = pal.kind;
  ctx.fillStyle = pal.pattern;
  ctx.strokeStyle = pal.pattern;
  ctx.lineCap = 'round';
  // Points along the back from tail tip to shoulders, with the local "up" direction.
  const spine: { p: V; up: number; r: number }[] = [];
  for (let i = s.tail.length - 2; i >= 1; i--) {
    const a = Math.atan2(s.tail[i - 1].p.y - s.tail[i].p.y, s.tail[i - 1].p.x - s.tail[i].p.x);
    spine.push({ p: s.tail[i].p, up: a + Math.PI / 2, r: s.tail[i].r });
  }
  for (let t = 0; t <= 1.001; t += 0.25) spine.push({ p: { x: lerp(s.hip.x, s.chest.x, t), y: lerp(s.hip.y, s.chest.y, t) }, up: s.pitch + Math.PI / 2, r: lerp(s.hipR, s.chestR, t) });
  if (kind === 'none') return;
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
  const bands = kind === 'bands';
  for (let i = 0; i < spine.length; i++) {
    if (!bands && i % 1 !== 0) continue;
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
  ctx.fillStyle = pal.iris;
  ctx.beginPath();
  ctx.arc(px, py, irisR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#17121c';
  ctx.beginPath();
  if (r.baby < 0.3 && state !== 'wide') ctx.ellipse(px, py, irisR * 0.32, irisR * 0.62, 0, 0, Math.PI * 2);
  else ctx.arc(px, py, irisR * (state === 'wide' ? 0.42 : 0.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px - irisR * 0.32, py + irisR * 0.34, irisR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px + irisR * 0.3, py - irisR * 0.3, irisR * 0.13, 0, Math.PI * 2);
  ctx.fill();
  // Eyelid.
  if (s.lid > 0.02) {
    const lidY = R - s.lid * 2 * R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R + o * 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = pal.body;
    ctx.fillRect(-R - o, lidY, 2 * R + 2 * o, 2 * R + 2 * o);
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 1.2;
    ctx.beginPath();
    ctx.moveTo(-R - o, lidY);
    ctx.lineTo(R + o, lidY);
    ctx.stroke();
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
    const f = new Path2D();
    capsule(f, base, H * 0.11 * (1 - 0.35 * r.baby), tip, H * 0.04);
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(f);
    ctx.fillStyle = i % 2 ? darken(pal.accent, 0.15) : pal.accent;
    ctx.fill(f);
  }
}

function tailFeathers(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const t = r.s.tail;
  const n = t.length;
  const tip = t[n - 1].p;
  const prev = t[n - 2].p;
  const a = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  for (let i = -2; i <= 2; i++) {
    const f = new Path2D();
    const end = add2(tip, dir(a + i * 0.28, r.p.tailLen * 0.16));
    capsule(f, tip, r.p.tailR * 0.22, end, r.p.tailR * 0.1);
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = o * 2;
    ctx.stroke(f);
    ctx.fillStyle = i % 2 ? pal.accent : darken(pal.accent, 0.18);
    ctx.fill(f);
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
