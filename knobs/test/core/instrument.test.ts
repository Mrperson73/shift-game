import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { instrumentProject } from '../../src/core/instrument';
import { scanHtml } from '../../src/core/html';
import { createRegistry } from '../../src/runtime/registry';
import type { InstrumentResult } from '../../src/core/types';

const page = (...scripts: string[]) => `<!doctype html>\n<html><head><title>T</title></head><body>\n${scripts.map((s) => `<script>\n${s}\n</script>`).join('\n')}\n</body></html>`;

function build(html: string, extra: Record<string, string> = {}, opts = {}) {
  const files: Record<string, string> = { 'index.html': html, ...extra };
  return instrumentProject('index.html', (p) => files[p] ?? null, opts);
}

/** Run the instrumented inline scripts in a VM wired to a real registry. */
function run(res: InstrumentResult) {
  const reg = createRegistry(res.knobs.map((k) => k.value), res.sites);
  const context = vm.createContext({ __K: reg.K, __KO: reg.KO, __KP: reg.KP, Math, console });
  const out = res.files[res.entry];
  for (const s of scanHtml(out).scripts) if (s.start !== undefined) vm.runInContext(out.slice(s.start, s.end), context);
  const knob = (label: string) => {
    const k = res.knobs.find((x) => x.label === label);
    if (!k) throw new Error(`no knob ${label}; have: ${res.knobs.map((x) => x.label).join(', ')}`);
    return k;
  };
  return {
    ctx: context,
    ev: (code: string) => vm.runInContext(code, context),
    set: (label: string, v: number | string | boolean) => reg.set(knob(label).id, v),
    knob,
  };
}

const lines = (s: string) => s.split('\n').length;

describe('named constants', () => {
  it('rewrites const reads so changes apply live', () => {
    const res = build(page('const GRAVITY = 0.5;\nlet vy = 0;\nfunction step() { vy += GRAVITY; return vy; }'));
    const g = res.knobs.find((k) => k.label === 'GRAVITY')!;
    expect(g).toMatchObject({ group: 'tunable', live: 'live', value: 0.5, line: 4 });
    const r = run(res);
    expect(r.ev('step()')).toBe(0.5);
    r.set('GRAVITY', 1);
    expect(r.ev('step()')).toBe(1.5);
  });

  it('marks constants only read at top level as restart', () => {
    const res = build(page('const W = 800;\nconst canvas = { width: W };'));
    expect(res.knobs.find((k) => k.label === 'W')!.live).toBe('restart');
  });

  it('handles shorthand properties, var globals and cross-script references', () => {
    const res = build(page('var FRICTION = 0.9;\nconst SPEED = 5;\nfunction make() { return { SPEED }; }', 'function f() { return FRICTION * SPEED; }'));
    const r = run(res);
    expect(r.ev('make().SPEED')).toBe(5);
    r.set('SPEED', 7);
    r.set('FRICTION', 0.5);
    expect(r.ev('make().SPEED')).toBe(7);
    expect(r.ev('f()')).toBe(3.5);
  });

  it('treats reassigned variables as starting values', () => {
    const res = build(page('let lives = 3;\nfunction die() { lives--; return lives; }'));
    expect(res.knobs.find((k) => k.label === 'lives')).toMatchObject({ group: 'start', live: 'restart' });
    const r = run(res);
    expect(r.ev('die()')).toBe(2);
  });

  it('treats single-assignment variables as constants', () => {
    const res = build(page('let gravity;\nfunction init() { gravity = 0.5; }\nfunction f() { return gravity * 2; }\ninit();'));
    const r = run(res);
    r.set('gravity', 2);
    expect(r.ev('f()')).toBe(4);
  });

  it('supports booleans and colors', () => {
    const res = build(page("const DEBUG = false;\nconst BG = '#102030';\nfunction d() { return DEBUG ? BG : 'none'; }"));
    expect(res.knobs.map((k) => [k.label, k.kind, k.group])).toEqual([
      ['DEBUG', 'boolean', 'tunable'],
      ['BG', 'color', 'color'],
    ]);
    const r = run(res);
    r.set('DEBUG', true);
    r.set('BG', '#ffffff');
    expect(r.ev('d()')).toBe('#ffffff');
  });
});

