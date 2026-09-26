import { describe, expect, it } from 'vitest';
import { BRACHIO, BUILT_IN, DILO, PARASAUR, RAPTOR, REX, type SpeciesDef, STEGO, TRIKE } from '../../src/pet/species';
import { startFidget } from '../../src/sim/fidgets';
import type { Fidget } from '../../src/sim/pet';
import { choices, DEINO, H, keepFresh, make, MICRO, PTERA, sane } from './sim-helpers';

const FIDGETS: Fidget[] = ['look', 'turn', 'scratch', 'ground', 'preen', 'stretchNeck', 'tailFlick', 'headShake', 'yawn', 'snap', 'stompInPlace', 'sway', 'reach', 'jerk', 'crouchWatch', 'headToss', 'rear', 'wingStretch', 'mantle', 'crestShake', 'dart', 'hops'];
const COMPY: SpeciesDef = { ...RAPTOR, id: 'compy', name: 'Compy', lengthM: 1, features: { teeth: true } };

describe('idle animations', () => {
  it('every fidget plays out and ends, for every kind of body', () => {
    for (const species of [REX, TRIKE, BRACHIO, PTERA, MICRO, DEINO, COMPY]) {
      for (const what of FIDGETS) {
        const { pet, run } = make({ species, seed: 2 });
        run(0.5);
        startFidget(pet, what);
        const t = run(12, () => {
          sane(pet);
          return pet.act.k !== 'fidget' && pet.act.k !== 'hop' && pet.act.k !== 'fall' && pet.act.k !== 'land';
        });
        expect(t, `${species.id} ${what}`).toBeLessThan(10);
        expect(pet.grounded).toBe(true);
        expect(pet.y).toBe(H);
      }
    }
  });

  it('scratches an itch with a hind foot', () => {
    const { pet, run } = make({ species: RAPTOR });
    run(0.5);
    startFidget(pet, 'scratch');
    let lift = 0;
    run(1.5, () => {
      lift = Math.max(lift, pet.rig.s.legs[0].ball.y);
    });
    expect(lift).toBeGreaterThan(pet.rig.p.hipHeight * 0.25);
  });

  it('snaps at a fly buzzing about its head', () => {
    const { pet, run } = make({ species: REX, seed: 3 });
    run(0.5);
    startFidget(pet, 'snap');
    expect(pet.gnat).not.toBeNull();
    expect(pet.smooth).toBe(true);
    run(8);
    expect(pet.gnat).toBeNull();
  });

  it('each kind of dinosaur has its own habits', () => {
    const cases: [SpeciesDef, string[]][] = [
      [BRACHIO, ['fidget:sway', 'fidget:reach', 'special:browse']],
      [RAPTOR, ['fidget:jerk', 'fidget:crouchWatch', 'fidget:preen']],
      [TRIKE, ['fidget:headToss', 'special:charge', 'forage:graze']],
      [PARASAUR, ['fidget:rear', 'special:honk']],
      [PTERA, ['fidget:wingStretch', 'fidget:mantle', 'fidget:crestShake', 'fly', 'forage:stalk']],
      [DEINO, ['lurk', 'special:gape', 'special:roll', 'special:fish']],
      [COMPY, ['fidget:dart', 'fidget:hops', 'forage:peck']],
      [STEGO, ['fidget:stompInPlace', 'special:tailSwipe']],
      [DILO, ['special:display', 'fidget:jerk']],
      [REX, ['special:stomp', 'fidget:stompInPlace', 'fidget:scratch']],
    ];
    for (const [species, habits] of cases) {
      const { pet, run } = make({ species, seed: 12 });
      run(0.5);
      const seen = choices(pet, 2000);
      for (const h of habits) expect(seen.has(h), `${species.id}: ${h}`).toBe(true);
    }
    // ...and not the others' (a Brachiosaurus doesn't dart about, a Rex doesn't sway its neck).
    const brachio = make({ species: BRACHIO, seed: 3 });
    const rex = make({ species: REX, seed: 3 });
    expect(choices(brachio.pet, 1500).has('fidget:dart')).toBe(false);
    expect(choices(rex.pet, 1500).has('fidget:sway')).toBe(false);
  });

  it('does lots of different things, never the same thing twice in a row', () => {
    for (const species of BUILT_IN) {
      const { pet, run } = make({ species, seed: 5 });
      run(1);
      pet.setCursor(null, 1 / 30);
      let repeats = 0;
      const names = new Set<string>();
      for (let i = 0; i < 300; i++) {
        keepFresh(pet);
        // Nothing else to do first (no butterfly, food or toys): it always picks from its options.
        pet.butterfly = null;
        pet.toys = [];
        pet.foods = [];
        const before = pet.lastBeh;
        pet.act = pet.idleAct(1);
        pet.choose();
        if (pet.lastBeh === before) repeats++;
        names.add(pet.lastBeh);
      }
      expect(repeats, species.id).toBe(0);
      expect(names.size, species.id).toBeGreaterThan(20);
    }
  });
});

describe('transitions', () => {
  it('settles down to sleep in stages: a yawn, sits, lies down, head down', () => {
    const { pet, run } = make({ species: TRIKE });
    run(1);
    pet.sleepNow();
    expect(pet.asleep).toBe(true);
    expect(pet.settling).toBe(true);
    const drops: number[] = [];
    run(3.5, () => {
      drops.push(pet.rig.target.hipDrop);
    });
    // Standing, then sitting (0.5), then lying (1).
    expect(drops[5]).toBe(0);
    expect(drops.some((d) => d === 0.5)).toBe(true);
    expect(drops[drops.length - 1]).toBe(1);
    expect(pet.settling).toBe(false);
    expect(pet.rig.eyes).toBe('sleepy');
    run(3);
    expect(pet.rig.eyes).toBe('closed');
  });

  it('falls asleep at once when the PC locks', () => {
    const { pet, run } = make();
    run(1);
    pet.setActivity({ idle: 0, locked: true, game: null });
    expect(pet.asleep).toBe(true);
  });

  it('wakes up with a stretch and a yawn', () => {
    const { pet, run } = make({ species: RAPTOR });
    run(1);
    pet.sleepNow();
    run(8);
    pet.wakeNow();
    let stretched = false;
    let yawned = false;
    run(2.4, () => {
      if (pet.rig.target.stretch === 1) stretched = true;
      if (pet.rig.target.jaw >= 0.9 && pet.rig.eyes === 'closed') yawned = true;
    });
    expect(stretched).toBe(true);
    expect(yawned).toBe(true);
  });

  it('lies down by way of sitting', () => {
    const { pet, run } = make();
    run(1);
    pet.act = { k: 'lie', t: 0, dur: 5 };
    run(0.2);
    expect(pet.rig.target.hipDrop).toBe(0.5);
    run(1);
    expect(pet.rig.target.hipDrop).toBe(1);
  });
});
