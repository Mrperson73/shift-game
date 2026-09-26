import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, Notification, powerMonitor, protocol, screen, session, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { BUILT_IN, movesOf, type SpeciesDef } from '../pet/species';
import type { Area, DinoAction, Leave, PanelUpdate, WorldUpdate } from '../shared/api';
import { moveName, toyName, trickName } from '../shared/labels';
import { resolveTheme } from '../shared/themes';
import { type Activity, ALL_PETS, type Arrival, type Command, type Dino, type DisplayInfo, type HostedPet, type ModProblem, newPet, OUT_MAX, type OverlayInit, type PanelInit, type PetCommand, ROSTER_MAX, type Settings, TOYS, TRICKS } from '../shared/types';
import { type Desktop, NO_DESKTOP, openDesktop } from './desktop';
import { computeWorld, type WinRect } from './geometry';
import { MediaWatcher } from './media';
import { allSpecies, ensureModsFolder } from './mods';
import { edgesOf, type Mon, monitorAt, neighbour, othersOf, splitMonitor } from './monitors';
import { pastOf, sanitizeColors, sanitizeName, sanitizePet, sanitizeSettings, Store, tidy } from './store';

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

// Hatchling never uses the network, so run Chromium's network layer inside the main process
// instead of a separate helper process (one process and some memory less).
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2,NetworkServiceInProcess');
protocol.registerSchemesAsPrivileged([{ scheme: 'hatchling', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setAppUserModelId('app.hatchling.desktop');

const ORIGIN = 'hatchling://app';
const DIST = __dirname;
const RENDERER = path.join(DIST, 'renderer');
const USER = app.getPath('userData');
const MODS_DIR = process.env.HATCHLING_MODS_DIR || (SMOKE ? path.join(smokeDir, 'species') : path.join(app.getPath('documents'), 'Hatchling', 'species'));
const LOGIN_NAME = 'Hatchling';

const store = new Store(path.join(USER, 'hatchling.json'));
let desktop: Desktop = NO_DESKTOP;
let species: SpeciesDef[] = BUILT_IN;
let problems: ModProblem[] = [];
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let hiddenUntil = 0;
let locked = false;
let game: string | null = null;
/** Windows of running games are left out of the dinos' world, so they never walk over a game. */
let games = new Set<number>();
/** The last activity sent to the overlays (for one that opens later). */
let activity: Activity | null = null;
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

// ---------------- your dinos ----------------

const dinoOf = (id: unknown) => (typeof id === 'string' ? store.data.roster.find((d) => d.pet.id === id) : undefined);
const isOut = (id: string) => store.data.out.includes(id);
const selectedDino = () => dinoOf(store.data.selected);
const speciesOf = (id: string) => species.find((s) => s.id === id) ?? BUILT_IN[0];

/** What each dino's overlay last said it's doing (for the tray). */
const statuses = new Map<string, { text: string; asleep: boolean }>();
/** Every dino that's out is asleep: the desktop can be checked less often. */
const allAsleep = () => store.data.out.length > 0 && store.data.out.every((id) => statuses.get(id)?.asleep);

/** Roster changes from the panel and the tray. Returns why it couldn't be done, or null. */
function dinoAction(a: DinoAction): string | null {
  const d = dinoOf(a?.id);
  if (!d) return 'That dino is not in your roster any more.';
  const id = d.pet.id;
  const s = store.data;
  switch (a.type) {
    case 'select':
      s.selected = id;
      break;
    case 'out':
      if (isOut(id)) break;
      if (s.out.length >= OUT_MAX) return `Up to ${OUT_MAX} dinos can be out at once. Put one away first.`;
      // Put away, it was frozen in time: no time has passed for it.
      d.pet.lastSeen = Date.now();
      s.out.push(id);
      entrances.set(id, { kind: 'poof' });
      break;
    case 'away':
      s.out = s.out.filter((x) => x !== id);
      break;
    case 'release':
      s.history = [...s.history, pastOf(d.pet, Date.now())].slice(-50);
      s.roster = s.roster.filter((x) => x !== d);
      s.out = s.out.filter((x) => x !== id);
      statuses.delete(id);
      break;
    case 'move': {
      const m = allMonitors().find((x) => x.id === a.display);
      if (!m) return 'That screen is not connected any more.';
      d.display = m.primary ? null : m.id;
      break;
    }
    default:
      return 'Unknown action.';
  }
  tidy(s);
  save();
  sync();
  rebuildTray();
  pushPanel();
  return null;
}

function hatch(o: { species: string; variant: number; name: string; startWithWindows: boolean }) {
  const s = store.data;
  if (s.roster.length >= ROSTER_MAX) throw new Error(`You have ${ROSTER_MAX} dinos already. Release one to make room.`);
  const sp = speciesOf(String(o?.species));
  const variant = Math.max(0, Math.min(sp.variants.length - 1, Math.floor(Number(o.variant) || 0)));
  // About 1 egg in 20 hatches shiny: it starts in its species' shiny colours (and keeps them unlocked).
  const shiny = TEST ? process.env.HATCHLING_SHINY === '1' : Math.random() < 0.05;
  const pet = newPet(sp.id, shiny ? -1 : variant, sanitizeName(o.name), Date.now(), shiny);
  // It hatches on the monitor you're looking at (the one with the panel).
  const b = panel && !panel.isDestroyed() ? panel.getBounds() : null;
  const m = b ? monitorAt(mons, b.x + b.width / 2, b.y + b.height / 2) : primaryMon();
  s.roster.push({ pet, display: m.primary ? null : m.id });
  // Only so many fit on the desktop: the dino that has been out longest goes for a rest.
  if (s.out.length >= OUT_MAX) s.out.shift();
  s.out.push(pet.id);
  s.selected = pet.id;
  s.settings = sanitizeSettings({ ...settings(), startWithWindows: !!o.startWithWindows });
  save();
  applyLoginItem();
  sync();
  rebuildTray();
  pushPanel();
  panel?.close();
}

// ---------------- monitors ----------------

/** Tests only: HATCHLING_FAKE_DISPLAYS=2 splits the screen into two monitors side by side. */
const FAKE_DISPLAYS = TEST ? Math.min(4, Math.floor(Number(process.env.HATCHLING_FAKE_DISPLAYS) || 0)) : 0;

/** Every connected monitor. */
function allMonitors(): Mon[] {
  const primary = screen.getPrimaryDisplay().id;
  const list: Mon[] = screen.getAllDisplays().map((d, i) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, label: `${d.label || `Display ${i + 1}`} (${d.size.width}×${d.size.height})`, primary: d.id === primary }));
  return FAKE_DISPLAYS > 1 ? splitMonitor(list.find((m) => m.primary) ?? list[0], FAKE_DISPLAYS) : list;
}

/** The monitors dinos live on: every one, or only the main one (Settings). */
let mons: Mon[] = [];
let displayList: DisplayInfo[] = [];

function refreshMonitors() {
  const all = allMonitors();
  displayList = all.map((m) => ({ id: m.id, label: m.label, primary: m.primary }));
  mons = settings().monitors === 'primary' ? all.filter((m) => m.primary) : all;
  if (!mons.length) mons = all.slice(0, 1);
}

const primaryMon = () => mons.find((m) => m.primary) ?? mons[0];
/** Where a dino that's out belongs: on its own monitor while that's there, else the main one. */
const homeOf = (d: Dino) => mons.find((m) => m.id === d.display) ?? primaryMon();
const displayOf = (m: Mon) => (m.primary ? null : m.id);

function displaysChanged() {
  refreshMonitors();
  for (const o of overlays.values()) {
    const m = mons.find((x) => x.id === o.mon.id);
    if (!m || o.win.isDestroyed()) continue;
    o.mon = m;
    // Only move the window when the screen area really changed (moving it can make it blink).
    const b = o.win.getBounds();
    const wa = m.workArea;
    if (b.x !== wa.x || b.y !== wa.y || b.width !== wa.width || b.height !== wa.height) o.win.setBounds(wa);
  }
  sync();
  resetWorld();
  pushPanel();
}

// ---------------- overlays: one per monitor that has dinos ----------------

interface Overlay {
  mon: Mon;
  win: BrowserWindow;
  /** Its page has loaded and is listening. */
  ready: boolean;
  /** Its window has been shown (it's left alone before that). */
  shown: boolean;
  hidden: boolean;
  /** It takes the mouse (the cursor is over a dino). */
  capture: boolean;
  lastWorld: string;
  lastCursor: string;
  /** The dinos on it, including ones on their way in or out. */
  pets: Set<string>;
  /** Arrivals and departures waiting for the page to be ready. */
  queue: HostedPet[];
  removals: string[];
  /** Since when it has had no dinos (0 while it has some). Empty overlays close after a minute,
   * so a dino that walks back and forth doesn't open and close windows. */
  emptySince: number;
}

const overlays = new Map<number, Overlay>();
/** Dinos asked to leave their overlay, until it answers with their latest data (or doesn't). */
const leaving = new Map<string, NodeJS.Timeout>();
/** How dinos that are about to come out arrive (brought out from My Dinos: with a pop). */
const entrances = new Map<string, Arrival>();

function hostOf(id: string) {
  for (const o of overlays.values()) if (o.pets.has(id)) return o;
  return undefined;
}

function handleOf(w: BrowserWindow) {
  const h = w.getNativeWindowHandle();
  return String(h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0));
}

