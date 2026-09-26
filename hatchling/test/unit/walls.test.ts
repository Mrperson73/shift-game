import { describe, expect, it } from 'vitest';
import { BRACHIO, RAPTOR, REX } from '../../src/pet/species';
import { startFunClimb } from '../../src/sim/walls';
import { ground } from '../../src/sim/world';
import { choices, H, keepFresh, make, MICRO, sane, W, windowAt } from './sim-helpers';

describe('climbing walls for fun', () => {
  it('climbs the screen edges now and then when lively, clings on looking around, and gets back down', () => {
    const { pet, run } = make({ species: RAPTOR, seed: 3, settings: { activity: 'lively' } });
    let clings = 0;
    let edges = 0;
    let highest = 0;
    let was = false;
    let looked = 0;
    run(6 * 60, () => {
      sane(pet);
      keepFresh(pet);
      const a = pet.act;
      if (a.k === 'cling') {
        if (!was) {
          clings++;
          if (a.wall.id.startsWith('edge:')) edges++;
        }
        highest = Math.max(highest, H - pet.y);
        // Clinging on: rotated flat against the wall, feet on it.
        expect(Math.abs(Math.abs(pet.rot) - Math.PI / 2)).toBeLessThan(1e-6);
        expect(pet.x).toBe(a.wall.x);
        if (pet.lookAt) looked++;
      }
      was = a.k === 'cling';
    });
    expect(clings).toBeGreaterThan(1);
    expect(edges).toBeGreaterThan(0);
    expect(highest).toBeGreaterThan(pet.heightPx * 1.5);
    expect(looked).toBeGreaterThan(30);
  }, 120_000);

  it('climbs window sides for fun too', () => {
    const { pet, run } = make({ species: RAPTOR, seed: 4, settings: { activity: 'lively' } });
    const w = windowAt('w', 500, 1100, 250, H);
    pet.setWorld(W, H, [ground(W, H), w.p], w.walls);
    pet.setEdges('exit', 'exit');
    let window = 0;
    run(8 * 60, () => {
      sane(pet);
      keepFresh(pet);
      if (pet.act.k === 'cling' && pet.act.wall.win === 'w') window++;
    });
    expect(window).toBeGreaterThan(0);
  }, 120_000);

  it("doesn't climb edges that lead to another monitor", () => {
    const { pet, run } = make({ species: RAPTOR, seed: 3, settings: { activity: 'lively' } });
    pet.setEdges('exit', 'exit');
    let clung = false;
    run(5 * 60, () => {
      keepFresh(pet);
      if (pet.act.k === 'cling') clung = true;
    });
    expect(clung).toBe(false);
    expect(pet.world.walls.some((w) => w.id.startsWith('edge:'))).toBe(false);
  }, 120_000);

  it('gets down every way: climbing down, jumping off, letting go', () => {
    for (const then of ['down', 'jump', 'drop'] as const) {
      for (const species of [REX, BRACHIO, MICRO]) {
        const { pet, run } = make({ species, seed: 5, x: 0.2 });
        run(1);
        const edge = pet.world.walls.find((w) => w.id === 'edge:L')!;
        expect(startFunClimb(pet, edge)).toBe(true);
        run(30, () => {
          sane(pet);
          if (pet.act.k === 'cling') {
            pet.act.then = then;
            return true;
          }
        });
        expect(pet.act.k, `${species.id} ${then}`).toBe('cling');
        run(30, () => {
          sane(pet);
          return pet.grounded && pet.act.k !== 'land' && pet.act.k !== 'move' && pet.act.k !== 'fly';
        });
        expect(pet.grounded, `${species.id} ${then}`).toBe(true);
        expect(pet.y).toBe(H);
        expect(pet.rot).toBe(0);
      }
    }
  });

  it('gets down quickly when there is food', () => {
    for (const [species, stage] of [[RAPTOR, 'cling'], [REX, 'cling'], [RAPTOR, 'climb'], [MICRO, 'cling']] as const) {
      const { pet, run } = make({ species, seed: 5, x: 0.2 });
      run(1);
      const edge = pet.world.walls.find((w) => w.id === 'edge:L')!;
      expect(startFunClimb(pet, edge)).toBe(true);
      run(30, () => pet.act.k === stage && (stage === 'cling' || H - pet.y > pet.heightPx));
      expect(pet.act.k).toBe(stage);
      pet.feed();
      // Down and on its way to the food in a moment (the food takes about a second to land).
      const t = run(20, () => {
        sane(pet);
        return pet.grounded && (pet.act.k === 'travel' || pet.act.k === 'eat');
      });
      expect(t, `${species.id} ${stage}`).toBeLessThan(3);
      run(10, () => pet.data.stats.meals > 0);
      expect(pet.data.stats.meals).toBe(1);
    }
  });

  it('climbs for fun a lot less when calm', () => {
    const count = (activity: 'calm' | 'lively') => {
      const { pet, run } = make({ species: RAPTOR, seed: 6, settings: { activity } });
      run(0.5);
      return choices(pet, 1500).get('climb') ?? 0;
    };
    expect(count('calm') * 3).toBeLessThan(count('lively'));
  });
});
