import { describe, expect, it } from 'vitest';
import { rng } from '../../src/pet/math';
import { BUILT_IN, PACHY, RAPTOR, REX } from '../../src/pet/species';
import { DEFAULT_SETTINGS, newPet, type Platform, type Settings, type Wall } from '../../src/shared/types';
import { Pet, type SimEvent } from '../../src/sim/pet';
import { ground } from '../../src/sim/world';

const W = 1600;
const H = 860;

function make(opts: { species?: typeof REX; hatched?: boolean; settings?: Partial<Settings>; seed?: number; hours?: number } = {}) {
  let now = 1_700_000_000_000;
  const data = newPet((opts.species ?? REX).id, 0, 'Test', now);
  if (opts.hatched !== false) data.hatchedAt = now;
  data.activeSeconds = (opts.hours ?? 10) * 3600;
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const env = { rand: rng(opts.seed ?? 1), hour: () => 14, now: () => now };
  const pet = new Pet(data, opts.species ?? REX, settings, { width: W, height: H, platforms: [ground(W, H)], walls: [] }, env);
  const events: SimEvent[] = [];
  const run = (seconds: number, each?: (t: number) => void) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      now += 1000 / 30;
      pet.update(1 / 30);
      events.push(...pet.drain());
      each?.(t);
    }
  };
  return { pet, run, events };
}

const win = (id: string, x1: number, x2: number, y: number): Platform => ({ id, x1, x2, y, win: id, wx: x1 - 50, wy: y });

/** A window rect as the main process reports it: top edge (minus icon/caption areas) and sides. */
function windowAt(id: string, left: number, right: number, top: number, bottom: number): { p: Platform; walls: Wall[] } {
  return {
    p: { id, x1: left + 40, x2: right - 150, y: top, win: id, wx: left, wy: top },
    walls: [
      { id: `${id}:L`, win: id, side: 'left', x: left, y1: top, y2: bottom, wx: left, wy: top },
      { id: `${id}:R`, win: id, side: 'right', x: right, y1: top, y2: bottom, wx: left, wy: top },
    ],
  };
}