describe('objects and classes', () => {
  it('registers top-level config objects for live mutation', () => {
    const res = build(page("const CONFIG = { player: { jump: 12, speed: 3 }, colors: { bg: '#123456' }, waves: [5, 8] };\nfunction j() { return CONFIG.player.jump + CONFIG.waves[1]; }"));
    expect(res.knobs.map((k) => k.label)).toEqual(['CONFIG.player.jump', 'CONFIG.player.speed', 'CONFIG.colors.bg', 'CONFIG.waves[0]', 'CONFIG.waves[1]']);
    const r = run(res);
    expect(r.ev('j()')).toBe(20);
    r.set('CONFIG.player.jump', 20);
    r.set('CONFIG.waves[1]', 10);
    expect(r.ev('j()')).toBe(30);
    r.set('CONFIG.colors.bg', '#000000');
    expect(r.ev('CONFIG.colors.bg')).toBe('#000000');
  });

  it('keeps frozen config objects working (applies on restart)', () => {
    const res = build(page('const C = Object.freeze({ g: 2 });\nfunction f() { return C.g; }'));
    expect(res.knobs[0]).toMatchObject({ label: 'C.g', live: 'restart' });
    expect(run(res).ev('f()')).toBe(2);
  });

  it('updates existing class instances from constructor props and fields', () => {
    const res = build(page('class Player {\n  speed = 3;\n  static G = 9.8;\n  constructor() { this.jumpForce = 10; this.x = 0; }\n  update() { this.x += this.speed; return this.x; }\n}\nconst p = new Player();'));
    const byLabel = Object.fromEntries(res.knobs.map((k) => [k.label, k]));
    expect(byLabel.speed).toMatchObject({ group: 'tunable', live: 'live', scope: 'Player' });
    expect(byLabel.x.group).toBe('start');
    expect(byLabel.jumpForce.group).toBe('tunable');
    const r = run(res);
    expect(r.ev('p.update()')).toBe(3);
    r.set('speed', 5);
    r.set('jumpForce', 14);
    r.set('G', 20);
    expect(r.ev('p.update()')).toBe(8);
    expect(r.ev('p.jumpForce')).toBe(14);
    expect(r.ev('Player.G')).toBe(20);
  });

  it('marks object literals built inside functions as spawn', () => {
    const res = build(page('const enemies = [];\nfunction spawn() { enemies.push({ x: 0, speed: 2.5 }); }'));
    expect(res.knobs.find((k) => k.label === 'speed')).toMatchObject({ live: 'spawn', group: 'tunable', scope: 'spawn › enemies.push(…)' });
    expect(res.knobs.find((k) => k.label === 'x')!.group).toBe('start');
  });

  it('registers config objects seeded from constants', () => {
    const res = build(page('const G = 0.5;\nconst CFG = { gravity: G };\nfunction f() { return CFG.gravity; }'));
    const r = run(res);
    r.set('G', 2);
    expect(r.ev('f()')).toBe(2);
  });
});

describe('numbers in code', () => {
  const code = [
    'const arr = [1, 2, 3, 4];',
    'const ctx = { arc() {} };',
    'const e = { keyCode: 0 };',
    'function update(p, s) {',
    '  p.vy += 0.35;',
    '  if (p.y > 400) p.y = 400;',
    '  for (let i = 0; i < 10; i++) {}',
    '  ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);',
    '  arr[3]; s.toFixed(2); p.y % 2; e.keyCode === 32;',
    '  setTimeout(() => {}, 1500);',
    '  const dt = 16 / 1000;',
    '}',
    'function jump(p) { p.vy = -12; }',
  ].join('\n');

  it('extracts useful numbers and skips structural ones', () => {
    const res = build(page(code));
    const codeKnobs = res.knobs.filter((k) => k.group === 'code').map((k) => [k.label, k.value]);
    expect(codeKnobs).toEqual([
      ['p.vy += ·', 0.35],
      ['p.y > ·', 400],
      ['p.y = ·', 400],
      ['i < ·', 10],
      ['ctx.arc(p.x, p.y, ·, 0, Math.PI * 2)', 8],
      ['setTimeout(() => {}, ·)', 1500],
      ['dt = · / 1000', 16],
      ['p.vy = ·', -12],
    ]);
    const jump = res.knobs.find((k) => k.value === -12)!;
    expect(jump).toMatchObject({ scope: 'jump', negSafe: true, live: 'live' });
  });

  it('can be switched off', () => {
    expect(build(page(code), {}, { codeNumbers: false }).knobs.filter((k) => k.group === 'code')).toEqual([]);
  });

  it('applies code numbers live', () => {
    const res = build(page('function step(p) { p.vy += 0.35; return p.vy; }'));
    const r = run(res);
    r.set('p.vy += ·', 1);
    expect(r.ev('step({ vy: 0 })')).toBe(1);
  });
});

