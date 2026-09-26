// Monitors: which screen edges lead to the next monitor, which monitor a point is on, and a fake
// two-monitor layout for tests. Pure functions over rectangles in Electron's DIP coordinates;
// main.ts feeds them the real displays.

import type { EdgeKind } from '../sim/pet';
import type { Area } from './geometry';

export interface Mon {
  id: number;
  /** The whole screen. */
  bounds: Area;
  /** The screen minus its taskbar: the overlay covers this, and its bottom is the ground. */
  workArea: Area;
  label: string;
  primary: boolean;
}

/** Screens closer than this count as touching (rounding with mixed scale factors). */
const TOUCH = 8;
/** Side-by-side screens must overlap vertically by this much for a dino to walk across. */
const MIN_OVERLAP = 120;

const overlapY = (a: Area, b: Area) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

/**
 * The monitor on the `side` of `m` that a dino walks onto: its screen touches that edge and
 * overlaps `m` vertically. With several, the one at height `y` (global), else the biggest overlap.
 */
export function neighbour(mons: Mon[], m: Mon, side: 'left' | 'right', y?: number): Mon | null {
  const a = m.bounds;
  let best: Mon | null = null;
  let bestScore = -Infinity;
  for (const n of mons) {
    if (n.id === m.id) continue;
    const b = n.bounds;
    const gap = side === 'right' ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
    const over = overlapY(a, b);
    if (Math.abs(gap) > TOUCH || over < Math.min(MIN_OVERLAP, a.height / 2, b.height / 2)) continue;
    const score = over + (y !== undefined && y >= b.y && y < b.y + b.height ? 1e6 : 0);
    if (score > bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}

/** What each side of `m` is for a dino walking into it: the way to another monitor, or a wall. */
export function edgesOf(mons: Mon[], m: Mon): { left: EdgeKind; right: EdgeKind } {
  return { left: neighbour(mons, m, 'left') ? 'exit' : 'wall', right: neighbour(mons, m, 'right') ? 'exit' : 'wall' };
}

/** The other monitors' work areas, in `m`'s overlay coordinates. */
export function othersOf(mons: Mon[], m: Mon): Area[] {
  const o = m.workArea;
  return mons.filter((n) => n.id !== m.id).map((n) => ({ x: n.workArea.x - o.x, y: n.workArea.y - o.y, width: n.workArea.width, height: n.workArea.height }));
}

/** The monitor a point (global DIPs) is on, or the nearest one. */
export function monitorAt(mons: Mon[], x: number, y: number): Mon {
  let best = mons[0];
  let bestD = Infinity;
  for (const m of mons) {
    const b = m.bounds;
    const dx = Math.max(b.x - x, 0, x - (b.x + b.width - 1));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.height - 1));
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

/** Tests only: one screen split into `n` monitors side by side (the first is the main one). */
export function splitMonitor(m: Mon, n: number): Mon[] {
  const out: Mon[] = [];
  const w = Math.floor(m.bounds.width / n);
  for (let i = 0; i < n; i++) {
    const x1 = m.bounds.x + i * w;
    const x2 = i === n - 1 ? m.bounds.x + m.bounds.width : x1 + w;
    const wx1 = Math.max(x1, m.workArea.x);
    const wx2 = Math.min(x2, m.workArea.x + m.workArea.width);
    out.push({
      id: i + 1,
      bounds: { x: x1, y: m.bounds.y, width: x2 - x1, height: m.bounds.height },
      workArea: { x: wx1, y: m.workArea.y, width: Math.max(0, wx2 - wx1), height: m.workArea.height },
      label: `Test screen ${i + 1}`,
      primary: i === 0,
    });
  }
  return out;
}
