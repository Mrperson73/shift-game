// Flying: winged species take off, fly and soar over the screen and land on window tops, the
// taskbar or the very corner of a window. Pterosaurs fly under power and soar in circles; a
// feathered glider (Microraptor) mostly glides down from high places and only flutters up a bit.
//
// Seen from the side, turning around happens "into the screen": the flight model steers the
// horizontal and vertical speeds separately (with limited acceleration), so paths curve smoothly
// and a turn slows it down, flips it round and speeds it up the other way.

import { clamp, lerp } from '../pet/math';
import type { Platform } from '../shared/types';
import { between, type Option, pickWeighted, sgn, TAU } from './common';
import type { Act, Food, FlyGoal, FlyPhase, Pet } from './pet';
import * as Toys from './toys';
import { GROUND, ground } from './world';

type FlyAct = Extract<Act, { k: 'fly' }>;
type Cat = 'rest' | 'move' | 'play' | 'express' | 'social' | 'explore';

/** Cruising airspeed, px/s: 300-500 for an adult, scaled by how big it is on screen. */
export function cruiseSpeed(p: Pet) {
  const size = clamp(p.px / 1.1, 0.55, 1.3);
  return (300 + 200 * p.species.personality.speed) * size * (p.traits.glider ? 0.8 : 1);
}

/** Wing beats per second: big wings beat slowly. */
function beatRate(p: Pet) {
  return clamp(260 / Math.max(40, p.heightPx), 1.3, 4.5) * (p.traits.glider ? 1.35 : 1);
}

/** Where its feet may go in the air (the whole pet, wings and all, stays on screen). */
function airspace(p: Pet) {
  const w = p.world;
  const m = Math.max(80, p.margin * 1.5);
  return { x1: m, x2: w.width - m, y1: p.heightPx * 1.5 + 40, y2: w.height - p.heightPx * 0.8 };
}

function groundOf(p: Pet): Platform {
  return p.world.platforms.find((q) => q.id === GROUND) ?? ground(p.world.width, p.world.height);
}

/** The platform as it is now (windows move), or null if it's gone. */
function resolve(p: Pet, to: Platform | null): Platform | null {
  if (!to) return null;
  const plats = p.platforms;
  return plats.find((q) => q.id === to.id) ?? (to.win ? plats.find((q) => q.win === to.win) ?? null : null);
}

/** High enough up to glide down from. */
function highUp(p: Pet) {
  return p.platform.id !== GROUND && p.world.height - p.platform.y > p.heightPx * 2.5;
}

function newFly(p: Pet, goal: FlyGoal, phase: FlyPhase): FlyAct {
  return { k: 'fly', phase, t: 0, pt: 0, goal, tx: p.x, ty: p.y, hops: 2, to: null, lx: p.x, perch: false, cx: p.x, cy: p.y, r: 150, spin: 1, ang: 0, laps: 1, wing: 0, beat: 1, burst: 1.5, speed: 0, heading: -Math.PI / 2, dur: 20, got: false, beats: 0, fin: false, gulp: 0 };
}

/** Takes off (or, already flying, changes plans). False if it can't fly now. */
export function startFlight(p: Pet, goal: FlyGoal, asked = false): boolean {
  if (!p.winged || p.held || !p.hatched) return false;
  if (p.act.k === 'fly') {
    retarget(p, p.act, goal);
    return true;
  }
  if (!p.grounded || p.anchored) return false;
  const r = p.env.rand;
  const a = newFly(p, goal, 'crouch');
  const tr = p.traits;
  a.dur = tr.glider ? between(r, 3, 6) : between(r, 12, 28) * (asked ? 1.2 : 1) * (p.settings.activity === 'calm' ? 0.7 : 1);
  a.hops = tr.glider ? 1 : 2 + Math.floor(r() * 3);
  // A glider on the ground flutters up to a window it can reach (and glides down from there later).
  if (tr.glider && !highUp(p) && (goal === 'roam' || goal === 'show')) {
    a.goal = 'land';
    approach(p, a);
  }
  if (goal === 'show') {
    a.dur = Math.max(a.dur, 14);
    a.hops = 3;
  }
  p.act = a;
  p.vx = 0;
  return true;
}

