import { describe, expect, it } from 'vitest';
import { instrumentProject } from '../../src/core/instrument';
import { bake } from '../../src/core/bake';
import { errorReport, parseStack, tweaksReport } from '../../src/core/report';
import { formatColor, parseColor, toHex6 } from '../../src/core/colors';
import { inferRange, snap } from '../../src/core/ranges';

const src = [
  '<!doctype html><style>:root { --gap: 12px; --tint: rgb(10, 20, 30); }</style>',
  '<script>',
  'const GRAVITY = 0.5;',
  "const PLAYER = { color: '#FFAA00', jump: 12 };",
  'function f(x) { return x-5; }',
  'const DEBUG = false;',
  '</script>',
].join('\n');

describe('bake', () => {
  const res = instrumentProject('index.html', (p) => (p === 'index.html' ? src : null));
  const key = (label: string) => res.knobs.find((k) => k.label === label)!.key;

  it('writes tuned values back in the original notation', () => {
    const out = bake(res, {
      [key('GRAVITY')]: 0.62,
      [key('PLAYER.color')]: '#00FF00',
      [key('PLAYER.jump')]: 14.5,
      [key('x-·')]: -2,
      [key('--gap')]: 16,
      [key('--tint')]: 'rgb(1, 2, 3)',
      [key('DEBUG')]: true,
    });
    expect(out.skipped).toEqual([]);
    expect(out.applied.length).toBe(7);
    const text = out.files['index.html'];
    expect(text).toContain('const GRAVITY = 0.62;');
    expect(text).toContain("const PLAYER = { color: '#00FF00', jump: 14.5 };");
    expect(text).toContain('return x-(-2);');
    expect(text).toContain(':root { --gap: 16px; --tint: rgb(1, 2, 3); }');
    expect(text).toContain('const DEBUG = true;');
  });

  it('refuses to bake when the source no longer matches', () => {
    const stale = { ...res, sources: { 'index.html': src.replace('0.5', '0.7') } };
    const out = bake(stale, { [key('GRAVITY')]: 1 });
    expect(out.applied).toEqual([]);
    expect(out.skipped[0].reason).toBe('the code changed');
  });

  it('ignores unchanged values', () => {
    expect(bake(res, { [key('GRAVITY')]: 0.5 }).applied).toEqual([]);
  });
});

describe('colors', () => {
  it('parses common notations', () => {
    expect(parseColor('#f80')).toMatchObject({ r: 255, g: 136, b: 0, a: 1, format: 'hex' });
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toMatchObject({ r: 255, a: 0.5, format: 'rgb', hasAlpha: true });
    expect(parseColor('rgb(0 128 255 / 50%)')).toMatchObject({ b: 255, a: 0.5 });
    expect(parseColor('hsl(120, 100%, 50%)')).toMatchObject({ r: 0, g: 255, b: 0, format: 'hsl' });
    expect(parseColor('tomato')).toMatchObject({ r: 255, g: 99, b: 71, format: 'named' });
    expect(parseColor('hsl(1, 2, 3)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });

  it('formats in the original notation', () => {
    const green = { r: 0, g: 255, b: 0, a: 1 };
    expect(formatColor(green, '#f80')).toBe('#0f0');
    expect(formatColor({ r: 18, g: 52, b: 86, a: 1 }, '#FFAA00')).toBe('#123456');
    expect(formatColor(green, 'rgb(1, 2, 3)')).toBe('rgb(0, 255, 0)');
    expect(formatColor({ ...green, a: 0.25 }, 'rgb(1, 2, 3)')).toBe('rgba(0, 255, 0, 0.25)');
    expect(formatColor({ ...green, a: 0.5 }, 'rgb(1 2 3 / 1)')).toBe('rgb(0 255 0 / 0.5)');
    expect(formatColor(green, 'hsl(10, 50%, 50%)')).toBe('hsl(120, 100%, 50%)');
    expect(formatColor(green, 'red')).toBe('#00ff00');
    expect(toHex6(green)).toBe('#00ff00');
  });
});

describe('ranges', () => {
  it('infers sensible slider ranges', () => {
    expect(inferRange(0.5, 'GRAVITY')).toEqual({ min: 0, max: 2, step: 0.01 });
    expect(inferRange(-12, 'vy')).toEqual({ min: -50, max: 0, step: 0.1 });
    expect(inferRange(0.9, 'friction')).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(inferRange(800, 'width')).toEqual({ min: 0, max: 2500, step: 10 });
    expect(inferRange(5, 'maxEnemies').step).toBe(1);
    expect(snap(0.1 + 0.2, 0.01)).toBe(0.3);
  });
});

describe('reports', () => {
  it('parses V8 stacks and drops runtime frames', () => {
    const stack = 'TypeError: x\n    at update (knobs-game://abc/index.html:42:7)\n    at pump (knobs-game://abc/__knobs__/runtime.js:1:99)\n    at knobs-game://abc/js/game.js:3:1';
    expect(parseStack(stack)).toEqual([
      { fn: 'update', file: 'index.html', line: 42, col: 7 },
      { fn: '', file: 'js/game.js', line: 3, col: 1 },
    ]);
  });

  it('builds a copy-ready error report with source context', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join('\n');
    const report = errorReport(
      { message: "TypeError: Cannot read properties of undefined (reading 'x')", stack: 'TypeError\n    at update (knobs-game://abc/index.html:42:7)', count: 3, at: 12400 },
      { 'index.html': text },
      [],
    );
    expect(report).toContain('index.html, around line 42:');
    expect(report).toContain('> 42 | line42');
    expect(report).toContain('It happened 3 times, first 12.4s after the game started.');
    expect(report).toContain('at update (index.html:42:7)');
  });

  it('summarizes tweaks for an AI assistant', () => {
    const res = instrumentProject('index.html', (p) => (p === 'index.html' ? src : null));
    const g = res.knobs.find((k) => k.label === 'GRAVITY')!;
    expect(tweaksReport([{ knob: g, value: 0.62 }])).toContain('- GRAVITY — index.html:3: 0.5 → 0.62');
  });
});