function ownHandles(): Set<string> {
  const out = new Set<string>();
  for (const w of [...[...overlays.values()].map((o) => o.win), panel]) if (w && !w.isDestroyed()) out.add(handleOf(w));
  return out;
}

function send(o: Overlay, channel: string, payload: unknown) {
  if (o.ready && !o.win.isDestroyed()) o.win.webContents.send(channel, payload);
}

/** To every overlay. */
function broadcast(channel: string, payload: unknown) {
  for (const o of overlays.values()) send(o, channel, payload);
}

/** Sends a command to the overlay of the dino it's for (the selected one without `pet`), or to
 * every overlay for ALL_PETS. */
function command(c: PetCommand) {
  if (c.pet === ALL_PETS) {
    broadcast('command', c);
    return;
  }
  const id = c.pet ?? store.data.selected;
  const o = id ? hostOf(id) : undefined;
  if (o) send(o, 'command', { ...c, pet: id });
}

function createOverlay(mon: Mon): Overlay {
  const wa = mon.workArea;
  const win = new BrowserWindow({
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
  const o: Overlay = { mon, win, ready: false, shown: false, hidden: Date.now() < hiddenUntil, capture: false, lastWorld: '', lastCursor: '', pets: new Set(), queue: [], removals: [], emptySince: 0 };
  overlays.set(mon.id, o);
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setBounds(wa);
  void win.loadURL(`${ORIGIN}/overlay.html`);
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    // A monitor with another scale factor can resize the window as it lands there.
    const b = win.getBounds();
    const a = o.mon.workArea;
    if (b.x !== a.x || b.y !== a.y || b.width !== a.width || b.height !== a.height) win.setBounds(a);
    o.shown = true;
    if (!o.hidden) win.showInactive();
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`overlay renderer gone: ${d.reason}`);
    if (quitting || SMOKE) return;
    // Its dinos come back from their last save on a new overlay.
    dropOverlay(o);
    setTimeout(() => !quitting && sync(), 1500);
  });
  // Never leave the screen blocked: if the page hangs, let every click through.
  win.on('unresponsive', () => {
    log('overlay unresponsive');
    if (!win.isDestroyed()) win.setIgnoreMouseEvents(true);
    o.capture = false;
  });
  // Windows is shutting down or logging off (before-quit doesn't fire then): save what we have.
  win.on('query-session-end', () => {
    broadcast('command', { type: 'flush' });
    save();
  });
  win.on('session-end', () => save());
  win.on('closed', () => {
    const had = o.pets.size > 0;
    dropOverlay(o);
    if (had && !quitting) setTimeout(() => !quitting && sync(), 1500);
  });
  return o;
}