/** Recover from a fall by flying (dropped, thrown, let go of a wall). */
export function catchAir(p: Pet): boolean {
  if (!p.winged || p.data.energy < 0.05 || !p.hatched) return false;
  if (p.world.height - p.y < p.heightPx * 1.2) return false;
  const a = newFly(p, p.traits.glider ? 'land' : 'roam', 'cruise');
  a.dur = between(p.env.rand, 3, 8);
  a.hops = 1;
  a.beat = 1;
  a.burst = 1.2;
  p.act = a;
  p.grounded = false;
  if (a.goal === 'land') approach(p, a);
  else waypoint(p, a);
  p.emote('exclaim');
  p.sound('flap');
  return true;
}

/** Flies to food: catches it while it falls, or lands next to it. False when walking is better. */
export function flyToFood(p: Pet, food: Food): boolean {
  if (!p.winged || p.data.energy < 0.1) return false;
  if (food.landed && food.platform?.id === p.platform.id && Math.abs(food.x - p.x) < 450) return false;
  if (!startFlight(p, 'food')) return false;
  // Takes off towards it.
  if (p.act.k === 'fly' && p.act.phase === 'crouch') p.facing = food.x >= p.x ? 1 : -1;
  return true;
}

function retarget(p: Pet, a: FlyAct, goal: FlyGoal) {
  a.goal = goal;
  a.got = false;
  if (goal === 'show') {
    a.dur = a.t + 12;
    a.hops = 3;
    waypoint(p, a);
  } else if (goal === 'land') approach(p, a);
  // Circling, gliding in or coming in to land: off it goes after the new goal instead.
  if ((a.phase === 'approach' || a.phase === 'soar' || a.phase === 'glide') && goal !== 'land') {
    a.phase = 'cruise';
    a.pt = 0;
  }
}

function launch(p: Pet, a: FlyAct) {
  const cr = cruiseSpeed(p);
  const glide = p.traits.glider && highUp(p);
  p.grounded = false;
  a.pt = 0;
  if (glide) {
    // Leap off and glide down.
    a.phase = 'glide';
    p.vx = p.facing * cr * 0.7;
    p.vy = -cr * 0.15;
    approach(p, a);
    a.phase = 'glide';
  } else {
    a.phase = 'up';
    p.vx = p.facing * cr * 0.35;
    p.vy = -cr * 0.75;
  }
  p.events.push({ type: 'dust', x: p.x, y: p.y, big: false }, { type: 'squash', amount: -0.2 });
  p.sound('flap');
  p.sound('whoosh', true);
  p.say('fly');
}

/** Picks the next point to fly to. */
function waypoint(p: Pet, a: FlyAct) {
  const r = p.env.rand;
  const sky = airspace(p);
  const low = p.traits.glider ? Math.max(sky.y1, p.world.height - 380) : sky.y1;
  const hi = Math.max(low + 10, sky.y2 * 0.9);
  for (let i = 0; i < 8; i++) {
    // A show flight crosses the screen; otherwise anywhere at least a little way off.
    const x = a.goal === 'show' ? (p.x < p.world.width / 2 ? lerp(p.world.width * 0.6, sky.x2, r()) : lerp(sky.x1, p.world.width * 0.4, r())) : lerp(sky.x1, sky.x2, r());
    const y = lerp(low, hi, Math.pow(r(), 1.3));
    a.tx = x;
    a.ty = y;
    if (Math.hypot(x - p.x, y - p.y) > 260) break;
  }
}

function startSoar(p: Pet, a: FlyAct, center?: { x: number; y: number }) {
  const r = p.env.rand;
  const sky = airspace(p);
  a.phase = 'soar';
  a.pt = 0;
  a.r = between(r, 130, 230) * clamp(p.px, 0.7, 1.3);
  a.cx = clamp(center?.x ?? p.x + p.facing * a.r * 0.6, sky.x1 + a.r, sky.x2 - a.r);
  a.cy = clamp(center?.y ?? p.y, sky.y1 + 30, sky.y2 - 40);
  a.spin = r() < 0.5 ? 1 : -1;
  a.ang = Math.atan2(p.y - a.cy, p.x - a.cx);
  a.laps = 1 + Math.floor(r() * 2);
  a.hops = Math.max(1, a.hops);
}

