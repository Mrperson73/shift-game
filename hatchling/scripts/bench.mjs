// Times the skeleton, drawing and simulation per frame in Chromium: node scripts/bench.mjs
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const js = await build({ entryPoints: ['src/dev/bench.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const html = path.resolve('shots', 'bench.html');
fs.mkdirSync(path.dirname(html), { recursive: true });
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body><script>${js.outputFiles[0].text}</script>`);
const browser = await chromium.launch({ executablePath: ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p)), args: ['--enable-gpu-rasterization'] });
const page = await browser.newPage();
await page.goto(`file://${html}${process.argv[2] ? `?ids=${process.argv[2]}` : ""}`);
await page.waitForFunction(() => window.result, null, { timeout: 120_000 });
console.log(await page.evaluate(() => window.result));
await browser.close();
