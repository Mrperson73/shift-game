// Shared setup for the behaviour tests: a pet in a world, stepped at 30 fps.

import { rng } from '../../src/pet/math';
import { ANKY, RAPTOR, REX, type SpeciesDef, TRIKE } from '../../src/pet/species';
import { DEFAULT_SETTINGS, newPet, type Platform, type Settings, type Wall } from '../../src/shared/types';
import { Pet, type SimEvent } from '../../src/sim/pet';
import { ground } from '../../src/sim/world';

export const W = 1600;
export const H = 860;

/** A pterosaur until the real ones exist: four legs on the ground, membrane wings. */
export const PTERA: SpeciesDef = { ...TRIKE, id: 'ptera', name: 'Ptera', features: { beak: true, wings: 'membrane' }, moves: ['fly', 'fish'], lengthM: 6, personality: { ...TRIKE.personality, speed: 0.6, jump: 0.5, playfulness: 0.6 } };
/** A small feathered glider (Microraptor). */
export const MICRO: SpeciesDef = { ...RAPTOR, id: 'micro', name: 'Micro', features: { ...RAPTOR.features, wings: 'feather' }, moves: ['fly', 'screech'], lengthM: 0.8 };
/** A crocodilian (Deinosuchus). */
export const DEINO: SpeciesDef = { ...ANKY, id: 'deino', name: 'Deino', diet: 'carnivore', food: 'meat', features: { armor: true, teeth: true, crocSnout: true }, moves: ['roll', 'gape', 'fish'], lengthM: 11 };

export interface MakeOpts {
  species?: SpeciesDef;
  settings?: Partial<Settings>;
  seed?: number;
  hours?: number;
  x?: number;
}

export function make(opts: MakeOpts = {}) {
  let now = 1_700_000_000_000;
  const species = opts.species ?? REX;
  const data = newPet(species.id, 0, 'Test', now);
  data.hatchedAt = now;
  data.activeSeconds = (opts.hours ?? 10) * 3600;
  if (opts.x !== undefined) data.x = opts.x;
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const env = { rand: rng(opts.seed ?? 1), hour: () => 14, now: () => now };
  const pet = new Pet(data, species, settings, { width: W, height: H, platforms: [ground(W, H)], walls: [] }, env);
  const events: SimEvent[] = [];
  /** Runs `seconds`; `each` is called every step and can stop early by returning true. */
  const run = (seconds: number, each?: (t: number) => boolean | void) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      now += 1000 / 30;
      pet.update(1 / 30);
      events.push(...pet.drain());
      if (each?.(t)) return t;
    }
    return seconds;
  };
  const sounds = () => events.filter((e): e is Extract<SimEvent, { type: 'sound' }> => e.type === 'sound').map((e) => e.name);
  const fxs = () => events.filter((e): e is Extract<SimEvent, { type: 'fx' }> => e.type === 'fx').map((e) => e.kind);
  const emotes = () => events.filter((e): e is Extract<SimEvent, { type: 'emote' }> => e.type === 'emote').map((e) => e.kind);
  const says = () => events.filter((e): e is Extract<SimEvent, { type: 'say' }> => e.type === 'say').map((e) => e.text);
  return { pet, run, events, sounds, fxs, emotes, says, advance: (ms: number) => (now += ms) };
}

export const win = (id: string, x1: number, x2: number, y: number): Platform => ({ id, x1, x2, y, win: id, wx: x1 - 50, wy: y });

/** A window as the main process reports it: its top edge (minus icon and caption buttons) and sides. */
export function windowAt(id: string, left: number, right: number, top: number, bottom: number): { p: Platform; walls: Wall[] } {
  return {
    p: { id, x1: left + 40, x2: right - 150, y: top, win: id, wx: left, wy: top },
    walls: [
      { id: `${id}:L`, win: id, side: 'left', x: left, y1: top, y2: bottom, wx: left, wy: top },
      { id: `${id}:R`, win: id, side: 'right', x: right, y1: top, y2: bottom, wx: left, wy: top },
    ],
  };
}

/** What it picks when it decides what to do next, `n` times over (no simulation: fast). Counts by
 * behaviour name, e.g. 'fidget:sway', 'special:stomp', 'climb', 'fly'. */
export function choices(pet: Pet, n: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    keepFresh(pet);
    pet.butterfly = null;
    pet.toys = [];
    pet.foods = [];
    pet.act = pet.idleAct(1);
    pet.lastBeh = '';
    pet.choose();
    out.set(pet.lastBeh, (out.get(pet.lastBeh) ?? 0) + 1);
  }
  return out;
}

/** Keeps it fed and rested so a test measures its choices, not its needs. */
export function keepFresh(pet: Pet) {
  pet.data.energy = 1;
  pet.data.hunger = 0;
}

/** Checks it's somewhere sensible: on screen, and standing on its platform when grounded. */
export function sane(pet: Pet) {
  if (!Number.isFinite(pet.x) || !Number.isFinite(pet.y)) throw new Error(`not finite: ${pet.x}, ${pet.y} (${pet.act.k})`);
  if (pet.x < 0 || pet.x > W || pet.y > H + 0.01 || pet.y < 0) throw new Error(`off screen: ${pet.x.toFixed(1)}, ${pet.y.toFixed(1)} (${pet.act.k})`);
  if (pet.grounded && pet.act.k !== 'playdead' && Math.abs(pet.y - pet.platform.y) > 0.01) throw new Error(`not on its platform: ${pet.y} vs ${pet.platform.y} (${pet.act.k})`);
}
