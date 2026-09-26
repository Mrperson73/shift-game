import { describe, expect, it } from 'vitest';
import type { SoundName } from '../../src/audio/types';
import { ANKY, BRACHIO, DILO, GALLI, PACHY, PARASAUR, RAPTOR, REX, type SignatureMove, type SpeciesDef, SPINO, STEGO, TRIKE } from '../../src/pet/species';
import type { FxKind } from '../../src/sim/pet';
import { ground } from '../../src/sim/world';
import { choices, DEINO, H, make, sane, W, windowAt } from './sim-helpers';

const CASES: [SignatureMove, SpeciesDef, SoundName | null, FxKind | null][] = [
  ['stomp', REX, 'stomp', 'shockwave'],
  ['headbutt', PACHY, 'snort', null],
  ['tailSwipe', STEGO, 'swish', 'swoosh'],
  ['charge', TRIKE, 'snort', null],
  ['fish', SPINO, 'splash', 'splash'],
  ['honk', PARASAUR, 'call', 'rings'],
  ['display', DILO, 'growl', null],
  ['browse', BRACHIO, 'rustle', 'leaves'],
  ['dig', GALLI, 'dig', 'dirt'],
  ['screech', RAPTOR, 'roar', null],
  ['rake', { ...RAPTOR, id: 'therizino', moves: ['rake'] }, 'swish', 'slash'],
  ['whip', { ...BRACHIO, id: 'diplo', moves: ['whip'] }, 'whip', 'crack'],
  ['curl', { ...ANKY, moves: ['curl'] }, 'snort', null],
  ['roll', DEINO, 'splash', 'splash'],
  ['gape', DEINO, 'chew', null],
];

