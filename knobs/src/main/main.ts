import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { scanHtml } from '../core/html';
import type { KnobValue } from '../core/types';
import type { GamePayload, InitInfo, Rect, RecentGame, Settings, Shortcut, VersionInfo } from '../shared/types';
import { Store, writeAtomic } from './store';
import { Snapshots } from './snapshots';
import { GameSession, type Host, safeJoin, type SessionDeps } from './session';
import { mimeOf, serveGame } from './serve';

/** `--smoke-test`: start, open the demo game in a hidden window, verify it runs, then exit 0/1. Used by CI on the installed app. */
const SMOKE = process.argv.includes('--smoke-test');
// A private per-user folder (not the shared temp dir). Chromium keeps writing to userData while it
// shuts down, so each smoke test wipes this fixed folder on start instead of deleting it on exit.
const smokeDir = path.join(app.getPath('userData'), 'smoke-test');
if (SMOKE) {
  try {
    fs.rmSync(smokeDir, { recursive: true, force: true });
  } catch { /* a previous run may still be exiting; reusing its folder is harmless */ }
}
if (process.env.KNOBS_USER_DATA) app.setPath('userData', process.env.KNOBS_USER_DATA);
else if (SMOKE) app.setPath('userData', path.join(smokeDir, 'user'));

const UI_ORIGIN = 'knobs-app://ui';
protocol.registerSchemesAsPrivileged([
  { scheme: 'knobs-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'knobs-game', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

const DIST = __dirname;
const RENDERER = path.join(DIST, 'renderer');
const DEMO = app.isPackaged ? path.join(process.resourcesPath, 'demo') : path.join(DIST, '..', 'resources', 'demo');
const USER = app.getPath('userData');
const THUMBS = path.join(USER, 'thumbs');
const GAMES_DIR = process.env.KNOBS_GAMES_DIR || (SMOKE ? path.join(smokeDir, 'games') : path.join(app.getPath('documents'), 'Knobs'));

const store = new Store(path.join(USER, 'state.json'));
const snapshots = new Snapshots(path.join(USER, 'versions'));
const hosts = new Map<string, Host>();
let runtime = '';
let win: BrowserWindow | null = null;
let current: GameSession | null = null;

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);

const deps: SessionDeps = {
  store,
  snapshots,
  settings: () => store.data.settings,
  onReload: (p) => send('reloaded', p),
  onError: (m) => send('error', m),
};

// ---------------- recents ----------------

function recents(): RecentGame[] {
  return store.data.recents.filter((r) => fs.existsSync(r.path));
}

function touchRecent(s: GameSession, thumb?: number) {
  const list = store.data.recents.filter((r) => r.id !== s.info.id);
  const prev = store.data.recents.find((r) => r.id === s.info.id);
  list.unshift({ id: s.info.id, name: s.info.name, path: s.info.path, lastOpened: Date.now(), thumb: thumb ?? prev?.thumb });
  store.data.recents = list.slice(0, 40);
  store.save();
}

// ---------------- sessions ----------------

function closeCurrent() {
  if (!current) return;
  current.unwatch();
  for (const h of [...hosts.keys()]) if (h.startsWith(current.info.id)) hosts.delete(h);
  current = null;
}

function openGame(p: string, pasted = false): GamePayload {
  const s = new GameSession(p, deps, pasted);
  closeCurrent();
  current = s;
  hosts.set(s.host, s);
  snapshots.add(s.info.id, s.res.sources, 'Opened');
  s.watch();
  touchRecent(s);
  return s.payload('open');
}

function requireGame(): GameSession {
  if (!current) throw new Error('No game is open.');
  return current;
}

export function slug(title: string): string {
  let s = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/^[. ]+|[. ]+$/g, '');
  if (!s) s = 'Untitled game';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  return s;
}

function uniqueDir(base: string, name: string): string {
  let dir = path.join(base, name);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(base, `${name} ${i}`);
  return dir;
}

function pathArg(argv: string[]): string | null {
  const appPath = path.resolve(app.getAppPath());
  for (const a of argv.slice(1).reverse()) {
    if (a.startsWith('-') || path.resolve(a) === appPath) continue;
    try {
      const st = fs.statSync(a);
      if (st.isDirectory() || /\.html?$/i.test(a)) return path.resolve(a);
    } catch { /* not a path */ }
  }
  return null;
}

// ---------------- IPC ----------------

const fromUi = (e: IpcMainEvent | IpcMainInvokeEvent) => e.senderFrame?.url.startsWith(UI_ORIGIN + '/') ?? false;

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromUi(e)) throw new Error('forbidden');
    return fn(...(args as A));
  });
}