/** Forgets an overlay (closed, crashed, or not needed any more). Its dinos are still out: sync()
 * puts them on another one from their last save. */
function dropOverlay(o: Overlay) {
  if (overlays.get(o.mon.id) === o) overlays.delete(o.mon.id);
  for (const id of o.pets) {
    clearTimeout(leaving.get(id));
    leaving.delete(id);
  }
  o.pets.clear();
  o.ready = false;
  if (!o.win.isDestroyed()) o.win.destroy();
}

/** Puts every dino that's out on its monitor and takes away the ones that shouldn't be there any
 * more. Call it whenever something changed: dinos out or away, monitors plugged in or out. */
function sync() {
  if (quitting) return;
  for (const o of overlays.values()) {
    for (const id of [...o.pets]) {
      if (leaving.has(id)) continue;
      const d = dinoOf(id);
      if (!d || !isOut(id) || homeOf(d).id !== o.mon.id) takeAway(o, id);
    }
  }
  for (const id of store.data.out) {
    const d = dinoOf(id);
    if (!d || leaving.has(id) || hostOf(id)) continue;
    host(homeOf(d), { pet: d.pet, arrive: entrances.get(id) });
    entrances.delete(id);
  }
  for (const o of [...overlays.values()]) {
    if (o.pets.size) o.emptySince = 0;
    else if (!mons.some((m) => m.id === o.mon.id)) dropOverlay(o);
    else o.emptySince ||= Date.now();
  }
}

/** A dino goes to a monitor's overlay (opened if needed). */
function host(mon: Mon, hp: HostedPet) {
  const o = overlays.get(mon.id) ?? createOverlay(mon);
  o.pets.add(hp.pet.id);
  o.emptySince = 0;
  if (o.ready) send(o, 'add', hp);
  else o.queue.push(hp);
}

/** Asks an overlay for a dino back (it answers with the dino's latest data; see left()). */
function takeAway(o: Overlay, id: string) {
  const q = o.queue.findIndex((h) => h.pet.id === id);
  if (q >= 0) {
    // It never got there.
    o.queue.splice(q, 1);
    left(o, id, null);
    return;
  }
  leaving.set(id, setTimeout(() => left(o, id, null), 2500));
  if (o.ready) send(o, 'remove', id);
  else o.removals.push(id);
}

