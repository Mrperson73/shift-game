// Special parts of the 1.2 species: wings, feather coats, crests, spines, spikes and claws.
// Same conventions as draw.ts: rig units, y up, `o` is half the outline width.

import { darken, lighten, mix, type Palette } from './colors';
import { at, clamp, dir, lerp, lerpV, rot, type V, wrapAngle } from './math';
import type { ArmOut, LegOut, Rig } from './rig';
import { add2, type Ctx, dorsalAt, horn, smoothClosed, type Station, ventralAt } from './shapes';

/** Outline, then fill, so the outline only shows outside the shape. */
function part(ctx: Ctx, path: Path2D, color: string, pal: Palette, o: number) {
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = o * 2;
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
}

/** A soft pointed tuft (a feather or a lock of fluff) from base to tip. */
function tuft(path: Path2D, base: V, tip: V, w: number) {
  const a = Math.atan2(tip.y - base.y, tip.x - base.x);
  const n = dir(a + Math.PI / 2, w / 2);
  const m = lerpV(base, tip, 0.4);
  path.moveTo(base.x + n.x, base.y + n.y);
  path.quadraticCurveTo(m.x + n.x * 1.15, m.y + n.y * 1.15, tip.x, tip.y);
  path.quadraticCurveTo(m.x - n.x * 1.15, m.y - n.y * 1.15, base.x - n.x, base.y - n.y);
  path.closePath();
}

/** Calls `fn` for the stations with k in [from, to], plus `extra` evenly spaced ones between each pair. */
function along(st: Station[], from: number, to: number, extra: number, fn: (q: Station, i: number) => void) {
  let n = 0;
  let prev: Station | null = null;
  for (const q of st) {
    if (q.k < from || q.k > to) continue;
    if (prev) {
      for (let j = 1; j <= extra; j++) {
        const u = j / (extra + 1);
        fn({ p: lerpV(prev.p, q.p, u), a: prev.a + wrapAngle(q.a - prev.a) * u, up: lerp(prev.up, q.up, u), dn: lerp(prev.dn, q.dn, u), k: lerp(prev.k, q.k, u) }, n++);
      }
    }
    fn(q, n++);
    prev = q;
  }
}

// ---------------- coats and feathers ----------------

/**
 * A shaggy coat: tufts along the back, the throat and the chest, all pointing towards the tail.
 * Outlined and filled with the body colour before the body, so they read as part of its outline.
 * `fluff` scales them (babies are fluffier), `puff` fluffs them up when showing off.
 */
export function coatPaths(st: Station[], fluff: number, puff: number): { back: Path2D; belly: Path2D } {
  const path = new Path2D();
  const belly = new Path2D();
  const grow = 1 + 0.4 * puff;
  along(st, -7.5, 9, 2, (q, i) => {
    const sz = (q.up * 0.36 + 1.6) * fluff * grow * (0.85 + 0.3 * ((i * 7) % 3) / 2);
    const base = dorsalAt(q, -sz * 0.28);
    const tip = add2(base, add2(dir(q.a + Math.PI, sz * 1.3), dir(q.a + Math.PI / 2, sz * 0.45)));
    tuft(path, base, tip, sz * 0.75);
  });
  // The throat, chest and belly: a softer ruff.
  along(st, 0.3, 9, 2, (q, i) => {
    const sz = (q.dn * 0.26 + 1.1) * fluff * grow * (0.8 + 0.4 * ((i * 5) % 3) / 2);
    const base = ventralAt(q, -sz * 0.35);
    const tip = add2(base, add2(dir(q.a + Math.PI, sz * 1.1), dir(q.a - Math.PI / 2, sz * 0.5)));
    tuft(belly, base, tip, sz * 0.7);
  });
  return { back: path, belly };
}