function on<A extends unknown[]>(channel: string, fn: (...args: A) => void) {
  ipcMain.on(channel, (e, ...args) => {
    if (!fromUi(e)) return;
    try {
      fn(...(args as A));
    } catch (err) {
      send('error', (err as Error).message);
    }
  });
}

function registerIpc() {
  handle('app:init', (): InitInfo => ({
    recents: recents(), settings: store.data.settings, platform: process.platform, version: app.getVersion(),
    gamesDir: GAMES_DIR, openAtStart: SMOKE ? null : pathArg(process.argv), smoke: SMOKE,
  }));
  on('smoke:result', (result: string) => finishSmoke(String(result)));
  handle('game:open', (p: string) => openGame(String(p)));
  handle('game:openDialog', async (kind: 'file' | 'folder') => {
    const r = await dialog.showOpenDialog(win!, {
      title: kind === 'file' ? 'Open an HTML game' : 'Open a game folder',
      properties: [kind === 'file' ? 'openFile' : 'openDirectory'],
      filters: kind === 'file' ? [{ name: 'HTML', extensions: ['html', 'htm'] }] : undefined,
    });
    return r.canceled || !r.filePaths[0] ? null : openGame(r.filePaths[0]);
  });
  handle('game:openDemo', () => {
    const dir = path.join(GAMES_DIR, 'Knobs Demo');
    const file = path.join(dir, 'index.html');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(DEMO, 'index.html'), file);
    }
    return openGame(file, true);
  });
  handle('game:paste', (html: string) => {
    if (typeof html !== 'string' || html.length > 5_000_000) throw new Error('That clipboard content is too large.');
    const title = scanHtml(html).title.trim();
    if (current && title && current.info.name === title) {
      const s = current;
      const before = snapshots.add(s.info.id, s.res.sources, 'Before paste');
      const undo = before?.id ?? snapshots.list(s.info.id)[0]?.id ?? null;
      writeAtomic(path.join(s.info.root, s.info.entry), html);
      const dropped = s.load();
      snapshots.add(s.info.id, s.res.sources, 'Pasted');
      s.watch();
      touchRecent(s);
      return { payload: s.payload('paste', dropped), updated: true, undo };
    }
    const dir = uniqueDir(GAMES_DIR, slug(title));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'index.html');
    writeAtomic(file, html);
    return { payload: openGame(file, true), updated: false, undo: null };
  });
  handle('game:close', () => {
    closeCurrent();
    store.flush();
  });
  on('game:setKnobs', (pairs: [string, KnobValue][]) => current?.setValues(pairs));
  handle('game:resetKnobs', (keys: string[] | null) => requireGame().reset(keys));
  on('game:setPinned', (key: string, pinned: boolean) => current?.setPinned(key, pinned));
  on('game:setRange', (key: string, range: [number, number] | null) => current?.setRange(key, range));
  handle('game:restart', (scale: number) => {
    const s = requireGame();
    s.scale = Number(scale) > 0 ? Number(scale) : 1;
    return s.url();
  });
  handle('game:bake', () => {
    const s = requireGame();
    const { result, changedIds } = s.bake();
    return { result, payload: s.payload('bake'), reload: changedIds };
  });
  handle('game:source', (file: string) => {
    const s = requireGame();
    if (file in s.res.sources) return s.res.sources[file];
    const abs = safeJoin(s.info.root, file);
    try {
      return abs && fs.statSync(abs).size < 4_000_000 ? fs.readFileSync(abs, 'utf8') : null;
    } catch {
      return null;
    }
  });
  handle('versions:list', (): VersionInfo[] => {
    const s = requireGame();
    const latest = snapshots.latestHash(s.info.id);
    return snapshots.list(s.info.id).map((v, i) => ({ ...v, current: i === 0 && latest === s.contentHash }));
  });
  handle('versions:preview', (vid: string) => {
    const s = requireGame();
    const files = snapshots.get(s.info.id, vid);
    if (!files) return null;
    const p = s.preview(files);
    const host = `${s.info.id}-${vid}`;
    hosts.set(host, p.host);
    return { url: `knobs-game://${host}/${p.entryPath}?r=${Date.now()}`, state: p.state };
  });
  handle('versions:restore', (vid: string) => {
    const s = requireGame();
    const files = snapshots.get(s.info.id, vid);
    if (!files) throw new Error('That version is gone.');
    snapshots.add(s.info.id, s.res.sources, 'Before restore');
    s.writeFiles(files);
    const dropped = s.load();
    snapshots.add(s.info.id, s.res.sources, 'Restored');
    s.watch();
    send('reloaded', s.payload('restore', dropped));
  });
  handle('versions:diff', (vid: string) => {
    const s = requireGame();
    const list = snapshots.list(s.info.id);
    const i = list.findIndex((v) => v.id === vid);
    if (i < 0) return '';
    const after = snapshots.get(s.info.id, vid) ?? {};
    const before = (list[i + 1] && snapshots.get(s.info.id, list[i + 1].id)) || {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .map((f) => (before[f] === after[f] ? '' : createTwoFilesPatch(f, f, before[f] ?? '', after[f] ?? '', '', '', { context: 2 })))
      .filter(Boolean)
      .join('\n');
  });
  on('thumb:capture', async (rect: Rect) => {
    const s = current;
    if (!s || !win) return;
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (r.width < 32 || r.height < 32) return;
    // Captured while this game was on screen; it may have been closed since, which is fine.
    const img = await win.webContents.capturePage(r);
    if (img.isEmpty()) return;
    fs.mkdirSync(THUMBS, { recursive: true });
    fs.writeFileSync(path.join(THUMBS, `${s.info.id}.jpg`), img.resize({ width: Math.min(480, r.width) }).toJPEG(80));
    const entry = store.data.recents.find((x) => x.id === s.info.id);
    if (entry) entry.thumb = Date.now();
    store.save();
    send('recents', recents());
  });
  on('shell:reveal', () => current && shell.showItemInFolder(path.join(current.info.root, current.info.entry)));
  on('shell:gamesFolder', () => {
    fs.mkdirSync(GAMES_DIR, { recursive: true });
    shell.openPath(GAMES_DIR);
  });
  on('shell:external', (url: string) => /^https?:\/\//i.test(url) && shell.openExternal(url));
  handle('recents:list', () => recents());
  handle('recents:remove', (id: string) => {
    store.data.recents = store.data.recents.filter((r) => r.id !== id);
    fs.rmSync(path.join(THUMBS, `${id}.jpg`), { force: true });
    store.save();
    return recents();
  });
  handle('settings:set', (patch: Partial<Settings>) => {
    const prev = store.data.settings;
    const next: Settings = { autoRestart: patch.autoRestart ?? prev.autoRestart, codeNumbers: patch.codeNumbers ?? prev.codeNumbers };
    store.data.settings = next;
    store.save();
    if (current && next.codeNumbers !== prev.codeNumbers) send('reloaded', current.payload('settings', current.load()));
    return next;
  });
  on('win:devtools', () => win?.webContents.toggleDevTools());
  on('win:fullscreen', (on: boolean) => win?.setFullScreen(!!on));
}

let smokeDone = false;
function finishSmoke(result: string) {
  if (!SMOKE || smokeDone) return;
  smokeDone = true;
  const line = `KNOBS_SMOKE ${result}`;
  console.log(line);
  if (process.env.KNOBS_SMOKE_OUT) {
    try { fs.writeFileSync(process.env.KNOBS_SMOKE_OUT, line + '\n'); } catch { /* best effort */ }
  }
  app.exit(result.startsWith('OK') ? 0 : 1);
}

// ---------------- window ----------------

function shortcutFor(input: Electron.Input): Shortcut | 'devtools' | null {
  const mod = input.control || input.meta;
  const k = input.key;
  if (input.alt) return null;
  if (mod) {
    if (k.toLowerCase() === 'k' && !input.shift) return 'palette';
    if (k.toLowerCase() === 'i' && input.shift) return 'devtools';
    return null;
  }
  switch (k) {
    case 'F1': return 'help';
    case 'F5': return 'restart';
    case 'F6': return 'pause';
    case 'F7': return 'step';
    case 'F8': return input.shift ? 'faster' : 'slower';
    case 'F11': return 'focus';
    case 'F12': return 'devtools';
    default: return null;
  }
}

function createWindow() {
  const saved = store.data.window;
  const visible = saved?.x !== undefined && screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return saved.x! >= b.x - 50 && saved.y! >= b.y - 50 && saved.x! < b.x + b.width && saved.y! < b.y + b.height;
  });
  win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: visible ? saved!.x : undefined,
    y: visible ? saved!.y : undefined,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Knobs',
    backgroundColor: '#0d0f13',
    icon: process.platform === 'linux' ? path.join(DIST, '..', 'build', 'icon.png') : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#0d0f13', symbolColor: '#9aa1b1', height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(DIST, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (saved?.maximized) win.maximize();
  win.once('ready-to-show', () => !SMOKE && win?.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const s = shortcutFor(input);
    if (!s || (input.isAutoRepeat && s !== 'step')) return;
    e.preventDefault();
    if (s === 'devtools') win?.webContents.toggleDevTools();
    else send('shortcut', s);
  });
  win.on('close', () => {
    if (!win) return;
    const b = win.getNormalBounds();
    store.data.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    store.flush();
  });
  win.on('closed', () => (win = null));
  win.loadURL(`${UI_ORIGIN}/index.html`);
}

