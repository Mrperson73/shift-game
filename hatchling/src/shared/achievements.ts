// Badges a pet earns, computed purely from its saved data (nothing extra is stored).

import { growthOf, STAGES } from '../pet/growth';
import type { PetData } from './types';

/** Picks the badge artwork in the panel. */
export type AchievementIcon =
  | 'egg'
  | 'meal'
  | 'feast'
  | 'banquet'
  | 'pet'
  | 'hearts'
  | 'game'
  | 'nap'
  | 'sprout'
  | 'dino'
  | 'crown'
  | 'clock'
  | 'sun'
  | 'infinity'
  | 'plane'
  | 'sparkle';

/** Colour family of the badge. */
export type AchievementKind = 'food' | 'love' | 'play' | 'rest' | 'growth' | 'time' | 'special';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: AchievementIcon;
  kind: AchievementKind;
  /** 0..1 */
  progress: number;
  done: boolean;
  /** Where the pet is now and what it needs, for "7 / 10" labels (whole numbers). */
  current: number;
  target: number;
}

interface Def {
  id: string;
  name: string;
  description: string;
  icon: AchievementIcon;
  kind: AchievementKind;
  target: number;
  value: (p: PetData) => number;
}

const stageFrom = (id: string) => STAGES.find((s) => s.id === id)!.from;
/** Whole percent grown, so stage badges read like "12 / 15". */
const percentGrown = (p: PetData) => Math.floor(growthOf(p.activeSeconds) * 100 + 1e-9);
const hoursTogether = (p: PetData) => p.togetherSeconds / 3600;

const DEFS: Def[] = [
  { id: 'hatched', name: 'Hello, world', description: 'Hatch your egg', icon: 'egg', kind: 'special', target: 1, value: (p) => (p.hatchedAt !== null ? 1 : 0) },
  { id: 'meal-1', name: 'First bite', description: 'Share a first meal', icon: 'meal', kind: 'food', target: 1, value: (p) => p.stats.meals },
  { id: 'meal-10', name: 'Snack pack', description: 'Share 10 meals', icon: 'feast', kind: 'food', target: 10, value: (p) => p.stats.meals },
  { id: 'meal-100', name: 'Feast master', description: 'Share 100 meals', icon: 'banquet', kind: 'food', target: 100, value: (p) => p.stats.meals },
  { id: 'pets-50', name: 'Best buddy', description: 'Give 50 pets', icon: 'pet', kind: 'love', target: 50, value: (p) => p.stats.pets },
  { id: 'pets-500', name: 'Cuddle champ', description: 'Give 500 pets', icon: 'hearts', kind: 'love', target: 500, value: (p) => p.stats.pets },
  { id: 'game-1', name: 'Player two', description: 'Start a game while it watches', icon: 'game', kind: 'play', target: 1, value: (p) => p.stats.games },
  { id: 'naps-10', name: 'Sleepyhead', description: 'Take 10 naps', icon: 'nap', kind: 'rest', target: 10, value: (p) => p.stats.naps },
  { id: 'throws-10', name: 'Frequent flyer', description: 'Get tossed 10 times', icon: 'plane', kind: 'play', target: 10, value: (p) => p.stats.throws },
  { id: 'juvenile', name: 'Growing up', description: 'Reach the juvenile stage', icon: 'sprout', kind: 'growth', target: Math.round(stageFrom('juvenile') * 100), value: percentGrown },
  { id: 'subadult', name: 'Almost there', description: 'Reach the sub-adult stage', icon: 'dino', kind: 'growth', target: Math.round(stageFrom('subadult') * 100), value: percentGrown },
  { id: 'adult', name: 'All grown up', description: 'Reach adulthood', icon: 'crown', kind: 'growth', target: Math.round(stageFrom('adult') * 100), value: percentGrown },
  { id: 'hours-1', name: 'First hour', description: 'Spend 1 hour together', icon: 'clock', kind: 'time', target: 1, value: hoursTogether },
  { id: 'hours-10', name: 'Good friends', description: 'Spend 10 hours together', icon: 'sun', kind: 'time', target: 10, value: hoursTogether },
  { id: 'hours-50', name: 'Inseparable', description: 'Spend 50 hours together', icon: 'infinity', kind: 'time', target: 50, value: hoursTogether },
  { id: 'shiny', name: 'Lucky egg', description: 'Hatch a rare shiny (about 1 in 20)', icon: 'sparkle', kind: 'special', target: 1, value: (p) => (p.shiny ? 1 : 0) },
];

/** Every badge, in display order, with the pet's progress towards it. */
export function achievementsOf(p: PetData): Achievement[] {
  return DEFS.map((d) => {
    const raw = d.value(p);
    const v = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const done = v >= d.target;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      icon: d.icon,
      kind: d.kind,
      progress: done ? 1 : Math.min(1, v / d.target),
      done,
      current: done ? d.target : Math.floor(v),
      target: d.target,
    };
  });
}

/** Ids of the badges that are unlocked in `now` but weren't in `before`. */
export function newlyUnlocked(before: PetData, now: PetData): Achievement[] {
  const had = new Set(achievementsOf(before).filter((a) => a.done).map((a) => a.id));
  return achievementsOf(now).filter((a) => a.done && !had.has(a.id));
}
