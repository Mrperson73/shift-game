// Growth: a pet grows only while you're actually at your PC (not idle, not locked).
// Stages follow The Isle: hatchling -> juvenile -> sub-adult -> adult.

import type { BodyKey, BodyParams, SpeciesDef } from './species';

export type Stage = 'hatchling' | 'juvenile' | 'subadult' | 'adult';

/** Active hours needed to be fully grown. At 3-5 hours a day that's about two to three weeks. */
export const HOURS_TO_ADULT = 60;

export const STAGES: { id: Stage; name: string; from: number }[] = [
  { id: 'hatchling', name: 'Hatchling', from: 0 },
  { id: 'juvenile', name: 'Juvenile', from: 0.15 },
  { id: 'subadult', name: 'Sub-adult', from: 0.6 },
  { id: 'adult', name: 'Adult', from: 1 },
];

/** Growth from 0 (just hatched) to 1 (adult) for a number of active seconds. */
export function growthOf(activeSeconds: number): number {
  const g = activeSeconds / 3600 / HOURS_TO_ADULT;
  return Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0;
}

export function stageOf(growth: number): Stage {
  let s: Stage = 'hatchling';
  for (const st of STAGES) if (growth >= st.from) s = st.id;
  return s;
}

export const stageName = (s: Stage) => STAGES.find((x) => x.id === s)!.name;

export const isStage = (v: unknown): v is Stage => STAGES.some((s) => s.id === v);

/** Active seconds at the very start of a stage (for picking a stage by hand). */
export const stageSeconds = (s: Stage) => STAGES.find((x) => x.id === s)!.from * HOURS_TO_ADULT * 3600;

/** Active hours until the next stage, or null when adult. */
export function hoursToNextStage(activeSeconds: number): number | null {
  const g = growthOf(activeSeconds);
  const next = STAGES.find((s) => s.from > g);
  if (!next) return null;
  return Math.max(0, next.from * HOURS_TO_ADULT - activeSeconds / 3600);
}

/** Overall size relative to an adult. */
export function sizeOf(growth: number): number {
  return 0.42 + 0.58 * Math.pow(Math.min(1, Math.max(0, growth)), 0.75);
}

/** How "baby-like" the proportions are: 1 at hatch, 0 for adults. Eases out fast early on. */
export function babyness(growth: number): number {
  return Math.pow(1 - Math.min(1, Math.max(0, growth)), 1.6);
}

/** Body proportions at a given growth (before the overall size is applied). */
export function morphBody(species: SpeciesDef, growth: number): BodyParams {
  const b = babyness(growth);
  const out = { ...species.body };
  for (const [k, mul] of Object.entries(species.baby) as [BodyKey, number][]) {
    out[k] = species.body[k] * (1 + (mul - 1) * b);
  }
  return out;
}
