// Renders every species (baby and adult) to shots/lineup-<pose>.png: node scripts/lineup.mjs [pose] [zoom]
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [pose = 'stand', zoom = '1.2', extra = '', name = pose] = process.argv.slice(2);
const out = path.resolve('shots');
fs.mkdirSync(out, { recursive: true });
const js = await build({ entryPoints: ['src/dev/lineup.ts'], bundle: true, write: false, format: 'iife', target: 'es2022' });
const html = path.join(out, 'lineup.html');
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${js.outputFiles[0].text}</script>`);
const browser = await chromium.launch({ executablePath: ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p)) });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(`file://${html}?pose=${pose}&zoom=${zoom}${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.done === true);
const file = path.join(out, `lineup-${name}.png`);
await (await page.$('canvas')).screenshot({ path: file });
await browser.close();
console.log(file);
