// Toys you put out from the panel (the ball is separate, see Pet.play): bubbles to snap at, a bone
// to fetch and chew, a squeaky duck to pounce on, a laser dot to chase and a puddle to splash in
// (the fishing move uses the puddle too). Pure logic; overlay/toys.ts draws them.

import { clamp, type V } from '../pet/math';
import type { Platform, ToyKind } from '../shared/types';
import { between, every, G, sgn } from './common';
import type { Act, Pet } from './pet';
import { GROUND, ground, landingOn, ride } from './world';

export interface Bubble {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

/** A bubble wand: bubbles come out of it for a while and float up. */
export interface Bubbles {
  kind: 'bubbles';
  x: number;
  y: number;
  /** Seconds it keeps blowing bubbles. */
  left: number;
  next: number;
  list: Bubble[];
  nextId: number;
}

/** A toy that can be picked up, carried in the mouth and thrown: a bone or a squeaky duck. */
export interface Thing {
  kind: 'bone' | 'duck';
  x: number;
  /** Bottom of the toy. */
  y: number;
  vx: number;
  vy: number;
  angle: number;
  r: number;
  /** You're dragging it. */
  held: boolean;
  /** In the pet's mouth. */
  carried: boolean;
  /** Resting on this platform. */
  on: Platform | null;
  /** Seconds since it was put out or you last threw it (new toys are exciting). */
  age: number;
  /** Seconds before it goes away (throwing it again keeps it around). */
  life: number;
  /** 0..1 squeezed (the duck squeaks). */
  squish: number;
  /** You threw it: it brings it back. */
  thrown: boolean;
  /** Times it set off to get it without getting it (it gives up on one it can't reach). */
  tries: number;
  hist: { x: number; y: number; t: number }[];
}

/** A laser pointer dot that darts around for a while. */
export interface Laser {
  kind: 'laser';
  x: number;
  y: number;
  tx: number;
  ty: number;
  left: number;
  /** Seconds it stays put before darting off again. */
  pause: number;
  on: Platform;
}

export interface Puddle {
  kind: 'puddle';
  x: number;
  y: number;
  w: number;
  left: number;
  on: Platform;
  /** A fish in the pet's mouth (drawn there). */
  fish: 'none' | 'held';
  age: number;
}

export type Toy = Bubbles | Thing | Laser | Puddle;

type ToyAct = Extract<Act, { k: 'toy' }>;

type ToyOf<K extends Toy['kind']> = K extends 'bone' | 'duck' ? Thing : K extends 'bubbles' ? Bubbles : K extends 'laser' ? Laser : Puddle;

export function find<K extends Toy['kind']>(p: Pet, kind: K): ToyOf<K> | undefined {
  return p.toys.find((t) => t.kind === kind) as ToyOf<K> | undefined;
}

export function puddleOf(p: Pet) {
  return find(p, 'puddle');
}

function groundOf(p: Pet): Platform {
  return p.world.platforms.find((q) => q.id === GROUND) ?? ground(p.world.width, p.world.height);
}

function remove(p: Pet, t: Toy) {
  p.toys = p.toys.filter((q) => q !== t);
}

/** Puts a toy out (replacing one of the same kind). `at` places a bone or duck (dug up, say). */
export function putToy(p: Pet, kind: ToyKind, at?: { x: number; y: number; vx: number; vy: number }) {
  if (kind === 'ball') {
    p.play();
    return;
  }
  const old = find(p, kind);
  if (old) remove(p, old);
  const r = p.env.rand;
  const w = p.world;
  const pl = p.platform;
  const s = clamp(p.px, 0.8, 1.4);
  switch (kind) {
    case 'bubbles': {
      // The wand hangs a little above its head, off to one side: bubbles drift up from there.
      let x = p.x + p.facing * (p.margin + 130 * s);
      if (x < 40 || x > w.width - 40) x = p.x - p.facing * (p.margin + 130 * s);
      p.toys.push({ kind, x: clamp(x, 40, w.width - 40), y: Math.max(40, pl.y - p.heightPx * 1.4), left: 12, next: 0.2, list: [], nextId: 1 });
      break;
    }
    case 'bone':
    case 'duck': {
      const x = at?.x ?? clamp(p.x + p.facing * (120 + 60 * r()) * s, 30, w.width - 30);
      p.toys.push({ kind, x, y: at?.y ?? 20, vx: at?.vx ?? (r() - 0.5) * 120, vy: at?.vy ?? 0, angle: 0, r: (kind === 'bone' ? 9 : 10) * s, held: false, carried: false, on: null, age: 0, life: at ? 40 : 100, squish: 0, thrown: false, tries: 0, hist: [] });
      break;
    }
    case 'laser': {
      const x = clamp(p.x + p.facing * 200 * s, pl.x1 + 10, pl.x2 - 10);
      p.toys.push({ kind, x, y: pl.y - 1, tx: x, ty: pl.y - 1, left: 18, pause: 0.8, on: pl });
      break;
    }
    case 'puddle':
      ensurePuddle(p, 'near').left = 60;
      break;
  }
  p.sound('pop', true);
}

/** The puddle for fishing: next to it ('near'), or out on the taskbar for a flyer to dive at ('far'). */
export function ensurePuddle(p: Pet, where: 'near' | 'far'): Puddle {
  const w = Math.max(70, p.heightPx * 1.3);
  const on = where === 'far' ? groundOf(p) : p.platform;
  const old = puddleOf(p);
  if (old && old.on.id === on.id && (where === 'far' || Math.abs(old.x - p.x) < 500)) {
    old.left = Math.max(old.left, 30);
    return old;
  }
  if (old) remove(p, old);
  const lo = on.x1 + w * 0.55;
  const hi = on.x2 - w * 0.55;
  let x: number;
  if (where === 'near') {
    const off = p.margin + w * 0.75;
    x = p.x + p.facing * off;
    if (x < lo || x > hi) x = p.x - p.facing * off;
  } else x = p.x + sgn(p.world.width / 2 - p.x) * between(p.env.rand, 260, 460);
  x = hi > lo ? clamp(x, lo, hi) : (on.x1 + on.x2) / 2;
  const pd: Puddle = { kind: 'puddle', x, y: on.y, w, left: 45, on, fish: 'none', age: 0 };
  p.toys.push(pd);
  p.fx('ripple', x, on.y);
  p.sound('splash', true);
  return pd;
}

// ---------------- physics ----------------

export function updateToys(p: Pet, dt: number) {
  if (!p.toys.length) return;
  for (const t of [...p.toys]) {
    switch (t.kind) {
      case 'bubbles':
        updateBubbles(p, t, dt);
        if (t.left <= 0 && !t.list.length) remove(p, t);
        break;
      case 'bone':
      case 'duck':
        updateThing(p, t, dt);
        t.life -= dt;
        if (t.life <= 0 && !t.held && !t.carried) remove(p, t);
        break;
      case 'laser':
        updateLaser(p, t, dt);
        if (t.left <= 0) remove(p, t);
        break;
      case 'puddle':
        t.age += dt;
        if ((t.left -= dt) <= 0) remove(p, t);
        break;
    }
  }
}

function updateBubbles(p: Pet, t: Bubbles, dt: number) {
  const r = p.env.rand;
  const s = clamp(p.px, 0.8, 1.3);
  if (t.left > 0) {
    t.left -= dt;
    if ((t.next -= dt) <= 0 && t.list.length < 12) {
      t.next = between(r, 0.4, 0.7);
      t.list.push({ id: t.nextId++, x: t.x + (r() - 0.5) * 20, y: t.y, vx: between(r, -35, 35), vy: between(r, -45, -22), r: between(r, 8, 15) * s, age: 0, life: between(r, 6, 10) });
    }
  }
  const w = p.world;
  for (const b of [...t.list]) {
    b.age += dt;
    b.vy += (-38 - b.vy) * dt * 0.3;
    b.vx *= 1 - 0.2 * dt;
    b.x += (b.vx + Math.sin(b.age * 2.2 + b.id) * 18) * dt;
    b.y += b.vy * dt;
    if (b.age > b.life || b.y < 12 || b.x < -20 || b.x > w.width + 20) popBubble(p, t, b, false);
  }
}

function popBubble(p: Pet, t: Bubbles, b: Bubble, snapped: boolean) {
  t.list = t.list.filter((q) => q !== b);
  p.fx('pop', b.x, b.y, 1, b.r / 10);
  p.sound('bubble', true);
  if (snapped) {
    p.data.happiness = clamp(p.data.happiness + 0.004, 0, 1);
    if (p.env.rand() < 0.25) p.emote('note');
  }
}

function updateThing(p: Pet, t: Thing, dt: number) {
  t.squish = Math.max(0, t.squish - dt * 3);
  t.age += dt;
  if (t.held) return;
  if (t.carried) {
    const m = p.mouthAt();
    t.x = m.x;
    t.y = m.y + t.r * 0.5;
    t.vx = 0;
    t.vy = 0;
    t.on = null;
    t.angle = p.facing > 0 ? -0.2 : 0.2;
    return;
  }
  const w = p.world;
  if (t.on) {
    // Resting (or rolling to a stop) on a platform; it rides along with it (see rideToys).
    t.y = t.on.y;
    if (Math.abs(t.vx) > 5) {
      t.x += t.vx * dt;
      t.vx *= Math.max(0, 1 - dt * 4);
      t.angle += ((t.vx * dt) / t.r) * (t.kind === 'bone' ? 0.3 : 0.15);
      if (t.x < t.on.x1 || t.x > t.on.x2) t.on = null;
    } else t.vx = 0;
    t.x = clamp(t.x, t.r, w.width - t.r);
    return;
  }
  t.vy += G * 0.8 * dt;
  let nx = t.x + t.vx * dt;
  let ny = t.y + t.vy * dt;
  if (nx < t.r || nx > w.width - t.r) {
    nx = clamp(nx, t.r, w.width - t.r);
    t.vx = -t.vx * 0.5;
  }
  if (ny < t.r * 2) {
    ny = t.r * 2;
    t.vy = Math.abs(t.vy) * 0.4;
  }
  if (t.vy > 0) {
    const land = landingOn(w.platforms, nx, t.y, ny);
    if (land) {
      ny = land.y;
      if (t.vy > 260) {
        t.vy = -t.vy * (t.kind === 'duck' ? 0.45 : 0.3);
        t.vx *= 0.8;
        if (t.kind === 'duck' && t.vy < -250) {
          t.squish = 0.6;
          p.sound('toy', true);
        }
      } else {
        t.vy = 0;
        t.on = land;
      }
    }
  }
  t.angle += ((t.vx * dt) / t.r) * (t.kind === 'bone' ? 0.6 : 0.2);
  t.x = nx;
  t.y = ny;
  if (t.y > w.height + 60) {
    const g = groundOf(p);
    t.y = g.y;
    t.on = g;
    t.vy = 0;
  }
}

function updateLaser(p: Pet, l: Laser, dt: number) {
  const r = p.env.rand;
  l.left -= dt;
  if (l.pause > 0) {
    // Holding still-ish (a hand is never quite steady), then darting off.
    l.pause -= dt;
    l.x = clamp(l.x + (r() - 0.5) * 60 * dt, l.on.x1 + 4, l.on.x2 - 4);
    if (l.pause <= 0) laserTarget(p, l, false);
  } else {
    const dx = l.tx - l.x;
    const dy = l.ty - l.y;
    const d = Math.hypot(dx, dy);
    const step = 950 * dt;
    if (d <= step) {
      l.x = l.tx;
      l.y = l.ty;
      l.pause = r() < 0.25 ? 0.08 : between(r, 0.35, 1.2);
    } else {
      l.x += (dx / d) * step;
      l.y += (dy / d) * step;
    }
  }
  // It always gets away: when the pet pounces close, the dot darts off.
  if (!p.grounded && p.act.k === 'fall' && Math.abs(l.x - p.x) < p.heightPx && Math.abs(l.y - p.y) < p.heightPx && l.pause > 0) {
    l.pause = 0;
    laserTarget(p, l, true);
  }
}

function laserTarget(p: Pet, l: Laser, far: boolean) {
  const r = p.env.rand;
  const plats = p.platforms;
  if (!far && r() < 0.15 && plats.length > 1) {
    // Hop to another window (or down to the taskbar).
    const q = plats[Math.floor(r() * plats.length)];
    l.on = q;
    l.tx = between(r, q.x1 + 20, Math.max(q.x1 + 21, q.x2 - 20));
    l.ty = q.y - 1;
    return;
  }
  const q = l.on;
  const dirn = r() < 0.5 ? -1 : 1;
  const d = far ? between(r, 250, 450) : between(r, 70, 380);
  let x = l.x + dirn * d;
  if (x < q.x1 + 10 || x > q.x2 - 10) x = l.x - dirn * d;
  l.tx = clamp(x, q.x1 + 10, q.x2 - 10);
  l.ty = q.y - 1;
}

/** Toys lying on windows move with them. Called from Pet.setWorld. */
export function rideToys(p: Pet) {
  const plats = p.world.platforms;
  for (const t of [...p.toys]) {
    if ((t.kind === 'bone' || t.kind === 'duck') && t.on) {
      const m = ride(t.on, plats, t.x);
      if (m) {
        t.on = m.p;
        t.x = m.x;
        t.y = m.p.y;
      } else t.on = null;
    } else if (t.kind === 'puddle' || t.kind === 'laser') {
      const m = ride(t.on, plats, t.x);
      if (m) {
        t.on = m.p;
        t.x = m.x;
        t.y = t.kind === 'laser' ? m.p.y - 1 : m.p.y;
      } else if (t.kind === 'puddle') remove(p, t);
      else t.on = groundOf(p);
    }
  }
}

/** Whether any toy is moving (for the frame rate); resting toys don't need redrawing. */
export function toysMoving(p: Pet) {
  for (const t of p.toys) {
    if (t.kind === 'bubbles' || t.kind === 'laser') return true;
    if ((t.kind === 'bone' || t.kind === 'duck') && ((!t.on && !t.carried) || Math.abs(t.vx) > 5 || t.squish > 0)) return true;
  }
  return false;
}

// ---------------- the mouse ----------------

function thingAt(p: Pet, pt: V): Thing | undefined {
  for (const t of p.toys) if ((t.kind === 'bone' || t.kind === 'duck') && Math.hypot(pt.x - t.x, pt.y - (t.y - t.r)) < t.r + 8) return t;
  return undefined;
}

export function overToy(p: Pet, pt: V) {
  return !!thingAt(p, pt);
}

export function grabToy(p: Pet, pt: V) {
  const t = thingAt(p, pt);
  if (!t) return false;
  t.held = true;
  t.carried = false;
  t.on = null;
  t.life = Math.max(t.life, 60);
  t.hist = [{ x: pt.x, y: pt.y, t: p.time }];
  return true;
}

export function dragToy(p: Pet, pt: V) {
  const t = p.toys.find((q): q is Thing => (q.kind === 'bone' || q.kind === 'duck') && q.held);
  if (!t) return;
  const w = p.world;
  t.x = clamp(pt.x, t.r, w.width - t.r);
  t.y = clamp(pt.y + t.r, t.r * 2, w.height);
  t.hist.push({ x: pt.x, y: pt.y, t: p.time });
  if (t.hist.length > 12) t.hist.shift();
}

export function releaseToy(p: Pet) {
  const t = p.toys.find((q): q is Thing => (q.kind === 'bone' || q.kind === 'duck') && q.held);
  if (!t) return;
  t.held = false;
  const h = t.hist.filter((e) => p.time - e.t < 0.1);
  if (h.length >= 2) {
    const dt = Math.max(0.016, h[h.length - 1].t - h[0].t);
    t.vx = clamp((h[h.length - 1].x - h[0].x) / dt, -2200, 2200);
    t.vy = clamp((h[h.length - 1].y - h[0].y) / dt, -2200, 2200);
  } else {
    t.vx = 0;
    t.vy = 0;
  }
  t.thrown = Math.hypot(t.vx, t.vy) > 350;
  if (t.thrown) {
    t.age = 0;
    t.tries = 0;
  }
  // Throw it and it fetches.
  if (t.thrown && p.grounded && !p.anchored && p.interruptible && p.data.energy > 0.1) playWith(p, t.kind);
}

/** A click on a toy: squeezes the duck. */
export function tapToy(p: Pet, pt: V) {
  const t = thingAt(p, pt);
  if (!t) return false;
  if (t.kind === 'duck') {
    t.squish = 1;
    p.sound('toy');
    if (t.on) {
      t.on = null;
      t.vy = -180;
    }
    if (p.grounded && !p.anchored && p.interruptible) playWith(p, 'duck');
  }
  return true;
}

/** Lets go of whatever it carries in its mouth (picked up, say). */
export function dropToy(p: Pet) {
  for (const t of p.toys) {
    if ((t.kind === 'bone' || t.kind === 'duck') && t.carried) {
      t.carried = false;
      t.on = null;
      t.vy = 0;
    }
  }
}

// ---------------- playing ----------------

export function playWith(p: Pet, kind: ToyKind): boolean {
  const t = find(p, kind as Toy['kind']);
  if (!t || !p.grounded || p.anchored) return false;
  if (t.kind === 'bone' || t.kind === 'duck') {
    // Can't get to it? After a few tries it gives up on fetching it.
    if (++t.tries > 4) {
      t.thrown = false;
      if (t.tries > 6) return false;
    }
  }
  p.act = { k: 'toy', toy: kind, t: 0, stage: 0, st: 0, n: 0, next: 0, tx: p.x };
  return true;
}

/** New toys (and one you just threw) are too exciting to ignore. */
function fresh(t: Toy) {
  return t.kind === 'bubbles' || t.kind === 'laser' || t.age < 6 || ((t.kind === 'bone' || t.kind === 'duck') && t.thrown);
}

/** A toy that's out: plays with it (new toys always, older ones now and then). */
export function toyChoice(p: Pet): boolean {
  const r = p.env.rand;
  for (const kind of ['laser', 'bubbles', 'duck', 'bone', 'puddle'] as const) {
    const t = find(p, kind);
    if (!t || (t.kind !== 'bubbles' && t.kind !== 'laser' && t.kind !== 'puddle' && t.held)) continue;
    const keen = fresh(t) ? 1 : kind === 'puddle' ? 0.12 : 0.25;
    if (r() < keen && playWith(p, kind)) return true;
  }
  return false;
}

/** Arrived where a toy was (after travelling there): carry on playing with the nearest one. */
export function resumeToy(p: Pet) {
  let best: Toy | null = null;
  let bd = Infinity;
  for (const t of p.toys) {
    const d = Math.abs(t.x - p.x);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  if (!best || !playWith(p, best.kind)) p.act = p.idleAct(1);
}

function go(a: ToyAct, stage: number) {
  a.stage = stage;
  a.st = 0;
}

function done(p: Pet, happy = false) {
  if (happy) {
    p.emote('heart');
    p.data.happiness = clamp(p.data.happiness + 0.03, 0, 1);
  }
  p.act = p.idleAct(1 + p.env.rand());
}

/** Jumps up h px (towards vx) and carries on with the toy after landing. */
function hop(p: Pet, a: ToyAct, h: number, vx = 0) {
  p.vy = -Math.sqrt(2 * G * Math.max(4, h));
  p.vx = vx;
  p.grounded = false;
  p.act = { k: 'fall', t: 0, resume: a, voluntary: true };
  p.events.push({ type: 'squash', amount: -0.12 });
}

/** On the same platform as a toy lying at (x, y). */
function reachable(p: Pet, on: Platform | null) {
  return !!on && on.id === p.platform.id;
}

export function thinkToy(p: Pet, a: ToyAct, dt: number) {
  a.t += dt;
  a.st += dt;
  switch (a.toy) {
    case 'bubbles':
      return bubbles(p, a, dt);
    case 'bone':
      return bone(p, a, dt);
    case 'duck':
      return duck(p, a, dt);
    case 'laser':
      return laser(p, a, dt);
    case 'puddle':
      return puddle(p, a, dt);
    default:
      done(p);
  }
}

/** A jump from a toy game landed (called from Pet.land). */
export function toyLanded(p: Pet, a: ToyAct) {
  switch (a.toy) {
    case 'duck': {
      const d = find(p, 'duck');
      if (d && Math.abs(d.x - p.x) < p.heightPx * 1.1 && Math.abs(d.y - p.y) < p.heightPx) {
        // SQUEAK.
        d.squish = 1;
        d.tries = 0;
        d.on = null;
        d.vy = -260;
        d.vx = p.facing * 150;
        p.sound('toy');
        p.emote(p.env.rand() < 0.5 ? 'note' : 'heart');
        p.data.happiness = clamp(p.data.happiness + 0.02, 0, 1);
      } else p.emote('question');
      go(a, 3);
      return;
    }
    case 'laser':
      p.emote(p.env.rand() < 0.6 ? 'exclaim' : 'question');
      go(a, 2);
      return;
    case 'puddle': {
      const pd = puddleOf(p);
      p.sound('splash', a.n > 0);
      p.fx('splash', p.x, p.y, p.facing, Math.max(0.8, p.px));
      if (pd) p.fx('ripple', pd.x, pd.y);
      a.n++;
      a.st = 0;
      return;
    }
  }
}

/** Mid-jump in a toy game (called while it falls): bubbles pop on its snout. */
export function airborne(p: Pet, a: ToyAct) {
  if (a.toy !== 'bubbles') return;
  const t = find(p, 'bubbles');
  if (!t) return;
  const m = p.mouthAt();
  for (const b of t.list) {
    if (Math.hypot(b.x - m.x, b.y - m.y) < b.r + 12 * Math.max(0.8, p.px)) {
      popBubble(p, t, b, true);
      p.snap('jaw', 1);
      return;
    }
  }
}

function bubbles(p: Pet, a: ToyAct, dt: number) {
  const t = find(p, 'bubbles');
  if (!t || a.t > 40) {
    done(p, true);
    return;
  }
  const m = p.mouthAt();
  const pl = p.platform;
  const reachUp = p.maxJumpUp + p.heightPx * 0.8;
  let best: Bubble | null = null;
  let bd = Infinity;
  for (const b of t.list) {
    if (b.y < pl.y - reachUp || b.x < pl.x1 || b.x > pl.x2) continue;
    const d = Math.abs(b.x - p.x) + Math.abs(b.y - m.y) * 0.5;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  if (!best) {
    // Waiting for the next one.
    p.brake(dt);
    p.pose('happy', { neck: 0.3, head: 0.3 });
    p.lookAt = { x: t.x, y: t.y };
    if (t.left <= 0 && !t.list.length) done(p, true);
    return;
  }
  p.lookAt = { x: best.x, y: best.y };
  if (Math.hypot(best.x - m.x, best.y - m.y) < best.r + 10 * Math.max(0.8, p.px)) {
    popBubble(p, t, best, true);
    p.pose('look_up');
    p.snap('jaw', 1);
    return;
  }
  const face = sgn(best.x - p.x || p.facing);
  const reach = Math.abs(m.x - p.x);
  const tx = clamp(best.x - face * reach * 0.85, pl.x1 + p.margin * 0.6, pl.x2 - p.margin * 0.6);
  const far = Math.abs(tx - p.x) > 140;
  p.rig.run = far ? 1 : 0;
  p.pose(best.y < m.y - p.heightPx * 0.3 ? 'look_up' : 'alert', { tailWag: 0.3, jaw: 0.3 });
  const there = p.walkTo(tx, far, dt);
  if (there || Math.abs(tx - p.x) < 14) {
    p.facing = face;
    const up = m.y - best.y;
    // Jump for it when it's above the head (and not too high).
    if (up > best.r && up < p.maxJumpUp && a.st > 0.3) {
      hop(p, a, up + best.r * 0.5);
      p.sound('whoosh', true);
      a.st = 0;
    }
  }
}

function bone(p: Pet, a: ToyAct, dt: number) {
  const b = find(p, 'bone');
  if (!b || a.t > 45) {
    if (b) b.carried = false;
    done(p);
    return;
  }
  const r = p.env.rand;
  const pl = p.platform;
  const lo = pl.x1 + p.margin * 0.6;
  const hi = pl.x2 - p.margin * 0.6;
  switch (a.stage) {
    case 0: {
      // Go and get it.
      if (b.carried) {
        go(a, 2);
        return;
      }
      p.lookAt = { x: b.x, y: b.y - b.r };
      if (b.held) {
        // You've got it: wag and watch.
        p.brake(dt);
        p.pose('happy', { tailWag: 0.5, neck: 0.2 });
        return;
      }
      if (!reachable(p, b.on)) {
        if (b.on && a.st > 0.5) p.goTo(b.x, b.y, 'toy', true);
        else {
          // In the air or rolling: run along underneath.
          p.rig.run = 1;
          p.pose('stand', { tailLift: 0.3 });
          p.walkTo(clamp(b.x, lo, hi), true, dt);
        }
        return;
      }
      const m = p.mouthAt();
      const face = sgn(b.x - p.x || p.facing);
      const tx = clamp(b.x - face * Math.abs(m.x - p.x) * 0.9, lo, hi);
      const far = Math.abs(tx - p.x) > 120;
      p.rig.run = far ? 1 : 0;
      p.pose('stand', { tailLift: 0.3, tailWag: 0.2 });
      if (p.walkTo(tx, far, dt) || Math.abs(m.x - b.x) < 14 * p.px || a.st > 12) {
        p.facing = face;
        go(a, 1);
      }
      return;
    }
    case 1:
      // Pick it up.
      p.brake(dt);
      p.pose('sniff');
      if (a.st > 0.35) {
        if (!reachable(p, b.on) || b.held) {
          go(a, 0);
          return;
        }
        b.carried = true;
        b.on = null;
        b.tries = 0;
        p.sound('chew', true);
        a.n = b.thrown && p.cursor ? 1 : 0;
        a.tx = clamp(p.x + (r() < 0.5 ? -1 : 1) * between(r, 90, 240) * Math.max(0.7, p.px), lo, hi);
        go(a, 2);
      }
      return;
    case 2: {
      // Carry it: back to you if you threw it, else somewhere quiet to chew it.
      if (!b.carried) {
        go(a, 0);
        return;
      }
      const fetch = a.n === 1 && !!p.cursor;
      const tx = fetch ? clamp(p.cursor!.x, lo, hi) : a.tx;
      p.rig.run = fetch ? 1 : 0;
      p.pose('stand', { neck: 0.15, head: 0.1, tailLift: 0.35, tailWag: 0.3 });
      if (p.walkTo(tx, fetch, dt) || a.st > 10) go(a, fetch ? 3 : 5);
      return;
    }
    case 3:
      // Drops it at your feet and looks up, hopeful.
      p.brake(dt);
      if (a.st <= dt * 1.5) {
        b.carried = false;
        b.thrown = false;
        b.vy = -80;
        b.vx = p.facing * 40;
        p.emote('heart');
        p.sound('happy', true);
      }
      p.pose('happy', { tailWag: 0.55, neck: 0.3, head: 0.3 });
      p.lookAt = p.cursor;
      if (b.held || b.thrown) {
        go(a, 4);
        return;
      }
      if (a.st > 8) go(a, 0);
      return;
    case 4:
      // Thrown again: after it!
      p.lookAt = { x: b.x, y: b.y };
      if (!b.held) go(a, 0);
      else {
        p.brake(dt);
        p.pose('pounce', { wiggle: 0.6 });
      }
      return;
    case 5:
      // Lie down and chew it.
      if (!b.carried) {
        go(a, 0);
        return;
      }
      p.brake(dt);
      p.pose(a.st < 0.5 ? 'sit' : 'lie', a.st < 0.5 ? undefined : { neckAbs: 0.05, headAbs: -0.45 });
      p.snap('jaw', 0.15 + 0.3 * (0.5 + 0.5 * Math.sin(a.st * 8)));
      if (every(a.st, dt, 0.8)) p.sound('chew', true);
      if (!a.next) a.next = between(r, 6, 10);
      if (a.st > a.next) {
        b.carried = false;
        p.data.happiness = clamp(p.data.happiness + 0.05, 0, 1);
        done(p, true);
      }
  }
}

function duck(p: Pet, a: ToyAct, dt: number) {
  const d = find(p, 'duck');
  if (!d || a.t > 35) {
    done(p);
    return;
  }
  p.lookAt = { x: d.x, y: d.y - d.r };
  const pl = p.platform;
  switch (a.stage) {
    case 0: {
      // Get into pouncing range.
      if (d.held || !d.on) {
        p.brake(dt);
        p.pose('alert', { tailWag: 0.3 });
        return;
      }
      if (!reachable(p, d.on)) {
        if (a.st > 0.5) p.goTo(d.x, d.y, 'toy', true);
        return;
      }
      const face = sgn(d.x - p.x || p.facing);
      const tx = clamp(d.x - face * p.heightPx * 1.6, pl.x1 + p.margin * 0.6, pl.x2 - p.margin * 0.6);
      const far = Math.abs(tx - p.x) > 180;
      p.rig.run = far ? 1 : 0;
      p.pose('stand', { tailLift: 0.3 });
      if (p.walkTo(tx, far, dt) || a.st > 8) {
        p.facing = face;
        go(a, 1);
        a.next = between(p.env.rand, 0.5, 0.9);
      }
      return;
    }
    case 1:
      // Wiggle... and pounce.
      p.brake(dt);
      p.pose('pounce');
      if (a.st > a.next) {
        const h = p.heightPx * 0.55;
        const t = 2 * Math.sqrt((2 * h) / G);
        go(a, 2);
        hop(p, a, h, (d.x - p.x) / t);
        p.sound('whoosh', true);
      }
      return;
    case 2:
      go(a, 3);
      return;
    default:
      // After the squeak: a happy wiggle, then again.
      p.brake(dt);
      p.pose('happy', { tailWag: 0.5 });
      if (a.st > 0.9) {
        a.n++;
        if (a.n >= 3 + (p.env.rand() < 0.5 ? 1 : 0)) done(p, true);
        else go(a, 0);
      }
  }
}

function laser(p: Pet, a: ToyAct, dt: number) {
  const l = find(p, 'laser');
  if (!l) {
    // Where did it go?
    p.emote('question');
    done(p);
    return;
  }
  if (a.t > 30) {
    done(p);
    return;
  }
  p.lookAt = { x: l.x, y: l.y };
  switch (a.stage) {
    case 0: {
      if (l.on.id !== p.platform.id) {
        p.brake(dt);
        p.pose('alert');
        if (a.st > 0.5) p.goTo(l.x, l.y + 1, 'toy', true);
        return;
      }
      p.rig.run = 1;
      p.pose('stand', { tailLift: 0.35, neck: -0.1 });
      p.rig.eyes = 'wide';
      const dx = l.x - p.x;
      if (Math.abs(dx) < p.heightPx * 2.2 && Math.abs(dx) > p.heightPx * 0.4 && l.pause > 0.15 && a.st > 0.4) {
        p.facing = sgn(dx);
        go(a, 1);
        return;
      }
      p.walkTo(clamp(l.x - sgn(dx) * p.heightPx * 0.6, p.platform.x1 + p.margin * 0.6, p.platform.x2 - p.margin * 0.6), true, dt, 1.1);
      return;
    }
    case 1: {
      p.brake(dt);
      p.pose('pounce');
      if (a.st > 0.25) {
        const h = p.heightPx * 0.5;
        const t = 2 * Math.sqrt((2 * h) / G);
        go(a, 2);
        hop(p, a, h, (l.x - p.x) / t);
        p.sound('whoosh', true);
      }
      return;
    }
    default:
      p.brake(dt);
      p.pose('alert', { tailWag: 0.2 });
      if (a.st > 0.3) go(a, 0);
  }
}

function puddle(p: Pet, a: ToyAct, dt: number) {
  const pd = puddleOf(p);
  if (!pd || a.t > 25) {
    done(p);
    return;
  }
  switch (a.stage) {
    case 0:
      // Into the water.
      if (pd.on.id !== p.platform.id) {
        if (a.st > 0.3) p.goTo(pd.x, pd.y, 'toy', false);
        return;
      }
      p.pose('stand', { tailLift: 0.25 });
      if (p.walkTo(pd.x, false, dt) || a.st > 8) go(a, 1);
      return;
    case 1:
      // Splash about: little hops (landing does the splash).
      p.brake(dt);
      p.pose('happy', { tailLift: 0.4 });
      if (a.n >= 3) go(a, 2);
      else if (a.st > 0.2) hop(p, a, p.heightPx * 0.14);
      return;
    case 2: {
      // A drink.
      p.brake(dt);
      p.pose('eat');
      p.snap('jaw', 0.1 + 0.25 * (0.5 + 0.5 * Math.sin(a.st * 12)));
      const m = p.mouthAt();
      if (every(a.st, dt, 0.8)) p.fx('ripple', m.x, pd.y);
      if (every(a.st, dt, 1.6)) p.sound('gulp', true);
      if (a.st > 2.6) go(a, 3);
      return;
    }
    default: {
      // Shake the water off.
      p.pose('shake');
      const c = p.toWorld({ x: p.rig.p.bodyLen * 0.4, y: p.rig.height * 0.45 });
      if (a.st <= dt * 1.5) p.sound('splash', true);
      if (every(a.st, dt, 0.3) && a.st < 1.1) p.fx('drops', c.x, c.y, p.facing, Math.max(0.8, p.px));
      if (a.st > 1.3) done(p, true);
    }
  }
}
