// Procedural 2D skeleton for a dinosaur, side view: two-legged (theropods, pachy, hadrosaurs)
// or four-legged (ceratopsians, stegosaurs, ankylosaurs).
// Local coordinates: origin on the ground under the hips, x forward (facing right), y up.
// Behaviours only set a target pose, speed and look target; the rig animates everything else
// (walk cycle without foot sliding, tail physics, blinking, breathing, turning).

import { babyness, morphBody, sizeOf } from './growth';
import { add, approach, at, clamp, dir, ik2, lerp, lerpV, type V, wrapAngle } from './math';
import type { BodyParams, SpeciesDef } from './species';

export type EyeState = 'open' | 'closed' | 'happy' | 'wide' | 'dizzy' | 'sleepy' | 'angry';
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
  /** Curious head tilt, radians. */
  tilt: number;
  /** 0..1 dancing: bouncing on the spot, stepping, bobbing the head. */
  dance: number;
  /** 0..1 shaking itself off like a wet dog. */
  shake: number;
  /** 0..1 wiggling the hips before a pounce. */
  wiggle: number;
  /** 0..1 pawing the ground with the near hind foot. */
  paw: number;
}

export const NEUTRAL: Pose = { hipDrop: 0, pitch: 0, neck: 0, head: 0, jaw: 0, tailLift: 0, tailCurl: 0, tailWag: 0, arms: 0, tremble: 0, crouch: 0, stretch: 0, abs: 0, neckAbs: 0, headAbs: 0, tilt: 0, dance: 0, shake: 0, wiggle: 0, paw: 0 };

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
  /** Hind legs: near, far. */
  legs: [LegOut, LegOut];
  /** Front legs of four-legged species (near, far); empty for two-legged ones. */
  fronts: LegOut[];
  /** Arms of two-legged species; empty for four-legged ones. */
  arms: ArmOut[];
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

/** How a leg chain is built: bone lengths, width and which way the middle joint bends. */
interface LegSpec {
  upper: number;
  lower: number;
  meta: number;
  heel: number;
  toe: number;
  /** +1 knee forward (hind legs), -1 elbow back (front legs). */
  bend: 1 | -1;
}

export class Rig {
  species: SpeciesDef;
  growth = 0;
  p: BodyParams;
  /** Overall size relative to an adult (from growth). */
  size = 1;
  baby = 1;
  /** Walks on four legs. */
  quad: boolean;

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
  /** Counts footfalls while walking (for footstep sounds and dust). */
  steps = 0;
  /** Local x of the latest footfall. */
  stepX = 0;
  private gaitW = 0;
  private runS = 0;
  private blink = 0;
  private nextBlink = 2;
  private lookCur: V = { x: 80, y: 40 };
  private tailOff: number[] = new Array(TAIL_SEGS).fill(0);
  private tailVel: number[] = new Array(TAIL_SEGS).fill(0);
  private legCur: { heel: V; ball: V; lift: number }[] = [];
  private quadPitch: number | null = null;
  private rand: () => number;
  s!: Solved;

  constructor(species: SpeciesDef, growth: number, rand: () => number = Math.random) {
    this.species = species;
    this.quad = species.stance === 'quad';
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
    this.quad = species.stance === 'quad';
    this.legCur = [];
    this.quadPitch = null;
    this.setGrowth(this.growth);
  }

  /** Leg length from hip to heel, in rig units (before size). */
  get legLen() {
    return this.p.thigh + this.p.shin;
  }