/** Long feathers on the lower legs (Microraptor's hind wings), pointing back. */
export function legFeathers(ctx: Ctx, l: LegOut, r: Rig, pal: Palette, o: number, far: boolean) {
  const path = new Path2D();
  const k = 0.35 + 0.65 * (1 - r.baby);
  const len = r.p.meta * 1.6 * k;
  for (let i = 0; i < 6; i++) {
    const u = i / 5;
    const base = u < 0.5 ? lerpV(l.knee, l.heel, 0.3 + u * 1.2) : lerpV(l.heel, l.ball, (u - 0.5) * 1.4);
    const a = Math.atan2(l.ball.y - l.knee.y, l.ball.x - l.knee.x);
    tuft(path, base, add2(base, dir(a - 1.9 + u * 0.25, len * (0.75 + 0.35 * Math.sin(Math.PI * u)))), r.p.legW * 0.5);
  }
  part(ctx, path, far ? darken(pal.accent, 0.25) : pal.accent, pal, o);
}

// ---------------- wings ----------------

interface WingShape {
  root: V;
  elbow: V;
  wrist: V;
  tip: V;
  /** Where the back edge of the wing meets the body or legs. */
  back: V;
  /** Control point of the curved back edge. */
  ctrl: V;
  /** Direction from the leading edge towards the trailing edge. */
  chord: V;
}

/** Tilt of the view: a little from above, so the far wing shows above the back and the near one below. */
const VIEW = 0.42;

/**
 * An open wing seen from the side (and a little from above). `flap` -1..1 moves it down or up,
 * `spread` 0..1 opens it; closed wings are held up along the back.
 */
function wingShape(r: Rig, near: boolean, spread: number, flap: number): WingShape {
  const s = r.s;
  const p = r.p;
  const arm = r.quad ? p.fThigh + p.fShin + p.fMeta : p.armUpper + p.armFore;
  const finger = r.quad ? (p.fThigh + p.fShin) * 1.45 : p.armFore * 1.6;
  const span = (arm + finger) * (0.3 + 0.7 * spread);
  const phi = flap * 1.05 + (1 - spread) * 0.8;
  const side = near ? -1 : 1;
  // The wing's span direction, projected: up/down from the flap, and the view tilt shows its length.
  const d = rot({ x: -0.16 - 0.1 * spread, y: Math.sin(phi) * Math.cos(VIEW) + side * Math.cos(phi) * Math.sin(VIEW) }, s.pitch);
  const chord = dir(s.pitch + Math.PI, 1);
  const root = at(s.chest, s.pitch, { x: s.chestR * 0.05 + (near ? 0 : -1.5), y: s.chestR * 0.45 });
  const out = (u: number, sweep: number): V => ({ x: root.x + d.x * span * u + chord.x * sweep, y: root.y + d.y * span * u + chord.y * sweep });
  const elbow = out(0.2, -arm * 0.06);
  const wrist = out(0.42, -arm * 0.1);
  const tip = out(1, span * 0.22);
  // Pterosaur wings reach back to the ankles; feathered ones end at the body.
  const membrane = r.species.features.wings !== 'feather';
  const leg = s.legs[near ? 0 : 1];
  const back = membrane ? lerpV(at(s.hip, s.pitch, { x: -s.hipR * 0.1, y: -s.hipR * 0.2 }), leg.heel, clamp(r.pose.fly, 0, 1) * 0.85) : at(s.chest, s.pitch, { x: -p.bodyLen * 0.45, y: 0 });
  const ctrl = lerpV(lerpV(tip, back, 0.5), root, 0.28);
  return { root, elbow, wrist, tip, back, ctrl, chord };
}

