import { describe, expect, it } from 'vitest';
import { BUILT_IN, ModError, movesOf, parseSpeciesMod, REX } from '../../src/pet/species';

describe('species mods', () => {
  it('builds a species from a base with multipliers, features and colours', () => {
    const s = parseSpeciesMod(
      {
        id: 'cerato',
        name: 'Cerato',
        base: 'rex',
        proportions: { headLen: 0.8, armUpper: 0.5, headAngle: 0.1 },
        features: { horns: true },
        personality: { speed: 0.9 },
        variants: [{ name: 'Red', body: '#AA3322' }],
        lines: { hello: ['Hi from Cerato'] },
      },
      'cerato.json',
    );
    expect(s.body.headLen).toBeCloseTo(REX.body.headLen * 0.8);
    expect(s.body.headAngle).toBeCloseTo(REX.body.headAngle + 0.1);
    expect(s.features.horns).toBe(true);
    expect(s.features.teeth).toBe(true);
    expect(s.personality.speed).toBe(0.9);
    expect(s.variants[0].body).toBe('#aa3322');
    expect(s.lines.hello).toEqual(['Hi from Cerato']);
    expect(s.mod).toBe('cerato.json');
  });

  it('can start from a four-legged species and pick its food and voice', () => {
    const s = parseSpeciesMod({ id: 'diablo', name: 'Diablo', base: 'trike', food: 'berry', voice: { kind: 'honk' }, proportions: { fLegW: 1.2 } }, 'd.json');
    expect(s.stance).toBe('quad');
    expect(s.food).toBe('berry');
    expect(s.voice.kind).toBe('honk');
    expect(s.body.fLegW).toBeGreaterThan(0);
    expect(() => parseSpeciesMod({ id: 'x', name: 'X', food: 'rocks' }, 'x')).toThrow(/food/);
    expect(() => parseSpeciesMod({ id: 'x', name: 'X', voice: { kind: 'kazoo' } }, 'x')).toThrow(/kind/);
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
    expect(bad({ id: 'x', name: 'X', base: 'trex' })).toThrow(/base/);
    expect(bad({ id: 'carno', name: 'X' })).toThrow(/built-in/);
    expect(bad({ id: 'x', name: 'X', proportions: { wings: 2 } })).toThrow(/Unknown proportion/);
    expect(bad({ id: 'x', name: 'X', features: { laser: true } })).toThrow(/Unknown feature/);
    expect(bad({ id: 'x', name: 'X', variants: [{ body: 'red' }] })).toThrow(/colour/);
    expect(bad({ id: 'x', name: 'X', diet: 'rocks' })).toThrow(/diet/);
    expect(bad({ id: 'x' })).toThrow(/name/);
  });

  it('built-ins are valid shapes', () => {
    expect(BUILT_IN.length).toBe(26);
    expect(new Set(BUILT_IN.map((s) => s.id)).size).toBe(BUILT_IN.length);
    for (const s of BUILT_IN) {
      expect(s.variants.length, s.id).toBe(6);
      expect(new Set(s.variants.map((v) => v.id)).size, s.id).toBe(6);
      expect(s.shiny.body, s.id).toMatch(/^#[0-9a-f]{6}$/);
      for (const v of Object.values(s.body)) expect(Number.isFinite(v)).toBe(true);
      if (s.stance === 'quad') expect(s.body.shoulderHeight * s.body.fThigh * s.body.fShin * s.body.fLegW, s.id).toBeGreaterThan(0);
    }
  });

  it('every built-in has signature moves, and winged ones can fly', () => {
    for (const s of BUILT_IN) {
      expect(movesOf(s).length, s.id).toBeGreaterThan(0);
      if (s.features.wings) expect(movesOf(s), s.id).toContain('fly');
    }
    expect(BUILT_IN.filter((s) => s.features.wings).map((s) => s.id).sort()).toEqual(['micro', 'ptera', 'quetzal']);
  });

  it('mods can have wings, moves, a size and the new voices', () => {
    const s = parseSpeciesMod({ id: 'dimo', name: 'Dimo', base: 'ptera', features: { wings: 'feather', pteroCrest: false }, moves: ['fly', 'screech', 'fly'], scale: 0.7, voice: { kind: 'croak' } }, 'dimo.json');
    expect(s.features.wings).toBe('feather');
    expect(s.features.pteroCrest).toBe(false);
    expect(s.stance).toBe('quad');
    expect(s.moves).toEqual(['fly', 'screech']);
    expect(s.scale).toBe(0.7);
    expect(s.voice.kind).toBe('croak');
    // Without its own moves, a mod gets moves from its features.
    expect(movesOf(parseSpeciesMod({ id: 'spiky', name: 'Spiky', base: 'rex', features: { dome: true } }, 's.json'))).toContain('headbutt');
    const bad = (m: unknown) => () => parseSpeciesMod(m, 'x.json');
    expect(bad({ id: 'x', name: 'X', moves: ['moonwalk'] })).toThrow(/moves/);
    expect(bad({ id: 'x', name: 'X', features: { wings: 'jet' } })).toThrow(/wings/);
    expect(bad({ id: 'x', name: 'X', scale: 'big' })).toThrow(/scale/);
  });
});