  /** Approximate standing height in rig units (before size). */
  get height() {
    const p = this.p;
    if (this.quad) return Math.max(p.hipHeight + p.hipR * 1.15, p.shoulderHeight + p.chestR + p.headH * 0.6);
    return p.hipHeight + p.hipR + p.neckLen * 0.6 + p.headH;
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
    const p = this.p;
    let stride = (p.thigh + p.shin) * (0.95 + 0.55 * r);
    if (this.quad) {
      // The short front legs limit how far each step can reach.
      const drop = p.shoulderHeight - p.chestR * 0.35 - p.fMeta * 0.85;
      const reach = 0.97 * (p.fThigh + p.fShin);
      stride = Math.min(stride, 2 * Math.sqrt(Math.max(1, reach * reach - drop * drop)) * (1 + 0.2 * r));
    }
    const stance = 0.62 - (this.quad ? 0.12 : 0.2) * r;
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
    const quad = this.quad;
    const trem = po.tremble;
    const shake = (f: number, a: number) => Math.sin(t * f) * a * trem;
    const dance = clamp(po.dance, 0, 1);
    const shakeOff = clamp(po.shake, 0, 1);
    const wiggle = clamp(po.wiggle, 0, 1);
    const free = this.legMode === 'air' || this.legMode === 'held' || this.legMode === 'flail';

    // Body.
    const lieY = p.bellyR + p.bellyDrop * 0.7 - 1;
    let hipY = lerp(p.hipHeight, lieY, clamp(po.hipDrop, 0, 1));
    hipY -= po.crouch * p.hipHeight * 0.2;
    const bob = -Math.cos(this.phase * TAU * 2) * (1 + 2.2 * run) * gw * (1 - po.hipDrop) * (quad ? 0.5 : 1);
    const hop = dance * Math.abs(Math.sin(t * 7)) * p.hipHeight * 0.07;
    hipY += bob + hop + po.stretch * p.hipHeight * (quad ? 0.05 : 0.08) + shake(37, 0.8);
    const breath = Math.sin(t * (this.eyes === 'closed' ? 1.4 : 2.3)) * (this.eyes === 'closed' ? 0.045 : 0.022);
    const sway = clamp(-this.accel * 0.0006, -0.12, 0.12) + shake(29, 0.03) + Math.sin(t * 29) * 0.07 * shakeOff;
    let pitch: number;
    if (quad) {
      // Hips and shoulders each stand on their own legs; the body's pitch follows from their heights.
      // Sitting keeps the front legs straight (like a dog); lying down folds them too.
      const frontDrop = clamp((po.hipDrop - 0.5) * 2, 0, 1);
      const lieChest = p.bellyR * 0.85 + p.bellyDrop * 0.4;
      const maxChest = p.fMeta * 0.85 + (p.fThigh + p.fShin) * 0.96 + p.chestR * 0.35;
      let chestY = lerp(p.shoulderHeight, lieChest, frontDrop);
      chestY -= po.crouch * p.shoulderHeight * 0.18 + po.stretch * p.shoulderHeight * 0.34;
      chestY += po.pitch * p.bodyLen * 0.5 + bob * 0.8 + hop * 0.6;
      chestY = clamp(chestY, lieChest, Math.max(lieChest, maxChest));
      const want = free ? p.pitch + po.pitch : Math.asin(clamp((chestY - hipY) / p.bodyLen, -0.9, 0.9));
      this.quadPitch = this.quadPitch === null || dt === 0 ? want : this.quadPitch + (want - this.quadPitch) * approach(dt, 0.06);
      pitch = this.quadPitch + sway;
    } else {
      pitch = p.pitch + po.pitch - po.stretch * 0.38 - run * 0.14 * gw + sway;
    }
    const hip: V = { x: shake(41, 0.7) + Math.sin(t * 15) * wiggle * p.hipR * 0.22, y: hipY };
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
    const neckDir = neutralNeck + lookDelta * 0.4 + shake(33, 0.05) + dance * Math.sin(t * 7 + 0.3) * 0.08;
    const n1 = add(neckBase, dir(neckDir, p.neckLen * 0.5));
    const n2 = add(n1, dir(neckDir - 0.3, p.neckLen * 0.5));
    const headA = neutralHead + lookDelta * 0.7 + shake(45, 0.06) + Math.sin(this.phase * TAU * 2) * 0.03 * gw + po.tilt + dance * Math.sin(t * 7 + 0.6) * 0.16 + shakeOff * Math.sin(t * 29 + 1.2) * 0.4;
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
    const wagAmt = po.tailWag + dance * 0.22 + shakeOff * 0.45;
    const wagF = shakeOff > 0.2 ? 24 : 7;
    let prev = tailBase;
    for (let i = 0; i < TAIL_SEGS; i++) {
      const f = (i + 1) / TAIL_SEGS;
      const wag = Math.sin(t * wagF - i * 0.7) * wagAmt * f;
      const sway = Math.sin(t * 1.3 - i * 0.5) * 0.025 * (1 - p.tailStiff * 0.6) + Math.sin(this.phase * TAU - i * 0.6) * 0.05 * gw + Math.sin(t * 15 - i * 0.5) * wiggle * 0.07;
      a += sag + po.tailCurl + wag + sway + this.tailOff[i] + shake(31 + i, 0.02);
      const np = add(prev, dir(a, segLen));
      const r = Math.max(1.3, p.tailR * Math.pow(1 - f, 0.85)) + 0.2;
      if (np.y < r * 0.65) np.y = r * 0.65; // lies on the ground instead of sinking in
      tail.push({ p: np, r });
      prev = np;
    }

    // Legs. Hind legs are 0 (near) and 1 (far); four-legged species add front legs 2 (near) and 3 (far),
    // stepping in the lateral sequence of a walking elephant: near hind, near front, far hind, far front.
    const { stride, stance } = this.gait();
    const hindSpec: LegSpec = { upper: p.thigh, lower: p.shin, meta: p.meta, heel: p.heel, toe: p.toe, bend: 1 };
    const frontSpec: LegSpec = { upper: p.fThigh, lower: p.fShin, meta: p.fMeta, heel: p.fMeta * 0.85, toe: p.fMeta * 0.45, bend: -1 };
    const frontDrop = clamp((po.hipDrop - 0.5) * 2, 0, 1);
    const leg = (i: number, joint: V, spec: LegSpec, phaseOff: number, liftH: number, front: boolean): LegOut => {
      const len = spec.upper + spec.lower;
      let heel: V;
      let ball: V;
      let lift = 0;
      const near = i === 0 || i === 2;
      let mode = this.legMode;
      // A sitting four-legged pet keeps its front feet planted.
      if (front && mode === 'fold' && frontDrop < 0.5) mode = 'gait';
      if (mode === 'gait') {
        const idleX = (near ? 1 : -1) * stride * (front ? 0.08 : 0.1);
        const f = this.footAt(this.phase + phaseOff, stride, stance, liftH);
        let x = lerp(idleX, f.x, gw);
        lift = f.lift * gw;
        // Dancing: little alternating steps on the spot.
        if (dance > 0.01) lift = Math.max(lift, Math.max(0, Math.sin(t * 7 + (near ? 0 : Math.PI) + (front ? Math.PI / 2 : 0))) * len * 0.14 * dance);
        // Pawing the ground: the near hind foot scrapes backwards, lifts and comes forward again.
        if (i === 0 && po.paw > 0.01) {
          const k = (t * 2.2) % 1;
          const back = k < 0.7;
          const u = back ? k / 0.7 : (k - 0.7) / 0.3;
          x = lerp(x, (back ? lerp(0.2, -0.35, u) : lerp(-0.35, 0.2, u)) * stride, po.paw);
          lift = Math.max(lift, back ? 0 : Math.sin(Math.PI * u) * len * 0.12 * po.paw);
        }
        const bx = joint.x + x + spec.meta * (front ? 0.25 : 0.3);
        ball = { x: bx, y: lift };
        heel = front
          ? { x: bx - spec.meta * 0.15, y: spec.heel + lift * 0.9 - po.crouch * spec.heel * 0.3 }
          : { x: bx - spec.meta * 0.45 - lift * 0.15, y: spec.heel + lift * 0.9 - po.crouch * spec.heel * 0.4 };
      } else if (mode === 'fold') {
        const base = front ? joint.x + spec.meta * 0.2 : hip.x;
        const bx = base + spec.meta * (front ? 0.9 - (near ? 0 : 0.2) : 0.5 - (near ? 0 : 0.12));
        ball = { x: bx, y: 0 };
        heel = { x: bx - spec.meta * 0.9, y: 1.2 };
      } else if (mode === 'air') {
        ball = { x: joint.x + spec.upper * (front ? 0.45 : 0.2) - (near ? 0 : 3), y: joint.y - len * (front ? 0.62 : 0.7) };
        heel = { x: ball.x - spec.meta * 0.5, y: ball.y + spec.heel * 0.6 };
      } else if (mode === 'held') {
        const kick = Math.sin(t * 5 + i * 2.1) * 2.5;
        ball = { x: joint.x + kick + 1, y: joint.y - len * 1.02 - spec.meta * 0.3 };
        heel = { x: ball.x - 1.5, y: ball.y + spec.meta * 0.75 };
      } else {
        const k = Math.sin(t * 15 + i * Math.PI + (front ? 1 : 0));
        ball = { x: joint.x + k * len * 0.4 + 2, y: joint.y - len * 0.72 + Math.cos(t * 15 + i * Math.PI) * 3 };
        heel = { x: ball.x - spec.meta * 0.45, y: ball.y + spec.heel * 0.7 };
      }
      // Smooth between modes (walk cycle positions are used as-is so feet stay planted).
      if (!this.legCur[i]) this.legCur[i] = { heel, ball, lift };
      const cur = this.legCur[i];
      if (mode === 'gait' && (po.hipDrop < 0.05 || front)) {
        const kk = approach(dt, 0.05);
        cur.heel = lerpV(cur.heel, heel, dt === 0 ? 1 : Math.max(kk, gw));
        cur.ball = lerpV(cur.ball, ball, dt === 0 ? 1 : Math.max(kk, gw));
      } else {
        const kk = dt === 0 ? 1 : approach(dt, mode === 'flail' ? 0.03 : 0.08);
        cur.heel = lerpV(cur.heel, heel, kk);
        cur.ball = lerpV(cur.ball, ball, kk);
      }
      // A footfall: this foot just touched down while walking.
      if (mode === 'gait' && gw > 0.5 && cur.lift > 1e-6 && lift <= 1e-6) {
        this.steps++;
        this.stepX = cur.ball.x;
      }
      cur.lift = lift;
      const { mid: knee, end } = ik2(joint, cur.heel, spec.upper, spec.lower, spec.bend);
      const toeDir = mode === 'gait' || mode === 'fold' ? -lift * 0.04 : -0.9;
      const toe = add(cur.ball, dir(toeDir, spec.toe));
      return { hip: joint, knee, heel: end, ball: cur.ball, toe, lift };
    };
    const legs = [0, 1].map((i) => leg(i, at(hip, pitch, { x: p.hipR * 0.12 - i * 2.5, y: -p.hipR * 0.28 + i * 0.8 }), hindSpec, i * 0.5, p.hipHeight * (0.22 + 0.12 * run), false)) as [LegOut, LegOut];
    const fronts = quad ? [0, 1].map((i) => leg(i + 2, at(chest, pitch, { x: p.chestR * 0.18 - i * 2, y: -p.chestR * 0.35 + i * 0.6 }), frontSpec, i === 0 ? 0.25 : 0.75, p.shoulderHeight * (0.2 + 0.1 * run), true)) : [];

    // Arms (two-legged species).
    const arms: ArmOut[] = quad
      ? []
      : [0, 1].map((i) => {
          const shoulder = at(chest, pitch, { x: p.chestR * 0.25 - i * 1.5, y: -p.chestR * 0.45 + i * 0.6 });
          const swing = Math.sin((this.phase + i * 0.5) * TAU) * 0.35 * gw;
          const flap = po.arms * (1.7 + Math.sin(t * 9 + i) * 0.25 * trem) + dance * (0.6 + 0.5 * Math.sin(t * 7 + i * Math.PI));
          const up = pitch + p.armAngle + flap + swing + shake(23 + i, 0.2);
          const elbow = add(shoulder, dir(up, p.armUpper));
          const hand = add(elbow, dir(up + p.armBend * (1 - po.arms * 0.45), p.armFore));
          return { shoulder, elbow, hand };
        });

    // Eye and look.
    const eyeLocal = { x: p.eyeX * p.headLen, y: p.eyeY * p.headH };
    const eye = at(headO, headA, eyeLocal);
    const toTarget = wrapAngle(Math.atan2(this.lookCur.y - eye.y, this.lookCur.x - eye.x) - headA);
    const pupil = this.look ? { x: Math.cos(toTarget) * 0.9, y: Math.sin(toTarget) * 0.9 } : { x: 0.35, y: 0 };
    const lid = this.eyes === 'sleepy' ? Math.max(0.55, this.blink) : this.eyes === 'open' || this.eyes === 'wide' || this.eyes === 'angry' ? this.blink : 0;

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
    for (const l of [...legs, ...fronts]) {
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
      fronts,
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
    for (const l of s.fronts) out.push({ p: l.knee, r: p.fLegW * 0.55 }, { p: l.heel, r: p.fLegW * 0.45 }, { p: l.ball, r: p.fLegW * 0.4 });
    return out;
  }
}
