import { describe, expect, it } from 'vitest';
import { GALLI, RAPTOR, REX, type SpeciesDef, TRIKE } from '../../src/pet/species';
import type { Activity } from '../../src/shared/types';
import { startFlight } from '../../src/sim/flight';
import * as Social from '../../src/sim/social';
import { keepFresh, make, type MakeOpts, PTERA, sane } from './sim-helpers';

/** Two pets on the same screen, each seeing the other. */
function pair(a: SpeciesDef, b: SpeciesDef, opts: MakeOpts = {}) {
  const A = make({ ...opts, species: a, seed: (opts.seed ?? 1) * 7, x: 0.3 });
  const B = make({ ...opts, species: b, seed: (opts.seed ?? 1) * 13, x: 0.62 });
  A.pet.data.id = 'a';
  B.pet.data.id = 'b';
  const run = (seconds: number, each?: (t: number) => boolean | void) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      A.pet.setFriends([B.pet.asFriend()]);
      B.pet.setFriends([A.pet.asFriend()]);
      A.run(1 / 30);
      B.run(1 / 30);
      if (each?.(t)) return t;
    }
    return seconds;
  };
  return { A, B, run };
}

const act = (a: Partial<Activity>): Activity => ({ idle: 0, locked: false, game: null, video: null, ...a });