/** A dino left overlay `o`: it walked off an edge, was dropped on another monitor, or was taken
 * away (`l` is null if the overlay never answered). Sends it on to wherever it belongs now. */
function left(o: Overlay, id: string, l: Leave | null) {
  // Asked to leave (put away, moved) while it was walking off: what was asked for wins.
  const asked = leaving.has(id);
  clearTimeout(leaving.get(id));
  leaving.delete(id);
  o.pets.delete(id);
  if (!o.pets.size) o.emptySince = Date.now();
  const d = dinoOf(id);
  if (d && l) d.pet = l.pet;
  if (d && isOut(id)) {
    const here = mons.find((m) => m.id === o.mon.id);
    let to = homeOf(d);
    let arrive: Arrival = { kind: 'poof' };
    if (!asked && l?.how === 'exit') {
      // Walked off the edge: in from the facing edge of the monitor there, at the same height.
      const y = o.mon.workArea.y + l.y;
      const next = here ? neighbour(mons, here, l.side, y) : null;
      if (next) {
        to = next;
        arrive = { kind: 'edge', side: l.side === 'right' ? 'left' : 'right', y: y - next.workArea.y, ground: l.ground };
      } else if (here) {
        // Nowhere to go after all: it comes back.
        to = here;
        arrive = { kind: 'edge', side: l.side, y: l.y, ground: l.ground };
      }
      d.display = displayOf(to);
    } else if (!asked && l?.how === 'drop') {
      const x = o.mon.workArea.x + l.x;
      const y = o.mon.workArea.y + l.y;
      to = monitorAt(mons, x, y);
      arrive = { kind: 'drop', x: x - to.workArea.x, y: y - to.workArea.y };
      d.display = displayOf(to);
    }
    host(to, { pet: d.pet, arrive });
  }
  save();
  pushPanel();
  if (!o.pets.size && !mons.some((m) => m.id === o.mon.id)) dropOverlay(o);
}

function setOverlayHidden(o: Overlay, h: boolean) {
  if (h === o.hidden || o.win.isDestroyed()) return;
  o.hidden = h;
  send(o, 'hidden', h);
  if (h) o.win.hide();
  else if (o.shown) {
    o.win.showInactive();
    o.win.setAlwaysOnTop(true, 'screen-saver');
    o.lastWorld = '';
    pollWorld();
  }
}

/** Keeps the dinos on screen: re-shows an overlay if something hid it, and puts it back on top if
 * another always-on-top window got above it. It never touches the window otherwise, so it can't
 * make the dinos blink. */
function watchdog(o: Overlay) {
  const w = o.win;
  if (w.isDestroyed() || !o.shown || o.hidden || quitting) return;
  if (!w.isVisible() || w.isMinimized()) {
    log('overlay was hidden by something else; showing it again');
    w.showInactive();
    w.setAlwaysOnTop(true, 'screen-saver');
    return;
  }
  if (!desktop.available) return;
  try {
    if (desktop.coveredAbove(handleOf(w))) w.setAlwaysOnTop(true, 'screen-saver');
  } catch (e) {
    log(`watchdog: ${(e as Error).message}`);
  }
}

const allHidden = () => [...overlays.values()].every((o) => o.hidden);

// ---------------- polling the desktop ----------------

let worldTimer: NodeJS.Timeout | null = null;
let movingUntil = 0;

function resetWorld() {
  for (const o of overlays.values()) o.lastWorld = '';
  pollWorld();
}

function pollWorld() {
  if (locked) return;
  const live = [...overlays.values()].filter((o) => o.ready && !o.hidden);
  if (!live.length) return;
  let wins: WinRect[] = [];
  if (desktop.available && settings().explore) {
    try {
      wins = desktop.windows(ownHandles()).filter((w) => !games.has(w.pid)).map((w) => {
        const r = screen.screenToDipRect(null, { x: w.left, y: w.top, width: w.right - w.left, height: w.bottom - w.top });
        return { hwnd: w.hwnd, x: r.x, y: r.y, w: r.width, h: r.height };
      });
    } catch (e) {
      log(`windows: ${(e as Error).message}`);
    }
  }
  for (const o of live) {
    const wa = o.mon.workArea;
    const b = o.mon.bounds;
    let update: WorldUpdate = { width: wa.width, height: wa.height, platforms: [], walls: [], edges: edgesOf(mons, o.mon), others: othersOf(mons, o.mon) };
    if (wins.length) {
      try {
        // Each monitor's own windows are its platforms and walls.
        const here = wins.filter((w) => w.x < b.x + b.width && w.x + w.w > b.x && w.y < b.y + b.height && w.y + w.h > b.y);
        update = { ...update, ...computeWorld(here, wa) };
      } catch (e) {
        log(`world: ${(e as Error).message}`);
      }
    }
    const key = JSON.stringify(update);
    if (key !== o.lastWorld) {
      if (o.lastWorld) movingUntil = Date.now() + 1500;
      o.lastWorld = key;
      send(o, 'world', update);
    }
  }
}

