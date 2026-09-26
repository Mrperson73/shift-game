import { describe, expect, it } from 'vitest';
import { growthOf, isStage, stageOf, stageSeconds } from '../../src/pet/growth';
import { make } from './sim-helpers';

describe('picking a growth stage', () => {
  it('maps each stage to the start of that stage', () => {
    for (const s of ['hatchling', 'juvenile', 'subadult', 'adult'] as const) expect(stageOf(growthOf(stageSeconds(s)))).toBe(s);
    expect(isStage('adult')).toBe(true);
    expect(isStage('baby')).toBe(false);
  });

  it('resizes the pet both ways without a "grew" announcement', () => {
    const { pet, run, events } = make({ hours: 10 });
    pet.setStage('adult');
    expect(pet.growth).toBe(1);
    pet.setStage('hatchling');
    expect(pet.growth).toBe(0);
    expect(pet.data.activeSeconds).toBe(0);
    run(5);
    expect(events.some((e) => e.type === 'grew')).toBe(false);
  });

  it('stays put while growth is paused', () => {
    const { pet, run } = make({ hours: 10, settings: { growthSpeed: 0 } });
    const before = pet.data.activeSeconds;
    run(10);
    expect(pet.data.activeSeconds).toBe(before);
  });
});
