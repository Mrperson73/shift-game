import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeInstrumentProject } from '../core/instrument';
import { bake as bakeCore } from '../core/bake';
import type { InstrumentResult, KnobValue } from '../core/types';
import type { BakeResult, GameInfo, GamePayload, KnobState, LoadReason, Settings } from '../shared/types';
import { type GameData, type Store, writeAtomic } from './store';
import { hashFiles, type Snapshots } from './snapshots';

const MAX_FILE = 8 * 1024 * 1024;

export function gameId(absEntry: string): string {
  const norm = process.platform === 'win32' ? absEntry.toLowerCase() : absEntry;
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12);
}

export function safeJoin(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  return abs;
}

export function resolveGame(p: string): { root: string; entry: string; kind: 'file' | 'folder' } {
  const abs = path.resolve(p);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const htmls = fs.readdirSync(abs).filter((f) => /\.html?$/i.test(f)).sort();
    const entry = htmls.find((f) => /^index\.html?$/i.test(f)) ?? htmls[0];
    if (!entry) throw new Error('That folder has no .html file in it.');
    return { root: abs, entry, kind: 'folder' };
  }
  if (!/\.html?$/i.test(abs)) throw new Error('Knobs opens .html files, or folders that contain one.');
  return { root: path.dirname(abs), entry: path.basename(abs), kind: 'file' };
}

export function makeReader(root: string, overlay?: Record<string, string>) {
  return (rel: string): string | null => {
    if (overlay && rel in overlay) return overlay[rel];
    const abs = safeJoin(root, rel);
    if (!abs) return null;
    try {
      const st = fs.statSync(abs);
      return st.isFile() && st.size <= MAX_FILE ? fs.readFileSync(abs, 'utf8') : null;
    } catch {
      return null;
    }
  };
}

/** Something the knobs-game:// protocol can serve. */
export interface Host {
  root: string;
  entry: string;
  files(): Record<string, string>;
  init(): object;
  served: Set<string>;
}

export const cssUnits = (res: InstrumentResult) =>
  Object.fromEntries(res.knobs.filter((k) => k.lang === 'css').map((k) => [k.id, k.unit ?? '']));

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export interface SessionDeps {
  store: Store;
  snapshots: Snapshots;
  settings: () => Settings;
  onReload: (p: GamePayload) => void;
  onError: (msg: string) => void;
}

export class GameSession implements Host {
  info: GameInfo;
  res!: InstrumentResult;
  values: KnobValue[] = [];
  served = new Set<string>();
  scale = 1;
  private watchers: fs.FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private changed = new Set<string>();
  private hash = '';
  private loads = 0;

  constructor(opened: string, private deps: SessionDeps, pasted = false) {
    const g = resolveGame(opened);
    const id = gameId(path.join(g.root, g.entry));
    this.info = { id, name: '', path: path.resolve(opened), root: g.root, entry: g.entry, kind: g.kind, pasted };
    this.load();
  }

  get root() { return this.info.root; }
  get entry() { return this.info.entry; }
  get host() { return this.info.id; }
  get contentHash() { return this.hash; }
  private get data(): GameData { return this.deps.store.game(this.info.id); }

  files() { return this.res.files; }

  init() {
    return { values: this.values, sites: this.res.sites, css: cssUnits(this.res), time: { paused: false, scale: this.scale } };
  }

  private instrument(overlay?: Record<string, string>) {
    return safeInstrumentProject(this.info.entry, makeReader(this.info.root, overlay), { codeNumbers: this.deps.settings().codeNumbers });
  }

  /** (Re)analyze the game from disk and re-apply saved tweaks. Returns labels of tweaks that no longer apply. */
  load(): string[] {
    this.res = this.instrument();
    const base = this.info.entry.replace(/\.html?$/i, '');
    const fallback = this.info.kind === 'folder' || /^index$/i.test(base) ? path.basename(this.info.root) : base;
    this.info.name = this.res.title || fallback;
    this.hash = hashFiles(this.res.sources);
    return this.applyTweaks();
  }

  private applyTweaks(): string[] {
    const tweaks = this.data.tweaks;
    const dropped: string[] = [];
    this.values = this.res.knobs.map((k) => k.value);
    for (const k of this.res.knobs) {
      const t = tweaks[k.key];
      if (!t) continue;
      if (t.o === k.value) this.values[k.id] = t.v;
      else {
        dropped.push(k.label);
        delete tweaks[k.key];
      }
    }
    this.deps.store.save();
    return dropped;
  }

  state(dropped: string[] = []): KnobState {
    const d = this.data;
    return { knobs: this.res.knobs, values: this.values, pinned: d.pinned, ranges: d.ranges, warnings: this.res.warnings, dropped };
  }

  url(): string {
    return `knobs-game://${this.host}/${encodePath(this.info.entry)}?r=${++this.loads}`;
  }

  payload(reason: LoadReason, dropped: string[] = [], file?: string): GamePayload {
    return { game: { ...this.info }, url: this.url(), state: this.state(dropped), reason, file };
  }

