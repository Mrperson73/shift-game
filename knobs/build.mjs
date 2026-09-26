// Bundles main, preload, the in-game runtime and the renderer with esbuild.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const minify = !process.argv.includes('--dev');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

const common = { bundle: true, sourcemap: false, minify, logLevel: 'warning', legalComments: 'none', target: 'es2022' };

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/runtime/runtime.ts'], outfile: 'dist/runtime.js', platform: 'browser', format: 'iife' }),
  build({
    ...common,
    entryPoints: ['src/renderer/main.tsx'],
    outfile: 'dist/renderer/index.js',
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  }),
]);
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
console.log('built dist/');
if (watch) console.log('(watch mode is not implemented; rerun npm run build)');
