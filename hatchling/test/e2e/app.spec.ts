import { _electron as electron, expect, type ElectronApplication, type Page, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = process.env.HATCHLING_SHOTS ? path.join(ROOT, 'shots') : null;

let app: ElectronApplication;
let userData: string;
const consoleErrors: string[] = [];

async function launch(dir: string) {
  app = await electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ROOT],
    cwd: ROOT,
    env: { ...process.env, HATCHLING_USER_DATA: dir, HATCHLING_TEST: '1', HATCHLING_MODS_DIR: path.join(dir, 'species') },
  });
  app.on('window', (w) => w.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text())));
}

async function windowBy(name: 'overlay' | 'panel'): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((p) => p.url().endsWith(`/${name}.html`));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ${name} window`);
}

const pet = async (overlay: Page) => {
  await overlay.waitForFunction(() => !!(window as unknown as { __test?: unknown }).__test);
  return petNow(overlay);
};
const petNow = (overlay: Page) => overlay.evaluate(() => {
  const p = (window as unknown as { __test: { pet: { data: unknown; act: { k: string }; hatched: boolean; x: number; y: number; grounded: boolean; foods: unknown[] } } }).__test.pet;
  return { data: p.data as { name: string; species: string; stats: Record<string, number>; hatchedAt: number | null }, act: p.act.k, hatched: p.hatched, x: p.x, y: p.y, grounded: p.grounded, foods: p.foods.length };
});

const mainErrors = () => app.evaluate(() => (global as unknown as { __hatchling: { errors: string[] } }).__hatchling.errors);

test.describe.serial('Hatchling', () => {
  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hatchling-e2e-'));
    await launch(userData);
  });
  test.afterAll(async () => {
    await app?.close();
  });
  test.afterEach(async () => {
    expect(consoleErrors).toEqual([]);
    expect(await mainErrors()).toEqual([]);
  });

  test('first run asks you to choose an egg', async () => {
    const panel = await windowBy('panel');
    await expect(panel.getByRole('heading', { name: 'Choose your egg' })).toBeVisible();
    await expect(panel.getByRole('radio', { name: 'Rex' })).toBeVisible();
    await expect(panel.getByRole('radio', { name: 'Raptor' })).toBeVisible();
    await expect(panel.getByRole('radio', { name: 'Pachy' })).toBeVisible();
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, 'panel-choose.png') });
  });

  test('hatching an egg puts it on the taskbar', async () => {
    const panel = await windowBy('panel');
    await panel.getByRole('radio', { name: 'Raptor' }).click();
    await expect(panel.getByText('Utahraptor')).toBeVisible();
    await panel.getByLabel('Name').fill('Tiny');
    await panel.getByLabel('Start Hatchling when Windows starts').uncheck();
    await panel.getByRole('button', { name: 'Hatch Tiny!' }).click();
    const overlay = await windowBy('overlay');
    await expect.poll(async () => (await pet(overlay)).data.name).toBe('Tiny');
    const p = await pet(overlay);
    expect(p.data.species).toBe('raptor');
    expect(p.hatched).toBe(false);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'hatchling.json'), 'utf8'));
    expect(saved.pet.name).toBe('Tiny');
    expect(saved.settings.startWithWindows).toBe(false);
  });

  test('clicking the egg hatches it', async () => {
    const overlay = await windowBy('overlay');
    // Clicks arrive through the real mouse path: the overlay only captures when the cursor is on the egg.
    const { x, y } = await pet(overlay);
    for (let i = 0; i < 3; i++) {
      await overlay.mouse.move(x, y - 12);
      await overlay.mouse.down();
      await overlay.mouse.up();
    }
    await expect.poll(async () => (await pet(overlay)).hatched, { timeout: 5000 }).toBe(true);
    if (SHOTS) {
      await overlay.waitForTimeout(1200);
      await overlay.screenshot({ path: path.join(SHOTS, 'overlay-hatched.png'), clip: { x: Math.max(0, x - 200), y: Math.max(0, y - 220), width: 400, height: 240 } });
    }
  });

  test('feeding from the tray menu: it finds the food and eats it', async () => {
    const overlay = await windowBy('overlay');
    await app.evaluate(() => (global as unknown as { __hatchling: { sendOverlay: (c: string, p: unknown) => void } }).__hatchling.sendOverlay('command', { type: 'feed' }));
    await expect.poll(async () => (await pet(overlay)).foods).toBe(1);
    await expect.poll(async () => (await pet(overlay)).data.stats.meals, { timeout: 30_000 }).toBe(1);
  });

  test('dragging and throwing it, then it lands', async () => {
    const overlay = await windowBy('overlay');
    await overlay.waitForTimeout(2500);
    const p = await pet(overlay);
    await overlay.mouse.move(p.x, p.y - 15);
    await overlay.mouse.down();
    for (let i = 1; i <= 8; i++) await overlay.mouse.move(p.x - i * 30, p.y - 15 - i * 40);
    await expect.poll(async () => (await pet(overlay)).act).toBe('held');
    await overlay.mouse.up();
    await expect.poll(async () => (await pet(overlay)).grounded, { timeout: 8000 }).toBe(true);
    expect((await pet(overlay)).data.stats.throws).toBeGreaterThanOrEqual(1);
  });

  test('sleeps when you are away and greets you when you are back', async () => {
    const overlay = await windowBy('overlay');
    await overlay.evaluate(() => (window as unknown as { __test: { pet: { setActivity: (a: unknown) => void } } }).__test.pet.setActivity({ idle: 600, locked: false, game: null }));
    await expect.poll(async () => (await pet(overlay)).act).toBe('sleep');
    await overlay.evaluate(() => (window as unknown as { __test: { pet: { setActivity: (a: unknown) => void } } }).__test.pet.setActivity({ idle: 0, locked: false, game: null }));
    await expect.poll(async () => (await pet(overlay)).act).toBe('wake');
  });

  test('the pet card shows its name, stage and stats', async () => {
    await app.evaluate(() => (global as unknown as { __hatchling: { openPanel: (v: string) => void } }).__hatchling.openPanel('card'));
    const panel = await windowBy('panel');
    await expect(panel.getByRole('button', { name: /Tiny/ }).first()).toBeVisible();
    await expect(panel.locator('.stage strong')).toHaveText('Hatchling');
    await expect(panel.getByRole('meter', { name: 'Growth' })).toBeVisible();
    await expect(panel.getByText('meals')).toBeVisible();
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, 'panel-card.png') });
  });

  test('renaming from the card', async () => {
    const panel = await windowBy('panel');
    await panel.getByRole('button', { name: /rename/ }).click();
    await panel.locator('input.name-edit').fill('Blue');
    await panel.keyboard.press('Enter');
    const overlay = await windowBy('overlay');
    await expect.poll(async () => (await pet(overlay)).data.name).toBe('Blue');
  });

  test('settings apply live and persist', async () => {
    const panel = await windowBy('panel');
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByRole('radio', { name: 'Large' }).click();
    await panel.getByRole('radio', { name: 'Chatty' }).click();
    await panel.getByRole('switch', { name: /Sounds/ }).uncheck();
    const overlay = await windowBy('overlay');
    await expect.poll(() => overlay.evaluate(() => (window as unknown as { __test: { pet: { settings: { size: string; speech: string; sound: boolean } } } }).__test.pet.settings)).toMatchObject({ size: 'L', speech: 'chatty', sound: false });
    if (SHOTS) await panel.screenshot({ path: path.join(SHOTS, 'panel-settings.png') });
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'hatchling.json'), 'utf8'));
    expect(saved.settings).toMatchObject({ size: 'L', speech: 'chatty', sound: false });
  });

  test('custom species from the mods folder show up as eggs', async () => {
    const dir = path.join(userData, 'species');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spino.json'), JSON.stringify({ id: 'spino', name: 'Spino', base: 'rex', features: { sail: true }, proportions: { headLen: 1.2 } }));
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"id": "x"}');
    await app.evaluate(() => (global as unknown as { __hatchling: { openPanel: (v: string) => void } }).__hatchling.openPanel('settings'));
    const panel = await windowBy('panel');
    await panel.getByRole('button', { name: 'Open species folder' }).click();
    await expect(panel.getByText('Loaded: Spino')).toBeVisible({ timeout: 5000 });
    await expect(panel.getByText(/bad\.json/)).toBeVisible();
  });

  test('a game starting makes it react', async () => {
    const overlay = await windowBy('overlay');
    await overlay.evaluate(() => (window as unknown as { __test: { pet: { setActivity: (a: unknown) => void } } }).__test.pet.setActivity({ idle: 0, locked: false, game: 'The Isle' }));
    await expect.poll(async () => (await pet(overlay)).data.stats.games).toBe(1);
  });

  test('tricks and new colours from the panel reach the pet and are saved', async () => {
    const overlay = await windowBy('overlay');
    const send = (c: unknown) => app.evaluate((_e, cmd) => (global as unknown as { __hatchling: { sendOverlay: (c: string, p: unknown) => void } }).__hatchling.sendOverlay('command', cmd), c);
    await send({ type: 'trick', name: 'dance' });
    await expect.poll(async () => (await pet(overlay)).act).toBe('dance');
    const colors = { body: '#123456', belly: '#abcdef', pattern: '#0a0b0c', accent: '#ff00aa', iris: '#00ff00', pattern_kind: 'rosettes' };
    await app.evaluate((_e, c) => {
      const h = (global as unknown as { __hatchling: { store: { data: { pet: { colors: unknown } } } } }).__hatchling;
      h.store.data.pet.colors = c;
    }, colors);
    await send({ type: 'recolor', variant: 2, colors });
    await expect.poll(() => overlay.evaluate(() => (window as unknown as { __test: { pet: { data: { colors: { body: string } | null } } } }).__test.pet.data.colors?.body)).toBe('#123456');
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'hatchling.json'), 'utf8')).pet.colors?.body, { timeout: 15_000 }).toBe('#123456');
  });

  test('saves power: slow frames while asleep, none while hidden', async () => {
    const overlay = await windowBy('overlay');
    const fps = () => overlay.evaluate(() => (window as unknown as { __test: { fps: () => number } }).__test.fps());
    await overlay.evaluate(() => (window as unknown as { __test: { pet: { sleepNow: () => void } } }).__test.pet.sleepNow());
    await expect.poll(fps).toBe(10);
    await app.evaluate(() => (global as unknown as { __hatchling: { sendOverlay: (c: string, p: unknown) => void } }).__hatchling.sendOverlay('hidden', true));
    await expect.poll(fps).toBe(1);
    await app.evaluate(() => (global as unknown as { __hatchling: { sendOverlay: (c: string, p: unknown) => void } }).__hatchling.sendOverlay('hidden', false));
    await overlay.evaluate(() => (window as unknown as { __test: { pet: { wakeNow: () => void } } }).__test.pet.wakeNow());
    // Full-screen hiding is off by default, so the pet is always visible.
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'hatchling.json'), 'utf8'));
    expect(saved.settings.hideFullscreen).toBe(false);
  });

  test('it survives a restart with everything saved', async () => {
    const overlay = await windowBy('overlay');
    const before = await pet(overlay);
    await app.close();
    await launch(userData);
    const again = await windowBy('overlay');
    await expect.poll(async () => (await pet(again)).data.name).toBe('Blue');
    const after = await pet(again);
    expect(after.hatched).toBe(true);
    expect(after.data.stats.meals).toBe(before.data.stats.meals);
    expect(app.windows().some((w) => w.url().endsWith('/panel.html'))).toBe(false);
  });
});

test('--smoke-test exits 0', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-smoke-')), 'r.txt');
  const exe = require('electron') as unknown as string;
  const env: Record<string, string | undefined> = { ...process.env, HATCHLING_SMOKE_OUT: out };
  delete env.HATCHLING_USER_DATA;
  const r = spawnSync(exe, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ROOT, '--smoke-test'], { env, timeout: 80_000, encoding: 'utf8' });
  expect(fs.readFileSync(out, 'utf8')).toMatch(/^HATCHLING_SMOKE OK/);
  expect(r.status).toBe(0);
});
