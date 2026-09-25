// Renders the dev contact sheet to PNG with Chromium: node scripts/sheet.mjs rex [variant] [zoom] [poses] [growths]
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [species = 'rex', variant = '0', zoom = '1', poses = '', growth = ''] = process.argv.slice(2);
const out = path.resolve('shots');
fs.mkdirSync(out, { recursive: true });
const js = await build({ entryPoints: ['src/dev/sheet.ts'], bundle: true, write: false, format: 'iife', target: 'es2022' });
const html = path.join(out, 'sheet.html');
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${js.outputFiles[0].text}</script>`);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
const qs = new URLSearchParams({ species, variant, zoom, ...(poses ? { poses } : {}), ...(growth ? { growth } : {}) });
await page.goto(`file://${html}?${qs}`);
await page.waitForFunction(() => window.done === true);
const file = path.join(out, `sheet-${species}-${variant}${poses ? '-' + poses.replace(/,/g, '_') : ''}.png`);
await (await page.$('canvas')).screenshot({ path: file });
await browser.close();
console.log(file);
