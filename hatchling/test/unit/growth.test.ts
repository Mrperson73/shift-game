import { describe, expect, it } from 'vitest';
import { babyness, growthOf, HOURS_TO_ADULT, hoursToNextStage, morphBody, sizeOf, stageOf } from '../../src/pet/growth';
import { REX } from '../../src/pet/species';

describe('growth', () => {
  it('grows with active time and reaches adult', () => {
    expect(growthOf(0)).toBe(0);
    expect(growthOf(HOURS_TO_ADULT * 3600)).toBe(1);
    expect(growthOf(HOURS_TO_ADULT * 7200)).toBe(1);
    expect(growthOf(Number.NaN)).toBe(0);
    expect(stageOf(0)).toBe('hatchling');
    expect(stageOf(0.2)).toBe('juvenile');
    expect(stageOf(0.7)).toBe('subadult');
    expect(stageOf(1)).toBe('adult');
  });

  it('reports hours to the next stage', () => {
    expect(hoursToNextStage(0)).toBeCloseTo(0.15 * HOURS_TO_ADULT);
    expect(hoursToNextStage(HOURS_TO_ADULT * 3600)).toBeNull();
  });

  it('gets bigger and less baby-like monotonically', () => {
    let prev = 0;
    let prevBaby = 2;
    for (let g = 0; g <= 1.0001; g += 0.05) {
      expect(sizeOf(g)).toBeGreaterThan(prev);
      expect(babyness(g)).toBeLessThan(prevBaby);
      prev = sizeOf(g);
      prevBaby = babyness(g);
    }
    expect(sizeOf(1)).toBeCloseTo(1);
  });

  it('babies have relatively bigger heads and eyes', () => {
    const baby = morphBody(REX, 0);
    const adult = morphBody(REX, 1);
    expect(baby.headLen / baby.bodyLen).toBeGreaterThan(adult.headLen / adult.bodyLen);
    expect(baby.eyeR / baby.headH).toBeGreaterThan(adult.eyeR / adult.headH);
    expect(adult).toEqual(REX.body);
  });
});
