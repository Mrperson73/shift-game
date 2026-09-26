// Toys, treats, signature moves and tricks in the real overlay: they reach the pet, are drawn,
// and nothing errors. A separate app instance with a pet that's already hatched.
import { _electron as electron, expect, type ElectronApplication, type Page, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

type TestPet = { act: { k: string }; x: number; y: number; rot: number; toys: { kind: string; x: number; y: number; r?: number; on?: unknown; thrown?: boolean; carried?: boolean }[]; data: { activeSeconds: number }; foods: { golden?: boolean }[] };

let app: ElectronApplication;
let overlay: Page;
const errors: string[] = [];

async function windowBy(name: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((p) => p.url().endsWith(`/${name}.html`));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ${name} window`);
}

const send = (c: unknown) => app.evaluate((_e, cmd) => (global as unknown as { __hatchling: { sendOverlay: (c: string, p: unknown) => void } }).__hatchling.sendOverlay('command', cmd), c);
const pet = () => overlay.evaluate(() => {
  const p = (window as unknown as { __test: { pet: TestPet } }).__test.pet;
  return { act: p.act.k, x: p.x, y: p.y, rot: p.rot, toys: p.toys.map((t) => ({ kind: t.kind, x: t.x, y: t.y, r: t.r, on: !!t.on, thrown: t.thrown, carried: t.carried })), active: p.data.activeSeconds, golden: p.foods.filter((f) => f.golden).length };
});

test.describe.serial('Hatchling 1.2 play', () => {
  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatchling-play-'));
    const now = Date.now();
    const data = { v: 1, id: 'play', name: 'Splash', species: 'spino', variant: 0, bornAt: now, hatchedAt: now, activeSeconds: 3600 * 20, energy: 1, happiness: 0.8, hunger: 0.1, stats: { pets: 0, meals: 0, naps: 0, games: 0, throws: 0, pokes: 0 }, lastSeen: now, x: 0.5, colors: null, shiny: false };
    fs.writeFileSync(path.join(dir, 'hatchling.json'), JSON.stringify({ v: 1, rev: 2, pet: data, settings: { sound: false, startWithWindows: false }, history: [] }));
    app = await electron.launch({ args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ROOT], cwd: ROOT, env: { ...process.env, HATCHLING_USER_DATA: dir, HATCHLING_TEST: '1', HATCHLING_MODS_DIR: path.join(dir, 'species') } });
    app.on('window', (w) => w.on('console', (m) => m.type() === 'error' && errors.push(m.text())));
    overlay = await windowBy('overlay');
    await overlay.waitForFunction(() => !!(window as unknown as { __test?: unknown }).__test);
  });
  test.afterAll(async () => {
    await app?.close();
  });
  test.afterEach(async () => {
    expect(errors).toEqual([]);
    expect(await app.evaluate(() => (global as unknown as { __hatchling: { errors: string[] } }).__hatchling.errors)).toEqual([]);
  });

  test('bubbles float up on the overlay and pop', async () => {
    await send({ type: 'toy', toy: 'bubbles' });
    await expect.poll(() => overlay.locator('.toy-bubble').count()).toBeGreaterThan(1);
    await expect.poll(async () => (await pet()).act).toBe('toy');
    // Bubbles in motion keep the frames smooth.
    expect(await overlay.evaluate(() => (window as unknown as { __test: { fps: () => number } }).__test.fps())).toBe(60);
    // Popping bubbles leave little rings.
    await expect.poll(() => overlay.locator('.pop-ring').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('a growth treat: a golden snack it eats to grow', async () => {
    const before = (await pet()).active;
    await send({ type: 'treat' });
    await expect.poll(() => overlay.locator('.sprite.golden').count()).toBe(1);
    await expect.poll(async () => (await pet()).active, { timeout: 30_000 }).toBeGreaterThan(before + 1800);
    await expect(overlay.locator('.sprite.golden')).toHaveCount(0);
  });

  test('its signature move: a Spinosaurus goes fishing in a puddle', async () => {
    await expect.poll(async () => ['idle', 'sit', 'lie', 'walk', 'watch', 'gaze', 'fidget', 'forage', 'toy', 'stretch', 'react'].includes((await pet()).act), { timeout: 20_000 }).toBe(true);
    await send({ type: 'special' });
    await expect.poll(async () => (await pet()).act).toBe('special');
    await expect.poll(() => overlay.locator('.toy-puddle').count()).toBe(1);
    // Water splashes when it strikes.
    await expect.poll(() => overlay.locator('.drop').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('plays dead on request: upside down, then back up', async () => {
    await expect.poll(async () => (await pet()).act !== 'special', { timeout: 25_000 }).toBe(true);
    await send({ type: 'trick', name: 'playdead' });
    await expect.poll(async () => Math.abs(Math.abs((await pet()).rot) - Math.PI) < 0.01, { timeout: 5000 }).toBe(true);
    await expect.poll(async () => (await pet()).rot, { timeout: 8000 }).toBe(0);
  });

  test('a bone: drag it and throw it, and it fetches it', async () => {
    await send({ type: 'toy', toy: 'bone' });
    // Wait for it to come to rest on the taskbar.
    await expect.poll(async () => (await pet()).toys.some((t) => t.kind === 'bone' && t.on && !t.carried), { timeout: 20_000 }).toBe(true);
    const bone = (await pet()).toys.find((t) => t.kind === 'bone')!;
    const at = { x: bone.x, y: bone.y - (bone.r ?? 9) };
    await overlay.mouse.move(at.x, at.y);
    await overlay.mouse.down();
    for (let i = 1; i <= 6; i++) await overlay.mouse.move(at.x + (at.x > 800 ? -1 : 1) * i * 40, at.y - i * 25);
    await overlay.mouse.up();
    await expect.poll(async () => (await pet()).toys.find((t) => t.kind === 'bone')?.thrown).toBe(true);
    // It runs to it and picks it up.
    await expect.poll(async () => !!(await pet()).toys.find((t) => t.kind === 'bone')?.carried, { timeout: 30_000 }).toBe(true);
  });
});