  setValues(pairs: [string, KnobValue][]) {
    const byKey = new Map(this.res.knobs.map((k) => [k.key, k]));
    const tweaks = this.data.tweaks;
    for (const [key, v] of pairs) {
      const k = byKey.get(key);
      if (!k || typeof v !== typeof k.value) continue;
      this.values[k.id] = v;
      if (v === k.value) delete tweaks[key];
      else tweaks[key] = { v, o: k.value };
    }
    this.deps.store.save();
  }

  reset(keys: string[] | null): KnobState {
    const tweaks = this.data.tweaks;
    for (const k of this.res.knobs) {
      if (keys && !keys.includes(k.key)) continue;
      delete tweaks[k.key];
      this.values[k.id] = k.value;
    }
    if (!keys) for (const key of Object.keys(tweaks)) delete tweaks[key];
    this.deps.store.save();
    return this.state();
  }

  setPinned(key: string, on: boolean) {
    const d = this.data;
    d.pinned = d.pinned.filter((k) => k !== key);
    if (on) d.pinned.push(key);
    this.deps.store.save();
  }

  setRange(key: string, range: [number, number] | null) {
    const d = this.data;
    if (range && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1]) d.ranges[key] = range;
    else delete d.ranges[key];
    this.deps.store.save();
  }

  bake(): { result: BakeResult; changedIds: boolean } {
    const fresh = this.instrument();
    const tweaks = this.data.tweaks;
    const values: Record<string, KnobValue> = {};
    for (const k of fresh.knobs) {
      const t = tweaks[k.key];
      if (t && t.o === k.value && t.v !== k.value) values[k.key] = t.v;
    }
    const out = bakeCore(fresh, values);
    const result: BakeResult = {
      applied: out.applied.map((k) => ({ label: k.label, file: k.file, line: k.line })),
      skipped: out.skipped.map((s) => ({ label: s.knob.label, reason: s.reason })),
    };
    if (!out.applied.length) return { result, changedIds: false };
    this.deps.snapshots.add(this.info.id, fresh.sources, 'Before bake');
    for (const [file, text] of Object.entries(out.files)) {
      const abs = safeJoin(this.info.root, file);
      if (abs) writeAtomic(abs, text);
    }
    for (const k of out.applied) delete tweaks[k.key];
    const before = this.res.knobs.map((k) => k.key).join('\n');
    this.load();
    this.deps.snapshots.add(this.info.id, this.res.sources, 'Baked');
    return { result, changedIds: before !== this.res.knobs.map((k) => k.key).join('\n') };
  }

  /** Instrument a stored version for previewing, with current tweaks applied by key. */
  preview(files: Record<string, string>) {
    const res = this.instrument(files);
    const tweaks = this.data.tweaks;
    const values = res.knobs.map((k) => {
      const t = tweaks[k.key];
      return t && t.o === k.value ? t.v : k.value;
    });
    const state: KnobState = { knobs: res.knobs, values, pinned: this.data.pinned, ranges: this.data.ranges, warnings: res.warnings, dropped: [] };
    const host: Host = {
      root: this.info.root, entry: this.info.entry, served: new Set(), files: () => res.files,
      init: () => ({ values, sites: res.sites, css: cssUnits(res), time: { paused: false, scale: this.scale } }),
    };
    return { host, state, entryPath: encodePath(this.info.entry) };
  }

  writeFiles(files: Record<string, string>) {
    for (const [file, text] of Object.entries(files)) {
      const abs = safeJoin(this.info.root, file);
      if (abs) writeAtomic(abs, text);
    }
  }

  // ---------------- file watching ----------------

  watch() {
    this.unwatch();
    const recursive = this.info.kind === 'folder';
    const dirs = new Set<string>(recursive ? [this.info.root] : Object.keys(this.res.sources).map((f) => path.dirname(path.join(this.info.root, f))));
    for (const dir of dirs) {
      try {
        const w = fs.watch(dir, { recursive }, (_ev, name) => {
          if (!name) return this.schedule(null);
          const rel = path.relative(this.info.root, path.join(dir, name.toString())).split(path.sep).join('/');
          if (rel.startsWith('..') || /(^|\/)(node_modules|\.git)(\/|$)/.test(rel)) return;
          if (rel in this.res.sources || this.served.has(rel)) this.schedule(rel);
        });
        w.on('error', () => { /* directory vanished */ });
        this.watchers.push(w);
      } catch { /* unwatchable directory: hot reload just won't trigger */ }
    }
  }

  unwatch() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(rel: string | null) {
    if (rel) this.changed.add(rel);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(), 180);
  }

  private onChange() {
    const files = [...this.changed];
    this.changed.clear();
    const sourceChanged = !files.length || files.some((f) => f in this.res.sources);
    if (!sourceChanged) return this.deps.onReload(this.payload('change', [], files[0]));
    const prev = this.hash;
    let dropped: string[];
    try {
      dropped = this.load();
    } catch (e) {
      return this.deps.onError(`Couldn't reload: ${(e as Error).message}`);
    }
    if (this.hash === prev) return;
    this.deps.snapshots.add(this.info.id, this.res.sources, 'File changed');
    this.watch();
    this.deps.onReload(this.payload('change', dropped, files.find((f) => f in this.res.sources)));
  }
}