describe('pet', () => {
  it('hatches on its own, or sooner when poked', () => {
    const a = make({ hatched: false });
    a.run(20);
    expect(a.pet.hatched).toBe(false);
    a.run(30);
    expect(a.pet.hatched).toBe(true);
    expect(a.events.some((e) => e.type === 'hatched')).toBe(true);

    const b = make({ hatched: false });
    b.pet.poke();
    b.pet.poke();
    b.pet.poke();
    b.run(1.5);
    expect(b.pet.hatched).toBe(true);
  });

  it('lives for a while without leaving the screen or its platforms', () => {
    for (const species of BUILT_IN) {
      const { pet, run } = make({ species, seed: species.id.length });
      const ws = [windowAt('a', 150, 760, 520, 800), windowAt('b', 780, 1400, 380, 700), windowAt('c', 1250, 1590, 690, 900)];
      pet.setWorld(W, H, [ground(W, H), ...ws.map((w) => w.p)], ws.flatMap((w) => w.walls));
      const seen = new Set<string>();
      run(20 * 60, () => {
        expect(Number.isFinite(pet.x) && Number.isFinite(pet.y)).toBe(true);
        expect(pet.x).toBeGreaterThanOrEqual(0);
        expect(pet.x).toBeLessThanOrEqual(W);
        expect(pet.y).toBeLessThanOrEqual(H + 0.01);
        if (pet.grounded) {
          expect(pet.y).toBe(pet.platform.y);
          seen.add(pet.platform.id);
        }
      });
      // It explores at least one window over 20 minutes.
      expect(seen.size, species.id).toBeGreaterThan(1);
    }
  });

  it('stays on the taskbar when exploring is off', () => {
    const { pet, run } = make({ species: RAPTOR, settings: { explore: false } });
    pet.setWorld(W, H, [ground(W, H), win('a', 200, 700, 700)]);
    run(10 * 60, () => {
      if (pet.grounded) expect(pet.platform.id).toBe('ground');
    });
  });

  it('sleeps when you go idle and wakes up happy when you are back', () => {
    const { pet, run, events } = make();
    pet.setActivity({ idle: 400, locked: false, game: null });
    run(3);
    expect(pet.act.k).toBe('sleep');
    run(30);
    expect(pet.act.k).toBe('sleep');
    expect(events.some((e) => e.type === 'emote' && e.kind === 'zzz')).toBe(true);
    pet.setActivity({ idle: 0, locked: false, game: null });
    expect(pet.act.k).toBe('wake');
    events.length = 0;
    run(3);
    expect(events).toContainEqual({ type: 'emote', kind: 'heart' });
  });

  it('sleeps while the PC is locked', () => {
    const { pet, run } = make();
    pet.setActivity({ idle: 0, locked: true, game: null });
    expect(pet.act.k).toBe('sleep');
    run(60);
    expect(pet.act.k).toBe('sleep');
    pet.setActivity({ idle: 0, locked: false, game: null });
    expect(pet.act.k).toBe('wake');
  });

  it('only grows while you are active', () => {
    const { pet, run } = make({ hours: 0 });
    pet.setActivity({ idle: 10, locked: false, game: null });
    run(60);
    expect(pet.data.activeSeconds).toBeCloseTo(60, 0);
    pet.setActivity({ idle: 120, locked: false, game: null });
    run(60);
    expect(pet.data.activeSeconds).toBeCloseTo(60, 0);
  });

  it('announces a new growth stage', () => {
    const { pet, run, events } = make({ hours: 0.15 * 60 - 1 / 3600 });
    run(5);
    expect(events).toContainEqual({ type: 'grew', stage: 'juvenile' });
    expect(pet.growth).toBeGreaterThanOrEqual(0.15);
  });

  it('finds food, eats it and gets less hungry', () => {
    const { pet, run } = make({ species: PACHY });
    pet.data.hunger = 0.9;
    pet.feed();
    expect(pet.foods).toHaveLength(1);
    expect(pet.foods[0].kind).toBe('leaf');
    run(25);
    expect(pet.foods).toHaveLength(0);
    expect(pet.data.stats.meals).toBe(1);
    expect(pet.data.hunger).toBeLessThan(0.4);
  });

  it('climbs onto a window to reach food there', () => {
    const { pet, run } = make({ species: RAPTOR, seed: 9 });
    const shelf = win('shelf', 300, 900, 700);
    pet.setWorld(W, H, [ground(W, H), shelf]);
    pet.x = 1200;
    pet.foods.push({ id: 99, x: 600, y: 700, vy: 0, landed: true, platform: shelf, left: 1, kind: 'meat' });
    run(30);
    expect(pet.data.stats.meals).toBe(1);
  });

  it('climbs up the side of a tall window to reach food on top, and comes back down', () => {
    for (const species of BUILT_IN) {
      const { pet, run } = make({ species, seed: 5 });
      const top = win('t', 520, 1180, 180);
      const walls = [
        { id: 't:L', win: 't', side: 'left' as const, x: 480, y1: 180, y2: 820, wx: 480, wy: 180 },
        { id: 't:R', win: 't', side: 'right' as const, x: 1220, y1: 180, y2: 820, wx: 480, wy: 180 },
      ];
      pet.setWorld(W, H, [ground(W, H), top], walls);
      pet.x = 200;
      pet.foods.push({ id: 7, x: 800, y: 180, vy: 0, landed: true, platform: top, left: 1, kind: 'meat' });
      let climbed = false;
      run(70, () => {
        if (pet.act.k === 'climb') climbed = true;
        expect(Number.isFinite(pet.x) && Number.isFinite(pet.y)).toBe(true);
      });
      expect(climbed, species.id).toBe(true);
      expect(pet.data.stats.meals, species.id).toBe(1);
      // Head back to the taskbar: food on the ground.
      pet.foods.push({ id: 8, x: 1500, y: H, vy: 0, landed: true, platform: pet.world.platforms[0], left: 1, kind: 'meat' });
      run(70);
      expect(pet.data.stats.meals, species.id).toBe(2);
      expect(pet.rot).toBe(0);
    }
  });

  it('rides along when its window moves, and falls when it closes', () => {
    const { pet, run } = make();
    const a = win('a', 400, 1000, 500);
    pet.setWorld(W, H, [ground(W, H), a]);
    pet.x = 700;
    pet.y = 300;
    pet.grounded = false;
    pet.vy = 0;
    run(2);
    expect(pet.platform.id).toBe('a');
    const x0 = pet.x;
    pet.setWorld(W, H, [ground(W, H), { ...a, x1: 460, x2: 1060, y: 480, wx: a.wx + 60, wy: 480 }]);
    expect(pet.x).toBeCloseTo(x0 + 60);
    expect(pet.y).toBe(480);
    pet.setWorld(W, H, [ground(W, H)]);
    expect(pet.grounded).toBe(false);
    run(3);
    expect(pet.platform.id).toBe('ground');
  });

  it('can be picked up and thrown, and lands', () => {
    const { pet, run } = make({ species: RAPTOR });
    const start = { x: pet.x, y: pet.y - 20 };
    pet.grab(start);
    expect(pet.act.k).toBe('held');
    for (let i = 0; i < 6; i++) {
      pet.drag({ x: start.x - i * 40, y: start.y - 200 - i * 30 });
      run(1 / 30);
    }
    pet.release();
    expect(pet.grounded).toBe(false);
    expect(pet.data.stats.throws).toBe(1);
    run(4);
    expect(pet.grounded).toBe(true);
    expect(pet.y).toBe(H);
  });

  it('reacts to games starting and stopping', () => {
    const { pet } = make();
    pet.setActivity({ idle: 0, locked: false, game: 'The Isle' });
    expect(pet.act).toMatchObject({ k: 'react', kind: 'game' });
    expect(pet.data.stats.games).toBe(1);
    expect(pet.drain()).toContainEqual({ type: 'sound', name: 'roar', soft: false });
    pet.setActivity({ idle: 0, locked: false, game: null });
    expect(pet.act).toMatchObject({ k: 'react', kind: 'welcome' });
  });

  it('ignores games when game reactions are off', () => {
    const { pet } = make({ settings: { gameReactions: false } });
    pet.setActivity({ idle: 0, locked: false, game: 'Brawlhalla' });
    expect(pet.act.k).not.toBe('react');
  });

  it('gets petted by rubbing the cursor over it', () => {
    const { pet, run } = make();
    run(1);
    for (let i = 0; i < 10; i++) pet.stroke(15);
    expect(pet.act.k).toBe('petted');
    expect(pet.data.stats.pets).toBe(1);
    run(3);
    expect(pet.act.k).not.toBe('petted');
  });

  it('hit tests its body', () => {
    const { pet, run } = make();
    run(1);
    const head = pet.headAt();
    expect(pet.hitTest({ x: pet.x, y: pet.y - pet.heightPx * 0.4 })).toBe(true);
    expect(pet.hitTest({ x: head.x, y: head.y + 5 })).toBe(true);
    expect(pet.hitTest({ x: pet.x, y: pet.y - pet.heightPx * 3 })).toBe(false);
  });

  it('chases a ball', () => {
    const { pet, run } = make({ species: RAPTOR });
    pet.play();
    expect(pet.ball).not.toBeNull();
    let kicked = false;
    let prevVx = pet.ball!.vx;
    run(15, () => {
      if (pet.ball && Math.abs(pet.ball.vx - prevVx) > 200) kicked = true;
      prevVx = pet.ball?.vx ?? 0;
    });
    expect(kicked).toBe(true);
  });

  it('keeps speech to emotes unless chatty', () => {
    const quiet = make();
    quiet.pet.react('welcome');
    expect(quiet.pet.drain().some((e) => e.type === 'say')).toBe(false);
    const chatty = make({ settings: { speech: 'chatty' } });
    chatty.pet.react('welcome');
    expect(chatty.pet.drain().some((e) => e.type === 'say')).toBe(true);
    const off = make({ settings: { speech: 'off' } });
    off.pet.react('welcome');
    expect(off.pet.drain().some((e) => e.type === 'emote')).toBe(false);
  });
});
