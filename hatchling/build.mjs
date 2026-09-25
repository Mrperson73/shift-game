// Bundles the main process, preloads and both renderers with esbuild.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const minify = !process.argv.includes('--dev');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

const common = { bundle: true, sourcemap: false, minify, logLevel: 'warning', legalComments: 'none', target: 'es2022' };
const node = { ...common, platform: 'node', format: 'cjs', external: ['electron', 'koffi'] };
const web = { ...common, platform: 'browser', format: 'iife' };

await Promise.all([
  build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' }),
  build({ ...node, entryPoints: ['src/preload/overlay.ts'], outfile: 'dist/preload-overlay.js' }),
  build({ ...node, entryPoints: ['src/preload/panel.ts'], outfile: 'dist/preload-panel.js' }),
  build({ ...web, entryPoints: ['src/overlay/overlay.ts'], outfile: 'dist/renderer/overlay.js' }),
  build({ ...web, entryPoints: ['src/panel/panel.tsx'], outfile: 'dist/renderer/panel.js', jsx: 'automatic', jsxImportSource: 'preact' }),
]);
cpSync('src/overlay/index.html', 'dist/renderer/overlay.html');
cpSync('src/overlay/overlay.css', 'dist/renderer/overlay.css');
cpSync('src/panel/index.html', 'dist/renderer/panel.html');
cpSync('src/panel/panel.css', 'dist/renderer/panel.css');
console.log('built dist/');
