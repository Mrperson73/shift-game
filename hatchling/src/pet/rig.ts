// Procedural 2D skeleton for a bipedal dinosaur, side view.
// Local coordinates: origin on the ground under the hips, x forward (facing right), y up.
// Behaviours only set a target pose, speed and look target; the rig animates everything else
// (walk cycle without foot sliding, tail physics, blinking, breathing, turning).

import { babyness, morphBody, sizeOf } from './growth';
import { add, approach, at, clamp, dir, ik2, lerp, lerpV, type V, wrapAngle } from './math';
import type { BodyParams, SpeciesDef } from './species';

export type EyeState = 'open' | 'closed' | 'happy' | 'wide' | 'dizzy' | 'sleepy';
export type LegMode = 'gait' | 'fold' | 'air' | 'held' | 'flail';

export interface Pose {
  /** 0 standing .. 1 lying on the belly. */
  hipDrop: number;
  /** Extra body pitch, radians, + = chest up. */
  pitch: number;
  /** Extra neck angle, + = up. */
  neck: number;
  /** Extra head angle, + = up. */
  head: number;
  /** 0..1 mouth open. */
  jaw: number;
  /** Tail base lift, + = up. */
  tailLift: number;
  /** Tail bend per segment, + = curls down and forward. */
  tailCurl: number;
  /** Tail wag amplitude. */
  tailWag: number;
  /** 0 relaxed .. 1 raised arms. */
  arms: number;
  /** 0..1 shaking (roaring, shivering). */
  tremble: number;
  /** 0..1 knees bent (before a jump, after landing). */
  crouch: number;
  /** 0..1 cat-like stretch: chest down, hips up. */
  stretch: number;
  /** 0..1 blend from relative neck/head angles to the absolute ones below (same for every species). */
  abs: number;
  /** Absolute neck direction (radians from horizontal, + = up) used when abs > 0. */
  neckAbs: number;
  /** Absolute head direction used when abs > 0. */
  headAbs: number;
}

export const NEUTRAL: Pose = { hipDrop: 0, pitch: 0, neck: 0, head: 0, jaw: 0, tailLift: 0, tailCurl: 0, tailWag: 0, arms: 0, tremble: 0, crouch: 0, stretch: 0, abs: 0, neckAbs: 0, headAbs: 0 };

export interface LegOut {
  hip: V;
  knee: V;
  heel: V;
  ball: V;
  toe: V;
  lift: number;
}

export interface ArmOut {
  shoulder: V;
  elbow: V;
  hand: V;
}

export interface Solved {
  hip: V;
  chest: V;
  belly: V;
  neck: V[];
  headO: V;
  headA: number;
  jawA: number;
  tail: { p: V; r: number }[];
  legs: [LegOut, LegOut];
  arms: [ArmOut, ArmOut];
  hipR: number;
  chestR: number;
  bellyR: number;
  neckR: number;
  pitch: number;
  /** Eye centre in local coordinates. */
  eye: V;
  /** Pupil offset in head coordinates, -1..1. */
  pupil: V;
  /** 0 open .. 1 shut. */
  lid: number;
  top: V;
  mouth: V;
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

const TAIL_SEGS = 9;
const TAU = Math.PI * 2;

export class Rig {
  species: SpeciesDef;
  growth = 0;
  p: BodyParams;
  /** Overall size relative to an adult (from growth). */
  size = 1;
  baby = 1;

  pose: Pose = { ...NEUTRAL };
  target: Pose = { ...NEUTRAL };
  eyes: EyeState = 'open';
  legMode: LegMode = 'gait';

  /** Ground speed in rig units per second (always >= 0; facing gives the direction). */
  speed = 0;
  /** 0 walk .. 1 run. */
  run = 0;
  /** Forward acceleration in rig units/s² (drives tail and body sway). */
  accel = 0;
  /** Look target in local coordinates, or null to look ahead. */
  look: V | null = null;
  /** 0..1 how strongly the head follows the look target. */
  lookAmount = 0.7;