/** A skin wing (pterosaurs): the membrane, the arm and the long wing finger along its front edge. */
function membraneWing(ctx: Ctx, w: WingShape, r: Rig, pal: Palette, o: number, far: boolean) {
  const skin = new Path2D();
  skin.moveTo(w.root.x, w.root.y);
  skin.lineTo(w.elbow.x, w.elbow.y);
  skin.lineTo(w.wrist.x, w.wrist.y);
  skin.lineTo(w.tip.x, w.tip.y);
  skin.quadraticCurveTo(w.ctrl.x, w.ctrl.y, w.back.x, w.back.y);
  skin.closePath();
  const base = mix(pal.body, pal.accent, 0.25);
  part(ctx, skin, far ? darken(base, 0.22) : base, pal, o);
  ctx.save();
  ctx.clip(skin);
  // A paler back half and fine fibres fanning out from the finger, like real pterosaur wings.
  ctx.fillStyle = mix(pal.belly, base, 0.45);
  ctx.globalAlpha = far ? 0.35 : 0.55;
  const inner = new Path2D();
  const m1 = lerpV(w.wrist, w.back, 0.45);
  const m2 = lerpV(w.tip, w.ctrl, 0.5);
  inner.moveTo(m1.x, m1.y);
  inner.quadraticCurveTo(lerpV(m1, m2, 0.5).x, lerpV(m1, m2, 0.5).y - 0.5, m2.x, m2.y);
  inner.lineTo(w.tip.x, w.tip.y);
  inner.quadraticCurveTo(w.ctrl.x, w.ctrl.y, w.back.x, w.back.y);
  inner.closePath();
  ctx.fill(inner);
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = darken(base, 0.35);
  ctx.lineWidth = o * 0.7;
  ctx.beginPath();
  for (let i = 1; i <= 5; i++) {
    const a = lerpV(w.wrist, w.tip, i / 6);
    const b = lerpV(w.back, w.ctrl, 0.2 + i * 0.12);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(lerpV(a, b, 0.75).x, lerpV(a, b, 0.75).y);
  }
  ctx.stroke();
  ctx.restore();
  // The bones along the front edge: a thick arm and the thin wing finger.
  const bones = new Path2D();
  const t = r.p.fLegW || r.p.armW;
  boneTo(bones, w.root, w.elbow, t * 0.55, t * 0.42);
  boneTo(bones, w.elbow, w.wrist, t * 0.42, t * 0.3);
  boneTo(bones, w.wrist, w.tip, t * 0.26, t * 0.08);
  part(ctx, bones, far ? darken(pal.body, 0.2) : pal.body, pal, o * 0.8);
}

/** A feathered wing (Microraptor): long flight feathers fanning back from the arm and hand. */
function featherWing(ctx: Ctx, w: WingShape, r: Rig, pal: Palette, o: number, far: boolean) {
  const color = far ? darken(pal.accent, 0.3) : pal.accent;
  const p = r.p;
  const flight = new Path2D();
  const coverts = new Path2D();
  const chordA = Math.atan2(w.chord.y, w.chord.x);
  const spanA = Math.atan2(w.tip.y - w.root.y, w.tip.x - w.root.x);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const base = u < 0.45 ? lerpV(w.elbow, w.wrist, u / 0.45) : lerpV(w.wrist, w.tip, ((u - 0.45) / 0.55) * 0.7);
    // Inner feathers point back; the outer ones swing round towards the wing tip.
    const a = chordA + wrapAngle(spanA - chordA) * Math.pow(u, 1.6) * 0.8;
    const len = p.armFore * lerp(1.15, 1.45, Math.sin(Math.PI * Math.min(1, u * 1.2))) * (0.92 + 0.12 * (i % 2));
    tuft(flight, base, add2(base, dir(a, len)), p.armW * 1.25);
    if (i % 2 === 0) tuft(coverts, base, add2(base, dir(a, len * 0.5)), p.armW * 1.1);
  }
  part(ctx, flight, color, pal, o);
  ctx.fillStyle = far ? darken(pal.body, 0.25) : mix(pal.body, pal.accent, 0.25);
  ctx.fill(coverts);
  const arm = new Path2D();
  boneTo(arm, w.root, w.elbow, p.armW * 1.2, p.armW * 1.0);
  boneTo(arm, w.elbow, w.wrist, p.armW * 1.0, p.armW * 0.75);
  boneTo(arm, w.wrist, lerpV(w.wrist, w.tip, 0.4), p.armW * 0.75, p.armW * 0.35);
  part(ctx, arm, far ? pal.far : pal.body, pal, o * 0.8);
}

