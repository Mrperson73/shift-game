import { describe, expect, it } from 'vitest';
import { startForage } from '../../src/sim/fidgets';
import { startFlight } from '../../src/sim/flight';
import { ground } from '../../src/sim/world';
import { choices, H, keepFresh, make, MICRO, PTERA, sane, W, windowAt } from './sim-helpers';

const twoWindows = () => [windowAt('a', 150, 760, 520, 800), windowAt('b', 780, 1400, 380, 700)];

describe('flying', () => {
  it('takes off, flies about over the screen and lands on a platform', () => {
    const { pet, run, sounds } = make({ species: PTERA, seed: 2, hours: 60 });
    const ws = twoWindows();
    pet.setWorld(W, H, [ground(W, H), ...ws.map((w) => w.p)], ws.flatMap((w) => w.walls));
    run(1);
    pet.special();
    expect(pet.act.k).toBe('fly');
    let flew = 0;
    let top = H;
    let flapLo = 1;
    let flapHi = -1;
    let fastest = 0;
    let landed: string | null = null;
    run(90, () => {
      sane(pet);
      if (pet.flying) {
        flew += 1 / 30;
        top = Math.min(top, pet.y);
        flapLo = Math.min(flapLo, pet.rig.pose.flap);
        flapHi = Math.max(flapHi, pet.rig.pose.flap);
        fastest = Math.max(fastest, Math.hypot(pet.vx, pet.vy));
        if (flew > 0.1) {
          expect(pet.rig.target.fly).toBe(1);
          expect(pet.rig.legMode).toBe('air');
        }
      }
      if (flew > 1 && pet.grounded && pet.act.k !== 'fly') {
        landed = pet.platform.id;
        return true;
      }
    });
    expect(flew).toBeGreaterThan(5);
    expect(H - top).toBeGreaterThan(200);
    // It flapped (wings up and down) and flew at a good speed.
    expect(flapHi - flapLo).toBeGreaterThan(1.2);
    // An adult cruises at 300-500 px/s.
    expect(fastest).toBeGreaterThan(300);
    expect(fastest).toBeLessThan(700);
    expect(landed).not.toBeNull();
    expect(pet.y).toBe(pet.platform.y);
    expect(sounds()).toContain('flap');
  });

  it('flies a lot on its own, lands on windows, perches, and never leaves the screen', () => {
    const { pet, run } = make({ species: PTERA, seed: 7 });
    const ws = twoWindows();
    pet.setWorld(W, H, [ground(W, H), ...ws.map((w) => w.p)], ws.flatMap((w) => w.walls));
    let flights = 0;
    let flying = 0;
    let was = false;
    const landedOn = new Set<string>();
    let perched = false;
    let soared = false;
    run(12 * 60, () => {
      sane(pet);
      keepFresh(pet);
      const now = pet.act.k === 'fly';
      if (now && !was) flights++;
      if (was && !now && pet.grounded) landedOn.add(pet.platform.id);
      was = now;
      if (now) flying++;
      if (pet.act.k === 'fly' && pet.act.phase === 'soar') soared = true;
      if (pet.act.k === 'perch') perched = true;
    });
    expect(flights).toBeGreaterThan(3);
    expect(flying / (12 * 60 * 30)).toBeGreaterThan(0.1);
    expect([...landedOn].some((id) => id !== 'ground')).toBe(true);
    expect(perched).toBe(true);
    expect(soared).toBe(true);
  }, 120_000);

  it('can be grabbed out of the air, and flies off again when let go high up', () => {
    const { pet, run } = make({ species: PTERA, seed: 3 });
    run(1);
    pet.special();
    run(3);
    expect(pet.flying).toBe(true);
    const at = { x: pet.x, y: pet.y - pet.heightPx * 0.4 };
    pet.grab(at);
    expect(pet.act.k).toBe('held');
    for (let i = 0; i < 5; i++) {
      pet.drag({ x: 800, y: 250 });
      run(1 / 30);
    }
    pet.release();
    expect(pet.act.k).toBe('fall');
    run(1);
    expect(pet.act.k).toBe('fly');
    run(60, () => pet.grounded && pet.act.k !== 'fly');
    expect(pet.grounded).toBe(true);
  });

  it('goes after food by air', () => {
    const { pet, run } = make({ species: PTERA, seed: 4 });
    pet.data.hunger = 0.8;
    run(1);
    pet.special();
    run(2);
    pet.feed();
    let fliesToIt = false;
    run(40, () => {
      if (pet.act.k === 'fly' && pet.act.goal === 'food') fliesToIt = true;
      return pet.data.stats.meals > 0;
    });
    expect(fliesToIt).toBe(true);
    expect(pet.data.stats.meals).toBe(1);
  });

  it('breaks off circling or coming in to land to go for food', () => {
    for (const [species, phase] of [[PTERA, 'soar'], [PTERA, 'approach'], [MICRO, 'approach']] as const) {
      const { pet, run } = make({ species, seed: 7, hours: 60, x: 0.3 });
      const ws = twoWindows();
      pet.setWorld(W, H, [ground(W, H), ...ws.map((w) => w.p)], ws.flatMap((w) => w.walls));
      run(1);
      expect(startFlight(pet, 'roam')).toBe(true);
      run(1.2);
      const a = pet.act;
      if (a.k !== 'fly') throw new Error(`not flying: ${a.k}`);
      if (phase === 'soar') Object.assign(a, { phase: 'soar', pt: 0, cx: pet.x, cy: pet.y, r: 150, laps: 4, ang: 0, spin: 1 });
      else run(20, () => a.phase === 'approach');
      expect(a.phase, species.id).toBe(phase);
      // Food, well away from where it was going.
      const fx = pet.x < W / 2 ? W - 250 : 250;
      pet.foods.push({ id: 99, x: fx, y: 0, vy: 0, landed: false, platform: null, left: 1, kind: 'fish' });
      run(20, () => {
        sane(pet);
        return pet.act.k !== 'fly';
      });
      // Its first landing is next to the food (unless it snatched it on the way down).
      if (pet.data.stats.meals === 0) expect(Math.abs(pet.x - fx), `${species.id} ${phase}`).toBeLessThan(300);
      run(15, () => pet.data.stats.meals > 0);
      expect(pet.data.stats.meals, `${species.id} ${phase}`).toBe(1);
    }
  });

  it('snatches food out of the air when it falls right past', () => {
    const { pet, run, sounds } = make({ species: PTERA, seed: 4 });
    run(1);
    pet.special();
    run(2.5);
    // Drop food just ahead of it.
    pet.foods.push({ id: 50, x: pet.x + pet.facing * 40, y: pet.y - pet.heightPx * 1.2, vy: 0, landed: false, platform: null, left: 1, kind: 'fish' });
    run(6, () => pet.data.stats.meals > 0);
    expect(pet.data.stats.meals).toBe(1);
    expect(sounds()).toContain('gulp');
  });

  it('dives at a puddle and catches a fish on the wing', () => {
    const { pet, run, sounds, fxs } = make({ species: PTERA, seed: 5 });
    run(1);
    pet.specialIdx = 1; // fish
    pet.special();
    expect(pet.act).toMatchObject({ k: 'fly', goal: 'fish' });
    let dived = false;
    run(40, () => {
      sane(pet);
      if (pet.act.k === 'fly' && pet.act.phase === 'dive') dived = true;
    });
    expect(dived).toBe(true);
    expect(sounds()).toContain('splash');
    expect(fxs()).toContain('splash');
    expect(sounds()).toContain('gulp');
  });

  it('catches butterflies in the air', () => {
    let caught = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { pet, run } = make({ species: PTERA, seed });
      run(1);
      pet.special();
      run(2);
      pet.butterfly = { x: pet.x + 200, y: 300, vx: 0, vy: 0, t: 0, hue: 0, leaving: false };
      startFlight(pet, 'butterfly');
      run(15, () => !pet.butterfly || pet.butterfly.leaving);
      if (!pet.butterfly) caught++;
    }
    expect(caught).toBeGreaterThan(0);
  });

  it('a glider glides down from high up with barely a flap', () => {
    const { pet, run } = make({ species: MICRO, seed: 2 });
    const high = windowAt('hi', 200, 900, 250, 700);
    pet.setWorld(W, H, [ground(W, H), high.p], high.walls);
    pet.x = 600;
    pet.y = 250;
    pet.grounded = false;
    run(2);
    expect(pet.platform.id).toBe('hi');
    pet.special();
    let beat = 0;
    let n = 0;
    run(30, () => {
      sane(pet);
      if (pet.act.k === 'fly' && pet.flying) {
        beat += pet.act.beat;
        n++;
      }
      return n > 10 && pet.grounded && pet.act.k !== 'fly';
    });
    expect(n).toBeGreaterThan(10);
    expect(beat / n).toBeLessThan(0.5);
    expect(pet.grounded).toBe(true);
    expect(pet.platform.y).toBeGreaterThan(250);
  });

  it('a glider on the ground flutters up onto a window', () => {
    const { pet, run } = make({ species: MICRO, seed: 3 });
    const low = windowAt('lo', 300, 1300, 620, 860);
    pet.setWorld(W, H, [ground(W, H), low.p], low.walls);
    pet.x = 700;
    run(1);
    pet.special();
    run(20, () => pet.grounded && pet.act.k !== 'fly' && pet.act.k !== 'land' && 't' in pet.act && pet.act.t > 0.5);
    expect(pet.platform.id).toBe('lo');
  });

  it('pterosaurs stalk about on the ground like storks', () => {
    const { pet, run } = make({ species: PTERA, seed: 9 });
    run(0.5);
    expect(choices(pet, 1000).has('forage:stalk')).toBe(true);
    startForage(pet, 'stalk');
    let peered = false;
    run(30, () => {
      sane(pet);
      if (pet.act.k === 'forage' && pet.act.stage === 1) peered = true;
      return pet.act.k !== 'forage';
    });
    expect(peered).toBe(true);
    expect(pet.act.k).not.toBe('forage');
  });
});