/** Chooses where to land and starts the approach. */
function approach(p: Pet, a: FlyAct) {
  const r = p.env.rand;
  const m = p.margin;
  const glider = p.traits.glider;
  const plats = p.platforms.filter((q) => q.x2 - q.x1 > m * 2.2);
  const g = groundOf(p);
  const picks: [number, Platform][] = [];
  for (const q of plats) {
    const below = q.y - p.y;
    if (glider) {
      // Glides down (or flutters up a little from the ground).
      const reach = a.phase === 'crouch' ? 380 : -40;
      if (below < -reach) continue;
      const dx = Math.abs((q.x1 + q.x2) / 2 - p.x);
      if (below > 0 && dx > below * 3.5 + 260) continue;
    }
    // Flyers like being up high; a glider taking off from the ground aims for a window.
    picks.push([q.id === GROUND ? (glider && a.phase === 'crouch' ? 0.05 : 1) : 1.6, q]);
  }
  const to = pickWeighted(r, picks) ?? g;
  a.to = to;
  a.perch = to.id !== GROUND && r() < 0.4;
  if (a.perch) {
    // The window's corner nearest to where it is.
    const left = Math.abs(to.x1 - p.x) < Math.abs(to.x2 - p.x);
    a.lx = left ? to.x1 + m * 0.65 : to.x2 - m * 0.65;
  } else a.lx = lerp(to.x1 + m, to.x2 - m, r());
  if (a.phase !== 'crouch') {
    a.phase = 'approach';
    a.pt = 0;
  }
  a.fin = false;
}

function touchDown(p: Pet, a: FlyAct, to: Platform) {
  const m = p.margin;
  const x = clamp(p.x, to.x1 + m * 0.3, to.x2 - m * 0.3);
  p.vy = Math.min(p.vy, 420);
  const perch = a.perch && to.id !== GROUND && to.id === a.to?.id;
  p.land(to, x);
  p.sound('flap', true);
  if (p.act.k === 'land' && !p.act.resume && a.goal !== 'food') {
    if (perch || (p.env.rand() < 0.3 && to.id !== GROUND)) p.act.resume = { k: 'perch', t: 0, dur: between(p.env.rand, 4, 10), next: 1 };
    else if (p.traits.stalker && p.env.rand() < 0.35) p.act.resume = { k: 'forage', style: 'stalk', t: 0, stage: 0, st: 0, n: 0, toX: p.x };
  }
}

/** Moves the flying pet (no gravity) and lands it when it touches down. Called from Pet.physics. */
export function flightPhysics(p: Pet, dt: number) {
  const a = p.act as FlyAct;
  const y0 = p.y;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  const w = p.world;
  const lo = p.margin * 0.5;
  const hi = w.width - p.margin * 0.5;
  if (p.x < lo) {
    p.x = lo;
    p.vx = Math.abs(p.vx) * 0.3;
  } else if (p.x > hi) {
    p.x = hi;
    p.vx = -Math.abs(p.vx) * 0.3;
  }
  const top = p.heightPx * 1.1;
  if (p.y < top) {
    p.y = top;
    if (p.vy < 0) p.vy = 0;
  }
  if (p.vy < 0) return;
  const landing = a.phase === 'approach' || a.phase === 'glide';
  // Touching down where it meant to land...
  if (landing && a.to) {
    const to = resolve(p, a.to);
    if (to && y0 <= to.y + 1 && p.y >= to.y && p.x >= to.x1 && p.x <= to.x2) {
      touchDown(p, a, to);
      return;
    }
  }
  // ...or on the taskbar when coming down to land; otherwise it skims off it.
  const g = groundOf(p);
  if (p.y >= g.y - 1) {
    if (landing) {
      p.y = g.y;
      touchDown(p, a, g);
    } else {
      p.y = g.y - 1;
      p.vy = -Math.abs(p.vy) * 0.2;
    }
  }
}

