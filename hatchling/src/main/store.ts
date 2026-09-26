// Saves your dinos and settings as JSON in the app's data folder. Writes are atomic (temp file +
// rename) and the previous save is kept as a backup, so a crash or power cut can't lose a pet.

import fs from 'node:fs';
import path from 'node:path';
import { THEME_IDS } from '../shared/themes';
import { type CustomColors, DEFAULT_SETTINGS, type Dino, GROWTH_SPEEDS, OUT_MAX, type PastPet, PATTERN_KINDS, type PetData, ROSTER_MAX, type Settings } from '../shared/types';

export type { PastPet } from '../shared/types';

/** Bumped when saved data needs a one-time migration. 3: one pet became a roster of dinos. */
export const REV = 3;

export interface StoreData {
  v: 1;
  /** Data revision (see REV). */
  rev: number;
  /** Your dinos ("My Dinos"), in the order they hatched. */
  roster: Dino[];
  /** Ids of the dinos out on the desktop, in the order they came out (at most OUT_MAX). The
   * others are put away: frozen, they don't grow or get hungry. */
  out: string[];
  /** The dino the panel's card and the tray menu are for. */
  selected: string | null;
  settings: Settings;
  history: PastPet[];
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, max: number, d: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const newId = () => Math.random().toString(36).slice(2, 10);

export function sanitizeName(v: unknown): string {
  const s = str(v, 24, 'Rexy').replace(/[\u0000-\u001f<>]/g, '').trim();
  return s || 'Rexy';
}

const HEX = /^#[0-9a-f]{6}$/i;

export function sanitizeColors(raw: unknown): CustomColors | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const col = (k: string) => (typeof c[k] === 'string' && HEX.test(c[k] as string) ? (c[k] as string).toLowerCase() : null);
  const body = col('body');
  const belly = col('belly');
  const pattern = col('pattern');
  const accent = col('accent');
  const iris = col('iris');
  if (!body || !belly || !pattern || !accent || !iris) return null;
  return { body, belly, pattern, accent, iris, pattern_kind: oneOf(c.pattern_kind, PATTERN_KINDS, 'none') };
}

export function sanitizePet(raw: unknown): PetData | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const s = (p.stats ?? {}) as Record<string, unknown>;
  const now = Date.now();
  return {
    v: 1,
    id: str(p.id, 32, newId()),
    name: sanitizeName(p.name),
    species: str(p.species, 32, 'rex').toLowerCase(),
    variant: Math.floor(num(p.variant, -1, 99, 0)),
    bornAt: num(p.bornAt, 0, 8.64e15, now),
    hatchedAt: p.hatchedAt === null ? null : num(p.hatchedAt, 0, 8.64e15, now),
    activeSeconds: num(p.activeSeconds, 0, 1e9, 0),
    // Saves from before 1.2.2 only had growth time: the best guess for time together.
    togetherSeconds: num(p.togetherSeconds, 0, 1e9, num(p.activeSeconds, 0, 1e9, 0)),
    energy: num(p.energy, 0, 1, 1),
    happiness: num(p.happiness, 0, 1, 0.7),
    hunger: num(p.hunger, 0, 1, 0.2),
    stats: {
      pets: Math.floor(num(s.pets, 0, 1e9, 0)),
      meals: Math.floor(num(s.meals, 0, 1e9, 0)),
      naps: Math.floor(num(s.naps, 0, 1e9, 0)),
      games: Math.floor(num(s.games, 0, 1e9, 0)),
      throws: Math.floor(num(s.throws, 0, 1e9, 0)),
      pokes: Math.floor(num(s.pokes, 0, 1e9, 0)),
    },
    lastSeen: num(p.lastSeen, 0, 8.64e15, now),
    x: p.x === null || p.x === undefined ? null : num(p.x, 0, 1, 0.8),
    colors: sanitizeColors(p.colors),
    shiny: p.shiny === true,
  };
}

/** An Electron display id, or null. */
export const sanitizeDisplay = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

function sanitizeDino(raw: unknown): Dino | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const pet = sanitizePet(d.pet);
  return pet ? { pet, display: sanitizeDisplay(d.display) } : null;
}

function sanitizePast(raw: unknown): PastPet | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  return {
    name: sanitizeName(h.name),
    species: str(h.species, 32, 'rex').toLowerCase(),
    variant: Math.floor(num(h.variant, -1, 99, 0)),
    hatchedAt: typeof h.hatchedAt === 'number' ? num(h.hatchedAt, 0, 8.64e15, 0) : null,
    activeSeconds: num(h.activeSeconds, 0, 1e9, 0),
    togetherSeconds: num(h.togetherSeconds, 0, 1e9, num(h.activeSeconds, 0, 1e9, 0)),
    retiredAt: num(h.retiredAt, 0, 8.64e15, 0),
    shiny: h.shiny === true,
    colors: sanitizeColors(h.colors),
  };
}

/** What's kept of a dino when you release it. */
export function pastOf(p: PetData, now: number): PastPet {
  return { name: p.name, species: p.species, variant: p.variant, hatchedAt: p.hatchedAt, activeSeconds: p.activeSeconds, togetherSeconds: p.togetherSeconds, retiredAt: now, shiny: p.shiny, colors: p.colors };
}

