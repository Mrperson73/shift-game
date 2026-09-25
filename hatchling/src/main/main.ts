import { app, BrowserWindow, type Display, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, Notification, powerMonitor, protocol, screen, session, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { BUILT_IN, type SpeciesDef } from '../pet/species';
import type { WorldUpdate } from '../shared/api';
import { resolveTheme } from '../shared/themes';
import { type Activity, type Command, type ModProblem, newPet, type OverlayInit, type PanelInit, type Settings, TRICKS } from '../shared/types';
import { type Desktop, openDesktop } from './desktop';
import { detectGame, gamePids } from './games';
import { computeWorld, type WinRect } from './geometry';
import { allSpecies, ensureModsFolder } from './mods';
import { sanitizeColors, sanitizeName, sanitizePet, sanitizeSettings, Store } from './store';

/** `--smoke-test`: start with a fresh pet, exercise it for a few seconds, check the Windows integration, exit 0/1. */
const SMOKE = process.argv.includes('--smoke-test');
const TEST = process.env.HATCHLING_TEST === '1';

const smokeDir = path.join(app.getPath('userData'), 'smoke-test');
if (SMOKE) {
  try {
    fs.rmSync(smokeDir, { recursive: true, force: true });
  } catch { /* a previous run may still be exiting */ }
}
if (process.env.HATCHLING_USER_DATA) app.setPath('userData', process.env.HATCHLING_USER_DATA);
else if (SMOKE) app.setPath('userData', path.join(smokeDir, 'user'));

protocol.registerSchemesAsPrivileged([{ scheme: 'hatchling', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setAppUserModelId('app.hatchling.desktop');

const ORIGIN = 'hatchling://app';
const DIST = __dirname;
const RENDERER = path.join(DIST, 'renderer');
const USER = app.getPath('userData');
const MODS_DIR = process.env.HATCHLING_MODS_DIR || (SMOKE ? path.join(smokeDir, 'species') : path.join(app.getPath('documents'), 'Hatchling', 'species'));
const LOGIN_NAME = 'Hatchling';

const store = new Store(path.join(USER, 'hatchling.json'));
let desktop: Desktop = { available: false, error: null, windows: () => [], foreground: () => null, busy: () => false, processes: () => new Map() };
let species: SpeciesDef[] = BUILT_IN;
let problems: ModProblem[] = [];
let overlay: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let display: Display | null = null;
let fullscreenHidden = false;
let hiddenUntil = 0;
let overlayHidden = false;
let locked = false;
let game: string | null = null;
/** Windows of running games are left out of the pet's world, so it never walks over a game. */
let games = new Set<number>();
let lastWorld = '';
let lastCursor = '';
let statusText = 'Hatchling';
let quitting = false;
const timers: NodeJS.Timeout[] = [];
const errors: string[] = [];

const settings = () => store.data.settings;

function log(msg: string) {
  errors.push(msg);
  try {
    const f = path.join(USER, 'errors.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* logging is best effort */ }
}

function save() {
  try {
    store.save();
  } catch (e) {
    log(`save failed: ${(e as Error).message}`);
  }
}

// ---------------- displays and the overlay ----------------

function pickDisplay(): Display {
  const id = settings().display;
  return screen.getAllDisplays().find((d) => d.id === id) ?? screen.getPrimaryDisplay();
}

function ownHandles(): Set<string> {
  const out = new Set<string>();
  for (const w of [overlay, panel]) {
    if (!w || w.isDestroyed()) continue;
    const h = w.getNativeWindowHandle();
    out.add(String(h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0)));
  }
  return out;
}

function sendOverlay(channel: string, payload: unknown) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

function createOverlay() {
  display = pickDisplay();
  const wa = display.workArea;
  overlay = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    backgroundColor: '#00000000',
    title: 'Hatchling',
    webPreferences: {
      preload: path.join(DIST, 'preload-overlay.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setBounds(wa);
  void overlay.loadURL(`${ORIGIN}/overlay.html`);
  overlay.once('ready-to-show', () => {
    if (!overlay) return;
    overlay.showInactive();
    lastWorld = '';
    pollWorld();
  });
  overlay.webContents.on('render-process-gone', (_e, d) => {
    log(`overlay renderer gone: ${d.reason}`);
    if (quitting || SMOKE) return;
    overlay?.destroy();
    overlay = null;
    setTimeout(() => !quitting && createOverlay(), 1500);
  });
  overlay.on('closed', () => (overlay = null));
}

function placeOverlay() {
  if (!overlay) return;
  display = pickDisplay();
  overlay.setBounds(display.workArea);
  lastWorld = '';
  pollWorld();
}

function setOverlayHidden(h: boolean) {
  if (!overlay || h === overlayHidden) return;
  overlayHidden = h;
  sendOverlay('hidden', h);
  if (h) overlay.hide();
  else {
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'screen-saver');
  }
}

// ---------------- polling the desktop ----------------

let worldRate = 8;
let worldTimer: NodeJS.Timeout | null = null;
let movingUntil = 0;

function pollWorld() {
  if (!overlay || !display || overlayHidden) return;
  const wa = display.workArea;
  let update: WorldUpdate = { width: wa.width, height: wa.height, platforms: [], walls: [] };
  if (desktop.available && settings().explore) {
    try {
      const wins: WinRect[] = desktop.windows(ownHandles()).filter((w) => !games.has(w.pid)).map((w) => {
        const r = screen.screenToDipRect(null, { x: w.left, y: w.top, width: w.right - w.left, height: w.bottom - w.top });
        return { hwnd: w.hwnd, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const world = computeWorld(wins, wa);
      update = { ...update, ...world };
    } catch (e) {
      log(`windows: ${(e as Error).message}`);
    }
  }
  const key = JSON.stringify(update);
  if (key !== lastWorld) {
    if (lastWorld) movingUntil = Date.now() + 1500;
    lastWorld = key;
    sendOverlay('world', update);
  }
}

function scheduleWorld() {
  if (worldTimer) clearTimeout(worldTimer);
  // Faster while windows are moving, so a pet riding a dragged window keeps up.
  const hz = Date.now() < movingUntil ? 30 : worldRate;
  worldTimer = setTimeout(() => {
    pollWorld();
    scheduleWorld();
  }, 1000 / hz);
}

function pollCursor() {
  if (!overlay || !display || overlayHidden) return;
  const p = screen.getCursorScreenPoint();
  const wa = display.workArea;
  const inside = p.x >= wa.x && p.x < wa.x + wa.width && p.y >= wa.y - 60 && p.y < wa.y + wa.height + 60;
  const local = inside ? { x: p.x - wa.x, y: p.y - wa.y } : null;
  const key = local ? `${local.x},${local.y}` : 'out';
  if (key === lastCursor) return;
  lastCursor = key;
  sendOverlay('cursor', local);
}

let processTick = 0;
function pollActivity() {
  // Pick up a species folder created by hand after startup.
  if (!modsWatcher && processTick % 15 === 7 && fs.existsSync(MODS_DIR)) {
    reloadSpecies();
    watchMods();
  }
  const idle = powerMonitor.getSystemIdleTime();
  const state = powerMonitor.getSystemIdleState(1);
  if (desktop.available && processTick++ % 3 === 0) {
    try {
      const procs = desktop.processes();
      const exes = new Set(procs.values());
      const needTitles = exes.has('javaw.exe') || exes.has('java.exe');
      const wins = needTitles ? desktop.windows(new Set()) : [];
      game = detectGame(exes, wins.map((w) => ({ exe: procs.get(w.pid) ?? '', title: w.title })));
      games = gamePids(procs, wins);
    } catch (e) {
      log(`processes: ${(e as Error).message}`);
    }
  }
  const a: Activity = { idle, locked: locked || state === 'locked', game };
  sendOverlay('activity', a);
}

function pollFullscreen() {
  if (!overlay || !display) return;
  let hide = Date.now() < hiddenUntil;
  if (!hide && settings().hideFullscreen && desktop.available) {
    try {
      const fg = desktop.foreground(ownHandles());
      if (fg?.fullscreen || (fg && desktop.busy())) {
        const m = screen.screenToDipRect(null, { x: fg.monitor.left, y: fg.monitor.top, width: fg.monitor.right - fg.monitor.left, height: fg.monitor.bottom - fg.monitor.top });
        const b = display.bounds;
        const same = Math.abs(m.x - b.x) < 4 && Math.abs(m.y - b.y) < 4 && Math.abs(m.width - b.width) < 4;
        hide = same;
      }
    } catch (e) {
      log(`foreground: ${(e as Error).message}`);
    }
  }
  if (hide !== fullscreenHidden || hide !== overlayHidden) {
    fullscreenHidden = hide;
    setOverlayHidden(hide);
  }
}

function startPolling() {
  timers.push(setInterval(pollCursor, 33));
  timers.push(setInterval(pollActivity, 2000));
  timers.push(setInterval(pollFullscreen, 1000));
  scheduleWorld();
  pollActivity();
}

// ---------------- tray and menus ----------------

function petMenu(): MenuItemConstructorOptions[] {
  const pet = store.data.pet;
  if (!pet) return [{ label: 'Choose an egg…', click: () => openPanel('choose') }];
  const cmd = (c: Command) => () => sendOverlay('command', c);
  const hatched = pet.hatchedAt !== null;
  const hidden = Date.now() < hiddenUntil;
  return [
    { label: statusText, click: () => openPanel('card') },
    { type: 'separator' },
    ...(hatched
      ? ([
          { label: 'Feed', click: cmd({ type: 'feed' }) },
          { label: 'Play ball', click: cmd({ type: 'play' }) },
          { label: 'Come here', click: cmd({ type: 'call' }) },
          { label: 'Nap', click: cmd({ type: 'sleep' }) },
          { label: 'Wake up', click: cmd({ type: 'wake' }) },
        ] as MenuItemConstructorOptions[])
      : ([{ label: 'Hatch now', click: cmd({ type: 'hatch-now' }) }] as MenuItemConstructorOptions[])),
    { type: 'separator' },
    hidden
      ? { label: 'Show again', click: () => ((hiddenUntil = 0), pollFullscreen(), rebuildTray()) }
      : { label: 'Hide for an hour', click: () => ((hiddenUntil = Date.now() + 3600_000), pollFullscreen(), rebuildTray()) },
    { label: 'Pet card…', click: () => openPanel('card') },
    { label: 'Settings…', click: () => openPanel('settings') },
    { type: 'separator' },
    { label: 'Quit Hatchling', click: () => app.quit() },
  ];
}

function trayIcon() {
  const file = path.join(app.isPackaged ? process.resourcesPath : path.join(DIST, '..', 'resources'), 'tray.png');
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16, quality: 'best' });
}

function rebuildTray() {
  if (!tray) return;
  tray.setToolTip(statusText);
  tray.setContextMenu(Menu.buildFromTemplate(petMenu()));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', () => openPanel(store.data.pet ? 'card' : 'choose'));
  rebuildTray();
}

function popupPetMenu() {
  const menu = Menu.buildFromTemplate(petMenu());
  if (tray && process.platform === 'win32') tray.popUpContextMenu(menu, screen.getCursorScreenPoint());
  else menu.popup();
}

// ---------------- the panel window ----------------

function panelInit(view: PanelInit['view']): PanelInit {
  return {
    pet: store.data.pet,
    settings: settings(),
    species,
    problems,
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `${d.label || `Display ${i + 1}`} (${d.size.width}×${d.size.height})`, primary: d.id === screen.getPrimaryDisplay().id })),
    version: app.getVersion(),
    platform: process.platform,
    modsDir: MODS_DIR,
    view,
    history: store.data.history,
    systemDark: nativeTheme.shouldUseDarkColors,
  };
}

let panelView: PanelInit['view'] = 'card';

function openPanel(view: PanelInit['view']) {
  panelView = view;
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('view', view);
    if (panel.isMinimized()) panel.restore();
    panel.show();
    panel.focus();
    return;
  }
  const theme = resolveTheme(settings().theme, nativeTheme.shouldUseDarkColors);
  panel = new BrowserWindow({
    width: 460,
    height: 700,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Hatchling',
    backgroundColor: theme.bg,
    // The page draws its own title bar; Windows keeps the real minimise and close buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: theme.bar, symbolColor: theme.barInk, height: 40 },
    autoHideMenuBar: true,
    icon: path.join(DIST, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(DIST, 'preload-panel.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  panel.setMenu(null);
  void panel.loadURL(`${ORIGIN}/panel.html`);
  panel.once('ready-to-show', () => !SMOKE && panel?.show());
  panel.on('closed', () => (panel = null));
}

function pushPanel() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('update', { pet: store.data.pet, settings: settings(), species, problems, history: store.data.history, systemDark: nativeTheme.shouldUseDarkColors });
}

// ---------------- settings ----------------

function applyLoginItem() {
  if (!app.isPackaged || SMOKE || TEST) return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings().startWithWindows, name: LOGIN_NAME, args: ['--autostart'] });
  } catch (e) {
    log(`login item: ${(e as Error).message}`);
  }
}

function updateSettings(partial: Partial<Settings>) {
  const before = settings();
  const next = sanitizeSettings({ ...before, ...partial }, before);
  store.data.settings = next;
  save();
  if (next.startWithWindows !== before.startWithWindows) applyLoginItem();
  if (next.display !== before.display) placeOverlay();
  if (next.explore !== before.explore) {
    lastWorld = '';
    pollWorld();
  }
  if (next.hideFullscreen !== before.hideFullscreen) pollFullscreen();
  sendOverlay('settings', next);
  pushPanel();
  return next;
}

// ---------------- mods ----------------

let modsWatcher: fs.FSWatcher | null = null;
let modsTimer: NodeJS.Timeout | null = null;

function reloadSpecies() {
  const r = allSpecies(MODS_DIR);
  species = r.species;
  problems = r.problems;
  sendOverlay('species', species);
  pushPanel();
}

function watchMods() {
  modsWatcher?.close();
  modsWatcher = null;
  try {
    if (!fs.existsSync(MODS_DIR)) return;
    modsWatcher = fs.watch(MODS_DIR, () => {
      if (modsTimer) clearTimeout(modsTimer);
      modsTimer = setTimeout(reloadSpecies, 400);
    });
  } catch (e) {
    log(`mods watch: ${(e as Error).message}`);
  }
}

// ---------------- IPC ----------------

function fromOverlay(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return !!overlay && e.sender === overlay.webContents;
}
function fromPanel(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return !!panel && e.sender === panel.webContents;
}

function registerIpc() {
  ipcMain.handle('overlay:init', (e): OverlayInit | null => {
    if (!fromOverlay(e) || !display) return null;
    return {
      pet: store.data.pet!,
      settings: settings(),
      species,
      width: display.workArea.width,
      height: display.workArea.height,
      test: TEST,
      smoke: SMOKE,
      now: Date.now(),
    };
  });
  ipcMain.on('overlay:capture', (e, on: boolean) => {
    if (fromOverlay(e) && overlay) overlay.setIgnoreMouseEvents(!on);
  });
  ipcMain.on('overlay:save', (e, p: unknown) => {
    if (!fromOverlay(e) || !store.data.pet) return;
    const pet = sanitizePet(p);
    // Only accept saves for the current pet (a new egg may have replaced it meanwhile).
    if (!pet || pet.id !== store.data.pet.id) return;
    store.data.pet = pet;
    save();
    pushPanel();
  });
  ipcMain.on('overlay:notify', (e, n: { type: string; text?: string }) => {
    if (!fromOverlay(e)) return;
    if (n.type === 'status' && n.text) {
      statusText = String(n.text).slice(0, 80);
      rebuildTray();
    } else if (n.type === 'grew' && n.text && Notification.isSupported() && !overlayHidden && !SMOKE) {
      new Notification({ title: `${store.data.pet?.name ?? 'Your pet'} grew up a bit!`, body: `Now a ${String(n.text).toLowerCase()}.`, silent: true }).show();
    } else if (n.type === 'hatched') rebuildTray();
  });
  ipcMain.on('overlay:card', (e) => fromOverlay(e) && openPanel('card'));
  ipcMain.on('overlay:menu', (e) => fromOverlay(e) && popupPetMenu());
  ipcMain.on('overlay:error', (e, msg: string) => fromOverlay(e) && log(`overlay: ${String(msg).slice(0, 2000)}`));
  ipcMain.on('overlay:smoke', (e, report: Record<string, unknown>) => fromOverlay(e) && finishSmoke(report));

  ipcMain.handle('panel:init', (e) => (fromPanel(e) ? panelInit(panelView) : null));
  ipcMain.handle('panel:hatch', (e, o: { species: string; variant: number; name: string; startWithWindows: boolean }) => {
    if (!fromPanel(e)) return;
    const sp = species.find((s) => s.id === o.species) ?? BUILT_IN[0];
    const variant = Math.max(0, Math.min(sp.variants.length - 1, Math.floor(Number(o.variant) || 0)));
    const old = store.data.pet;
    if (old) store.data.history.push({ name: old.name, species: old.species, variant: old.variant, hatchedAt: old.hatchedAt, activeSeconds: old.activeSeconds, retiredAt: Date.now(), shiny: old.shiny, colors: old.colors });
    // About 1 egg in 20 hatches shiny: it starts in its species' shiny colours (and keeps them unlocked).
    const shiny = Math.random() < 0.05;
    store.data.pet = newPet(sp.id, shiny ? -1 : variant, sanitizeName(o.name), Date.now(), shiny);
    store.data.settings = sanitizeSettings({ ...settings(), startWithWindows: !!o.startWithWindows });
    save();
    applyLoginItem();
    if (overlay) sendOverlay('pet', store.data.pet);
    else createOverlay();
    rebuildTray();
    panel?.close();
  });
  ipcMain.handle('panel:settings', (e, s: Partial<Settings>) => (fromPanel(e) ? updateSettings(s) : settings()));
  ipcMain.on('panel:command', (e, c: Command) => {
    if (!fromPanel(e) || !c || typeof c !== 'object') return;
    if (c.type === 'rename') {
      const name = sanitizeName(c.name);
      if (store.data.pet) store.data.pet.name = name;
      save();
      sendOverlay('command', { type: 'rename', name });
      pushPanel();
      return;
    }
    if (c.type === 'recolor') {
      const p = store.data.pet;
      if (!p) return;
      const sp = species.find((s) => s.id === p.species) ?? BUILT_IN[0];
      const v = Math.floor(Number(c.variant));
      // -1 (shiny colours) only for shiny pets.
      p.variant = Number.isFinite(v) && v >= (p.shiny ? -1 : 0) && v < sp.variants.length ? v : p.variant;
      p.colors = sanitizeColors(c.colors);
      save();
      sendOverlay('command', { type: 'recolor', variant: p.variant, colors: p.colors });
      pushPanel();
      return;
    }
    if (c.type === 'trick') {
      if (TRICKS.includes(c.name)) sendOverlay('command', { type: 'trick', name: c.name });
      return;
    }
    if (['feed', 'play', 'call', 'sleep', 'wake', 'hatch-now'].includes(c.type)) sendOverlay('command', { type: c.type });
  });
  ipcMain.on('panel:titleBar', (e, o: { color: unknown; symbolColor: unknown }) => {
    if (!fromPanel(e) || !panel || !o) return;
    const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
    const color = hex(o.color);
    const symbolColor = hex(o.symbolColor);
    if (!color || !symbolColor) return;
    try {
      panel.setTitleBarOverlay({ color, symbolColor, height: 40 });
    } catch {
      /* not supported on this platform */
    }
  });
  ipcMain.handle('panel:newEgg', (e) => {
    if (fromPanel(e)) openPanel('choose');
  });
  ipcMain.on('panel:mods', (e) => {
    if (!fromPanel(e)) return;
    try {
      ensureModsFolder(MODS_DIR);
      reloadSpecies();
      watchMods();
      if (!TEST) void shell.openPath(MODS_DIR);
    } catch (err) {
      log(`mods folder: ${(err as Error).message}`);
    }
  });
  ipcMain.on('panel:external', (e, url: string) => {
    if (fromPanel(e) && /^https:\/\/github\.com\/mrperson73\/shift-game(\/|$)/i.test(String(url))) void shell.openExternal(String(url));
  });
  ipcMain.on('panel:close', (e) => fromPanel(e) && panel?.close());
}

// ---------------- security ----------------

function harden() {
  // Hatchling never uses the network: every request that isn't the app's own files is blocked.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith(ORIGIN + '/') || details.url.startsWith('devtools://') || details.url.startsWith('data:');
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => {
      if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
    });
  });
  protocol.handle('hatchling', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.resolve(RENDERER, rel);
    if (u.host !== 'app' || !file.startsWith(RENDERER + path.sep) || !/^[\w.-]+$/.test(rel)) return new Response('Not found', { status: 404 });
    try {
      const ext = path.extname(file).toLowerCase();
      const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
      const type = TYPES[ext] ?? 'application/octet-stream';
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------- smoke test ----------------

let smokeDone = false;
function finishSmoke(report: Record<string, unknown>) {
  if (!SMOKE || smokeDone) return;
  smokeDone = true;
  const checks: [string, boolean][] = [
    ['overlay hatched the egg', report.hatched === true],
    ['food appeared', Number(report.food) > 0],
    ['hit test works', report.hit === true],
    ['landed after being thrown', report.landed === true],
    ['fell asleep on command', report.slept === true],
    ['drew the pet', Number(report.ink) > 20],
    ['animated', Number(report.frames) > 30],
    ['no renderer errors', Array.isArray(report.errors) && report.errors.length === 0 && errors.length === 0],
  ];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const k = require('koffi') as { version: string };
    checks.push([`native module loads (koffi ${k.version})`, true]);
  } catch (e) {
    checks.push([`native module loads (${(e as Error).message})`, false]);
  }
  if (process.platform === 'win32') {
    const procs = desktop.processes();
    const self = procs.get(process.pid) ?? '';
    checks.push(['Windows integration loaded', desktop.available], ['sees its own process', self.endsWith('.exe')]);
    try {
      desktop.windows(new Set());
      desktop.foreground(new Set());
      desktop.busy();
      checks.push(['reads windows', true]);
    } catch (e) {
      checks.push([`reads windows (${(e as Error).message})`, false]);
    }
  }
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  const line = failed.length ? `HATCHLING_SMOKE FAIL ${failed.join('; ')} ${JSON.stringify(report)} ${desktop.error ?? ''} ${errors.slice(0, 3).join(' | ')}` : `HATCHLING_SMOKE OK ${JSON.stringify(report)}`;
  console.log(line);
  if (process.env.HATCHLING_SMOKE_OUT) {
    try {
      fs.writeFileSync(process.env.HATCHLING_SMOKE_OUT, line + '\n');
    } catch { /* best effort */ }
  }
  app.exit(failed.length ? 1 : 0);
}

// ---------------- lifecycle ----------------

if (SMOKE) {
  process.on('uncaughtException', (e) => finishSmoke({ errors: [`main: ${e.message}`] }));
  setTimeout(() => finishSmoke({ errors: ['timed out after 60s'] }), 60_000);
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openPanel(store.data.pet ? 'card' : 'choose'));
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });
  app.on('before-quit', (e) => {
    if (quitting || !overlay) return;
    e.preventDefault();
    quitting = true;
    sendOverlay('command', { type: 'flush' });
    setTimeout(() => {
      save();
      app.quit();
    }, 350);
  });
  powerMonitor.on('lock-screen', () => {
    locked = true;
    pollActivity();
  });
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    pollActivity();
  });
  powerMonitor.on('suspend', () => {
    locked = true;
    pollActivity();
  });
  powerMonitor.on('resume', () => {
    locked = false;
    pollActivity();
  });

  void app.whenReady().then(() => {
    harden();
    registerIpc();
    desktop = openDesktop();
    if (desktop.error) log(`desktop: ${desktop.error}`);
    if (store.recovered) log(store.recovered);
    reloadSpecies();
    watchMods();
    if (SMOKE) {
      store.data.pet = newPet('rex', 0, 'Smoke', Date.now());
      store.data.pet.activeSeconds = 3600 * 20;
      openPanel('card');
    }
    createTray();
    applyLoginItem();
    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed'] as const) screen.on(ev as 'display-added', () => placeOverlay());
    if (store.data.pet) createOverlay();
    else openPanel('choose');
    startPolling();
    if (TEST) (global as unknown as Record<string, unknown>).__hatchling = { store, sendOverlay, openPanel, updateSettings, setGame: (g: string | null) => (game = g), setLocked: (l: boolean) => ((locked = l), pollActivity()), errors, desktop: () => desktop };
  });
}
