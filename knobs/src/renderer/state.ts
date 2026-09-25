import { batch, computed, signal, type Signal } from '@preact/signals';
import type { Knob, KnobValue } from '../core/types';
import type { GameInfo, GamePayload, InitInfo, KnobsApi, RecentGame, Settings, VersionInfo } from '../shared/types';
import { errorReport, gameFile, parseStack, tweaksReport, type Tweak } from '../core/report';

declare global {
  interface Window { knobs: KnobsApi }
}
export const api = window.knobs;

// ---------------- app ----------------
export const info = signal<InitInfo | null>(null);
export const view = signal<'home' | 'game'>('home');
export const recents = signal<RecentGame[]>([]);
export const settings = signal<Settings>({ autoRestart: true, codeNumbers: true });

// ---------------- game ----------------
export const game = signal<GameInfo | null>(null);
export const gameUrl = signal('');
export const knobs = signal<Knob[]>([]);
export const values = signal<Signal<KnobValue>[]>([]);
export const pinned = signal<Set<string>>(new Set());
export const ranges = signal<Record<string, [number, number]>>({});
export const warnings = signal<string[]>([]);
export const preview = signal<{ id: string; ts: number } | null>(null);
export const gameFocused = signal(false);
export const loading = signal(false);

export const modified = computed(() => knobs.value.filter((k) => values.value[k.id]?.value !== k.value));

// ---------------- time ----------------
export const paused = signal(false);
export const scale = signal(1);
const SLOW = [1, 0.5, 0.25, 0.1];

// ---------------- layout ----------------
const stored = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
export const persist = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
};
export const drawerOpen = signal(stored('drawerOpen', true));
export const drawerTab = signal<'console' | 'perf' | 'versions'>(stored('drawerTab', 'console'));
export const drawerHeight = signal(stored('drawerHeight', 220));
export const panelOpen = signal(stored('panelOpen', true));
export const panelWidth = signal(stored('panelWidth', 360));
export const viewport = signal<string>(stored('viewport', 'fill'));
export const focusMode = signal(false);
export const paletteOpen = signal(false);
export const helpOpen = signal(false);
export const knobFilter = signal('');
export const focusKnob = signal<{ id: number; n: number } | null>(null);

// ---------------- console ----------------
export interface LogEntry {
  id: number;
  level: 'log' | 'warn' | 'error' | 'sep';
  text: string;
  stack?: string;
  file?: string;
  line?: number;
  count: number;
  t: number;
}
let logId = 0;
export const logs = signal<LogEntry[]>([]);
export const errorCount = computed(() => logs.value.reduce((n, e) => n + (e.level === 'error' ? e.count : 0), 0));

export function addSeparator(text: string) {
  const list = logs.value;
  if (!list.length || list[list.length - 1].level === 'sep') return;
  logs.value = [...list, { id: ++logId, level: 'sep', text, count: 1, t: 0 }];
}

function addLogs(entries: unknown, dropped: unknown) {
  if (!Array.isArray(entries)) return;
  const list = logs.value.slice();
  for (const raw of entries as Record<string, unknown>[]) {
    if (!raw || typeof raw.text !== 'string') continue;
    const level = raw.level === 'error' || raw.level === 'warn' ? raw.level : 'log';
    const stack = typeof raw.stack === 'string' ? raw.stack.slice(0, 8000) : undefined;
    let file = typeof raw.file === 'string' ? gameFile(raw.file) ?? undefined : undefined;
    let line = typeof raw.line === 'number' ? raw.line : undefined;
    const top = parseStack(stack)[0];
    if (top && (!file || level !== 'error' || !line)) {
      file = top.file;
      line = top.line;
    }
    const text = raw.text.slice(0, 8000);
    const prev = list[list.length - 1];
    if (prev && prev.level === level && prev.text === text && prev.stack === stack) {
      list[list.length - 1] = { ...prev, count: prev.count + 1 };
      continue;
    }
    list.push({ id: ++logId, level, text, stack, file, line, count: 1, t: typeof raw.t === 'number' ? raw.t : 0 });
  }
  if (typeof dropped === 'number' && dropped > 0) list.push({ id: ++logId, level: 'warn', text: `…${dropped} more messages were dropped (the game is logging very fast)`, count: 1, t: 0 });
  logs.value = list.length > 1000 ? list.slice(-1000) : list;
}

// ---------------- performance ----------------
const FR = 600;
export const frameBuf = new Float32Array(FR);
export const workBuf = new Float32Array(FR);
export const perfState = { idx: 0, len: 0 };
export const perfTick = signal(0);
export const fps = signal(0);
export const heapMB = signal(0);
export const hasLoop = signal(true);

