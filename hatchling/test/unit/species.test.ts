import { describe, expect, it } from 'vitest';
import { BUILT_IN, ModError, parseSpeciesMod, REX } from '../../src/pet/species';

describe('species mods', () => {
  it('builds a species from a base with multipliers, features and colours', () => {
    const s = parseSpeciesMod(
      {
        id: 'carno',
        name: 'Carno',
        base: 'rex',
        proportions: { headLen: 0.8, armUpper: 0.5, headAngle: 0.1 },
        features: { horns: true },
        personality: { speed: 0.9 },
        variants: [{ name: 'Red', body: '#AA3322' }],
        lines: { hello: ['Hi from Carno'] },
      },
      'carno.json',
    );
    expect(s.body.headLen).toBeCloseTo(REX.body.headLen * 0.8);
    expect(s.body.headAngle).toBeCloseTo(REX.body.headAngle + 0.1);
    expect(s.features.horns).toBe(true);
    expect(s.features.teeth).toBe(true);
    expect(s.personality.speed).toBe(0.9);
    expect(s.variants[0].body).toBe('#aa3322');
    expect(s.lines.hello).toEqual(['Hi from Carno']);
    expect(s.mod).toBe('carno.json');
  });

  it('clamps extreme numbers', () => {
    const s = parseSpeciesMod({ id: 'big', name: 'Big', proportions: { tailLen: 99 }, personality: { jump: 5 } }, 'x');
    expect(s.body.tailLen).toBeCloseTo(REX.body.tailLen * 2.5);
    expect(s.personality.jump).toBe(1);
  });

  it('rejects bad files with a helpful message', () => {
    const bad = (m: unknown) => () => parseSpeciesMod(m, 'x');
    expect(bad(null)).toThrow(ModError);
    expect(bad([])).toThrow(/JSON object/);
    expect(bad({ id: 'rex', name: 'X' })).toThrow(/built-in/);
    expect(bad({ id: 'Bad Id!', name: 'X' })).toThrow(/a-z/);
    expect(bad({ id: 'x', name: 'X', base: 'stego' })).toThrow(/base/);
    expect(bad({ id: 'x', name: 'X', proportions: { wings: 2 } })).toThrow(/Unknown proportion/);
    expect(bad({ id: 'x', name: 'X', features: { laser: true } })).toThrow(/Unknown feature/);
    expect(bad({ id: 'x', name: 'X', variants: [{ body: 'red' }] })).toThrow(/colour/);
    expect(bad({ id: 'x', name: 'X', diet: 'rocks' })).toThrow(/diet/);
    expect(bad({ id: 'x' })).toThrow(/name/);
  });

  it('built-ins are valid shapes', () => {
    for (const s of BUILT_IN) {
      expect(s.variants.length).toBeGreaterThan(0);
      for (const v of Object.values(s.body)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