  facing: 1 | -1 = 1;
  /** Animated facing (-1..1); passes through 0 while turning. */
  face = 1;

  time = 0;
  phase = 0;
  private gaitW = 0;
  private runS = 0;
  private blink = 0;
  private nextBlink = 2;
  private lookCur: V = { x: 80, y: 40 };
  private tailOff: number[] = new Array(TAIL_SEGS).fill(0);
  private tailVel: number[] = new Array(TAIL_SEGS).fill(0);
  private legCur: { heel: V; ball: V; lift: number }[] | null = null;
  private rand: () => number;
  s!: Solved;

  constructor(species: SpeciesDef, growth: number, rand: () => number = Math.random) {
    this.species = species;
    this.rand = rand;
    this.p = morphBody(species, growth);
    this.setGrowth(growth);
    this.solve(0);
  }

  setGrowth(g: number) {
    this.growth = g;
    this.p = morphBody(this.species, g);
    this.size = sizeOf(g);
    this.baby = babyness(g);
  }

  setSpecies(species: SpeciesDef) {
    this.species = species;
    this.setGrowth(this.growth);
  }

  /** Leg length from hip to heel, in rig units (before size). */
  get legLen() {
    return this.p.thigh + this.p.shin;
  }

  /** Approximate standing height in rig units (before size). */
  get height() {
    return this.p.hipHeight + this.p.hipR + this.p.neckLen * 0.6 + this.p.headH;
  }

  update(dt: number) {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    const k = approach(dt, 0.12);
    const pose = this.pose as unknown as Record<string, number>;
    const tgt = this.target as unknown as Record<string, number>;
    for (const key in tgt) pose[key] += (tgt[key] - pose[key]) * (key === 'jaw' ? approach(dt, 0.05) : k);

    // Turning: squash through zero, quickly.
    this.face += clamp(this.facing - this.face, -dt * 9, dt * 9);

    // Blinking.
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt / 0.16);
    else if ((this.nextBlink -= dt) <= 0) {
      this.blink = 1;
      this.nextBlink = 1.8 + this.rand() * 3.5;
    }

    // Gait phase: advances by distance so feet never slide.
    const walking = this.legMode === 'gait' && this.speed > 0.5;
    this.gaitW += ((walking ? 1 : 0) - this.gaitW) * approach(dt, 0.1);
    this.runS += (this.run - this.runS) * approach(dt, 0.2);
    const { stride, stance } = this.gait();
    if (walking) this.phase = (this.phase + (this.speed * dt) / (stride / stance)) % 1;
    else if (this.gaitW < 0.05) this.phase = 0;

    // Tail: damped springs pushed by body acceleration.
    const stiff = this.p.tailStiff;
    const kS = 55 + 90 * stiff;
    const cS = 7 + 6 * stiff;
    for (let i = 0; i < TAIL_SEGS; i++) {
      const f = (i + 1) / TAIL_SEGS;
      const a = -kS * this.tailOff[i] - cS * this.tailVel[i] + this.accel * 0.0022 * f * (1.2 - stiff);
      this.tailVel[i] += a * dt;
      this.tailOff[i] = clamp(this.tailOff[i] + this.tailVel[i] * dt, -0.5, 0.5);
    }

    // Look target easing.
    const lt = this.look ?? { x: 120, y: this.p.hipHeight + 10 };
    this.lookCur = lerpV(this.lookCur, lt, approach(dt, 0.18));

    this.solve(dt);
  }

  private gait() {
    const r = this.runS;
    const stride = (this.p.thigh + this.p.shin) * (0.95 + 0.55 * r);
    const stance = 0.62 - 0.2 * r;
    return { stride, stance };
  }

  /** Foot contact offset (x relative to hip, lift) for a leg at gait phase f. */
  private footAt(f: number, stride: number, stance: number, liftH: number) {
    f = ((f % 1) + 1) % 1;
    if (f < stance) return { x: stride / 2 - (f / stance) * stride, lift: 0 };
    const u = (f - stance) / (1 - stance);
    const e = u * u * (3 - 2 * u);
    return { x: -stride / 2 + e * stride, lift: Math.sin(Math.PI * u) * liftH };
  }

