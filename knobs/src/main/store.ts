import fs from 'node:fs';
import path from 'node:path';
import type { KnobValue } from '../core/types';
import type { RecentGame, Settings } from '../shared/types';

export interface GameData {
  /** Unbaked tweaks by knob key: current value + the source value it was based on. */
  tweaks: Record<string, { v: KnobValue; o: KnobValue }>;
  pinned: string[];
  ranges: Record<string, [number, number]>;
}

interface Data {
  recents: RecentGame[];
  settings: Settings;
  games: Record<string, GameData>;
  window?: { x?: number; y?: number; width: number; height: number; maximized: boolean };
}

const DEFAULTS: Data = { recents: [], settings: { autoRestart: true, codeNumbers: true }, games: {} };

/** Tiny JSON store: debounced, atomic writes. */
export class Store {
  data: Data;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    let loaded: Partial<Data> = {};
    try {
      loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* first run or corrupt: start fresh */ }
    this.data = { ...DEFAULTS, ...loaded, settings: { ...DEFAULTS.settings, ...loaded.settings }, games: loaded.games ?? {}, recents: loaded.recents ?? [] };
  }

  game(id: string): GameData {
    const g = (this.data.games[id] ??= { tweaks: {}, pinned: [], ranges: {} });
    g.tweaks ??= {};
    g.pinned ??= [];
    g.ranges ??= {};
    return g;
  }

  save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // drop empty per-game records so the file doesn't grow forever
    for (const [id, g] of Object.entries(this.data.games)) {
      if (!Object.keys(g.tweaks).length && !g.pinned.length && !Object.keys(g.ranges).length) delete this.data.games[id];
    }
    writeAtomic(this.file, JSON.stringify(this.data));
  }
}

export function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse to replace a file another program holds open; fall back to a direct write.
    fs.writeFileSync(file, text);
    fs.rmSync(tmp, { force: true });
  }
}