/** Adds a tapered bone segment. */
function boneTo(path: Path2D, a: V, b: V, ra: number, rb: number) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const n = dir(ang + Math.PI / 2, 1);
  path.moveTo(a.x + n.x * ra, a.y + n.y * ra);
  path.lineTo(b.x + n.x * rb, b.y + n.y * rb);
  path.arc(b.x, b.y, rb, ang + Math.PI / 2, ang - Math.PI / 2, true);
  path.lineTo(a.x - n.x * ra, a.y - n.y * ra);
  path.arc(a.x, a.y, ra, ang - Math.PI / 2, ang + Math.PI / 2, true);
  path.closePath();
}

/** How open the wings are: flying, or spread wide while showing off. */
export function wingSpread(r: Rig): number {
  return clamp(Math.max(r.pose.fly * 1.2, r.pose.display * 0.85), 0, 1);
}

/** Draws one open wing (flying or showing off). */
export function drawWing(ctx: Ctx, r: Rig, pal: Palette, o: number, near: boolean) {
  const spread = wingSpread(r);
  const flying = r.pose.fly > 0.4;
  const flap = flying ? clamp(r.pose.flap, -1, 1) : 0.55;
  const w = wingShape(r, near, spread, flap);
  if (r.species.features.wings === 'feather') featherWing(ctx, w, r, pal, o, !near);
  else membraneWing(ctx, w, r, pal, o, !near);
}

/**
 * A pterosaur's folded wing while it walks on its hands: the long wing finger runs up from the wrist
 * and back along the flank, with the membrane folded against the side and its tip past the hips.
 * Showing off (`open`), the tip swings up and the wing half opens, like a heron mantling.
 */
export function foldedWing(ctx: Ctx, st: Station[], l: LegOut, r: Rig, pal: Palette, o: number, far: boolean, open = 0) {
  const s = r.s;
  const torso = st.filter((q) => q.k >= 0 && q.k <= 1);
  if (torso.length < 2) return;
  const k = 0.55 + 0.45 * (1 - r.baby);
  const lift = open * 1.1 + (far ? 0.08 : 0);
  // Folded, the wing lies along the flank; opening swings it up around the shoulder.
  const swing = (q: V) => at(l.hip, -lift, { x: q.x - l.hip.x, y: q.y - l.hip.y });
  const tip = swing(at(s.hip, s.pitch, { x: -s.hipR * (1.2 + 0.9 * k + 1.2 * open), y: s.hipR * (0.5 + 0.6 * open) }));
  const top = torso.map((q) => swing(dorsalAt(q, 0.8 + (far ? 1 : 0)))).reverse();
  const mid = torso.map((q) => swing(dorsalAt(q, -(q.up + q.dn) * (0.5 - 0.15 * open))));
  const pts = [l.knee, ...top, tip, ...mid];
  const skin = new Path2D();
  smoothClosed(skin, pts, 0.7);
  const base = mix(pal.body, pal.accent, 0.3);
  part(ctx, skin, far ? darken(base, 0.25) : darken(base, 0.06), pal, o);
  // The wing finger along the top edge, from the wrist up and back to the tip.
  const bone = new Path2D();
  const t = r.p.fLegW;
  boneTo(bone, l.heel, top[0], t * 0.32, t * 0.26);
  for (let i = 1; i < top.length; i++) boneTo(bone, top[i - 1], top[i], t * 0.26, t * 0.22);
  boneTo(bone, top[top.length - 1], tip, t * 0.22, t * 0.08);
  part(ctx, bone, far ? pal.far : pal.body, pal, o * 0.8);
}

// ---------------- heads ----------------

