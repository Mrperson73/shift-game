// Power check (not part of the normal run): HATCHLING_PERF=1 npx playwright test perf
// Prints CPU, frame rate and memory per process for each state the pet can be in.
import { _electron as electron, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ROOT = path.resolve(__dirname, '../..');
test('cpu by state', async () => {
  test.skip(!process.env.HATCHLING_PERF, 'set HATCHLING_PERF=1 to measure');
  test.setTimeout(240_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hperf-'));
  const now = Date.now();
  const pet = { v: 1, id: 'perf', name: 'Perf', species: process.env.SP ?? 'trike', variant: 0, bornAt: now, hatchedAt: now, activeSeconds: 3600 * 40, energy: 1, happiness: 0.7, hunger: 0.2, stats: { pets: 0, meals: 0, naps: 0, games: 0, throws: 0, pokes: 0 }, lastSeen: now, x: 0.5, colors: null, shiny: false };
  fs.writeFileSync(path.join(dir, 'hatchling.json'), JSON.stringify({ v: 1, rev: 2, pet, settings: { sound: false }, history: [] }));
  const app = await electron.launch({ args: ['--no-sandbox', ROOT], cwd: ROOT, env: { ...process.env, HATCHLING_USER_DATA: dir, HATCHLING_TEST: '1' } });
  const overlay = await (async () => { for (;;) { const w = app.windows().find((p) => p.url().endsWith('/overlay.html')); if (w) return w; await new Promise((r) => setTimeout(r, 100)); } })();
  await overlay.waitForFunction(() => !!(window as unknown as { __test?: unknown }).__test);
  const measure = async (label: string, setup: string) => {
    await overlay.evaluate(setup);
    await new Promise((r) => setTimeout(r, 3000));
    await app.evaluate(({ app }) => app.getAppMetrics());
    const f0 = await overlay.evaluate(() => (window as unknown as { __test: { frames: () => number } }).__test.frames());
    await new Promise((r) => setTimeout(r, 15000));
    const m = await app.evaluate(({ app }) => app.getAppMetrics().map((x) => ({ type: x.type, cpu: x.cpu.percentCPUUsage, mem: x.memory.workingSetSize })));
    const f1 = await overlay.evaluate(() => (window as unknown as { __test: { frames: () => number } }).__test.frames());
    const total = m.reduce((s, x) => s + x.cpu, 0);
    const mem = m.reduce((s, x) => s + x.mem, 0);
    console.log(`PERF ${label.padEnd(14)} cpu ${total.toFixed(1)}%  fps ${((f1 - f0) / 15).toFixed(1)}  mem ${(mem / 1024).toFixed(0)} MB  ${m.map((x) => `${x.type}:${x.cpu.toFixed(1)}/${(x.mem / 1024).toFixed(0)}MB`).join(' ')}`);
  };
  const T = 'window.__test.pet';
  await measure('idle', `${T}.act = { k: 'idle', t: 0, dur: 1e9, nextLook: 1, look: null, sniff: 0 }`);
  await measure('sitting', `${T}.act = { k: 'sit', t: 0, dur: 1e9 }`);
  await measure('asleep', `${T}.sleepNow()`);
  await measure('walking', `${T}.wakeNow(); ${T}.act = { k: 'walk', toX: 60, run: false, dur: 1e9, t: 0 }; setInterval(() => { const p = ${T}; if (p.act.k === 'walk') p.act.toX = p.x < 400 ? 1200 : p.x > 1100 ? 100 : p.act.toX; }, 500)`);
  await measure('running', `${T}.act = { k: 'zoomies', t: 0, laps: 1e9, toX: 100 }`);

  await app.evaluate(() => (global as unknown as { __hatchling: { sendOverlay: (c: string, p: unknown) => void } }).__hatchling.sendOverlay('hidden', true));
  await measure('hidden', `0`);
  await app.close();
});
