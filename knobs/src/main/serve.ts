import fs from 'node:fs';
import path from 'node:path';
import { type Host, safeJoin } from './session';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
};

export const mimeOf = (file: string) => MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';

export interface Served { status: number; headers: Record<string, string>; body: string | Buffer }

const notFound = (msg = 'Not found'): Served => ({ status: 404, headers: { 'content-type': 'text/plain' }, body: msg });

/** Resolve a knobs-game:// request against a host: instrumented sources, the runtime, or raw files. */
export function serveGame(host: Host | undefined, pathname: string, range: string | null, runtime: string, parentOrigin: string): Served {
  if (!host) return notFound('This game is no longer open.');
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return notFound();
  }
  if (!rel || rel.endsWith('/')) rel += rel ? 'index.html' : host.entry;
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (rel === '__knobs__/runtime.js') {
    const init = { ...host.init(), parent: parentOrigin };
    return { status: 200, headers: { ...headers, 'content-type': MIME.js }, body: `${runtime}\n;__knobsBoot(${JSON.stringify(init)});` };
  }
  const files = host.files();
  const key = rel in files ? rel : Object.keys(files).find((f) => process.platform === 'win32' && f.toLowerCase() === rel.toLowerCase());
  if (key !== undefined) {
    host.served.add(key);
    return { status: 200, headers: { ...headers, 'content-type': mimeOf(key) }, body: files[key] };
  }
  const abs = safeJoin(host.root, rel);
  // Hidden files and folders (.git, .env, …) are never served to games.
  if (!abs || rel.split('/').some((seg) => seg.startsWith('.'))) return { status: 403, headers: { 'content-type': 'text/plain' }, body: 'Forbidden' };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return notFound();
  }
  host.served.add(rel);
  headers['content-type'] = mimeOf(rel);
  headers['accept-ranges'] = 'bytes';
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    const size = buf.length;
    let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` }, body: '' };
    return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}` }, body: buf.subarray(start, end + 1) };
  }
  return { status: 200, headers, body: buf };
}
