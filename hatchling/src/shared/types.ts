// Data shared by the main process, the overlay (the pet) and the panel window.

import type { ThemeId } from './themes';

export type PatternKind = 'stripes' | 'spots' | 'bands' | 'rosettes' | 'speckles' | 'saddle' | 'none';
export const PATTERN_KINDS: PatternKind[] = ['stripes', 'bands', 'spots', 'rosettes', 'speckles', 'saddle', 'none'];

/** Colours the player picked by hand (overrides the species colour variant). */
export interface CustomColors {
  body: string;
  belly: string;
  pattern: string;
  accent: string;
  iris: string;
  pattern_kind: PatternKind;
}

export interface PetStats {
  pets: number;
  meals: number;
  naps: number;
  games: number;
  throws: number;
  pokes: number;
}

export interface PetData {
  v: 1;
  id: string;
  name: string;
  species: string;
  variant: number;
  /** Egg laid (ms since epoch). */
  bornAt: number;
  /** Hatched (ms since epoch), or null while still an egg. */
  hatchedAt: number | null;
  /** Seconds spent together while you were active at the PC. Drives growth. */
  activeSeconds: number;
  energy: number;
  happiness: number;
  hunger: number;
  stats: PetStats;
  /** Last time the app saved (ms since epoch). */
  lastSeen: number;
  /** Last horizontal position as a fraction of the screen width. */
  x: number | null;
  /** Hand-picked colours, or null to use the species variant. */
  colors: CustomColors | null;
  /** A rare shiny hatchling (about 1 in 20): special colours and sparkles. */
  shiny: boolean;
}

export type SizeSetting = 'S' | 'M' | 'L';
export type SpeechSetting = 'off' | 'emotes' | 'chatty';
export type ActivitySetting = 'calm' | 'normal' | 'lively';

export interface Settings {
  size: SizeSetting;
  sound: boolean;
  /** 0..1 */
  volume: number;
  speech: SpeechSetting;
  /** Walk and jump on top of windows, not just the taskbar. */
  explore: boolean;
  /** Hide while a full-screen app (a game, a video) is in front. */
  hideFullscreen: boolean;
  /** Electron display id, or null for the primary display. */
  display: number | null;
  startWithWindows: boolean;
  activity: ActivitySetting;
  /** React when The Isle, Brawlhalla or Minecraft starts and stops. */
  gameReactions: boolean;
  /** Colour theme of the panel window. */
  theme: ThemeId;
}

export const DEFAULT_SETTINGS: Settings = {
  size: 'M',
  sound: true,
  volume: 0.5,
  speech: 'emotes',
  explore: true,
  hideFullscreen: false,
  display: null,
  startWithWindows: true,
  activity: 'normal',
  gameReactions: true,
  theme: 'auto',
};

export const SIZE_SCALE: Record<SizeSetting, number> = { S: 0.8, M: 1.1, L: 1.5 };

export function newPet(species: string, variant: number, name: string, now: number, shiny = false): PetData {
  return {
    v: 1,
    id: Math.random().toString(36).slice(2, 10),
    name,
    species,
    variant,
    bornAt: now,
    hatchedAt: null,
    activeSeconds: 0,
    energy: 1,
    happiness: 0.7,
    hunger: 0.2,
    stats: { pets: 0, meals: 0, naps: 0, games: 0, throws: 0, pokes: 0 },
    lastSeen: now,
    x: null,
    colors: null,
    shiny,
  };
}

/** A pet you had before (kept when you hatch a new egg). */
export interface PastPet {
  name: string;
  species: string;
  variant: number;
  hatchedAt: number | null;
  activeSeconds: number;
  retiredAt: number;
  shiny?: boolean;
  colors?: CustomColors | null;
}

/** A platform the pet can stand on, in overlay coordinates (CSS pixels, y down). */
export interface Platform {
  id: string;
  x1: number;
  x2: number;
  y: number;
  /** Window handle for window tops; null for the taskbar/ground. */
  win: string | null;
  /** Left/top of the window, to carry the pet along when a window moves. */
  wx: number;
  wy: number;
}

/** A climbable window side, in overlay coordinates. */
export interface Wall {
  id: string;
  win: string;
  /** Which side of the window: the pet climbs on the outside of it. */
  side: 'left' | 'right';
  x: number;
  y1: number;
  y2: number;
  wx: number;
  wy: number;
}

/** What the main process tells the pet about you, every couple of seconds. */
export interface Activity {
  /** Seconds since your last keyboard/mouse input. */
  idle: number;
  locked: boolean;
  /** A known game that's running, e.g. "The Isle", or null. */
  game: string | null;
}

/** A species as sent to renderers (mods included). */
export interface SpeciesInfo {
  id: string;
  name: string;
  mod?: string;
}

export interface ModProblem {
  file: string;
  error: string;
}

export type Command =
  | { type: 'feed' }
  | { type: 'play' }
  | { type: 'call' }
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'rename'; name: string }
  | { type: 'hatch-now' }
  /** Change the pet's colours: a species variant (-1 = the shiny colours), or hand-picked colours. */
  | { type: 'recolor'; variant: number; colors: CustomColors | null }
  /** Ask the pet to do a trick right now. */
  | { type: 'trick'; name: TrickName }
  /** Save right away (the app is about to quit). */
  | { type: 'flush' };

export type TrickName = 'dance' | 'roar' | 'spin' | 'sit' | 'shake';
export const TRICKS: TrickName[] = ['dance', 'roar', 'spin', 'sit', 'shake'];

export interface OverlayInit {
  pet: PetData;
  settings: Settings;
  species: unknown[];
  /** Work area size in CSS pixels. */
  width: number;
  height: number;
  test: boolean;
  smoke: boolean;
  now: number;
}

export interface PanelInit {
  pet: PetData | null;
  settings: Settings;
  species: unknown[];
  problems: ModProblem[];
  displays: { id: number; label: string; primary: boolean }[];
  version: string;
  platform: string;
  modsDir: string;
  view: 'choose' | 'card' | 'settings';
  /** Past pets, oldest first. */
  history: PastPet[];
  /** Whether Windows is in dark mode (for the 'auto' theme). */
  systemDark: boolean;
}
