// The pet's world: the ground (top of the taskbar), the visible top edges of windows, and the
// sides of windows it can climb.

import type { Platform, Wall } from '../shared/types';

export interface World {
  width: number;
  height: number;
  platforms: Platform[];
  walls: Wall[];
}

export const GROUND = 'ground';

export function ground(w: number, h: number): Platform {
  return { id: GROUND, x1: 0, x2: w, y: h, win: null, wx: 0, wy: h };
}

/** Platforms with enough room above them for a pet of the given height. */
export function usable(world: Pick<World, 'platforms' | 'height'>, petHeight: number, minWidth: number): Platform[] {
  return world.platforms.filter((p) => p.id === GROUND || (p.y >= petHeight * 0.85 && p.x2 - p.x1 >= minWidth && p.y < world.height - 4));
}

/** The highest platform the pet passes through when moving from y0 down to y1 at x. */
export function landingOn(platforms: Platform[], x: number, y0: number, y1: number): Platform | null {
  let best: Platform | null = null;
  for (const p of platforms) {
    if (x < p.x1 || x > p.x2) continue;
    if (p.y + 0.5 < y0 || p.y > y1) continue;
    if (!best || p.y < best.y) best = p;
  }
  return best;
}

/** The platform directly below a point (the one it would land on if dropped). */
export function below(platforms: Platform[], x: number, y: number): Platform | null {
  return landingOn(platforms, x, y, Infinity);
}

export type Hop =
  | { kind: 'walk'; fromX: number; toX: number; to: Platform }
  | { kind: 'drop'; fromX: number; toX: number; to: Platform }
  | { kind: 'jump'; fromX: number; toX: number; to: Platform }
  /** Walk to the foot of a window side, climb it and step onto the window's top. */
  | { kind: 'climbUp'; fromX: number; toX: number; to: Platform; wall: Wall }
  /** Climb down a window side from its top, then drop onto whatever is below. */
  | { kind: 'climbDown'; fromX: number; toX: number; to: Platform; wall: Wall };

export interface Abilities {
  /** Highest jump, px. */
  maxUp: number;
  /** Highest it can leap to grab the side of a window and start climbing, px. */
  maxReach: number;
  /** Widest gap it jumps across, px. */
  maxGap: number;
  /** Highest it will drop off an edge instead of climbing down, px. */
  maxDrop: number;
  /** Half the body length: how far from edges it stands, px. */
  margin: number;
}

/**
 * The window-top platform a wall leads to: the visible part of that window's top edge nearest to
 * the wall (top edges skip the window icon and caption buttons, so it may start a bit inside).
 */
