// Climbing walls just for fun: the screen edges (when they're walls, not the way to another
// monitor) and the sides of windows. It walks to the foot of the wall, climbs up partway, clings
// there looking around, then climbs back down, jumps off or lets go.

import { clamp } from '../pet/math';
import type { Platform, Wall } from '../shared/types';
import { between, type Option, pickWeighted } from './common';
import type { Act, EdgeKind, Pet } from './pet';
import { wallFoot } from './world';

type Cat = 'rest' | 'move' | 'play' | 'express' | 'social' | 'explore';
type ClingAct = Extract<Act, { k: 'cling' }>;

/** The screen edges as climbable walls (an 'exit' edge leads to the next monitor instead).
 * The pet climbs on the inside of the screen, like on the outside of a window: the left edge is
 * the "right side" of what's beyond it. */
export function edgeWalls(edges: { left: EdgeKind; right: EdgeKind }, width: number, height: number): Wall[] {
  const out: Wall[] = [];
  if (edges.left === 'wall') out.push({ id: 'edge:L', win: 'edge:L', side: 'right', x: 0, y1: 0, y2: height, wx: 0, wy: 0 });
  if (edges.right === 'wall') out.push({ id: 'edge:R', win: 'edge:R', side: 'left', x: width, y1: 0, y2: height, wx: 0, wy: 0 });
  return out;
}

export const isEdge = (w: Wall) => w.id.startsWith('edge:');

/** Which way is away from the wall, into open space. */
const outward = (w: Wall) => (w.side === 'left' ? -1 : 1);

/** Walls it can walk to on its platform and climb for fun. */
export function funWalls(p: Pet): Wall[] {
  const pl = p.platform;
  const m = p.margin;
  const out: Wall[] = [];
  for (const w of p.world.walls) {
    // Staying on the taskbar (exploring off): only the screen edges.
    if (!p.settings.explore && !isEdge(w)) continue;
    const foot = wallFoot(w, m);
    if (foot < pl.x1 + m * 0.3 || foot > pl.x2 - m * 0.3) continue;
    // It rises from (about) this platform, and high enough to be worth it.
    if (w.y2 < pl.y - p.heightPx * 1.2 || w.y1 > pl.y - p.heightPx * 3) continue;
    out.push(w);
  }
  return out;
}

/** Climbing a wall as something to do (for choosing). */
export function options(p: Pet): Partial<Record<Cat, Option[]>> {
  if (!p.grounded || p.anchored) return {};
  const walls = funWalls(p).filter((z) => Math.abs(wallFoot(z, p.margin) - p.x) < 1000);
  if (!walls.length) return {};
  const lively = p.settings.activity === 'lively' ? 1 : p.settings.activity === 'normal' ? 0.4 : 0.08;
  const pers = p.species.personality;
  const w = (0.05 + 0.45 * lively) * (0.45 + pers.jump + 0.3 * pers.playfulness) * (p.traits.heavy ? 0.4 : 1) * (0.3 + p.data.energy);
  const go = () => {
    // Walls nearby are more tempting; the screen edges are the big ones.
    const wall = pickWeighted(p.env.rand, walls.map((z) => [(isEdge(z) ? 1.5 : 1) / (1 + Math.abs(wallFoot(z, p.margin) - p.x) / 350), z] as const));
    if (!wall || !startFunClimb(p, wall)) p.act = p.idleAct(1);
  };
  return { play: [[w, 'climb', go]] };
}

/** Heads for the foot of a wall to climb it. */
export function startFunClimb(p: Pet, w: Wall): boolean {
  if (!p.grounded || p.anchored) return false;
  const top = Math.max(w.y1 + p.margin * 1.5, 40 + p.heightPx * 1.2);
  const bottom = Math.min(p.platform.y, w.y2) - p.heightPx * 0.2;
  if (bottom - top < p.heightPx * 1.5) return false;
  // Partway up: at least a couple of body heights, not too far (it climbs back down, too).
  const up = Math.min((bottom - top) * between(p.env.rand, 0.25, 0.6), 480 * Math.max(0.8, p.px));
  const stopY = clamp(bottom - Math.max(up, p.heightPx * 1.5), top, bottom - p.heightPx * 1.4);
  p.act = { k: 'climbfun', wall: w, t: 0, stopY };
  return true;
}