describe('signature moves', () => {
  for (const [move, species, sound, fx] of CASES) {
    it(`${move} (${species.id})`, () => {
      const sp = { ...species, moves: [move] };
      const { pet, run, sounds, fxs } = make({ species: sp, seed: 3, x: 0.5 });
      run(1);
      pet.special();
      expect(pet.act).toMatchObject({ k: 'special', move });
      let seen = 0;
      let jaw = 0;
      const t = run(30, () => {
        sane(pet);
        jaw = Math.max(jaw, pet.rig.pose.jaw);
        if (pet.act.k === 'special' || pet.act.k === 'fall' || pet.act.k === 'land') seen = 0;
        else seen += 1 / 30;
        // Done: it's been doing something else for a moment.
        return seen > 0.5;
      });
      expect(t, 'finishes').toBeLessThan(25);
      if (sound) expect(sounds(), move).toContain(sound);
      if (fx) expect(fxs(), move).toContain(fx);
      if (move === 'gape') expect(jaw).toBeGreaterThan(1);
      expect(pet.grounded).toBe(true);
      expect(pet.rot).toBe(0);
    });
  }

  it('each species has its own moves, and the Special button goes through them in turn', () => {
    const { pet, run } = make({ species: { ...SPINO, moves: ['fish', 'display'] } });
    run(1);
    pet.special();
    expect(pet.act).toMatchObject({ k: 'special', move: 'fish' });
    run(20, () => pet.act.k !== 'special' && pet.act.k !== 'fall' && pet.act.k !== 'land');
    pet.special();
    expect(pet.act).toMatchObject({ k: 'special', move: 'display' });
  });

  it('head-butts a window in its way, and the edge of the screen', () => {
    // A window standing on the taskbar, to the right.
    const a = make({ species: PACHY, seed: 2 });
    const w = windowAt('w', 900, 1400, 300, H);
    a.pet.setWorld(W, H, [ground(W, H), w.p], w.walls);
    a.pet.x = 500;
    a.pet.facing = 1;
    a.run(0.5);
    a.pet.special();
    a.run(12, () => sane(a.pet));
    expect(a.sounds()).toContain('bonk');
    expect(a.fxs()).toContain('bonk');
    expect(a.emotes()).toContain('stars');
    expect(a.pet.x).toBeLessThan(900);
    // The right edge of the screen (edges are walls unless they lead to another monitor).
    const b = make({ species: PACHY, seed: 2 });
    b.pet.x = 1250;
    b.pet.facing = 1;
    b.run(0.5);
    b.pet.special();
    b.run(12, () => sane(b.pet));
    expect(b.sounds()).toContain('bonk');
    // An edge that leads to another monitor isn't a wall: it charges and skids instead.
    const c = make({ species: PACHY, seed: 2 });
    c.pet.setEdges('wall', 'exit');
    c.pet.x = 1250;
    c.pet.facing = 1;
    c.run(0.5);
    c.pet.special();
    c.run(12, () => sane(c.pet));
    expect(c.sounds()).not.toContain('bonk');
  });

  it('fishes: a puddle appears, it catches a fish and eats it', () => {
    for (const species of [SPINO, DEINO]) {
      const { pet, run, sounds, says } = make({ species: { ...species, moves: ['fish'] }, seed: 4, settings: { speech: 'chatty' } });
      pet.data.hunger = 0.5;
      run(1);
      pet.special();
      expect(pet.toys.some((t) => t.kind === 'puddle')).toBe(true);
      let held = false;
      run(25, () => {
        sane(pet);
        const pd = pet.toys.find((t) => t.kind === 'puddle');
        if (pd && pd.kind === 'puddle' && pd.fish === 'held') held = true;
      });
      expect(held, species.id).toBe(true);
      expect(sounds(), species.id).toContain('gulp');
      expect(pet.data.hunger, species.id).toBeLessThan(0.45);
      expect(says().length, species.id).toBeGreaterThan(0);
    }
  });

  it('a crocodile lies in wait at the water, then lunges', () => {
    const { pet, run } = make({ species: DEINO, seed: 5 });
    run(1);
    pet.special = pet.special.bind(pet);
    pet.specialIdx = 2; // fish
    pet.special();
    let still = 0;
    let lunged = false;
    run(20, () => {
      const a = pet.act;
      if (a.k === 'special' && a.stage === 1) still = Math.max(still, a.st);
      if (a.k === 'fall' && a.resume?.k === 'special') lunged = true;
    });
    expect(still).toBeGreaterThan(1.5);
    expect(lunged).toBe(true);
  });

  it('a requested move is not cut short by food, and it eats afterwards', () => {
    const { pet, run } = make({ species: REX, seed: 6 });
    run(1);
    pet.special();
    pet.feed();
    let wentForFood = false;
    run(1.2, () => {
      if (pet.act.k === 'travel' || pet.act.k === 'eat') wentForFood = true;
    });
    expect(wentForFood).toBe(false);
    run(25);
    expect(pet.data.stats.meals).toBe(1);
  });

  it('wakes up to do a move asked for while asleep', () => {
    const { pet, run } = make({ species: TRIKE });
    run(1);
    pet.sleepNow();
    run(5);
    pet.special();
    expect(pet.act.k).toBe('wake');
    run(3);
    expect(pet.act).toMatchObject({ k: 'special', move: 'charge' });
  });

  it('does its moves on its own now and then', () => {
    for (const [species, move] of [
      [REX, 'stomp'],
      [BRACHIO, 'browse'],
      [PARASAUR, 'honk'],
      [TRIKE, 'charge'],
      [PACHY, 'headbutt'],
      [GALLI, 'dig'],
    ] as const) {
      const { pet, run } = make({ species, seed: 8, settings: { activity: 'lively' } });
      run(0.5);
      const seen = choices(pet, 1000);
      // Now and then: not never, not all the time.
      const n = seen.get(`special:${move}`) ?? 0;
      expect(n, species.id).toBeGreaterThan(5);
      expect(n, species.id).toBeLessThan(250);
    }
  });

  it('armoured pets poked too often curl up instead of growling', () => {
    const { pet, run } = make({ species: { ...ANKY, moves: ['tailSwipe', 'curl'] } });
    run(1);
    for (let i = 0; i < 4; i++) {
      pet.poke();
      run(0.1);
    }
    expect(pet.act).toMatchObject({ k: 'special', move: 'curl' });
  });
});