export function clearPerf() {
  perfState.idx = 0;
  perfState.len = 0;
  fps.value = 0;
  perfTick.value++;
}

/** Last n frame times, oldest first. */
export function recentFrames(n: number, buf = frameBuf): number[] {
  const out: number[] = [];
  const count = Math.min(n, perfState.len);
  for (let i = count; i > 0; i--) out.push(buf[(perfState.idx - i + FR) % FR]);
  return out;
}

function addPerf(m: Record<string, unknown>) {
  const frames = Array.isArray(m.frames) ? (m.frames as number[]) : [];
  const work = Array.isArray(m.work) ? (m.work as number[]) : [];
  for (let i = 0; i < frames.length; i++) {
    const f = Number(frames[i]);
    if (!(f > 0)) continue;
    frameBuf[perfState.idx] = f;
    workBuf[perfState.idx] = Number(work[i]) || 0;
    perfState.idx = (perfState.idx + 1) % FR;
    perfState.len = Math.min(FR, perfState.len + 1);
  }
  if (typeof m.heap === 'number' && m.heap > 0) heapMB.value = m.heap / 1048576;
  hasLoop.value = m.loop !== false || frames.length > 0;
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= perfState.len && sum < 1000; i++) {
    sum += frameBuf[(perfState.idx - i + FR) % FR];
    n++;
  }
  fps.value = sum > 0 && !paused.value ? Math.round((n / sum) * 1000) : fps.value;
  perfTick.value++;
}

// ---------------- toasts ----------------
export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'success'; action?: { label: string; run: () => void } }
let toastId = 0;
export const toasts = signal<Toast[]>([]);
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const t = { id: ++toastId, text, kind, action };
  toasts.value = [...toasts.value.slice(-2), t];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x !== t)), kind === 'error' ? 7000 : action ? 6000 : 3500);
}
export const fail = (e: unknown) => toast(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');

// ---------------- game frame bridge ----------------
let frame: HTMLIFrameElement | null = null;
export const setFrame = (el: HTMLIFrameElement | null) => {
  frame = el;
};
export const getFrame = () => frame;

function targetOrigin(): string {
  try {
    const o = new URL(gameUrl.value).origin;
    return o && o !== 'null' ? o : '*';
  } catch {
    return '*';
  }
}
function post(msg: object) {
  frame?.contentWindow?.postMessage({ __knobs: 1, ...msg }, targetOrigin());
}

let thumbTimer = 0;
window.addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || m.__knobs !== 1) return;
  if (m.type === 'ready') {
    if (scale.value !== 1) post({ type: 'time', paused: false, scale: scale.value });
    paused.value = false;
    // Give the game the keyboard, unless the user is busy in the UI (palette, a text field, …).
    const active = document.activeElement;
    if (!paletteOpen.value && !helpOpen.value && (!active || active === document.body || active === frame)) frame.focus();
    clearTimeout(thumbTimer);
    const url = gameUrl.value;
    thumbTimer = window.setTimeout(() => url === gameUrl.value && !preview.value && captureThumb(), 2500);
  } else if (m.type === 'log') addLogs(m.entries, m.dropped);
  else if (m.type === 'perf') addPerf(m);
});

export function captureThumb() {
  if (!frame || view.value !== 'game') return;
  const r = frame.getBoundingClientRect();
  api.captureThumb({ x: r.x, y: r.y, width: r.width, height: r.height });
}

// ---------------- knob values ----------------
const toGame = new Map<number, KnobValue>();
const toMain = new Map<string, KnobValue>();
let gameRaf = 0;
let mainTimer = 0;
let restartTimer = 0;

function flushGame() {
  gameRaf = 0;
  if (toGame.size) post({ type: 'set', values: [...toGame] });
  toGame.clear();
}
export function flushMain() {
  clearTimeout(mainTimer);
  if (toMain.size) api.setKnobs([...toMain]);
  toMain.clear();
}

export function setKnob(id: number, v: KnobValue) {
  const k = knobs.value[id];
  const sig = values.value[id];
  if (!k || !sig || preview.value || sig.value === v) return;
  sig.value = v;
  toGame.set(id, v);
  if (!gameRaf) gameRaf = requestAnimationFrame(flushGame);
  toMain.set(k.key, v);
  clearTimeout(mainTimer);
  mainTimer = window.setTimeout(flushMain, 150);
  if (k.live === 'restart' && settings.value.autoRestart) {
    clearTimeout(restartTimer);
    restartTimer = window.setTimeout(restart, 500);
  }
}

