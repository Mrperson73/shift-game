import { describe, expect, it } from 'vitest';
import type { Platform } from '../../src/shared/types';
import type { Wall } from '../../src/shared/types';
import { type Abilities, below, ground, landingOn, ride, rideWall, route, usable } from '../../src/sim/world';

const ab = (maxUp: number, maxGap = 150, maxDrop = 1000, maxReach = maxUp): Abilities => ({ maxUp, maxReach, maxGap, maxDrop, margin: 30 });

const win = (id: string, x1: number, x2: number, y: number, wx = x1 - 40): Platform => ({ id, x1, x2, y, win: id, wx, wy: y });

describe('world', () => {
  const g = ground(1000, 700);
  const a = win('a', 100, 400, 400);
  const b = win('b', 500, 800, 250);

  it('lands on the highest platform crossed', () => {
    expect(landingOn([g, a, b], 200, 0, 800)?.id).toBe('a');
    expect(landingOn([g, a, b], 450, 0, 800)?.id).toBe('ground');
    expect(landingOn([g, a, b], 200, 401, 800)?.id).toBe('ground');
    expect(below([g, a, b], 600, 100)?.id).toBe('b');
  });

  it('drops platforms without headroom or too narrow', () => {
    const low = win('low', 0, 500, 40);
    const thin = win('thin', 0, 30, 300);
    const ids = usable({ height: 700, platforms: [g, a, low, thin] }, 100, 60).map((p) => p.id);
    expect(ids).toEqual(['ground', 'a']);
  });

  it('routes by dropping down and jumping up', () => {
    const plats = [g, a, b];
    // From the ground to window a (300 up): needs a big enough jump.
    const up = route(plats, [], g, 600, a, 250, ab(320));
    expect(up?.kind).toBe('jump');
    expect(route(plats, [], g, 600, a, 250, ab(250))).toBeNull();
    // Window b is 450 up, but reachable in two hops via a (a -> b: 150 up, 100 gap).
    expect(route(plats, [], g, 600, b, 600, ab(320))).toMatchObject({ kind: 'jump', to: { id: 'a' } });
    // From b down to the ground: drop off an edge, unless that's too far to fall.
    expect(route(plats, [], b, 650, g, 900, ab(200))?.kind).toBe('drop');
    // (It can hop down onto a first and drop 300 from there, but not with a 250 limit.)
    expect(route(plats, [], b, 650, g, 900, ab(200, 150, 300))?.kind).toBe('jump');
    expect(route(plats, [], b, 650, g, 900, ab(200, 150, 250))).toBeNull();
    // Same platform: just walk.
    expect(route(plats, [], a, 150, a, 300, ab(0))?.kind).toBe('walk');
  });

  it('climbs window sides it cannot jump to, and climbs back down', () => {
    // A tall window: top at 150, bottom at 650 (50 above the ground at 700).
    const top = win('t', 340, 860, 150, 300);
    const walls: Wall[] = [
      { id: 't:L', win: 't', side: 'left', x: 300, y1: 150, y2: 650, wx: 300, wy: 150 },
      { id: 't:R', win: 't', side: 'right', x: 900, y1: 150, y2: 650, wx: 300, wy: 150 },
    ];
    const plats = [g, top];
    const hop = route(plats, walls, g, 100, top, 600, ab(120));
    expect(hop).toMatchObject({ kind: 'climbUp', wall: { side: 'left' }, to: { id: 't' } });
    expect(hop!.fromX).toBeLessThan(300);
    // The foot of the wall is out of jump range: unreachable.
    expect(route(plats, walls, g, 100, top, 600, ab(30))).toBeNull();
    // Down again: climb down the nearer side and drop the last bit.
    const down = route(plats, walls, top, 800, g, 950, ab(120, 150, 200));
    expect(down).toMatchObject({ kind: 'climbDown', to: { id: 'ground' } });
    expect(rideWall(walls[0], [{ ...walls[0], x: 320, wx: 320, wy: 170 }], 400)).toEqual({ w: { ...walls[0], x: 320, wx: 320, wy: 170 }, y: 420 });
  });

  it('carries the pet along with a moving window', () => {
    const moved = win('a', 150, 450, 380, 110);
    const r = ride(a, [g, moved], 200);
    expect(r?.x).toBe(250);
    expect(r?.p.y).toBe(380);
    expect(ride(a, [g], 200)).toBeNull();
    // Part of the window is now covered: the pet's spot is gone.
    const split = [win('a', 100, 180, 400, 60), { ...win('a', 300, 400, 400, 60), id: 'a:2' }];
    expect(ride(a, [g, ...split], 250)).toBeNull();
  });
});