describe('files and structure', () => {
  it('preserves line counts, doctype and injects the runtime in <head>', () => {
    const html = page('const A = 1.5;\nconst B = { c: 2 };\nfunction f() { return A + B.c; }');
    const res = build(html);
    const out = res.files['index.html'];
    expect(lines(out)).toBe(lines(html));
    expect(out.startsWith('<!doctype html>\n<html><head><script src="/__knobs__/runtime.js"></script><title>')).toBe(true);
  });

  it('instruments external classic scripts with a worker-safe prelude after directives', () => {
    const res = build('<!doctype html><script src="js/game.js"></script>', { 'js/game.js': '"use strict";\nconst SPEED = 4;\nfunction f() { return SPEED; }\n' });
    const out = res.files['js/game.js'];
    expect(out.startsWith('"use strict";;(function(g){')).toBe(true);
    expect(out).toContain('return __K[0]');
    expect(lines(out)).toBe(4);
    // the prelude alone makes it runnable without the page runtime (e.g. inside a worker)
    const c = vm.createContext({ globalThis: undefined });
    vm.runInContext('var globalThis = this;' + out + '\nvar r = f();', c);
    expect(vm.runInContext('r', c)).toBe(4);
  });

  it('links exported constants across ES modules', () => {
    const res = build('<!doctype html><script type="module" src="main.js"></script>', {
      'main.js': "import { JUMP } from './config.js';\nimport * as C from './config.js';\nexport function j() { return JUMP + C.JUMP + C.LIST.length; }\n",
      'config.js': 'export const JUMP = 12;\nexport const LIST = [1, 2];\n',
    });
    const jump = res.knobs.find((k) => k.label === 'JUMP')!;
    expect(jump.live).toBe('live');
    expect(res.files['main.js']).toContain(`return __K[${jump.id}] + __K[${jump.id}] + C.LIST.length`);
  });

  it('instruments CSS custom properties and whole-value colors', () => {
    const html = '<!doctype html><style>\n:root { --accent: #ff0; --gap: 12px; }\nbody { background: #111; margin: 0; content: "a;b" }\n</style>';
    const res = build(html);
    expect(res.knobs.map((k) => [k.label, k.kind, k.value, k.unit ?? ''])).toEqual([
      ['--accent', 'color', '#ff0', ''],
      ['--gap', 'number', 12, 'px'],
      ['body › background', 'color', '#111', ''],
    ]);
    expect(res.files['index.html']).toContain(':root { --accent: var(--__k0); --gap: var(--__k1); }');
    expect(res.knobs[1].line).toBe(2);
  });

  it('wraps JSX attribute colors in braces', () => {
    const res = build('<script type="text/babel">\nfunction App() { return <div color="#abcdef" />; }\n</script>');
    expect(res.files['index.html']).toContain('<div color={__K[0]} />');
  });

  it('leaves unparseable scripts untouched with a warning', () => {
    const html = page('const x = ;');
    const res = build(html);
    expect(res.knobs).toEqual([]);
    expect(res.warnings[0]).toMatch(/couldn't read this script/);
    expect(res.files['index.html']).toContain('const x = ;');
  });

  it('skips non-JS script types such as shaders and JSON', () => {
    const res = build('<script type="x-shader/x-vertex">void main() { float a = 0.5; }</script><script type="application/json">{"a": 2.5}</script>');
    expect(res.knobs).toEqual([]);
  });

  it('gives knobs stable keys across unrelated edits', () => {
    const a = build(page('const G = 1.5;\nfunction f(p) { p.vy += 0.35; }'));
    const b = build(page('// new comment\nfunction extra() {}\nconst G = 1.5;\nfunction f(p) { p.vy += 0.35; }'));
    expect(b.knobs.map((k) => k.key)).toEqual(a.knobs.map((k) => k.key));
  });
});

describe('robustness', () => {
  it('handles a UTF-8 BOM and CRLF line endings', () => {
    const html = '﻿<!doctype html>\r\n<script>\r\nconst G = 1.5;\r\nfunction f() { return G; }\r\n</script>';
    const res = build(html);
    const g = res.knobs.find((k) => k.label === 'G')!;
    expect(g).toMatchObject({ value: 1.5, line: 3, context: 'const G = 1.5;' });
    expect(html.slice(g.start, g.end)).toBe('1.5');
    const r = run(res);
    r.set('G', 3);
    expect(r.ev('f()')).toBe(3);
  });

  it('skips engine libraries and minified scripts', () => {
    const res = build('<script src="js/three.module.js"></script><script src="vendor/x.js"></script><script src="game.js"></script>', {
      'js/three.module.js': 'const A = 1.5;',
      'vendor/x.js': 'const B = 2.5;',
      'game.js': 'const C = 3.5;',
    });
    expect(res.knobs.map((k) => k.label)).toEqual(['C']);
  });

  it('falls back to running the game without knobs if analysis fails', async () => {
    const { safeInstrumentProject } = await import('../../src/core/instrument');
    let calls = 0;
    const res = safeInstrumentProject('index.html', (p) => {
      if (p === 'index.html' && calls++ === 0) throw new Error('boom');
      return p === 'index.html' ? '<!doctype html><head></head><script>const X = 2;</script>' : null;
    });
    expect(res.knobs).toEqual([]);
    expect(res.warnings[0]).toMatch(/couldn't analyze this game \(boom\)/);
    expect(res.files['index.html']).toContain('<head><script src="/__knobs__/runtime.js"></script></head>');
  });
});