export function thinkFly(p: Pet, a: FlyAct, dt: number) {
  a.t += dt;
  a.pt += dt;
  if (a.phase === 'crouch') {
    p.pose('takeoff');
    p.vx = 0;
    if (!p.grounded) a.phase = 'cruise';
    else if (a.pt > 0.3) launch(p, a);
    return;
  }
  p.fast = true;
  const cr = cruiseSpeed(p);
  // Food beats everything else up here too.
  if (a.goal !== 'food' && a.goal !== 'fish' && p.foods.length && p.data.energy > 0.1) retarget(p, a, 'food');
  const want = plan(p, a, dt, cr);
  if (p.act !== a) return;
  seek(p, a, dt, want.speed, cr);
  wings(p, a, dt, want.beat, cr);
  // Never stuck up there.
  if (a.t > a.dur + 45) p.startFall(Math.max(0, p.vy), true);
}

function plan(p: Pet, a: FlyAct, dt: number, cr: number): { speed: number; beat: number } {
  const r = p.env.rand;
  switch (a.phase) {
    case 'up':
      a.tx = p.x + p.facing * 220;
      a.ty = p.y - 300;
      if (a.pt > (a.got ? 0.5 : 0.75)) {
        a.phase = 'cruise';
        a.pt = 0;
        if (a.goal === 'land' && a.to && !a.got) {
          // Where it chose to land when it took off.
          a.phase = 'approach';
          a.fin = false;
        } else if (a.goal === 'land' || (a.got && a.goal !== 'roam')) approach(p, a);
        else waypoint(p, a);
      }
      return { speed: cr * 0.8, beat: 1 };
    case 'soar': {
      if (a.goal === 'friend') {
        const f = flyingFriend(p);
        if (f) {
          // Circle the point between the two of them.
          a.cx += ((p.x + f.x) / 2 - a.cx) * Math.min(1, dt * 0.8);
          a.cy += ((p.y + f.y) / 2 - a.cy) * Math.min(1, dt * 0.8);
        }
      } else a.cy -= 6 * dt; // riding a thermal
      const sky = airspace(p);
      a.cy = clamp(a.cy, sky.y1 + 20, sky.y2 - 30);
      a.ang += ((cr * 0.8) / a.r) * dt * a.spin;
      a.tx = a.cx + Math.cos(a.ang + a.spin * 0.6) * a.r;
      a.ty = a.cy + Math.sin(a.ang + a.spin * 0.6) * a.r * 0.3;
      if (a.pt * ((cr * 0.8) / a.r) > TAU * a.laps || a.pt > 25) {
        a.phase = 'cruise';
        a.pt = 0;
        if (a.goal === 'friend') a.goal = 'roam';
        waypoint(p, a);
      }
      return { speed: cr * 0.85, beat: 0 };
    }
    case 'glide': {
      const to = resolve(p, a.to);
      if (!to) {
        approach(p, a);
        a.phase = 'glide';
        return { speed: cr * 0.75, beat: 0 };
      }
      a.tx = a.lx;
      a.ty = to.y - 4;
      if (Math.abs(a.lx - p.x) < 160) {
        a.phase = 'approach';
        a.pt = 0;
      }
      if (a.pt > 12) approach(p, a);
      return { speed: cr * 0.75, beat: p.y > a.ty + 30 ? 0.7 : 0 };
    }
    case 'approach':
      return approachPlan(p, a, cr);
    case 'dive':
      return divePlan(p, a, cr);
    default: {
      // Cruising: goals first, then waypoints.
      const goal = goalPlan(p, a, cr);
      if (goal) return goal;
      if (Math.hypot(a.tx - p.x, a.ty - p.y) < 90) {
        a.hops--;
        if (a.hops <= 0 || a.t > a.dur) {
          approach(p, a);
          return { speed: cr, beat: -1 };
        }
        const f = flyingFriend(p);
        if (f && r() < 0.75) {
          a.goal = 'friend';
          startSoar(p, a, { x: (p.x + f.x) / 2, y: (p.y + f.y) / 2 });
          a.laps = 2;
        } else if (p.traits.soarer && r() < 0.3) startSoar(p, a);
        else waypoint(p, a);
      }
      if (a.t > a.dur + 20) approach(p, a);
      return { speed: cr, beat: -1 };
    }
  }
}