function registerProtocols() {
  protocol.handle('knobs-app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    let file: string | null;
    if (u.host !== 'ui') file = null;
    else if (rel.startsWith('thumbs/')) file = safeJoin(THUMBS, rel.slice(7));
    else file = safeJoin(RENDERER, (rel = rel || 'index.html'));
    try {
      if (!file) throw new Error();
      return new Response(fs.readFileSync(file), { headers: { 'content-type': mimeOf(file), 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  protocol.handle('knobs-game', (req) => {
    const u = new URL(req.url);
    const r = serveGame(hosts.get(u.host), u.pathname, req.headers.get('range'), runtime, UI_ORIGIN);
    return new Response((r.body.length || r.status === 200 ? r.body : null) as BodyInit | null, { status: r.status, headers: r.headers });
  });
}

function hardenSessions() {
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => {
    // Only the Knobs UI may read the clipboard ("Paste from clipboard"); games never can.
    const fromKnobs = details.requestingUrl?.startsWith(UI_ORIGIN + '/') ?? false;
    cb(allowed.has(perm) || (perm === 'clipboard-read' && fromKnobs));
  });
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!url.startsWith(UI_ORIGIN + '/')) e.preventDefault();
    });
    wc.on('will-frame-navigate', (e) => {
      if (e.isMainFrame || e.url.startsWith('knobs-game://') || e.url === 'about:blank') return;
      e.preventDefault();
      if (/^https?:\/\//i.test(e.url)) shell.openExternal(e.url);
    });
  });
}

if (SMOKE) {
  process.on('uncaughtException', (e) => finishSmoke(`FAIL main process: ${e.message}`));
  setTimeout(() => finishSmoke('FAIL timed out after 60s'), 60_000);
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = pathArg(argv);
    if (p) {
      try {
        send('opened', openGame(p));
      } catch (err) {
        send('error', (err as Error).message);
      }
    }
  });
  app.whenReady().then(() => {
    runtime = fs.readFileSync(path.join(DIST, 'runtime.js'), 'utf8');
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    registerProtocols();
    hardenSessions();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    closeCurrent();
    store.flush();
    app.quit();
  });
}