  solve(dt: number) {
    const p = this.p;
    const po = this.pose;
    const t = this.time;
    const run = this.runS;
    const gw = this.gaitW;
    const trem = po.tremble;
    const shake = (f: number, a: number) => Math.sin(t * f) * a * trem;

    // Body.
    const lieY = p.bellyR + p.bellyDrop * 0.7 - 1;
    let hipY = lerp(p.hipHeight, lieY, clamp(po.hipDrop, 0, 1));
    hipY -= po.crouch * p.hipHeight * 0.2;
    const bob = -Math.cos(this.phase * TAU * 2) * (1 + 2.2 * run) * gw * (1 - po.hipDrop);
    hipY += bob + po.stretch * p.hipHeight * 0.08 + shake(37, 0.8);
    const breath = Math.sin(t * (this.eyes === 'closed' ? 1.4 : 2.3)) * (this.eyes === 'closed' ? 0.045 : 0.022);
    const pitch = p.pitch + po.pitch - po.stretch * 0.38 - run * 0.14 * gw + clamp(-this.accel * 0.0006, -0.12, 0.12) + shake(29, 0.03);
    const hip: V = { x: shake(41, 0.7), y: hipY };
    const chest = at(hip, pitch, { x: p.bodyLen, y: 0 });
    const belly = at(lerpV(hip, chest, 0.45), pitch, { x: 0, y: -p.bellyDrop });
    const hipR = p.hipR * (1 + breath * 0.5);
    const chestR = p.chestR * (1 + breath);
    const bellyR = p.bellyR * (1 + breath * 1.2);

    // Neck and head, turned toward the look target within limits.
    const neckBase = at(chest, pitch, { x: p.chestR * 0.45, y: p.chestR * 0.3 });
    const ab = clamp(po.abs, 0, 1);
    const neutralNeck = lerp(pitch + p.neckAngle + po.neck, po.neckAbs, ab);
    const neutralHead = lerp(neutralNeck + p.headAngle + po.head, po.headAbs, ab);
    const toLook = Math.atan2(this.lookCur.y - neckBase.y, this.lookCur.x - neckBase.x);
    const headDir = neutralHead + 0.12; // the skull points roughly along neutralHead
    const lookDelta = clamp(wrapAngle(toLook - headDir), -0.55, 0.65) * this.lookAmount * (1 - 0.7 * po.hipDrop * (this.eyes === 'closed' ? 1 : 0));
    const neckDir = neutralNeck + lookDelta * 0.4 + shake(33, 0.05);
    const n1 = add(neckBase, dir(neckDir, p.neckLen * 0.5));
    const n2 = add(n1, dir(neckDir - 0.3, p.neckLen * 0.5));
    const headA = neutralHead + lookDelta * 0.7 + shake(45, 0.06) + Math.sin(this.phase * TAU * 2) * 0.03 * gw;
    let headO = at(n2, headA, { x: -p.headLen * 0.1, y: -p.headH * 0.3 });
    const jawA = -clamp(po.jaw, 0, 1.2) * 0.62;
    // Keep the head above the ground (resting chin, eating, sleeping).
    const lowest = Math.min(
      at(headO, headA + jawA, { x: p.headLen * 0.5, y: -p.jawD }).y,
      at(headO, headA + jawA, { x: p.headLen * 0.88, y: -p.jawD * 0.5 }).y,
      at(headO, headA, { x: p.headLen, y: p.snoutH * 0.3 }).y,
    );
    if (lowest < 0.4) headO = { x: headO.x, y: headO.y + (0.4 - lowest) };

    // Tail.
    const tailBase = at(hip, pitch, { x: -p.hipR * 0.5, y: p.hipR * 0.12 });
    const segLen = p.tailLen / TAIL_SEGS;
    const tail: { p: V; r: number }[] = [{ p: tailBase, r: p.tailR }];
    let a = Math.PI + pitch * 0.7 + p.tailDroop - po.tailLift;
    const sag = (1 - p.tailStiff) * 0.07;
    let prev = tailBase;
    for (let i = 0; i < TAIL_SEGS; i++) {
      const f = (i + 1) / TAIL_SEGS;
      const wag = Math.sin(t * 7 - i * 0.7) * po.tailWag * f;
      const sway = Math.sin(t * 1.3 - i * 0.5) * 0.025 * (1 - p.tailStiff * 0.6) + Math.sin(this.phase * TAU - i * 0.6) * 0.05 * gw;
      a += sag + po.tailCurl + wag + sway + this.tailOff[i] + shake(31 + i, 0.02);
      const np = add(prev, dir(a, segLen));
      const r = Math.max(1.3, p.tailR * Math.pow(1 - f, 0.85)) + 0.2;
      if (np.y < r * 0.65) np.y = r * 0.65; // lies on the ground instead of sinking in
      tail.push({ p: np, r });
      prev = np;
    }

    // Legs.
    const { stride, stance } = this.gait();
    const legs = [0, 1].map((i) => {
      const hipJ = at(hip, pitch, { x: p.hipR * 0.12 - i * 2.5, y: -p.hipR * 0.28 + i * 0.8 });
      let heel: V;
      let ball: V;
      let lift = 0;
      const mode = this.legMode;
      if (mode === 'gait') {
        const idleX = (i === 0 ? 1 : -1) * stride * 0.1;
        const f = this.footAt(this.phase + i * 0.5, stride, stance, p.hipHeight * (0.22 + 0.12 * run));
        const x = lerp(idleX, f.x, gw);
        lift = f.lift * gw;
        const bx = hipJ.x + x + p.meta * 0.3;
        ball = { x: bx, y: lift };
        heel = { x: bx - p.meta * 0.45 - lift * 0.15, y: p.heel + lift * 0.9 - po.crouch * p.heel * 0.4 };
      } else if (mode === 'fold') {
        const bx = hip.x + p.meta * (0.5 - i * 0.12);
        ball = { x: bx, y: 0 };
        heel = { x: bx - p.meta * 0.9, y: 1.2 };
      } else if (mode === 'air') {
        ball = { x: hipJ.x + p.thigh * 0.2 - i * 3, y: hipJ.y - this.legLen * 0.7 };
        heel = { x: ball.x - p.meta * 0.5, y: ball.y + p.heel * 0.6 };
      } else if (mode === 'held') {
        const kick = Math.sin(t * 5 + i * 2.1) * 2.5;
        ball = { x: hipJ.x + kick + 1, y: hipJ.y - this.legLen * 1.02 - p.meta * 0.3 };
        heel = { x: ball.x - 1.5, y: ball.y + p.meta * 0.75 };
      } else {
        const k = Math.sin(t * 15 + i * Math.PI);
        ball = { x: hipJ.x + k * this.legLen * 0.4 + 2, y: hipJ.y - this.legLen * 0.72 + Math.cos(t * 15 + i * Math.PI) * 3 };
        heel = { x: ball.x - p.meta * 0.45, y: ball.y + p.heel * 0.7 };
      }
      // Smooth between modes (walk cycle positions are used as-is so feet stay planted).
      if (!this.legCur) this.legCur = [{ heel, ball, lift }, { heel, ball, lift }];
      const cur = this.legCur[i];
      if (mode === 'gait' && po.hipDrop < 0.05) {
        const kk = approach(dt, 0.05);
        cur.heel = lerpV(cur.heel, heel, dt === 0 ? 1 : Math.max(kk, gw));
        cur.ball = lerpV(cur.ball, ball, dt === 0 ? 1 : Math.max(kk, gw));
      } else {
        const kk = dt === 0 ? 1 : approach(dt, mode === 'flail' ? 0.03 : 0.08);
        cur.heel = lerpV(cur.heel, heel, kk);
        cur.ball = lerpV(cur.ball, ball, kk);
      }
      cur.lift = lift;
      const { mid: knee, end } = ik2(hipJ, cur.heel, p.thigh, p.shin, 1);
      const toeDir = mode === 'gait' || mode === 'fold' ? -lift * 0.04 : -0.9;
      const toe = add(cur.ball, dir(toeDir, p.toe));
      return { hip: hipJ, knee, heel: end, ball: cur.ball, toe, lift };
    }) as [LegOut, LegOut];

    // Arms.
    const arms = [0, 1].map((i) => {
      const shoulder = at(chest, pitch, { x: p.chestR * 0.25 - i * 1.5, y: -p.chestR * 0.45 + i * 0.6 });
      const swing = Math.sin((this.phase + i * 0.5) * TAU) * 0.35 * gw;
      const flap = po.arms * (1.7 + Math.sin(t * 9 + i) * 0.25 * trem);
      const up = pitch + p.armAngle + flap + swing + shake(23 + i, 0.2);
      const elbow = add(shoulder, dir(up, p.armUpper));
      const hand = add(elbow, dir(up + p.armBend * (1 - po.arms * 0.45), p.armFore));
      return { shoulder, elbow, hand };
    }) as [ArmOut, ArmOut];

    // Eye and look.
    const eyeLocal = { x: p.eyeX * p.headLen, y: p.eyeY * p.headH };
    const eye = at(headO, headA, eyeLocal);
    const toTarget = wrapAngle(Math.atan2(this.lookCur.y - eye.y, this.lookCur.x - eye.x) - headA);
    const pupil = this.look ? { x: Math.cos(toTarget) * 0.9, y: Math.sin(toTarget) * 0.9 } : { x: 0.35, y: 0 };
    const lid = this.eyes === 'sleepy' ? Math.max(0.55, this.blink) : this.eyes === 'open' || this.eyes === 'wide' ? this.blink : 0;

    const top = at(headO, headA, { x: p.headLen * 0.3, y: p.headH * 1.05 });
    const mouth = at(headO, headA, { x: p.headLen * 0.85, y: -p.jawD * 0.2 });

    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    const grow = (q: V, r: number) => {
      x1 = Math.min(x1, q.x - r);
      y1 = Math.min(y1, q.y - r);
      x2 = Math.max(x2, q.x + r);
      y2 = Math.max(y2, q.y + r);
    };
    grow(hip, hipR);
    grow(chest, chestR);
    grow(belly, bellyR);
    grow(headO, 2);
    grow(at(headO, headA, { x: p.headLen, y: p.snoutH }), 2);
    grow(top, 2);
    for (const n of tail) grow(n.p, n.r);
    for (const l of legs) {
      grow(l.toe, 2);
      grow(l.ball, 2);
      grow(l.knee, p.legW * 0.6);
    }

    this.s = {
      hip,
      chest,
      belly,
      neck: [neckBase, n1, n2],
      headO,
      headA,
      jawA,
      tail,
      legs,
      arms,
      hipR,
      chestR,
      bellyR,
      neckR: p.neckR,
      pitch,
      eye,
      pupil,
      lid,
      top,
      mouth,
      bounds: { x1, y1, x2, y2 },
    };
  }

  /** Circles (local coordinates) that approximate the body, for hit testing. */
  hitCircles(): { p: V; r: number }[] {
    const s = this.s;
    const p = this.p;
    const out = [
      { p: s.hip, r: s.hipR },
      { p: s.chest, r: s.chestR },
      { p: s.belly, r: s.bellyR },
      { p: s.neck[1], r: s.neckR },
      { p: at(s.headO, s.headA, { x: p.headLen * 0.35, y: p.headH * 0.45 }), r: p.headH * 0.6 },
      { p: at(s.headO, s.headA, { x: p.headLen * 0.75, y: p.snoutH * 0.4 }), r: p.snoutH * 0.6 },
    ];
    for (let i = 1; i < s.tail.length; i += 2) out.push({ p: s.tail[i].p, r: Math.max(3, s.tail[i].r) });
    for (const l of s.legs) out.push({ p: l.knee, r: p.legW * 0.55 }, { p: l.heel, r: p.legW * 0.4 }, { p: l.ball, r: p.legW * 0.35 });
    return out;
  }
}