function scheduleWorld() {
  if (worldTimer) clearTimeout(worldTimer);
  // Faster while windows are moving, so a dino riding a dragged window keeps up; slow while they
  // all sleep, and hardly at all while hidden or locked.
  const idle = !overlays.size || locked || allHidden() || !settings().explore;
  const saver = settings().power === 'saver';
  const hz = Date.now() < movingUntil ? (saver ? 20 : 30) : idle ? 0.5 : allAsleep() ? 2 : saver ? 3 : 5;
  worldTimer = setTimeout(() => {
    pollWorld();
    scheduleWorld();
  }, 1000 / hz);
}

let cursorTimer: NodeJS.Timeout | null = null;
let cursorMovedAt = 0;

/** Follows the mouse: 30 times a second while it moves, 5 while it rests, never while hidden. */
function pollCursor() {
  if (cursorTimer) clearTimeout(cursorTimer);
  const now = Date.now();
  let capture = false;
  if (!locked) {
    let p: Electron.Point | null = null;
    for (const o of overlays.values()) {
      capture ||= o.capture;
      if (!o.ready || o.hidden) continue;
      p ??= screen.getCursorScreenPoint();
      const wa = o.mon.workArea;
      const inside = p.x >= wa.x && p.x < wa.x + wa.width && p.y >= wa.y - 60 && p.y < wa.y + wa.height + 60;
      const local = inside ? { x: p.x - wa.x, y: p.y - wa.y } : null;
      const key = local ? `${local.x},${local.y}` : 'out';
      if (key !== o.lastCursor) {
        o.lastCursor = key;
        cursorMovedAt = now;
        send(o, 'cursor', local);
      }
    }
  }
  const active = capture || now - cursorMovedAt < 3000;
  cursorTimer = setTimeout(pollCursor, !overlays.size || locked || allHidden() ? 500 : active ? 33 : 200);
}

let processTick = 0;
/** The game you're playing and the video you're watching (it lists programs at most every ~10 s). */
const media = new MediaWatcher();
let video: Activity['video'] = null;
function pollActivity() {
  // Pick up a species folder created by hand after startup.
  if (!modsWatcher && processTick % 15 === 7 && fs.existsSync(MODS_DIR)) {
    reloadSpecies();
    watchMods();
  }
  // The smoke test runs on an idle CI machine; don't let the pet fall asleep there.
  const idle = SMOKE ? 0 : powerMonitor.getSystemIdleTime();
  const state = powerMonitor.getSystemIdleState(1);
  if (desktop.available) {
    processTick++;
    try {
      const s = settings();
      const seen = media.poll(desktop, { games: s.gameReactions, videos: s.videoReactions, exclude: ownHandles() });
      game = seen.game;
      games = seen.gamePids;
      video = seen.video;
    } catch (e) {
      log(`media: ${(e as Error).message}`);
    }
  }
  const a: Activity = { idle, locked: locked || state === 'locked', game, video };
  activity = a;
  broadcast('activity', a);
}

function pollFullscreen() {
  const all = Date.now() < hiddenUntil;
  let full: Area | null = null;
  // Off by default: dinos stay visible all the time unless you turn this on in Settings.
  if (!all && settings().hideFullscreen && desktop.available && overlays.size) {
    try {
      const fg = desktop.foreground(ownHandles());
      if (fg?.fullscreen) full = screen.screenToDipRect(null, { x: fg.monitor.left, y: fg.monitor.top, width: fg.monitor.right - fg.monitor.left, height: fg.monitor.bottom - fg.monitor.top });
    } catch (e) {
      log(`foreground: ${(e as Error).message}`);
    }
  }
  for (const o of [...overlays.values()]) {
    // Only the monitor the full-screen app is on.
    const b = o.mon.bounds;
    const covered = !!full && Math.abs(full.x - b.x) < 4 && Math.abs(full.y - b.y) < 4 && Math.abs(full.width - b.width) < 4;
    setOverlayHidden(o, all || covered);
    watchdog(o);
    if (!o.pets.size && o.emptySince && Date.now() - o.emptySince > 60_000) dropOverlay(o);
  }
}

function startPolling() {
  timers.push(setInterval(pollActivity, 2000));
  timers.push(setInterval(pollFullscreen, 1500));
  pollCursor();
  scheduleWorld();
  pollActivity();
}

