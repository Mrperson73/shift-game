import { describe, expect, it } from 'vitest';
import { GALLI, RAPTOR, REX, TRIKE } from '../../src/pet/species';
import type { Thing } from '../../src/sim/toys';
import { H, keepFresh, make, sane } from './sim-helpers';

const thing = (toys: { kind: string }[], kind: 'bone' | 'duck') => toys.find((t) => t.kind === kind) as Thing | undefined;

describe('toys', () => {
  it('bubbles float up; it jumps and snaps at them and they pop', () => {
    const { pet, run, events, sounds } = make({ species: RAPTOR, seed: 2 });
    run(1);
    pet.toy('bubbles');
    expect(pet.toys.some((t) => t.kind === 'bubbles')).toBe(true);
    let jumped = false;
    let snapped = 0;
    let seen = 0;
    run(25, () => {
      sane(pet);
      keepFresh(pet);
      if (pet.act.k === 'fall' && pet.act.resume?.k === 'toy') jumped = true;
      // Pops right at its mouth are the ones it snapped.
      for (; seen < events.length; seen++) {
        const e = events[seen];
        const m = pet.mouthAt();
        if (e.type === 'fx' && e.kind === 'pop' && Math.hypot(e.x - m.x, e.y - m.y) < 60) snapped++;
      }
    });
    expect(jumped).toBe(true);
    expect(snapped).toBeGreaterThan(2);
    expect(sounds()).toContain('bubble');
    // The wand runs out, the last bubbles pop, and the toy is gone.
    run(20);
    expect(pet.toys.some((t) => t.kind === 'bubbles')).toBe(false);
  });

  it('a bone: it carries it about and chews it; throw it and it fetches it back', () => {
    const { pet, run, sounds } = make({ species: TRIKE, seed: 3 });
    run(1);
    pet.toy('bone');
    let carried = false;
    run(30, () => {
      sane(pet);
      keepFresh(pet);
      if (thing(pet.toys, 'bone')?.carried) carried = true;
    });
    expect(carried).toBe(true);
    expect(sounds()).toContain('chew');
    // Throw it: grab it (wherever it is), fling it to the left.
    const b = thing(pet.toys, 'bone')!;
    run(8, () => !b.carried && !!b.on);
    pet.setCursor({ x: 1300, y: H - 30 }, 1 / 30);
    const at = { x: b.x, y: b.y - b.r };
    expect(pet.overToy(at)).toBe(true);
    expect(pet.grabToy(at)).toBe(true);
    for (let i = 1; i <= 4; i++) {
      pet.dragToy({ x: at.x - i * 40, y: at.y - i * 30 });
      run(1 / 30);
    }
    pet.releaseToy();
    expect(b.thrown).toBe(true);
    // It runs after it, picks it up and brings it back to you.
    let fetched = false;
    run(30, () => {
      sane(pet);
      keepFresh(pet);
      if (b.carried) fetched = true;
      return fetched && !b.carried && pet.act.k === 'toy' && pet.act.stage === 3;
    });
    expect(fetched).toBe(true);
    expect(Math.abs(pet.x - 1300)).toBeLessThan(250);
  });

  it('a squeaky duck: it pounces on it and it squeaks; a click squeezes it too', () => {
    const { pet, run, sounds } = make({ species: REX, seed: 4 });
    run(1);
    pet.toy('duck');
    let pounced = false;
    run(30, () => {
      sane(pet);
      keepFresh(pet);
      if (pet.act.k === 'fall' && pet.act.resume?.k === 'toy') pounced = true;
    });
    expect(pounced).toBe(true);
    expect(sounds().filter((s) => s === 'toy').length).toBeGreaterThan(1);
    const d = thing(pet.toys, 'duck')!;
    run(5, () => !!d.on);
    const n = sounds().filter((s) => s === 'toy').length;
    expect(pet.tapToy({ x: d.x, y: d.y - d.r })).toBe(true);
    run(0.1);
    expect(sounds().filter((s) => s === 'toy').length).toBe(n + 1);
  });

  it('a laser dot: it chases it about and pounces, and it always gets away', () => {
    const { pet, run, emotes } = make({ species: GALLI, seed: 5 });
    run(1);
    pet.toy('laser');
    let chased = 0;
    let pounces = 0;
    let wasAir = false;
    run(17, () => {
      sane(pet);
      keepFresh(pet);
      const l = pet.toys.find((t) => t.kind === 'laser');
      if (l && pet.act.k === 'toy' && Math.sign(l.x - pet.x) === Math.sign(pet.vx) && Math.abs(pet.vx) > 30) chased++;
      const air = pet.act.k === 'fall' && pet.act.resume?.k === 'toy';
      if (air && !wasAir) pounces++;
      wasAir = air;
    });
    expect(chased).toBeGreaterThan(30);
    expect(pounces).toBeGreaterThan(0);
    // It's gone after a while: where did it go?
    run(6);
    expect(pet.toys.some((t) => t.kind === 'laser')).toBe(false);
    expect(emotes()).toContain('question');
  });

  it('a puddle: it splashes in it, drinks and shakes the water off', () => {
    const { pet, run, sounds, fxs } = make({ species: TRIKE, seed: 6 });
    run(1);
    pet.toy('puddle');
    run(20, () => {
      sane(pet);
      keepFresh(pet);
    });
    expect(sounds()).toContain('splash');
    expect(fxs()).toContain('splash');
    expect(fxs()).toContain('drops');
    expect(sounds()).toContain('gulp');
  });

  it('toys go away after a while, and resting toys need no redrawing', () => {
    const { pet, run } = make({ species: TRIKE, seed: 7 });
    run(1);
    pet.toy('bone');
    pet.toy('duck');
    pet.toy('puddle');
    run(3);
    // A toy lying still doesn't keep the frame rate up (the pet itself may still be playing).
    const d = thing(pet.toys, 'duck')!;
    run(10, () => !!d.on && Math.abs(d.vx) < 5 && d.squish === 0 && !d.carried);
    run(130, () => keepFresh(pet));
    expect(pet.toys).toHaveLength(0);
    expect(pet.smooth).toBe(false);
  }, 30_000);

  it('drops what it carries when you pick it up', () => {
    const { pet, run } = make({ species: TRIKE, seed: 3 });
    run(1);
    pet.toy('bone');
    run(30, () => !!thing(pet.toys, 'bone')?.carried);
    const b = thing(pet.toys, 'bone')!;
    expect(b.carried).toBe(true);
    pet.grab({ x: pet.x, y: pet.y - pet.heightPx * 0.4 });
    expect(b.carried).toBe(false);
  });
});
