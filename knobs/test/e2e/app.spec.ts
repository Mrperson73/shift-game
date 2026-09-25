import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = process.env.KNOBS_SHOTS;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knobs-e2e-'));
const gamesDir = path.join(tmp, 'games');
const fixtureDir = path.join(tmp, 'fixture');
const fixture = path.join(fixtureDir, 'index.html');

const hasXdotool = () => {
  try {
    execSync('xdotool version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const uiErrors: string[] = [];
let app: ElectronApplication;
let win: Page;

const shot = async (name: string) => {
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function gameFrame(): Promise<Frame> {
  await expect.poll(() => win.frames().some((f) => f.url().startsWith('knobs-game://')), { timeout: 15_000 }).toBe(true);
  const f = win.frames().find((x) => x.url().startsWith('knobs-game://'))!;
  await f.waitForFunction(() => (window as unknown as { probe?: unknown }).probe !== undefined, null, { timeout: 15_000 });
  return f;
}

const probe = (f: Frame) => f.evaluate(() => (window as unknown as { probe: Record<string, unknown> }).probe);

/** After pausing, a frame already in flight may still land: wait until the counter stops moving. */
async function stableFrames(f: Frame): Promise<number> {
  let prev = -1;
  for (let i = 0; i < 20; i++) {
    const n = (await probe(f)).frames as number;
    if (n === prev) return n;
    prev = n;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('frame counter never settled — game is not paused');
}
const knob = (label: string) => win.locator('.knob', { has: win.locator('.knob-name', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

test.describe.serial('Knobs app', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'test/fixtures/game.html'), fixture);
    // KNOBS_EXE=path/to/packaged/binary runs the same suite against a packaged build
    const exe = process.env.KNOBS_EXE;
    app = await electron.launch({
      executablePath: exe || undefined,
      args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(exe ? [] : [ROOT])],
      cwd: ROOT,
      env: { ...process.env, KNOBS_USER_DATA: path.join(tmp, 'user'), KNOBS_GAMES_DIR: gamesDir },
    });
    win = await app.firstWindow();
    win.on('pageerror', (e) => e.stack?.includes('knobs-app://') && uiErrors.push(e.message));
    await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test.afterEach(() => {
    // errors thrown by the Knobs UI itself (game errors are reported through the console panel instead)
    expect(uiErrors).toEqual([]);
  });

  test('shows the home screen and opens the demo', async () => {
    await expect(win.locator('.hero h1')).toHaveText('Knobs');
    await expect(win.locator('.step')).toHaveCount(3);
    await win.waitForTimeout(300);
    await expect(win.locator('.toast.error')).toHaveCount(0);
    await shot('01-home');
    await win.getByRole('button', { name: 'Try the demo' }).click();
    await expect(knob('GRAVITY')).toBeVisible();
    await expect(knob('COLORS.player')).toBeVisible();
    await expect(knob('--sky-top')).toBeVisible();
    await expect(win.locator('.game-name')).toHaveText('Knobs Demo');
    const f = win.frames().find((x) => x.url().startsWith('knobs-game://'))!;
    await f.waitForFunction(() => (window as unknown as { __knobsFrames: number }).__knobsFrames > 10);
    await win.waitForTimeout(800);
    await shot('02-demo');
    expect(fs.existsSync(path.join(gamesDir, 'Knobs Demo', 'index.html'))).toBe(true);
    await expect(win.locator('.log-error')).toHaveCount(0);
  });

  test('opens a game from another instance and lists its knobs', async () => {
    await app.evaluate(({ app: a }, p) => a.emit('second-instance', {}, ['electron', '.', p], ''), fixture);
    await expect(win.locator('.game-name')).toHaveText('Fixture Game');
    for (const l of ['SPEED', 'CONFIG.size', 'CONFIG.color', '--bg']) await expect(knob(l)).toBeVisible();
    const f = await gameFrame();
    expect(await probe(f)).toMatchObject({ speed: 2, size: 10, color: '#ff0000', bg: 'rgb(18, 52, 86)' });
    await expect(win.locator('.console')).toContainText('fixture ready');
  });

  test('applies knob changes live', async () => {
    const f = await gameFrame();
    const input = knob('SPEED').locator('.knob-value');
    await input.click();
    await input.fill('5');
    await input.press('Enter');
    await expect.poll(async () => (await probe(f)).speed).toBe(5);
    await knob('CONFIG.size').locator('.knob-value').fill('25');
    await knob('CONFIG.size').locator('.knob-value').press('Enter');
    await expect.poll(async () => (await probe(f)).size).toBe(25);
    // drag the slider all the way right
    const slider = knob('CONFIG.size').locator('.slider');
    const box = (await slider.boundingBox())!;
    await win.mouse.move(box.x + 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width + 20, box.y + box.height / 2, { steps: 4 });
    await win.mouse.up();
    await expect(knob('CONFIG.size').locator('.knob-value')).toHaveValue('50');
    await expect.poll(async () => (await probe(f)).size).toBe(50);
    await knob('--bg').locator('.knob-value').fill('#00ff00');
    await knob('--bg').locator('.knob-value').press('Enter');
    await expect.poll(async () => (await probe(f)).bg).toBe('rgb(0, 255, 0)');
    await expect(win.locator('.knob.mod')).toHaveCount(3);
    await shot('03-tuned');
  });

  test('captures errors with the right source line', async () => {
    const f = await gameFrame();
    await f.evaluate(() => setTimeout(() => (window as unknown as { boom: () => void }).boom()));
    const err = win.locator('.log-error').first();
    await expect(err).toContainText("Cannot read properties of null (reading 'x')");
    const line = fs.readFileSync(fixture, 'utf8').split('\n').findIndex((l) => l.includes('return null.x')) + 1;
    await expect(err.locator('.log-loc')).toHaveText(`index.html:${line}`);
    await expect(win.locator('.errs')).toContainText('1 error');
    await err.locator('.log-main').click();
    await expect(err.locator('.log-code')).toContainText('return null.x');
    await shot('04-error');
  });

  test('pauses and steps frames', async () => {
    const f = await gameFrame();
    await win.locator('.panel-head').click();
    await win.keyboard.press('F6');
    await expect(win.locator('.paused-badge')).toBeVisible();
    const a = await stableFrames(f);
    await win.waitForTimeout(300);
    expect((await probe(f)).frames).toBe(a);
    await win.keyboard.press('F7');
    await expect.poll(async () => (await probe(f)).frames).toBe(a + 1);
    await win.keyboard.press('F6');
    await expect.poll(async () => (await probe(f)).frames as number).toBeGreaterThan(a + 5);
  });

  test('F-keys reach Knobs even while the game has keyboard focus (real X11 keys)', async () => {
    test.skip(process.platform !== 'linux' || !hasXdotool(), 'needs xdotool');
    const f = await gameFrame();
    const box = (await win.locator('.stage').boundingBox())!;
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(win.locator('.stage.focused')).toBeVisible();
    execSync('xdotool key F6');
    await expect(win.locator('.paused-badge')).toBeVisible();
    const a = await stableFrames(f);
    execSync('xdotool key F7');
    await expect.poll(async () => (await probe(f)).frames).toBe(a + 1);
    execSync('xdotool key F6');
    await expect(win.locator('.paused-badge')).toHaveCount(0);
  });

  test('bakes tuned values into the file', async () => {
    await win.locator('.panel-head').click();
    await win.keyboard.press('Control+s');
    await expect(win.locator('.toast', { hasText: 'Baked' })).toContainText('Baked 3 values into index.html');
    const text = fs.readFileSync(fixture, 'utf8');
    expect(text).toContain('const SPEED = 5;');
    expect(text).toContain("const CONFIG = { size: 50, color: '#ff0000' };");
    expect(text).toContain(':root { --bg: #00ff00; }');
    await expect(win.locator('.knob.mod')).toHaveCount(0);
  });

  test('hot-reloads when the file changes and keeps a version history', async () => {
    fs.writeFileSync(fixture, fs.readFileSync(fixture, 'utf8').replace('size: 50', 'size: 7'));
    const f = await gameFrame();
    await expect.poll(async () => (await gameFrame().then(probe)).size, { timeout: 10_000 }).toBe(7);
    expect(f).toBeTruthy();
    await expect(knob('CONFIG.size').locator('.knob-value')).toHaveValue('7');
    await win.locator('.tab', { hasText: 'Versions' }).click();
    await expect.poll(() => win.locator('.ver').count()).toBeGreaterThanOrEqual(3);
    await win.locator('.ver').first().click();
    await expect(win.locator('.diff .add').first()).toContainText('size: 7');
    await shot('05-versions');
  });

  test('plays and restores older versions', async () => {
    const f0 = await gameFrame();
    expect((await probe(f0)).size).toBe(7);
    const opened = win.locator('.ver', { hasText: 'Opened' }).last();
    await opened.hover();
    await opened.getByRole('button', { name: 'Play' }).click();
    await expect(win.locator('.preview-banner')).toBeVisible();
    await expect(win.locator('.panel-note')).toContainText('read-only');
    await expect.poll(async () => (await gameFrame().then(probe)).size).toBe(10);
    await win.getByRole('button', { name: 'Back to current' }).click();
    await expect(win.locator('.preview-banner')).toHaveCount(0);
    await expect.poll(async () => (await gameFrame().then(probe)).size).toBe(7);
    await opened.hover();
    await opened.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => fs.readFileSync(fixture, 'utf8')).toContain("const CONFIG = { size: 10, color: '#ff0000' };");
    await expect(knob('CONFIG.size').locator('.knob-value')).toHaveValue('10');
  });

  test('resets knobs and copies changes for an AI chat', async () => {
    const f = await gameFrame();
    await knob('SPEED').locator('.knob-value').fill('9');
    await knob('SPEED').locator('.knob-value').press('Enter');
    await expect.poll(async () => (await probe(f)).speed).toBe(9);
    await win.getByRole('button', { name: 'Copy for AI' }).first().click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('- SPEED — index.html:10: 2 → 9');
    await knob('SPEED').locator('.knob-value').press('Escape');
    await knob('SPEED').focus();
    await win.keyboard.press('Delete');
    await expect.poll(async () => (await probe(f)).speed).toBe(2);
    await expect(win.locator('.knob.mod')).toHaveCount(0);
  });

  test('can hide numbers in code', async () => {
    await expect(win.locator('.group-head', { hasText: 'Numbers in code' })).toHaveCount(0);
    await win.locator('.panel-head .menu button').click();
    await win.getByRole('menuitem', { name: 'Show numbers in code' }).click();
    await expect(win.locator('.menu-pop')).toHaveCount(0);
    await win.locator('.panel-head .menu button').click();
    await expect(win.getByRole('menuitem', { name: 'Show numbers in code' }).locator('.check.on')).toHaveCount(0);
    await win.keyboard.press('Escape');
    await win.locator('.panel-head .menu button').click();
    await win.getByRole('menuitem', { name: 'Show numbers in code' }).click();
  });

  test('pasting HTML creates a new game', async () => {
    await win.locator('.panel-head').click();
    await win.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '<!doctype html><title>Pasted Game</title><script>const SIZE = 3; window.probe = { size: SIZE };</script>');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    });
    await expect(win.locator('.game-name')).toHaveText('Pasted Game');
    await expect(knob('SIZE')).toBeVisible();
    expect(fs.existsSync(path.join(gamesDir, 'Pasted Game', 'index.html'))).toBe(true);
  });

  test('palette and home recents work', async () => {
    await win.keyboard.press('Control+k');
    await expect(win.locator('.palette')).toBeVisible();
    await win.keyboard.type('fixture');
    await expect(win.locator('.pal-input input')).toHaveValue('fixture');
    await expect(win.locator('.pal-item.sel')).toContainText('Fixture Game');
    await shot('06-palette');
    await win.keyboard.press('Escape');
    await win.keyboard.press('Control+w');
    await expect(win.locator('.card')).toHaveCount(3);
    const thumbs = path.join(tmp, 'user', 'thumbs');
    await expect.poll(() => (fs.existsSync(thumbs) ? fs.readdirSync(thumbs).length : 0)).toBeGreaterThanOrEqual(1);
    await expect(win.locator('.card img').first()).toBeVisible();
    await shot('07-home-recents');
  });

  test('"Paste from clipboard" opens the game on the clipboard', async () => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('<!doctype html><title>Clipboard Game</title><script>const JUMP = 4.5;</script>'));
    await win.getByRole('button', { name: 'Paste from clipboard' }).click();
    await expect(win.locator('.game-name')).toHaveText('Clipboard Game');
    await expect(knob('JUMP')).toBeVisible();
  });
});