describe('tricks', () => {
  it('jumps high and lands happy', () => {
    const { pet, run } = make({ species: RAPTOR });
    run(1);
    pet.trick('jump');
    expect(pet.act.k).toBe('leap');
    let top = H;
    run(3, () => {
      top = Math.min(top, pet.y);
      sane(pet);
    });
    expect(H - top).toBeGreaterThan(pet.heightPx);
    expect(pet.grounded).toBe(true);
    expect(pet.y).toBe(H);
  });

  it('bows', () => {
    const { pet, run, emotes } = make();
    run(1);
    pet.trick('bow');
    expect(pet.act.k).toBe('bow');
    run(1);
    expect(pet.rig.target.pitch).toBeLessThan(-0.2);
    run(1.5);
    expect(pet.act.k).not.toBe('bow');
    expect(emotes()).toContain('heart');
  });

  it('plays dead: flops over, legs in the air, then pops back up', () => {
    for (const species of [REX, TRIKE, BRACHIO]) {
      const { pet, run, says } = make({ species, settings: { speech: 'chatty' } });
      run(1);
      pet.trick('playdead');
      expect(pet.act.k).toBe('playdead');
      run(1.4);
      // On its back: drawn upside down, resting on the ground, legs up.
      expect(Math.abs(Math.abs(pet.rot) - Math.PI)).toBeLessThan(0.01);
      expect(pet.y).toBeLessThan(H);
      expect(pet.rig.legMode).toBe('held');
      expect(pet.hitTest({ x: pet.x, y: pet.y + 4 })).toBe(true);
      run(3);
      expect(pet.act.k).not.toBe('playdead');
      expect(pet.rot).toBe(0);
      expect(pet.y).toBe(H);
      expect(says().length).toBeGreaterThan(0);
    }
  });

  it('pops up when poked while playing dead', () => {
    const { pet, run } = make();
    run(1);
    pet.trick('playdead');
    run(1.2);
    pet.poke();
    run(0.6);
    expect(pet.act.k).not.toBe('playdead');
    expect(pet.rot).toBe(0);
  });
});

describe('growth treat', () => {
  it('drops a golden snack; eating it grows it by half an hour, with sparkles', () => {
    const { pet, run, sounds, fxs, emotes } = make({ hours: 5 });
    run(1);
    const before = pet.data.activeSeconds;
    pet.treat();
    expect(pet.foods).toHaveLength(1);
    expect(pet.foods[0].golden).toBe(true);
    run(20, () => pet.foods.length === 0 && pet.act.k === 'react');
    run(3);
    expect(pet.data.activeSeconds - before).toBeGreaterThan(1800);
    expect(pet.data.activeSeconds - before).toBeLessThan(1800 + 40);
    expect(sounds()).toContain('magic');
    expect(fxs()).toContain('sparkles');
    expect(emotes()).toContain('sparkle');
  });

  it('is full for a while after one', () => {
    const { pet, run, says } = make({ settings: { speech: 'chatty' } });
    run(1);
    pet.treat();
    run(15, () => pet.foods.length === 0);
    run(2);
    pet.treat();
    expect(pet.foods).toHaveLength(0);
    run(0.1);
    expect(says().some((s) => s === "I'm full!" || s === 'No more, thanks!')).toBe(true);
    run(95);
    pet.treat();
    expect(pet.foods).toHaveLength(1);
  });

  it('can reach a new stage', () => {
    // Just short of juvenile (15% of 60 hours).
    const { pet, run, events } = make({ hours: 9 - 0.25 });
    run(1);
    pet.treat();
    run(20);
    expect(events).toContainEqual({ type: 'grew', stage: 'juvenile' });
  });
});