/** Butterflies, food and fish: returns what to do, or null to just cruise on. */
function goalPlan(p: Pet, a: FlyAct, cr: number): { speed: number; beat: number } | null {
  const r = p.env.rand;
  if (a.goal === 'butterfly') {
    const b = p.butterfly;
    if (!b || (b.leaving && a.pt > 3) || a.pt > 14) {
      a.goal = 'roam';
      waypoint(p, a);
      return null;
    }
    a.tx = b.x;
    a.ty = b.y + p.heightPx * 0.5;
    p.lookAt = { x: b.x, y: b.y };
    const m = p.mouthAt();
    if (Math.hypot(m.x - b.x, m.y - b.y) < 24 * Math.max(1, p.px)) {
      p.snap('jaw', 1);
      if (r() < 0.6) {
        // Caught it!
        p.butterfly = null;
        p.nextButterfly = 240 + r() * 480;
        p.sound('gulp', true);
        p.emote('note');
        p.data.happiness = clamp(p.data.happiness + 0.03, 0, 1);
      } else {
        b.leaving = true;
        b.vy = -300;
        p.emote('question');
      }
      a.goal = 'roam';
      a.hops = Math.max(a.hops, 1);
      waypoint(p, a);
    }
    return { speed: cr * 0.9, beat: -1 };
  }
  if (a.goal === 'food') {
    const food = p.foods.find((f) => !f.landed) ?? p.foods[0];
    if (!food) {
      a.goal = 'roam';
      approach(p, a);
      return null;
    }
    p.lookAt = { x: food.x, y: food.y };
    if (!food.landed) {
      // Snatch it out of the air.
      a.tx = food.x;
      a.ty = food.y + food.vy * 0.15 + p.heightPx * 0.4;
      const m = p.mouthAt();
      if (Math.hypot(m.x - food.x, m.y - food.y) < 34 * Math.max(1, p.px)) {
        snatch(p, food);
        a.got = true;
        a.goal = 'land';
        a.phase = 'up';
        a.pt = 0;
      }
      return { speed: cr * 1.15, beat: -1 };
    }
    // Landed: come down next to it (then it eats as usual; the goal stays food).
    const side = p.x < food.x ? -1 : 1;
    a.to = food.platform;
    a.lx = food.x + side * (p.margin + 10);
    a.perch = false;
    a.phase = 'approach';
    a.pt = 0;
    a.fin = false;
    return approachPlan(p, a, cr);
  }
  if (a.goal === 'fish') {
    const pd = Toys.puddleOf(p);
    if (!pd || a.pt > 20) {
      a.goal = 'land';
      approach(p, a);
      return null;
    }
    // Line up on one side, high, then dive across the water.
    const side = p.x < pd.x ? -1 : 1;
    a.tx = pd.x + side * 260;
    a.ty = pd.y - 230;
    if (Math.hypot(a.tx - p.x, a.ty - p.y) < 80) {
      a.phase = 'dive';
      a.pt = 0;
    }
    return { speed: cr, beat: -1 };
  }
  return null;
}

/** Eats food caught in the air. */
function snatch(p: Pet, food: Food) {
  p.foods = p.foods.filter((f) => f.id !== food.id);
  const d = p.data;
  if (food.golden) {
    // A growth treat is a treat either way.
    d.activeSeconds += 1800;
    p.treatReady = p.time + 90;
    p.events.push({ type: 'burst' });
    p.sound('magic');
    p.say('treat', true);
  } else {
    d.hunger = Math.max(0, d.hunger - 0.6);
    d.stats.meals++;
    p.say('feed');
  }
  d.happiness = clamp(d.happiness + 0.15, 0, 1);
  p.events.push({ type: 'save' }, { type: 'crumbs', x: p.mouthAt().x, y: p.mouthAt().y });
  p.sound('gulp');
  p.emote('heart');
}