export function wallTop(platforms: Platform[], w: Wall, margin: number): Platform | null {
  let best: Platform | null = null;
  let bestD = 220 + margin;
  for (const p of platforms) {
    if (p.win !== w.win || Math.abs(p.y - w.y1) > 3) continue;
    const d = w.side === 'left' ? p.x1 - w.x : w.x - p.x2;
    if (d > -margin && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Where the pet stands on its current platform to start climbing a wall (outside the window). */
export function wallFoot(w: Wall, margin: number) {
  return w.side === 'left' ? w.x - margin * 0.9 : w.x + margin * 0.9;
}

/**
 * A route from platform `from` (standing at x) to platform `to`: walk, drop off edges, jump and
 * climb window sides. Returns the first hop of the shortest route, or null if unreachable.
 */
export function route(platforms: Platform[], walls: Wall[], from: Platform, x: number, to: Platform, targetX: number, ab: Abilities): Hop | null {
  if (from.id === to.id) return { kind: 'walk', fromX: x, toX: targetX, to };
  const m = ab.margin;
  const edges = (p: Platform): Hop[] => {
    const out: Hop[] = [];
    for (const q of platforms) {
      if (q.id === p.id) continue;
      // Drop off an edge of p onto q below.
      if (q.y > p.y + 2 && q.y - p.y <= ab.maxDrop) {
        for (const edge of [p.x1 - m * 0.6, p.x2 + m * 0.6]) {
          if (edge < 0) continue;
          const land = below(platforms.filter((z) => z.y > p.y + 2), edge, p.y + 1);
          if (land && land.id === q.id) out.push({ kind: 'drop', fromX: edge < p.x1 ? p.x1 + m * 0.65 : p.x2 - m * 0.65, toX: edge, to: q });
        }
      }
      // Jump up to maxUp, or down, across a gap of at most maxGap.
      const up = p.y - q.y;
      if (up <= ab.maxUp && -up <= ab.maxDrop) {
        const lo = Math.max(p.x1 + m, q.x1 + m);
        const hi = Math.min(p.x2 - m, q.x2 - m);
        if (lo <= hi) {
          const mx = (lo + hi) / 2;
          if (up > 4) out.push({ kind: 'jump', fromX: mx, toX: mx, to: q });
        } else {
          const gap = q.x1 > p.x2 ? q.x1 - p.x2 : p.x1 - q.x2;
          if (gap <= ab.maxGap && q.x2 - q.x1 > m * 2) {
            const right = q.x1 > p.x2;
            out.push({ kind: 'jump', fromX: right ? p.x2 - m : p.x1 + m, toX: right ? q.x1 + m : q.x2 - m, to: q });
          }
        }
      }
    }
    for (const w of walls) {
      const top = wallTop(platforms, w, m);
      if (!top) continue;
      // Climb up: the foot of the wall is on p (or within a jump of it).
      if (top.id !== p.id && w.y1 < p.y - 4) {
        const foot = wallFoot(w, m);
        const reach = p.y - Math.min(w.y2, p.y);
        if (foot >= p.x1 + m * 0.3 && foot <= p.x2 - m * 0.3 && reach <= ab.maxReach) {
          const inside = w.side === 'left' ? w.x + m * 0.8 : w.x - m * 0.8;
          out.push({ kind: 'climbUp', fromX: foot, toX: inside, to: top, wall: w });
        }
      }
      // Climb down from p (the window's top) and drop onto what's below the wall's foot.
      if (top.id === p.id) {
        const foot = wallFoot(w, m);
        // It climbs down until it reaches a platform at the wall's foot, or the bottom of the wall
        // and then drops the rest of the way.
        const land = below(platforms.filter((z) => z.id !== p.id), foot, w.y1 + 2);
        if (land && land.y - Math.min(w.y2, land.y) <= ab.maxDrop) {
          // Stand as close to that side as the platform allows (it stops short of icons and buttons).
          const inside = w.side === 'left' ? w.x + m * 0.8 : w.x - m * 0.8;
          const fromX = Math.min(Math.max(inside, p.x1 + m * 0.65), p.x2 - m * 0.65);
          out.push({ kind: 'climbDown', fromX, toX: foot, to: land, wall: w });
        }
      }
    }
    return out;
  };
  // Breadth-first search over platforms.
  const firstHop = new Map<string, Hop>();
  const queue: Platform[] = [from];
  const seen = new Set([from.id]);
  while (queue.length) {
    const p = queue.shift()!;
    for (const h of edges(p)) {
      if (seen.has(h.to.id)) continue;
      seen.add(h.to.id);
      firstHop.set(h.to.id, p.id === from.id ? h : firstHop.get(p.id)!);
      if (h.to.id === to.id) return firstHop.get(to.id)!;
      queue.push(h.to);
    }
  }
  return null;
}

/**
 * Carry a standing pet along with its window: returns the moved position, or null if the pet's
 * spot is gone (window closed, minimised, or that part of it is now covered).
 */
export function ride(old: Platform, platforms: Platform[], x: number): { p: Platform; x: number } | null {
  if (old.win === null) {
    const g = platforms.find((p) => p.id === GROUND);
    return g ? { p: g, x: Math.min(Math.max(x, g.x1), g.x2) } : null;
  }
  const same = platforms.filter((p) => p.win === old.win);
  if (!same.length) return null;
  const nx = x + (same[0].wx - old.wx);
  const hit = same.find((p) => nx >= p.x1 - 2 && nx <= p.x2 + 2);
  return hit ? { p: hit, x: nx } : null;
}

/** Carry a climbing pet along with its window side. */
export function rideWall(old: Wall, walls: Wall[], y: number): { w: Wall; y: number } | null {
  const w = walls.find((z) => z.win === old.win && z.side === old.side);
  if (!w) return null;
  return { w, y: y + (w.wy - old.wy) };
}
