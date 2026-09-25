import { describe, expect, it } from 'vitest';
import { achievementsOf, newlyUnlocked } from '../../src/shared/achievements';
import { newPet, type PetData } from '../../src/shared/types';

const HOUR = 3600;

function pet(patch: Partial<PetData> = {}, stats: Partial<PetData['stats']> = {}): PetData {
  const p = newPet('rex', 0, 'Rexy', 0);
  return { ...p, hatchedAt: 1, ...patch, stats: { ...p.stats, ...stats } };
}

const byId = (p: PetData) => Object.fromEntries(achievementsOf(p).map((a) => [a.id, a]));

describe('achievements', () => {
  it('a fresh egg has earned nothing', () => {
    const list = achievementsOf(newPet('rex', 0, 'Rexy', 0));
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list.every((a) => !a.done)).toBe(true);
    expect(list.every((a) => a.progress >= 0 && a.progress <= 1)).toBe(true);
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
  });

  it('counts meals, pets, naps, games and throws', () => {
    const a = byId(pet({}, { meals: 10, pets: 50, naps: 9, games: 1, throws: 12 }));
    expect(a['hatched'].done).toBe(true);
    expect(a['meal-1'].done).toBe(true);
    expect(a['meal-10'].done).toBe(true);
    expect(a['meal-100'].done).toBe(false);
    expect(a['meal-100'].progress).toBeCloseTo(0.1);
    expect(a['meal-100'].current).toBe(10);
    expect(a['pets-50'].done).toBe(true);
    expect(a['pets-500'].progress).toBeCloseTo(0.1);
    expect(a['naps-10'].done).toBe(false);
    expect(a['naps-10'].current).toBe(9);
    expect(a['game-1'].done).toBe(true);
    expect(a['throws-10'].done).toBe(true);
  });

  it('follows growth stages and time together', () => {
    const young = byId(pet({ activeSeconds: 8 * HOUR }));
    expect(young['juvenile'].done).toBe(false);
    expect(young['hours-1'].done).toBe(true);
    expect(young['hours-10'].progress).toBeCloseTo(0.8);
    const juvenile = byId(pet({ activeSeconds: 9 * HOUR }));
    expect(juvenile['juvenile'].done).toBe(true);
    expect(juvenile['subadult'].done).toBe(false);
    const adult = byId(pet({ activeSeconds: 60 * HOUR }));
    expect(adult['subadult'].done).toBe(true);
    expect(adult['adult'].done).toBe(true);
    expect(adult['hours-50'].done).toBe(true);
  });

  it('knows a shiny', () => {
    expect(byId(pet())['shiny'].done).toBe(false);
    expect(byId(pet({ shiny: true }))['shiny'].done).toBe(true);
  });

  it('tolerates odd numbers', () => {
    const a = byId(pet({ activeSeconds: Number.NaN }, { meals: -3 }));
    expect(a['meal-1'].progress).toBe(0);
    expect(a['hours-1'].progress).toBe(0);
  });

  it('reports only what was just unlocked', () => {
    const before = pet({}, { meals: 9 });
    const now = pet({}, { meals: 10 });
    expect(newlyUnlocked(before, now).map((a) => a.id)).toEqual(['meal-10']);
    expect(newlyUnlocked(now, now)).toEqual([]);
  });
});