describe('friends', () => {
  it('walks over to greet a new friend: a sniff, then hearts', () => {
    const { A, B, run } = pair(REX, TRIKE);
    let greeted = false;
    let close = Infinity;
    run(60, () => {
      keepFresh(A.pet);
      keepFresh(B.pet);
      for (const [p, q] of [
        [A.pet, B.pet],
        [B.pet, A.pet],
      ]) {
        // Sniffing: right next to the friend.
        if (p.act.k === 'greet' && p.act.stage === 1) close = Math.min(close, Math.abs(p.x - q.x) - (p.margin + q.heightPx * 0.5));
        if (p.act.k === 'greet' && p.act.stage === 2) greeted = true;
      }
      return greeted;
    });
    expect(greeted).toBe(true);
    expect([...A.emotes(), ...B.emotes()]).toContain('heart');
    expect(close).toBeLessThan(20);
  });

  it('plays tag: "it" and the runner swap when they touch', () => {
    const { A, B, run } = pair(RAPTOR, GALLI, { settings: { activity: 'lively' } });
    let both = false;
    let swaps = 0;
    let role = '';
    run(8 * 60, () => {
      keepFresh(A.pet);
      keepFresh(B.pet);
      sane(A.pet);
      sane(B.pet);
      if (A.pet.act.k === 'tag' && B.pet.act.k === 'tag') both = true;
      if (A.pet.act.k === 'tag') {
        if (role && A.pet.act.role !== role) swaps++;
        role = A.pet.act.role;
      } else role = '';
      return swaps > 1;
    });
    expect(both).toBe(true);
    expect(swaps).toBeGreaterThan(0);
  }, 120_000);

  it("copies a friend's trick", () => {
    const { A, B, run } = pair(REX, RAPTOR);
    run(1);
    let copied = false;
    for (let i = 0; i < 12 && !copied; i++) {
      B.pet.act = B.pet.idleAct(30);
      B.pet.mem.mimicReady = 0;
      B.pet.x = A.pet.x + 200;
      A.pet.trick('dance');
      run(1, () => {
        if (B.pet.act.k === 'dance') copied = true;
      });
      A.pet.act = A.pet.idleAct(5);
      run(0.2);
    }
    expect(copied).toBe(true);
  });

  it('big theropods have roar-offs', () => {
    const { A, B, run } = pair(REX, REX);
    run(1);
    B.pet.act = B.pet.idleAct(30);
    const start = Social.options(A.pet).social?.find(([, name]) => name === 'roaroff');
    expect(start).toBeDefined();
    start![2]();
    expect(A.pet.act.k).toBe('roaroff');
    let answered = false;
    run(15, () => {
      if (B.pet.act.k === 'roaroff') answered = true;
    });
    expect(answered).toBe(true);
    expect(A.sounds().filter((s) => s === 'roar').length).toBeGreaterThan(1);
    expect(B.sounds().filter((s) => s === 'roar').length).toBeGreaterThan(1);
  });

  it('naps next to a sleeping friend', () => {
    const { A, B, run } = pair(REX, TRIKE);
    B.pet.sleepNow();
    run(5);
    expect(B.pet.asleep).toBe(true);
    A.pet.x = 200;
    A.pet.data.energy = 0.1;
    A.pet.choose();
    expect(A.pet.act).toMatchObject({ k: 'travel', purpose: 'nap' });
    run(40, () => A.pet.act.k === 'sleep');
    expect(A.pet.act.k).toBe('sleep');
    expect(Math.abs(A.pet.x - B.pet.x)).toBeLessThan(A.pet.margin + B.pet.heightPx);
    expect(A.pet.facing).toBe(Math.sign(B.pet.x - A.pet.x));
  });

  it("doesn't settle down on top of a resting friend, and hops over one in its way", () => {
    const { A, B, run } = pair(RAPTOR, TRIKE);
    run(1);
    B.pet.act = { k: 'lie', t: 0, dur: 1e9 };
    A.pet.x = B.pet.x + 5;
    run(0.2);
    expect(Social.crowded(A.pet)).toBeDefined();
    Social.shuffleAway(A.pet, Social.crowded(A.pet)!);
    run(6);
    expect(Social.crowded(A.pet)).toBeUndefined();
    // Walking past it, it hops over.
    A.pet.x = B.pet.x - 300;
    A.pet.act = { k: 'walk', toX: B.pet.x + 300, run: false, dur: 20, t: 0 };
    let hopped = false;
    run(15, () => {
      if (A.pet.act.k === 'fall' && A.pet.act.resume?.k === 'walk') hopped = true;
      sane(A.pet);
    });
    expect(hopped).toBe(true);
  });

  it('rarely rests on top of another pet over a long time', () => {
    const { A, B, run } = pair(REX, TRIKE, { settings: { activity: 'calm' } });
    const resting = new Set(['sit', 'lie', 'sleep']);
    let overlap = 0;
    let n = 0;
    run(6 * 60, () => {
      keepFresh(A.pet);
      keepFresh(B.pet);
      n++;
      if (resting.has(A.pet.act.k) && resting.has(B.pet.act.k) && Math.abs(A.pet.x - B.pet.x) < (A.pet.margin + B.pet.heightPx * 0.5) * 0.8) overlap++;
    });
    expect(overlap / n).toBeLessThan(0.03);
  }, 120_000);

  it('flyers circle each other', () => {
    const { A, B, run } = pair(PTERA, PTERA, { hours: 40 });
    run(1);
    startFlight(A.pet, 'roam');
    startFlight(B.pet, 'roam');
    let circled = false;
    run(90, () => {
      keepFresh(A.pet);
      keepFresh(B.pet);
      for (const p of [A.pet, B.pet]) if (p.act.k === 'fly' && p.act.phase === 'soar' && p.act.goal === 'friend') circled = true;
      for (const p of [A.pet, B.pet]) if (p.act.k !== 'fly' && p.grounded && p.act.k !== 'land') startFlight(p, 'roam');
      return circled;
    });
    expect(circled).toBe(true);
  }, 120_000);
});

