// Saves the pet and settings as JSON in the app's data folder. Writes are atomic (temp file +
// rename) and the previous save is kept as a backup, so a crash or power cut can't lose the pet.

import fs from 'node:fs';
import path from 'node:path';
import { THEME_IDS } from '../shared/themes';
import { type CustomColors, DEFAULT_SETTINGS, GROWTH_SPEEDS, type PastPet, PATTERN_KINDS, type PetData, type Settings } from '../shared/types';

export type { PastPet } from '../shared/types';

/** Bumped when saved data needs a one-time migration. */
export const REV = 2;

export interface StoreData {
  v: 1;
  /** Data revision (see REV). */
  rev: number;
  pet: PetData | null;
  settings: Settings;
  history: PastPet[];
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, max: number, d: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

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
    id: str(p.id, 32, Math.random().toString(36).slice(2, 10)),
    name: sanitizeName(p.name),
    species: str(p.species, 32, 'rex').toLowerCase(),
    variant: Math.floor(num(p.variant, -1, 99, 0)),
    bornAt: num(p.bornAt, 0, 8.64e15, now),
    hatchedAt: p.hatchedAt === null ? null : num(p.hatchedAt, 0, 8.64e15, now),
    activeSeconds: num(p.activeSeconds, 0, 1e9, 0),
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

function sanitizePast(raw: unknown): PastPet | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  return {
    name: sanitizeName(h.name),
    species: str(h.species, 32, 'rex').toLowerCase(),
    variant: Math.floor(num(h.variant, -1, 99, 0)),
    hatchedAt: typeof h.hatchedAt === 'number' ? num(h.hatchedAt, 0, 8.64e15, 0) : null,
    activeSeconds: num(h.activeSeconds, 0, 1e9, 0),
    retiredAt: num(h.retiredAt, 0, 8.64e15, 0),
    shiny: h.shiny === true,
    colors: sanitizeColors(h.colors),
  };
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
    display: s.display === null ? null : typeof s.display === 'number' && Number.isFinite(s.display) ? s.display : base.display,
    startWithWindows: bool('startWithWindows'),
    activity: oneOf(s.activity, ['calm', 'normal', 'lively'] as const, base.activity),
    gameReactions: bool('gameReactions'),
    theme: oneOf(s.theme, THEME_IDS, base.theme),
    growthSpeed: GROWTH_SPEEDS.find((g) => g === s.growthSpeed) ?? base.growthSpeed,
    videoReactions: bool('videoReactions'),
    power: oneOf(s.power, ['saver', 'balanced', 'smooth'] as const, base.power),
  };
}

function parse(text: string): StoreData {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const history = Array.isArray(raw.history) ? raw.history.map(sanitizePast).filter((h): h is PastPet => !!h).slice(-50) : [];
  const rev = typeof raw.rev === 'number' ? raw.rev : 1;
  const settings = sanitizeSettings(raw.settings);
  // 1.1: the pet stays visible over full-screen apps unless you turn hiding back on.
  if (rev < 2) settings.hideFullscreen = false;
  return { v: 1, rev: REV, pet: sanitizePet(raw.pet), settings, history };
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
    return { v: 1, rev: REV, pet: null, settings: { ...DEFAULT_SETTINGS }, history: [] };
  }

  private lastText = '';

  /** Writes the file if anything changed since the last save. */
  save() {
    const text = JSON.stringify(this.data, null, 1);
    if (text === this.lastText) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    } catch {
      /* the backup is best effort */
    }
    fs.renameSync(tmp, this.file);
    this.lastText = text;
  }
}