export async function resetKnobs(keys: string[] | null) {
  flushMain();
  try {
    const st = await api.resetKnobs(keys);
    const needsRestart = knobs.value.some((k) => (!keys || keys.includes(k.key)) && k.live === 'restart' && values.value[k.id].value !== k.value);
    batch(() => {
      st.values.forEach((v, i) => {
        const sig = values.value[i];
        if (sig && sig.value !== v) {
          sig.value = v;
          toGame.set(i, v);
        }
      });
    });
    flushGame();
    if (needsRestart && settings.value.autoRestart) restart();
  } catch (e) {
    fail(e);
  }
}

export function togglePin(key: string) {
  const next = new Set(pinned.value);
  const on = !next.has(key);
  if (on) next.add(key); else next.delete(key);
  pinned.value = next;
  api.setPinned(key, on);
}

export function setRange(key: string, r: [number, number] | null) {
  const next = { ...ranges.value };
  if (r) next[key] = r; else delete next[key];
  ranges.value = next;
  api.setRange(key, r);
}

// ---------------- loading games ----------------
let stash: { knobs: Knob[]; values: Signal<KnobValue>[] } | null = null;

export function applyPayload(p: GamePayload, restartFrame = true) {
  batch(() => {
    game.value = p.game;
    knobs.value = p.state.knobs;
    values.value = p.state.values.map((v) => signal(v));
    pinned.value = new Set(p.state.pinned);
    ranges.value = p.state.ranges;
    warnings.value = p.state.warnings;
    preview.value = null;
    stash = null;
    view.value = 'game';
    if (p.reason === 'open') {
      logs.value = [];
      clearPerf();
      paused.value = false;
      knobFilter.value = '';
    }
    if (restartFrame) {
      if (p.reason !== 'open') {
        addSeparator(p.reason === 'change' ? `Reloaded: ${p.file ?? 'files'} changed` : p.reason === 'paste' ? 'New version pasted' : p.reason === 'restore' ? 'Version restored' : 'Reloaded');
        clearPerf();
      }
      gameUrl.value = p.url;
    }
  });
  if (p.reason === 'open' || p.reason === 'paste') api.recents().then((r) => (recents.value = r)).catch(() => {});
  if (p.state.dropped.length) {
    toast(`${p.state.dropped.length} tweak${p.state.dropped.length > 1 ? 's' : ''} dropped because the code changed: ${p.state.dropped.slice(0, 3).join(', ')}${p.state.dropped.length > 3 ? '…' : ''}`);
  }
}

async function guard<T>(fn: () => Promise<T>, switching = false): Promise<T | undefined> {
  if (switching && view.value === 'game' && !preview.value) captureThumb();
  loading.value = true;
  try {
    return await fn();
  } catch (e) {
    fail(e);
    return undefined;
  } finally {
    loading.value = false;
  }
}

export const openPath = (p: string) => guard(async () => applyPayload(await api.open(p)), true);
export const openDialog = (kind: 'file' | 'folder') =>
  guard(async () => {
    const p = await api.openDialog(kind);
    if (p) applyPayload(p);
  }, true);
export const openDemo = () => guard(async () => applyPayload(await api.openDemo()), true);