// ---------------- tray and menus ----------------

/** The dinos that are out and what they're doing, the selected one first. */
function trayText() {
  const s = store.data;
  const ids = [...new Set([s.selected ?? '', ...s.out])].filter(isOut);
  const lines = ids.map((id) => statuses.get(id)?.text ?? dinoOf(id)?.pet.name ?? '').filter(Boolean);
  return (lines.join('\n') || 'Hatchling').slice(0, 127);
}

function petMenu(): MenuItemConstructorOptions[] {
  const s = store.data;
  const d = selectedDino();
  const hidden = Date.now() < hiddenUntil;
  const end: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    hidden
      ? { label: 'Show again', click: () => ((hiddenUntil = 0), pollFullscreen(), rebuildTray()) }
      : { label: 'Hide for an hour', click: () => ((hiddenUntil = Date.now() + 3600_000), pollFullscreen(), rebuildTray()) },
    ...(d ? [{ label: 'Pet card…', click: () => openPanel('card') }] : []),
    { label: 'My dinos…', click: () => openPanel(s.roster.length ? 'dinos' : 'choose') },
    { label: 'Settings…', click: () => openPanel('settings') },
    { type: 'separator' },
    { label: 'Quit Hatchling', click: () => app.quit() },
  ];
  if (!d) return [{ label: 'Choose an egg…', click: () => openPanel('choose') }, ...end];
  const id = d.pet.id;
  const cmd = (c: Command) => () => command({ ...c, pet: id });
  const everyone = (c: Command) => () => command({ ...c, pet: ALL_PETS });
  let actions: MenuItemConstructorOptions[];
  if (!isOut(id)) actions = [{ label: `Bring ${d.pet.name} out`, enabled: s.out.length < OUT_MAX, click: () => dinoAction({ type: 'out', id }) }];
  else if (d.pet.hatchedAt === null) actions = [{ label: 'Hatch now', click: cmd({ type: 'hatch-now' }) }];
  else {
    actions = [
      { label: 'Feed', click: cmd({ type: 'feed' }) },
      { label: 'Play ball', click: cmd({ type: 'play' }) },
      { label: 'Come here', click: cmd({ type: 'call' }) },
      { label: 'Nap', click: cmd({ type: 'sleep' }) },
      { label: 'Wake up', click: cmd({ type: 'wake' }) },
      { label: 'Tricks', submenu: TRICKS.map((name) => ({ label: trickName(name), click: cmd({ type: 'trick', name }) })) },
      { label: 'Toys', submenu: TOYS.map((toy) => ({ label: toyName(toy), click: cmd({ type: 'toy', toy }) })) },
      { label: moveName(movesOf(speciesOf(d.pet.species))[0]), click: cmd({ type: 'special' }) },
    ];
  }
  const more: MenuItemConstructorOptions[] = [];
  if (s.out.length > 1) {
    more.push({
      label: 'Everyone',
      submenu: [
        { label: 'Feed everyone', click: everyone({ type: 'feed' }) },
        { label: 'Everyone nap', click: everyone({ type: 'sleep' }) },
        { label: 'Wake everyone up', click: everyone({ type: 'wake' }) },
      ],
    });
  }
  if (s.roster.length > 1) {
    more.push({
      label: 'Dinos',
      submenu: s.roster.map((x) => ({ label: `${x.pet.name}${isOut(x.pet.id) ? '' : ' (resting)'}`, type: 'radio' as const, checked: x.pet.id === id, click: () => dinoAction({ type: 'select', id: x.pet.id }) })),
    });
  }
  return [
    { label: isOut(id) ? (statuses.get(id)?.text ?? d.pet.name) : `${d.pet.name} (resting)`, click: () => openPanel('card') },
    { type: 'separator' },
    ...actions,
    ...(more.length ? [{ type: 'separator' } as MenuItemConstructorOptions, ...more] : []),
    ...end,
  ];
}

function trayIcon() {
  const file = path.join(app.isPackaged ? process.resourcesPath : path.join(DIST, '..', 'resources'), 'tray.png');
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16, quality: 'best' });
}

function rebuildTray() {
  if (!tray) return;
  tray.setToolTip(trayText());
  tray.setContextMenu(Menu.buildFromTemplate(petMenu()));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', () => openPanel(store.data.roster.length ? 'card' : 'choose'));
  rebuildTray();
}

function popupPetMenu() {
  const menu = Menu.buildFromTemplate(petMenu());
  if (tray && process.platform === 'win32') tray.popUpContextMenu(menu, screen.getCursorScreenPoint());
  else menu.popup();
}

// ---------------- the panel window ----------------

