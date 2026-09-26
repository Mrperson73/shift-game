import { describe, expect, it } from 'vitest';
import { rng } from '../../src/pet/math';
import { REX } from '../../src/pet/species';
import { DEFAULT_SETTINGS, newPet } from '../../src/shared/types';
import { Pet, type SimEvent } from '../../src/sim/pet';
import { ground } from '../../src/sim/world';

const W = 1200;
const H = 800;

function make(hatched = true) {
  let now = 1_700_000_000_000;
  const data = newPet('rex', 0, 'Test', now);
  if (hatched) data.hatchedAt = now;
  data.activeSeconds = 10 * 3600;
  data.x = 0.8;
  const pet = new Pet(data, REX, { ...DEFAULT_SETTINGS }, { width: W, height: H, platforms: [ground(W, H)], walls: [] }, { rand: rng(3), hour: () => 14, now: () => now });
  const events: SimEvent[] = [];
  /** Runs for up to `seconds`, stopping early once `until` holds; true if it did. */
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      now += 1000 / 30;
      pet.update(1 / 30);
      events.push(...pet.drain());
      if (until?.()) return true;
    }
    return false;
  };
  const exited = () => events.some((e) => e.type === 'exit');
  return { pet, run, events, exited };
}

describe('moving to another monitor', () => {
  it('walks off an exit edge, and says so once it is out of sight', () => {
    const { pet, run, events, exited } = make();
    // Screen edges are walls unless there's a monitor there.
    expect(pet.leave('right')).toBe(false);
    pet.setEdges('wall', 'exit');
    expect(pet.leave('left')).toBe(false);
    expect(pet.leave('right')).toBe(true);
    expect(run(120, exited)).toBe(true);
    expect(events.filter((e) => e.type === 'exit')).toEqual([{ type: 'exit', side: 'right', y: H, ground: true }]);
    expect(pet.x).toBeGreaterThan(W);
    expect(pet.crossing).toBeNull();
  });

  it("isn't pulled back on screen by a world update while it crosses", () => {
    const { pet, run, events, exited } = make();
    pet.setEdges('wall', 'exit');
    pet.leave('right');
    run(60, () => pet.x > W + 5);
    const x = pet.x;
    pet.setWorld(W, H - 20, [ground(W, H - 20)], []);
    expect(pet.x).toBe(x);
    run(60, exited);
    expect(events.find((e) => e.type === 'exit')).toMatchObject({ side: 'right', y: H - 20 });
  });

  it('walks in from the edge it arrives at', () => {
    const { pet, run } = make();
    pet.setEdges('exit', 'wall');
    pet.enter('left', H, true);
    expect(pet.x).toBeLessThan(0);
    expect(pet.facing).toBe(1);
    expect(run(60, () => pet.crossing === null)).toBe(true);
    run(10);
    expect(pet.x).toBeGreaterThan(0);
    expect(pet.x).toBeLessThan(W);
    expect(pet.grounded).toBe(true);
  });

  it('stops leaving when something else comes up (picked up)', () => {
    const { pet, run, exited } = make();
    pet.setEdges('wall', 'exit');
    pet.leave('right');
    run(1);
    pet.grab({ x: pet.x, y: pet.y - 10 });
    pet.release();
    run(8);
    expect(exited()).toBe(false);
    expect(pet.crossing).toBeNull();
    expect(pet.x).toBeLessThanOrEqual(W);
  });

  it('can be dropped in from another monitor', () => {
    const { pet, run } = make();
    pet.dropIn(300, 200);
    expect(pet.grounded).toBe(false);
    expect(run(5, () => pet.grounded)).toBe(true);
    expect(pet.y).toBe(H);
    expect(pet.x).toBeCloseTo(300, -1);
  });

  it("eggs and sleeping dinos don't wander off", () => {
    const egg = make(false);
    egg.pet.setEdges('exit', 'exit');
    expect(egg.pet.leave('left')).toBe(false);
    const sleepy = make();
    sleepy.pet.setEdges('exit', 'exit');
    sleepy.pet.sleepNow();
    expect(sleepy.pet.leave('left')).toBe(false);
  });
});