function divePlan(p: Pet, a: FlyAct, cr: number): { speed: number; beat: number } {
  const pd = Toys.puddleOf(p);
  if (!pd || a.pt > 5) {
    a.phase = 'up';
    a.pt = 0;
    a.goal = 'land';
    return { speed: cr, beat: 1 };
  }
  const dir = sgn(pd.x - p.x || p.facing);
  a.tx = pd.x + dir * pd.w * 0.3;
  a.ty = pd.y - p.heightPx * 0.2;
  p.lookAt = { x: pd.x, y: pd.y };
  // Skims the water: snatches a fish as it passes over it.
  if (Math.abs(p.x - pd.x) < pd.w * 0.5 && p.y > pd.y - p.heightPx * 0.7) {
    p.sound('splash');
    p.fx('splash', pd.x, pd.y, p.facing, Math.max(0.9, p.px * 1.2));
    pd.fish = 'held';
    pd.left = Math.min(pd.left, 20);
    a.got = true;
    a.goal = 'fish';
    a.phase = 'up';
    a.pt = 0;
    a.gulp = 1.2;
  }
  return { speed: cr * 1.25, beat: 0 };
}

function approachPlan(p: Pet, a: FlyAct, cr: number): { speed: number; beat: number } {
  const to = resolve(p, a.to);
  if (!to || a.pt > 12) {
    // The window moved away, or this is taking too long: land somewhere below instead.
    a.to = to && a.pt <= 12 ? to : null;
    if (!a.to) {
      const g = groundOf(p);
      const below = p.platforms.filter((q) => q.y > p.y + 10 && q.x1 + p.margin < p.x && q.x2 - p.margin > p.x).sort((q1, q2) => q1.y - q2.y)[0];
      a.to = below ?? g;
      a.lx = p.x;
      a.perch = false;
      a.pt = 0;
    }
    return { speed: cr * 0.6, beat: -1 };
  }
  a.to = to;
  const m = p.margin;
  a.lx = clamp(a.lx, to.x1 + m * 0.6, to.x2 - m * 0.6);
  const dx = a.lx - p.x;
  const above = to.y - p.y;
  const high = Math.max(50, p.heightPx * 0.7);
  if (!a.fin && (Math.abs(dx) > 150 || above < high * 0.5)) {
    // Line up above the spot...
    a.tx = a.lx - sgn(dx || -p.facing) * Math.min(90, Math.abs(dx) * 0.5);
    a.ty = to.y - high;
    return { speed: cr * 0.8, beat: -1 };
  }
  // ...then come down slowly, flaring the wings.
  a.fin = true;
  if (Math.abs(dx) > 260) a.fin = false;
  a.tx = a.lx;
  a.ty = to.y + 12;
  return { speed: clamp(Math.hypot(dx, above) * 2, cr * 0.28, cr * 0.55), beat: 1 };
}

function seek(p: Pet, a: FlyAct, dt: number, speed: number, cr: number) {
  const dx = a.tx - p.x;
  const dy = a.ty - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const vxw = (dx / d) * speed;
  const vyw = clamp((dy / d) * speed, -cr * (p.traits.glider ? 0.4 : 0.6), cr * (a.phase === 'dive' ? 1.2 : 0.7));
  const acc = cr * (a.phase === 'approach' ? 2.4 : a.phase === 'dive' ? 2.6 : 1.5);
  p.vx += clamp(vxw - p.vx, -acc * dt, acc * dt);
  p.vy += clamp(vyw - p.vy, -acc * dt, acc * dt);
  // Near the edges of the screen, turn back.
  const sky = airspace(p);
  if (p.x < sky.x1 && p.vx < 0) p.vx += acc * 1.5 * dt;
  if (p.x > sky.x2 && p.vx > 0) p.vx -= acc * 1.5 * dt;
  if (p.y < sky.y1 && p.vy < 0) p.vy += acc * 1.5 * dt;
  // Faces where it's going.
  if (Math.abs(p.vx) > 25 && sgn(p.vx) !== p.facing) p.facing = sgn(p.vx);
  a.speed = Math.hypot(p.vx, p.vy);
  a.heading = Math.atan2(p.vy, p.vx);
}