function panelState(): PanelUpdate {
  const s = store.data;
  return { pet: selectedDino()?.pet ?? null, roster: s.roster, out: s.out, selected: s.selected, settings: settings(), species, problems, history: s.history, displays: displayList, systemDark: nativeTheme.shouldUseDarkColors };
}

function panelInit(view: PanelInit['view']): PanelInit {
  return { ...panelState(), version: app.getVersion(), platform: process.platform, modsDir: MODS_DIR, view };
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
  if (panel && !panel.isDestroyed()) panel.webContents.send('update', panelState());
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
  broadcast('settings', next);
  if (next.monitors !== before.monitors) {
    refreshMonitors();
    sync();
    resetWorld();
  } else if (next.explore !== before.explore) resetWorld();
  if (next.hideFullscreen !== before.hideFullscreen) pollFullscreen();
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
  broadcast('species', species);
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

function overlayOf(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  for (const o of overlays.values()) if (!o.win.isDestroyed() && e.sender === o.win.webContents) return o;
  return undefined;
}
function fromPanel(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return !!panel && e.sender === panel.webContents;
}

/** A dino leaving an overlay, checked. */
function readLeave(raw: unknown): Leave | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const pet = sanitizePet(l.pet);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e5, Math.min(1e5, v)) : 0);
  if (!pet) return null;
  if (l.how === 'exit' && (l.side === 'left' || l.side === 'right')) return { how: 'exit', pet, side: l.side, y: n(l.y), ground: l.ground !== false };
  if (l.how === 'drop') return { how: 'drop', pet, x: n(l.x), y: n(l.y) };
  if (l.how === 'removed') return { how: 'removed', pet };
  return null;
}

