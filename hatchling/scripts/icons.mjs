// Renders build/icon.png (1024) and resources/tray.png (32) with Chromium.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const js = await build({ entryPoints: ['src/dev/icon.ts'], bundle: true, write: false, format: 'iife', target: 'es2022' });
const html = path.resolve('shots/icon.html');
fs.mkdirSync('shots', { recursive: true });
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${js.outputFiles[0].text}</script>`);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
for (const [kind, size, out] of [['app', 1024, 'build/icon.png'], ['tray', 32, 'resources/tray.png'], ['app', 256, 'shots/icon-256.png'], ['tray', 128, 'shots/tray-128.png']]) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto(`file://${html}?kind=${kind}&size=${size}`);
  await page.waitForFunction(() => window.done === true);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await (await page.$('canvas')).screenshot({ path: out, omitBackground: true });
  console.log(out);
}
await browser.close();
