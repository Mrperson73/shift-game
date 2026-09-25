// Saves the pet and settings as JSON in the app's data folder. Writes are atomic (temp file +
// rename) and the previous save is kept as a backup, so a crash or power cut can't lose the pet.

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type PetData, type Settings } from '../shared/types';

export interface PastPet {
  name: string;
  species: string;
  variant: number;
  hatchedAt: number | null;
  activeSeconds: number;
  retiredAt: number;
}

export interface StoreData {
  v: 1;
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
    variant: Math.floor(num(p.variant, 0, 99, 0)),
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
  };
}

function parse(text: string): StoreData {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('not an object');
  const history = Array.isArray(raw.history) ? (raw.history as PastPet[]).filter((h) => h && typeof h === 'object').slice(-50) : [];
  return { v: 1, pet: sanitizePet(raw.pet), settings: sanitizeSettings(raw.settings), history };
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
    return { v: 1, pet: null, settings: { ...DEFAULT_SETTINGS }, history: [] };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    } catch {
      /* the backup is best effort */
    }
    fs.renameSync(tmp, this.file);
  }
}