describe('games', () => {
  it('cheers when a game starts, by name', () => {
    let named = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { pet, run, says } = make({ seed, settings: { speech: 'chatty' } });
      run(1);
      pet.setActivity(act({ game: 'Fortnite' }));
      expect(pet.act).toMatchObject({ k: 'react', kind: 'game' });
      run(0.5);
      if (says().some((s) => s.includes('Fortnite'))) named++;
    }
    expect(named).toBeGreaterThan(0);
  });

  it('is calmer and quieter while you play', () => {
    const measure = (game: string | null) => {
      const { pet, run, events } = make({ seed: 4, settings: { activity: 'lively' } });
      run(1);
      pet.setActivity(act({ game }));
      let rest = 0;
      let n = 0;
      run(6 * 60, () => {
        keepFresh(pet);
        n++;
        if (['idle', 'sit', 'lie', 'sleep', 'watch', 'gaze', 'fidget'].includes(pet.act.k)) rest++;
      });
      const idleNoises = events.filter((e) => e.type === 'sound' && e.soft && ['sniff', 'call', 'chirp', 'step', 'growl'].includes(e.name)).length;
      return { rest: rest / n, idleNoises };
    };
    const playing = measure('Minecraft');
    const not = measure(null);
    expect(playing.rest).toBeGreaterThan(not.rest);
    expect(playing.idleNoises).toBeLessThan(not.idleNoises);
  }, 120_000);

  it('says GG at the end, and does not cheer again for a quick restart', () => {
    const { pet, run, says, sounds } = make({ settings: { speech: 'chatty' } });
    run(1);
    pet.setActivity(act({ game: 'Brawlhalla' }));
    run(5);
    pet.setActivity(act({ game: null }));
    expect(pet.act).toMatchObject({ k: 'react', kind: 'welcome' });
    run(1);
    expect(says().some((s) => /GG|game/i.test(s))).toBe(true);
    const roars = sounds().filter((s) => s === 'roar').length;
    pet.setActivity(act({ game: 'Brawlhalla' }));
    expect(pet.act).not.toMatchObject({ kind: 'game' });
    run(1);
    expect(sounds().filter((s) => s === 'roar').length).toBe(roars);
    expect(pet.data.stats.games).toBe(2);
  });
});

describe('videos', () => {
  it('reacts when you start watching, and now and then sits and watches along', () => {
    const { pet, run, says, emotes } = make({ seed: 3, settings: { speech: 'chatty' } });
    run(1);
    pet.setActivity(act({ video: { site: 'YouTube', title: 'Dinosaur documentary' } }));
    expect(pet.act).toMatchObject({ k: 'react', kind: 'video' });
    run(0.5);
    expect(says().length).toBe(1);
    let watched = 0;
    let facedMiddle = true;
    const before = emotes().length;
    run(6 * 60, () => {
      keepFresh(pet);
      if (pet.act.k === 'watchVideo') {
        watched++;
        if (pet.act.t > 0.2 && Math.abs(pet.x - 800) > pet.margin * 2 && pet.facing !== Math.sign(800 - pet.x)) facedMiddle = false;
        pet.setActivity(act({ video: { site: 'YouTube', title: 'Dinosaur documentary' } }));
      }
    });
    expect(watched / 30).toBeGreaterThan(20);
    expect(facedMiddle).toBe(true);
    expect(emotes().length).toBeGreaterThan(before);
    // The video ends: it stops watching.
    pet.setActivity(act({ video: null }));
    run(2);
    expect(pet.act.k).not.toBe('watchVideo');
  }, 120_000);

  it("doesn't nag: one reaction per site for a while", () => {
    const { pet, run } = make();
    run(1);
    pet.setActivity(act({ video: { site: 'Twitch', title: 'a' } }));
    expect(pet.act.k).toBe('react');
    run(3);
    pet.setActivity(act({ video: null }));
    run(3);
    pet.setActivity(act({ video: { site: 'Twitch', title: 'b' } }));
    expect(pet.act.k).not.toBe('react');
  });

  it('ignores videos when video reactions are off', () => {
    const { pet, run } = make({ settings: { videoReactions: false } });
    run(1);
    pet.setActivity(act({ video: { site: 'Netflix', title: 'x' } }));
    expect(pet.act.k).not.toBe('react');
    let watched = false;
    run(5 * 60, () => {
      keepFresh(pet);
      if (pet.act.k === 'watchVideo') watched = true;
    });
    expect(watched).toBe(false);
  }, 120_000);
});