export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Settings) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : (base[k] as boolean));
  return {
    size: oneOf(s.size, ['S', 'M', 'L'] as const, base.size),
    sound: bool('sound'),
    volume: num(s.volume, 0, 1, base.volume),
    speech: oneOf(s.speech, ['off', 'emotes', 'chatty'] as const, base.speech),
    explore: bool('explore'),
    hideFullscreen: bool('hideFullscreen'),
    monitors: oneOf(s.monitors, ['all', 'primary'] as const, base.monitors),
    startWithWindows: bool('startWithWindows'),
    activity: oneOf(s.activity, ['calm', 'normal', 'lively'] as const, base.activity),
    gameReactions: bool('gameReactions'),
    theme: oneOf(s.theme, THEME_IDS, base.theme),
    growthSpeed: GROWTH_SPEEDS.find((g) => g === s.growthSpeed) ?? base.growthSpeed,
    videoReactions: bool('videoReactions'),
    power: oneOf(s.power, ['saver', 'balanced', 'smooth'] as const, base.power),
  };
}

/** Keeps the roster within its limits: unique ids, at most ROSTER_MAX dinos, at most OUT_MAX out,
 * and a selected dino that exists. Fixes `d` in place. */
export function tidy(d: Pick<StoreData, 'roster' | 'out' | 'selected'>) {
  const ids = new Set<string>();
  for (const x of d.roster) {
    // Two dinos with one id would share every save: give the later one its own.
    while (ids.has(x.pet.id)) x.pet.id = newId();
    ids.add(x.pet.id);
  }
  if (d.roster.length > ROSTER_MAX) d.roster.splice(ROSTER_MAX);
  const inRoster = new Set(d.roster.map((x) => x.pet.id));
  d.out = [...new Set(d.out)].filter((id) => inRoster.has(id)).slice(-OUT_MAX);
  if (d.selected === null || !inRoster.has(d.selected)) d.selected = d.out[0] ?? d.roster[0]?.pet.id ?? null;
}

function parse(text: string): StoreData {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const history = Array.isArray(raw.history) ? raw.history.map(sanitizePast).filter((h): h is PastPet => !!h).slice(-50) : [];
  const rev = typeof raw.rev === 'number' ? raw.rev : 1;
  const settings = sanitizeSettings(raw.settings);
  // 1.1: the pet stays visible over full-screen apps unless you turn hiding back on.
  if (rev < 2) settings.hideFullscreen = false;
  let roster: Dino[] = [];
  let out: string[] = [];
  let selected: string | null = null;
  if (rev >= 3 && Array.isArray(raw.roster)) {
    roster = raw.roster.map(sanitizeDino).filter((x): x is Dino => !!x);
    out = Array.isArray(raw.out) ? raw.out.filter((id): id is string => typeof id === 'string') : [];
    selected = typeof raw.selected === 'string' ? raw.selected : null;
  } else {
    // 1.2: the one pet becomes the first dino of the roster, out on the screen it lived on.
    const pet = sanitizePet(raw.pet);
    const s = (raw.settings ?? {}) as Record<string, unknown>;
    if (pet) {
      roster = [{ pet, display: sanitizeDisplay(s.display) }];
      out = [pet.id];
      selected = pet.id;
    }
  }
  const data: StoreData = { v: 1, rev: REV, roster, out, selected, settings, history };
  tidy(data);
  return data;
}

export class Store {
  data: StoreData;
  readonly file: string;
  /** Set when the main file was unreadable and the backup (or defaults) were used. */
  recovered: string | null = null;

  constructor(file: string) {
    this.file = file;
    this.data = this.load();
  }

  private load(): StoreData {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        const d = parse(fs.readFileSync(f, 'utf8'));
        if (f !== this.file) this.recovered = `Restored from backup: ${path.basename(this.file)} was unreadable`;
        return d;
      } catch (e) {
        if (f === this.file && fs.existsSync(f)) this.recovered = `Could not read ${path.basename(f)}: ${(e as Error).message}`;
      }
    }
    // Neither file could be read: keep a copy of the main one, or the next saves overwrite both
    // and every dino in it is lost for good.
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.unreadable-${Date.now()}`);
    } catch {
      /* best effort */
    }
    return { v: 1, rev: REV, roster: [], out: [], selected: null, settings: { ...DEFAULT_SETTINGS }, history: [] };
  }

  private lastText = '';

  /** Writes the file if anything changed since the last save. */
  save() {
    const d = this.data;
    // `pet` (the selected dino) is for older versions of Hatchling, so going back to one still
    // finds a pet. This version reads the roster.
    const pet = (d.roster.find((x) => x.pet.id === d.selected) ?? d.roster[0])?.pet ?? null;
    const text = JSON.stringify({ ...d, pet }, null, 1);
    if (text === this.lastText) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    // On disk before the rename, so a power cut can't leave a torn file behind.
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    } catch {
      /* the backup is best effort */
    }
    fs.renameSync(tmp, this.file);
    this.lastText = text;
  }
}