function registerIpc() {
  ipcMain.handle('overlay:init', (e): OverlayInit | null => {
    const o = overlayOf(e);
    if (!o) return null;
    const wa = o.mon.workArea;
    return { pets: o.queue.splice(0), settings: settings(), species, display: o.mon.id, width: wa.width, height: wa.height, test: TEST, smoke: SMOKE, now: Date.now() };
  });
  ipcMain.on('overlay:ready', (e) => {
    const o = overlayOf(e);
    if (!o || o.ready) return;
    o.ready = true;
    for (const hp of o.queue.splice(0)) send(o, 'add', hp);
    for (const id of o.removals.splice(0)) send(o, 'remove', id);
    if (o.hidden) send(o, 'hidden', true);
    if (activity) send(o, 'activity', activity);
    o.lastWorld = '';
    o.lastCursor = '';
    pollWorld();
  });
  ipcMain.on('overlay:capture', (e, on: boolean) => {
    const o = overlayOf(e);
    if (!o) return;
    o.capture = !!on;
    o.win.setIgnoreMouseEvents(!on);
    if (on) pollCursor();
  });
  ipcMain.on('overlay:save', (e, raw: unknown) => {
    const o = overlayOf(e);
    const p = sanitizePet(raw);
    // Only for a dino this overlay has (a save can cross it being taken away or released).
    const d = p && o?.pets.has(p.id) ? dinoOf(p.id) : undefined;
    if (!d || !p) return;
    d.pet = p;
    save();
    pushPanel();
  });
  ipcMain.on('overlay:leave', (e, raw: unknown) => {
    const o = overlayOf(e);
    const l = readLeave(raw);
    if (o && l && o.pets.has(l.pet.id)) left(o, l.pet.id, l);
  });
  ipcMain.on('overlay:notify', (e, n: { type: string; pet: string; text?: string; asleep?: boolean }) => {
    const o = overlayOf(e);
    if (!o || !n || !o.pets.has(n.pet)) return;
    if (n.type === 'status' && n.text) {
      statuses.set(n.pet, { text: String(n.text).slice(0, 80), asleep: n.asleep === true });
      rebuildTray();
    } else if (n.type === 'grew' && n.text && Notification.isSupported() && !o.hidden && !SMOKE) {
      new Notification({ title: `${dinoOf(n.pet)?.pet.name ?? 'Your pet'} grew up a bit!`, body: `Now a ${String(n.text).toLowerCase()}.`, silent: true }).show();
    } else if (n.type === 'hatched') rebuildTray();
  });
  // Double-click or right-click on a dino: it becomes the selected one.
  const pick = (id: unknown) => {
    if (!dinoOf(id)) return;
    store.data.selected = id as string;
    save();
    rebuildTray();
    pushPanel();
  };
  ipcMain.on('overlay:card', (e, id: unknown) => {
    if (!overlayOf(e)) return;
    pick(id);
    openPanel('card');
  });
  ipcMain.on('overlay:menu', (e, id: unknown) => {
    if (!overlayOf(e)) return;
    pick(id);
    popupPetMenu();
  });
  ipcMain.on('overlay:error', (e, msg: string) => overlayOf(e) && log(`overlay: ${String(msg).slice(0, 2000)}`));
  ipcMain.on('overlay:smoke', (e, report: Record<string, unknown>) => overlayOf(e) && finishSmoke(report));

  ipcMain.handle('panel:init', (e) => (fromPanel(e) ? panelInit(panelView) : null));
  ipcMain.handle('panel:hatch', (e, o: { species: string; variant: number; name: string; startWithWindows: boolean }) => {
    if (fromPanel(e) && o && typeof o === 'object') hatch(o);
  });
  ipcMain.handle('panel:settings', (e, s: Partial<Settings>) => (fromPanel(e) ? updateSettings(s) : settings()));
  ipcMain.handle('panel:dino', (e, a: DinoAction) => (fromPanel(e) && a && typeof a === 'object' ? dinoAction(a) : null));
  ipcMain.on('panel:command', (e, c: PetCommand) => {
    if (!fromPanel(e) || !c || typeof c !== 'object') return;
    const all = c.pet === ALL_PETS;
    const d = all ? undefined : dinoOf(c.pet ?? store.data.selected);
    if (!all && !d) return;
    const pet = d ? d.pet.id : ALL_PETS;
    switch (c.type) {
      case 'rename': {
        if (!d) return;
        const name = sanitizeName(c.name);
        d.pet.name = name;
        save();
        command({ type: 'rename', name, pet });
        rebuildTray();
        pushPanel();
        return;
      }
      case 'recolor': {
        if (!d) return;
        const p = d.pet;
        const sp = speciesOf(p.species);
        const v = Math.floor(Number(c.variant));
        // -1 (shiny colours) only for shiny pets.
        p.variant = Number.isFinite(v) && v >= (p.shiny ? -1 : 0) && v < sp.variants.length ? v : p.variant;
        p.colors = sanitizeColors(c.colors);
        save();
        command({ type: 'recolor', variant: p.variant, colors: p.colors, pet });
        pushPanel();
        return;
      }
      case 'trick':
        if (TRICKS.includes(c.name)) command({ type: 'trick', name: c.name, pet });
        return;
      case 'toy':
        if (TOYS.includes(c.toy)) command({ type: 'toy', toy: c.toy, pet });
        return;
      case 'feed':
      case 'play':
      case 'call':
      case 'sleep':
      case 'wake':
      case 'hatch-now':
      case 'treat':
      case 'special':
        command({ type: c.type, pet });
    }
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
    ['did a trick', report.danced === true],
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
    checks.push(['reads program paths', desktop.processPath(process.pid).toLowerCase().endsWith('\\' + self)]);
    try {
      desktop.windows(new Set());
      desktop.foreground(new Set());
      desktop.front(new Set());
      desktop.busy();
      desktop.coveredAbove('0');
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
  app.on('second-instance', () => openPanel(store.data.roster.length ? 'card' : 'choose'));
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    if (!overlays.size) return save();
    e.preventDefault();
    broadcast('command', { type: 'flush' });
    setTimeout(() => {
      save();
      app.quit();
    }, 350);
  });
  powerMonitor.on('lock-screen', () => {
    locked = true;
    pollActivity();
    broadcast('command', { type: 'flush' });
  });
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    pollActivity();
    resetWorld();
  });
  powerMonitor.on('suspend', () => {
    locked = true;
    pollActivity();
    broadcast('command', { type: 'flush' });
  });
  powerMonitor.on('shutdown', () => {
    broadcast('command', { type: 'flush' });
    save();
  });
  powerMonitor.on('resume', () => {
    locked = false;
    pollActivity();
    resetWorld();
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
      const pet = newPet('rex', 0, 'Smoke', Date.now());
      pet.activeSeconds = 3600 * 20;
      store.data.roster = [{ pet, display: null }];
      store.data.out = [pet.id];
      store.data.selected = pet.id;
      openPanel('card');
    }
    refreshMonitors();
    createTray();
    applyLoginItem();
    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed'] as const) screen.on(ev as 'display-added', () => displaysChanged());
    if (store.data.roster.length) sync();
    else openPanel('choose');
    startPolling();
    if (TEST) {
      (global as unknown as Record<string, unknown>).__hatchling = {
        store,
        sendOverlay: broadcast,
        command,
        dino: dinoAction,
        openPanel,
        updateSettings,
        setGame: (g: string | null) => (game = g),
        setLocked: (l: boolean) => ((locked = l), pollActivity()),
        errors,
        desktop: () => desktop,
        overlays: () => [...overlays.values()].map((o) => ({ display: o.mon.id, ready: o.ready, pets: [...o.pets] })),
        monitors: () => mons,
        menu: () => petMenu(),
      };
    }
  });
}