export function thinkClimbFun(p: Pet, a: Extract<Act, { k: 'climbfun' }>, dt: number) {
  a.t += dt;
  const w = a.wall;
  const foot = wallFoot(w, p.margin);
  const far = Math.abs(foot - p.x) > 220;
  p.rig.run = far ? 1 : 0;
  p.pose('alert', { tailLift: 0.25 });
  p.lookAt = { x: w.x, y: Math.max(a.stopY - 100, 0) };
  // Food on its way: never mind the wall.
  if (a.t > 15 || p.foods.length || (w.y2 < p.platform.y - p.heightPx * 1.2 && !isEdge(w))) {
    p.act = p.idleAct(1);
    return;
  }
  if (!p.walkTo(foot, far, dt)) return;
  // At the foot: up it goes, fast.
  const left = w.side === 'left';
  const r1 = left ? -Math.PI / 2 : Math.PI / 2;
  p.facing = left ? 1 : -1;
  p.grounded = false;
  const startY = Math.min(p.y, w.y2) - p.heightPx * 0.15;
  const climb: Act = { k: 'climb', wall: w, dir: 'up', t: 0, top: null, land: p.platform, resume: null, stopY: a.stopY, speed: Math.max(p.climbSpeed * 2, 110 * Math.max(0.7, p.px)) };
  const dy = Math.abs(p.y - startY);
  p.act = { k: 'move', t: 0, dur: 0.28 + Math.sqrt(dy) * 0.02, from: { x: p.x, y: p.y }, to: { x: w.x, y: startY }, r0: 0, r1, arc: dy > 20 ? 0 : p.heightPx * 0.2, next: climb, platform: null, wall: w };
  p.sound('whoosh', true);
}

/** Reached the spot on the wall it was climbing to (called from the climb act). */
export function startCling(p: Pet, w: Wall, land: Platform | null) {
  const r = p.env.rand;
  const high = (land?.y ?? p.world.height) - p.y;
  // How to get down again: flyers like to let go (and fly), heavy ones climb down.
  const then = pickWeighted(r, [
    [p.traits.heavy ? 3 : 1.6, 'down'],
    [p.traits.heavy ? 0.3 : 1.2, 'jump'],
    [p.winged ? 3 : high < p.heightPx * 5 ? 0.9 : 0.4, 'drop'],
  ] as const) ?? 'down';
  p.act = { k: 'cling', wall: w, t: 0, dur: between(r, 2.2, 5), next: 0.6, then, land };
  p.vx = 0;
  p.vy = 0;
}

export function thinkCling(p: Pet, a: ClingAct, dt: number) {
  const r = p.env.rand;
  a.t += dt;
  const w = a.wall;
  const out = outward(w);
  p.x = w.x;
  p.vx = 0;
  p.vy = 0;
  // Looking around: up the wall, out over the screen, down, back.
  if ((a.next -= dt) <= 0) {
    a.next = between(r, 0.8, 1.8);
    if (r() < 0.25) p.tailKick = (r() < 0.5 ? -1 : 1) * 9000;
  }
  const look = Math.floor(a.t / 1.3) % 4;
  p.lookAt = look === 0 ? { x: w.x + out * 60, y: p.y - 400 } : look === 1 ? { x: w.x + out * 500, y: p.y - 60 } : look === 2 ? { x: w.x + out * 80, y: p.y + 400 } : { x: w.x + out * 300, y: p.y - 200 };
  p.pose('cling', { tailWag: 0.12 });
  // Food! It spots it and gets down the quick way (flyers let go and fly to it).
  const food = p.foods[0];
  if (food && a.dur > a.t + 0.35) {
    a.dur = a.t + 0.35;
    a.then = p.winged ? 'drop' : 'jump';
    p.emote('exclaim');
  }
  if (food) p.lookAt = { x: food.x, y: food.y };
  else if (a.t > 0.7 && a.t - dt <= 0.7) p.emote(r() < 0.5 ? 'note' : 'exclaim');
  if (a.t < a.dur && a.t < 12) return;
  // Time to get down.
  if (a.then === 'down') {
    // Turn head-down on the wall and climb.
    p.facing = p.facing > 0 ? -1 : 1;
    p.act = { k: 'climb', wall: w, dir: 'down', t: 0, top: null, land: a.land, resume: null, speed: Math.max(p.climbSpeed * 1.6, 90 * Math.max(0.7, p.px)) };
    return;
  }
  p.rot = 0;
  p.x = w.x + out * p.margin * 0.6;
  p.facing = out;
  if (a.then === 'jump') {
    // Push off into a leap.
    p.vx = out * between(r, 170, 260) * Math.max(0.7, p.px);
    p.sound('whoosh', true);
    p.startFall(-between(r, 260, 380) * Math.max(0.7, p.px), true);
  } else {
    // Just let go.
    p.vx = out * 40;
    p.startFall(0, false);
  }
}