/** Pteranodon: a long, narrow crest sweeping back from the skull. */
export function pteroCrest(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 0.18 + 0.82 * (1 - r.baby);
  const pts = [
    { x: 0.34 * L, y: 0.72 * H },
    { x: 0.14 * L, y: (1.02 + 0.2 * k) * H },
    { x: (-0.18 - 0.5 * k) * L, y: (1.15 + 1.1 * k) * H },
    { x: (-0.24 - 0.5 * k) * L, y: (1.02 + 1.0 * k) * H },
    { x: -0.04 * L, y: 0.55 * H },
  ].map((q) => at(s.headO, s.headA, q));
  const path = new Path2D();
  smoothClosed(path, pts, 0.7);
  part(ctx, path, pal.accent, pal, o);
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = lighten(pal.accent, 0.3);
  ctx.lineWidth = H * 0.12;
  ctx.beginPath();
  const a = at(s.headO, s.headA, { x: 0.1 * L, y: 1.0 * H });
  const b = at(s.headO, s.headA, { x: (-0.14 - 0.45 * k) * L, y: (1.12 + 1.0 * k) * H });
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/** Corythosaurus: a tall, rounded helmet crest. */
export function helmetCrest(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 0.2 + 0.8 * (1 - r.baby);
  const pts = [
    { x: 0.64 * L, y: 0.7 * H },
    { x: 0.55 * L, y: (0.98 + 0.42 * k) * H },
    { x: 0.36 * L, y: (1.02 + 0.95 * k) * H },
    { x: 0.1 * L, y: (0.98 + 1.02 * k) * H },
    { x: -0.1 * L, y: (0.9 + 0.72 * k) * H },
    { x: -0.1 * L, y: 0.62 * H },
    { x: 0.2 * L, y: 0.72 * H },
  ].map((q) => at(s.headO, s.headA, q));
  const path = new Path2D();
  smoothClosed(path, pts, 0.85);
  part(ctx, path, pal.accent, pal, o);
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = lighten(pal.accent, 0.28);
  ctx.lineWidth = H * 0.14;
  ctx.beginPath();
  const c = at(s.headO, s.headA, { x: 0.2 * L, y: 0.9 * H });
  ctx.ellipse(c.x, c.y, L * 0.28 * k + 0.5, H * 0.72 * k + 0.5, s.headA, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();
  ctx.restore();
}

/** Oviraptor: a tall crest (casque) over the snout. */
export function casque(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 0.2 + 0.8 * (1 - r.baby);
  const pts = [
    { x: 0.9 * L, y: 0.62 * H },
    { x: 0.76 * L, y: (0.95 + 0.42 * k) * H },
    { x: 0.52 * L, y: (1.02 + 0.9 * k) * H },
    { x: 0.3 * L, y: (0.98 + 0.7 * k) * H },
    { x: 0.14 * L, y: 0.92 * H },
    { x: 0.5 * L, y: 0.78 * H },
  ].map((q) => at(s.headO, s.headA, q));
  const path = new Path2D();
  smoothClosed(path, pts, 0.8);
  part(ctx, path, pal.accent, pal, o);
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = lighten(pal.accent, 0.3);
  ctx.globalAlpha = 0.6;
  const c = at(s.headO, s.headA, { x: 0.5 * L, y: (1.05 + 0.55 * k) * H });
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, L * 0.12, H * 0.2 * k + 0.4, s.headA - 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Allosaurus: small horns in front of the eyes. */
export function lacrimalHorns(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const p = r.p;
  const k = 0.15 + 0.85 * (1 - r.baby);
  const path = new Path2D();
  horn(path, at(s.headO, s.headA, { x: (p.eyeX + 0.05) * p.headLen, y: p.eyeY * p.headH + p.eyeR * 0.9 }), s.headA + 1.25, p.headH * 0.36 * k + 0.6, p.headLen * 0.1, -0.25);
  part(ctx, path, pal.accent, pal, o);
}

/** Styracosaurus: long spikes around the top of the frill (drawn behind it). */
export function frillSpikes(ctx: Ctx, r: Rig, pal: Palette, o: number) {
  const s = r.s;
  const L = r.p.headLen;
  const H = r.p.headH;
  const k = 1 - 0.45 * r.baby;
  const grown = 1 - r.baby;
  const c = { x: 0.02 * L, y: 0.6 * H };
  const R1 = L * 0.5 * k;
  const R2 = H * 0.86 * k;
  const path = new Path2D();
  [74, 98, 122, 146, 170, 194].forEach((deg, i) => {
    const th = (deg * Math.PI) / 180;
    const base = at(s.headO, s.headA, { x: c.x + Math.cos(th) * R1 * 0.84, y: c.y + Math.sin(th) * R2 * 0.84 });
    const n = s.headA + Math.atan2(Math.sin(th) / R2, Math.cos(th) / R1);
    const len = H * (0.3 + (i >= 1 && i <= 3 ? 1.15 : 0.7) * grown);
    horn(path, base, n, len, H * 0.22, i < 3 ? 0.18 : 0.08);
  });
  part(ctx, path, pal.horn, pal, o);
}

/** Dilophosaurus: a frill around the neck that fans open when it shows off. */
export function neckFrill(ctx: Ctx, r: Rig, pal: Palette, o: number, open: number) {
  if (open < 0.03) return;
  const s = r.s;
  const K = s.neck.length - 1;
  const c = lerpV(s.neck[K - 1], s.neck[K], 0.55);
  const a = Math.atan2(s.neck[K].y - s.neck[K - 1].y, s.neck[K].x - s.neck[K - 1].x);
  const R = r.p.neckR * (1.1 + 3.4 * open) * (0.55 + 0.45 * (1 - r.baby));
  const pts: V[] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const th = a + Math.PI / 2 - 0.2 + ((Math.PI + 0.4) * i) / N;
    pts.push(add2(c, dir(th, R * (i % 2 ? 1 : 0.84))));
  }
  const frill = new Path2D();
  frill.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) frill.lineTo(pts[i].x, pts[i].y);
  frill.lineTo(c.x, c.y);
  frill.closePath();
  part(ctx, frill, pal.accent, pal, o);
  ctx.save();
  ctx.clip(frill);
  ctx.fillStyle = mix(pal.accent, pal.belly, 0.45);
  ctx.beginPath();
  ctx.arc(c.x, c.y, R * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pal.pattern;
  ctx.lineWidth = o * 1.3;
  ctx.beginPath();
  for (let i = 1; i < N; i += 2) {
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------- backs and tails ----------------

/** Small spines along the neck, back and tail (Diplodocus). */
export function dorsalSpines(st: Station[], grown: number): Path2D {
  const path = new Path2D();
  const k = 0.3 + 0.7 * grown;
  along(st, -7.5, 1.9, 1, (q) => {
    const size = Math.max(1.1, (q.up * 0.26 + 0.6) * k);
    horn(path, dorsalAt(q, -size * 0.3), q.a + Math.PI / 2 + 0.4, size, size * 0.95, 0.25);
  });
  return path;
}

/** Amargasaurus: two rows of tall spines down the neck, joined by skin. */
export function neckSpines(ctx: Ctx, st: Station[], pal: Palette, o: number, grown: number, far: boolean, display: number) {
  const k = 0.25 + 0.75 * grown;
  const path = new Path2D();
  const bases: V[] = [];
  const tips: V[] = [];
  along(st, 1.05, 2, 2, (q) => {
    const u = clamp((q.k - 1.05) / 0.95, 0, 1);
    const h = (q.up * 1.0 + 4) * (0.7 + 2.8 * Math.sin(Math.PI * clamp(u * 0.85 + 0.12, 0, 1))) * k;
    const base = dorsalAt(q, -q.up * 0.3);
    const lean = q.a + Math.PI / 2 + 0.42 + (far ? 0.12 : 0);
    const tip = add2(base, dir(lean, h));
    horn(path, base, lean, h, Math.max(0.9, q.up * 0.22), 0.08);
    bases.push(base);
    tips.push(tip);
  });
  if (!far && tips.length > 1) {
    const sail = new Path2D();
    sail.moveTo(bases[0].x, bases[0].y);
    for (const t of tips) sail.lineTo(t.x, t.y);
    for (let i = bases.length - 1; i >= 0; i--) sail.lineTo(bases[i].x, bases[i].y);
    sail.closePath();
    ctx.fillStyle = mix(pal.accent, pal.body, 0.4);
    ctx.globalAlpha = 0.35 + 0.5 * display;
    ctx.fill(sail);
    ctx.globalAlpha = 1;
  }
  part(ctx, path, far ? darken(pal.accent, 0.25) : pal.accent, pal, o);
}

/** Kentrosaurus: long paired spikes over the hips and down the tail. */
export function spikeRow(ctx: Ctx, st: Station[], pal: Palette, o: number, grown: number, far: boolean) {
  const k = 0.3 + 0.7 * grown;
  const path = new Path2D();
  along(st, -6.5, 0.45, 0, (q) => {
    const peak = q.k < 0 ? 1 - Math.min(1, -q.k / 7) * 0.5 : 1 - q.k * 0.3;
    const h = Math.max(2, (q.up * 0.55 + 7) * peak * k);
    horn(path, dorsalAt(q, -q.up * 0.2), q.a + Math.PI / 2 + 0.55 + (far ? 0.18 : 0), h, Math.max(1.4, h * 0.22), 0.1);
  });
  part(ctx, path, far ? pal.hornDark : pal.horn, pal, o);
}

/** Kentrosaurus: a long spike from each shoulder, pointing back. */
export function shoulderSpike(ctx: Ctx, r: Rig, pal: Palette, o: number, far: boolean) {
  const s = r.s;
  const k = 0.25 + 0.75 * (1 - r.baby);
  const path = new Path2D();
  const base = at(s.chest, s.pitch, { x: -s.chestR * 0.25 - (far ? 1.5 : 0), y: s.chestR * (far ? 0.3 : 0.08) });
  horn(path, base, s.pitch + Math.PI - 0.5 + (far ? 0.12 : 0), s.chestR * 1.75 * k, s.chestR * 0.42, -0.15);
  part(ctx, path, far ? pal.hornDark : pal.horn, pal, o);
}

/** Crocodilians: a serrated ridge of keeled scutes along the back, taller down the tail. */
export function osteoRidge(st: Station[], grown: number): Path2D {
  const path = new Path2D();
  const k = 0.35 + 0.65 * grown;
  along(st, -8.5, 1.4, 1, (q) => {
    const tail = q.k < 0 ? clamp(-q.k / 8, 0, 1) : 0;
    const h = (q.up * (0.12 + 0.3 * tail) + 0.7) * k;
    horn(path, dorsalAt(q, -h * 0.35), q.a + Math.PI / 2 + 0.2, h, h * 1.4, 0);
  });
  return path;
}

// ---------------- hands ----------------

/** Therizinosaurus: three huge, curved hand claws. */
export function scytheClaws(ctx: Ctx, a: ArmOut, r: Rig, pal: Palette, o: number, far: boolean) {
  const p = r.p;
  const k = 0.3 + 0.7 * (1 - r.baby);
  const ang = Math.atan2(a.hand.y - a.elbow.y, a.hand.x - a.elbow.x);
  const path = new Path2D();
  for (let i = 0; i < 3; i++) {
    const base = add2(a.hand, dir(ang + Math.PI / 2, p.armW * (0.4 - i * 0.35)));
    horn(path, base, ang + 0.1 - i * 0.22, p.armFore * (i === 1 ? 1.05 : 0.88) * k, p.armW * 1.05, -0.8);
  }
  part(ctx, path, far ? pal.hornDark : lighten(pal.horn, 0.1), pal, o);
}

/** Iguanodon: a conical spike on each thumb, pointing up and forward from the wrist. */
export function thumbSpike(ctx: Ctx, l: LegOut, r: Rig, pal: Palette, o: number, far: boolean) {
  const k = 0.3 + 0.7 * (1 - r.baby);
  const path = new Path2D();
  horn(path, lerpV(l.heel, l.ball, 0.3), 1.15, r.p.fLegW * 1.3 * k, r.p.fLegW * 0.55, 0.15);
  part(ctx, path, far ? pal.hornDark : pal.horn, pal, o);
}