const HTML_RE = /<(!doctype|html|head|body|script|canvas|svg|div|style)\b/i;
export async function pasteGame(text: string) {
  if (!HTML_RE.test(text)) {
    if (/\bfrom\s+['"]react['"]|export\s+default\s+function/.test(text)) {
      toast('That looks like a React component. Knobs runs plain HTML games — ask for a single-file HTML version.', 'error');
    } else toast("The clipboard doesn't contain an HTML page.", 'error');
    return;
  }
  await guard(async () => {
    const r = await api.paste(text);
    applyPayload(r.payload);
    if (r.updated) {
      const undo = r.undo;
      toast(`Updated “${r.payload.game.name}”`, 'success', undo ? { label: 'Undo', run: () => restoreVersion(undo) } : undefined);
    } else toast(`Saved “${r.payload.game.name}” to your Knobs folder`, 'success');
  }, true);
}

export async function closeGame() {
  captureThumb();
  flushMain();
  await api.close().catch(() => {});
  batch(() => {
    view.value = 'home';
    game.value = null;
    gameUrl.value = '';
    knobs.value = [];
    values.value = [];
    logs.value = [];
    preview.value = null;
    focusMode.value = false;
  });
  api.setFullscreen(false);
  recents.value = await api.recents();
}

// ---------------- controls ----------------
export async function restart() {
  if (!game.value) return;
  clearTimeout(restartTimer);
  flushMain();
  if (preview.value) {
    const pv = preview.value;
    const r = await api.previewVersion(pv.id);
    if (r) gameUrl.value = r.url;
    return;
  }
  try {
    const url = await api.restart(scale.value);
    batch(() => {
      addSeparator('Restarted');
      clearPerf();
      paused.value = false;
      gameUrl.value = url;
    });
  } catch (e) {
    fail(e);
  }
}

export function setPaused(p: boolean) {
  paused.value = p;
  post({ type: 'time', paused: p, scale: scale.value });
}
export const togglePause = () => setPaused(!paused.value);
export function step() {
  if (!paused.value) setPaused(true);
  else post({ type: 'step' });
}
export function setScale(s: number) {
  scale.value = s;
  post({ type: 'time', paused: paused.value, scale: s });
}
export function slower() {
  const i = SLOW.indexOf(scale.value);
  setScale(i < 0 ? 1 : SLOW[(i + 1) % SLOW.length]);
}
export function faster() {
  const i = SLOW.indexOf(scale.value);
  setScale(i <= 0 ? 2 : SLOW[i - 1]);
}

export function currentTweaks(): Tweak[] {
  return modified.value.map((k) => ({ knob: k, value: values.value[k.id].value }));
}

export async function copyTweaks() {
  const t = currentTweaks();
  if (!t.length) return toast('Nothing to copy — no values have been changed.');
  await navigator.clipboard.writeText(tweaksReport(t));
  toast(`Copied ${t.length} change${t.length > 1 ? 's' : ''} for your AI chat`, 'success');
}

export async function copyError(e: LogEntry) {
  const files = new Set<string>();
  if (e.file) files.add(e.file);
  const top = parseStack(e.stack)[0];
  if (top) files.add(top.file);
  const sources: Record<string, string> = {};
  for (const f of files) {
    const s = await api.source(f).catch(() => null);
    if (s != null) sources[f] = s;
  }
  const text = errorReport({ message: e.text, stack: e.stack, file: e.file, line: e.line, count: e.count, at: e.t }, sources, currentTweaks());
  await navigator.clipboard.writeText(text);
  toast('Error report copied — paste it into your AI chat', 'success');
}

export async function bake() {
  if (preview.value) return;
  flushMain();
  const n = modified.value.length;
  if (!n) return toast('Nothing to bake — no values have been changed.');
  await guard(async () => {
    const { result, payload, reload } = await api.bake();
    applyPayload(payload, reload);
    const files = [...new Set(result.applied.map((a) => a.file))].join(', ');
    if (result.applied.length) toast(`Baked ${result.applied.length} value${result.applied.length > 1 ? 's' : ''} into ${files}`, 'success');
    if (result.skipped.length) toast(`Skipped ${result.skipped.map((s) => `${s.label} (${s.reason})`).join(', ')}`, 'error');
    if (drawerTab.value === 'versions') versionsTick.value++;
  });
}

// ---------------- versions ----------------
export const versions = signal<VersionInfo[]>([]);
export const versionsTick = signal(0);
export async function loadVersions() {
  try {
    versions.value = await api.versions();
  } catch {
    versions.value = [];
  }
}

export async function previewVersion(v: VersionInfo) {
  flushMain();
  const r = await api.previewVersion(v.id).catch(fail);
  if (!r) return;
  batch(() => {
    if (!stash) stash = { knobs: knobs.value, values: values.value };
    knobs.value = r.state.knobs;
    values.value = r.state.values.map((x) => signal(x));
    preview.value = { id: v.id, ts: v.ts };
    addSeparator(`Previewing version from ${new Date(v.ts).toLocaleTimeString()}`);
    clearPerf();
    gameUrl.value = r.url;
  });
}

export async function exitPreview() {
  if (!preview.value) return;
  const s = stash;
  batch(() => {
    if (s) {
      knobs.value = s.knobs;
      values.value = s.values;
    }
    stash = null;
    preview.value = null;
  });
  await restart();
}

export async function restoreVersion(id: string) {
  await guard(async () => {
    await api.restoreVersion(id);
    versionsTick.value++;
  });
}

export async function setSetting(patch: Partial<Settings>) {
  settings.value = await api.setSettings(patch);
}

// ---------------- events from main ----------------
api.on('reloaded', (p) => {
  applyPayload(p);
  if (p.reason === 'change') toast(`Reloaded — ${p.file ?? 'a file'} changed`);
  versionsTick.value++;
});
api.on('opened', (p) => applyPayload(p));
api.on('error', (m) => toast(m, 'error'));
api.on('recents', (list) => (recents.value = list));