function wings(p: Pet, a: FlyAct, dt: number, want: number, cr: number) {
  const r = p.env.rand;
  const tr = p.traits;
  let beat = want;
  if (beat < 0) {
    // Climbing and slow flight take work; level flight alternates flapping and gliding.
    const climbing = p.vy < -cr * 0.12;
    const slow = a.speed < cr * 0.55;
    if (a.burst > 0) {
      a.burst -= dt;
      if (a.burst <= 0) a.burst = -between(r, tr.soarer ? 1.5 : 0.8, tr.soarer ? 4 : 2.2);
    } else {
      a.burst += dt;
      if (a.burst >= 0) a.burst = between(r, 0.8, 2.2);
    }
    beat = climbing || slow ? 1 : a.burst > 0 ? 0.85 : 0;
    if (tr.glider && !climbing) beat *= 0.3;
  }
  a.beat += (beat - a.beat) * Math.min(1, dt * 4);
  const w0 = a.wing;
  a.wing += dt * TAU * beatRate(p) * (0.25 + 0.75 * a.beat);
  const stroke = Math.cos(a.wing + 0.35 * Math.sin(a.wing));
  const glide = 0.18 + 0.06 * Math.sin(a.t * 1.7);
  let flap = lerp(glide, stroke, clamp(a.beat, 0, 1));
  if (a.phase === 'dive') flap = 0.45;
  // A wing beat sound at the top of the stroke, not every one.
  if (a.beat > 0.6 && Math.floor(a.wing / TAU) !== Math.floor(w0 / TAU)) {
    a.beats++;
    if (a.phase === 'up' || a.fin || a.beats % 3 === 0) p.sound('flap', true);
  }
  // The body pitches with the climb (banking) and flares to land.
  const pitch = clamp((-p.vy / Math.max(1, cr)) * 0.75, -0.5, 0.45) + (a.fin ? 0.25 : 0);
  p.pose('fly', { pitch, tailLift: 0.1 + pitch * 0.3, neck: 0.1 - pitch * 0.2, jaw: a.gulp > 0 ? 0.25 : 0 });
  p.snap('flap', flap);
  p.rig.run = 0;
  // A fish caught on the wing gets swallowed on the way up.
  if (a.gulp > 0 && (a.gulp -= dt) <= 0) {
    const pd = Toys.puddleOf(p);
    if (pd) pd.fish = 'none';
    p.sound('gulp');
    p.emote('heart');
    p.say('fish');
    p.data.hunger = Math.max(0, p.data.hunger - 0.1);
    p.data.happiness = clamp(p.data.happiness + 0.05, 0, 1);
    a.goal = 'land';
  }
}

/** Another pet flying nearby. */
function flyingFriend(p: Pet) {
  return p.friends.find((f) => f.act === 'fly' && Math.hypot(f.x - p.x, f.y - p.y) < 900);
}

/** Perching after landing: looking around, stretching the wings, then off again (or not). */
export function thinkPerch(p: Pet, a: Extract<Act, { k: 'perch' }>, dt: number) {
  a.t += dt;
  p.brake(dt);
  const s0 = a.dur * 0.45;
  const stretch = p.winged && a.t > s0 && a.t < s0 + 1.4;
  p.pose(stretch ? 'wings' : 'alert');
  if (stretch) p.snap('flap', 0.3 + Math.sin((a.t - s0) * 4) * 0.35);
  if ((a.next -= dt) <= 0) {
    a.next = between(p.env.rand, 1.5, 3.5);
    if (p.env.rand() < 0.3) p.facing = p.facing > 0 ? -1 : 1;
  }
  if (a.t > a.dur) {
    if (p.winged && p.env.rand() < 0.45 && p.data.energy > 0.3 && startFlight(p, 'roam')) return;
    p.choose();
  }
}

/** Flying as something to do (for choosing). */
export function options(p: Pet): Partial<Record<Cat, Option[]>> {
  if (!p.winged || !p.grounded) return {};
  const tr = p.traits;
  const d = p.data;
  const lively = p.settings.activity === 'lively' ? 1 : p.settings.activity === 'normal' ? 0.5 : 0;
  const fly = (goal: FlyGoal) => () => void (startFlight(p, goal) || (p.act = p.idleAct(1)));
  if (tr.glider) {
    if (highUp(p)) return { move: [[3.2 * (0.4 + d.energy), 'glide', fly('land')]], explore: [[2, 'glide', fly('land')]] };
    return { explore: [[1.3 * (0.4 + d.energy), 'flutter', fly('land')]] };
  }
  const w = (2.2 + 1.6 * lively) * (0.3 + d.energy);
  return { move: [[w, 'fly', fly('roam')]], explore: [[w * 0.8, 'fly', fly('roam')]] };
}
