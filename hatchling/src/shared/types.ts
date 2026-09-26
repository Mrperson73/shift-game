// Data shared by the main process, the overlay (the pet) and the panel window.

import type { Stage } from '../pet/growth';
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
  /** Growth progress in seconds (active time × growth speed, plus treats or a picked stage). Drives growth. */
  activeSeconds: number;
  /** Real seconds spent together while you were active at the PC (what "together" and time badges show). */
  togetherSeconds: number;
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

/** A dino in your roster ("My Dinos"): out on the desktop or put away. */
export interface Dino {
  pet: PetData;
  /** The monitor it lives on (Electron display id), or null for the main one. */
  display: number | null;
}

/** At most this many dinos are out on the desktop at once (each one is drawn live). */
export const OUT_MAX = 4;
/** At most this many dinos in the roster. */
export const ROSTER_MAX = 24;

export type SizeSetting = 'S' | 'M' | 'L';
export type SpeechSetting = 'off' | 'emotes' | 'chatty';
export type ActivitySetting = 'calm' | 'normal' | 'lively';
/** Where dinos live: on every monitor (they walk from one to the next), or only on the main one. */
export type MonitorSetting = 'all' | 'primary';
/** How many times faster than normal a pet grows (normal: about 60 active hours to adult).
 * 0 = paused: it stays at the stage it's at. */
export type GrowthSpeed = 0 | 1 | 2 | 5 | 10;
export const GROWTH_SPEEDS: GrowthSpeed[] = [0, 1, 2, 5, 10];
/** Frame rate budget: 'saver' halves most frame rates, 'smooth' keeps everything at 60 fps. */
export type PowerSetting = 'saver' | 'balanced' | 'smooth';

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
  /** Every monitor, or only the main one. */
  monitors: MonitorSetting;
  startWithWindows: boolean;
  activity: ActivitySetting;
  /** React when The Isle, Brawlhalla or Minecraft starts and stops. */
  gameReactions: boolean;
  /** Colour theme of the panel window. */
  theme: ThemeId;
  /** React to videos you watch (YouTube, Twitch, Netflix, video players...). */
  videoReactions: boolean;
  /** Growth speed multiplier. */
  growthSpeed: GrowthSpeed;
  /** Smoothness versus power use. */
  power: PowerSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  size: 'M',
  sound: true,
  volume: 0.5,
  speech: 'emotes',
  explore: true,
  hideFullscreen: false,
  monitors: 'all',
  startWithWindows: true,
  activity: 'normal',
  gameReactions: true,
  theme: 'auto',
  videoReactions: true,
  growthSpeed: 1,
  power: 'balanced',
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
    togetherSeconds: 0,
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

/** A pet you had before (kept when you release it). */
export interface PastPet {
  name: string;
  species: string;
  variant: number;
  hatchedAt: number | null;
  activeSeconds: number;
  /** Missing in saves from before 1.2.2. */
  togetherSeconds?: number;
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
  /** A game that's running, e.g. "The Isle", or null. */
  game: string | null;
  /** A video you're watching (a video site in the browser or a video player), or null. */
  video?: { site: string; title: string } | null;
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
  /** A growth treat: a golden snack that makes it grow a bit right away. */
  | { type: 'treat' }
  /** Jump to the start of a growth stage (bigger or smaller). */
  | { type: 'set-stage'; stage: Stage }
  /** Put a toy out to play with. */
  | { type: 'toy'; toy: ToyKind }
  /** Its species' signature move (stomp, head-butt, tail swipe, fly...). */
  | { type: 'special' }
  /** Save right away (the app is about to quit). */
  | { type: 'flush' };

/** Every dino that's out (a `PetCommand` target). */
export const ALL_PETS = '*';

/** A command for one dino (`pet`: its id), for all of them (ALL_PETS), or, without `pet`, for the
 * selected one (from the panel and tray) or every dino on that monitor (to an overlay). */
export type PetCommand = Command & { pet?: string };

export type TrickName = 'dance' | 'roar' | 'spin' | 'sit' | 'shake' | 'jump' | 'bow' | 'playdead';
export const TRICKS: TrickName[] = ['dance', 'roar', 'spin', 'sit', 'shake', 'jump', 'bow', 'playdead'];

/** Toys you can put out ('ball' is the same as the play command). */
export type ToyKind = 'ball' | 'bubbles' | 'bone' | 'duck' | 'laser' | 'puddle';
export const TOYS: ToyKind[] = ['ball', 'bubbles', 'bone', 'duck', 'laser', 'puddle'];

/** How a dino shows up on a monitor. */
export type Arrival =
  /** Walks in from a screen edge (it walked off the monitor on that side); `y` is where its feet were. */
  | { kind: 'edge'; side: 'left' | 'right'; y: number; ground: boolean }
  /** Dropped here from another monitor: it falls from this point (overlay coordinates). */
  | { kind: 'drop'; x: number; y: number }
  /** Brought out from My Dinos: it pops in where it was last. */
  | { kind: 'poof' };

/** A dino for an overlay to host, and how it arrives (none: it's just there, like at startup). */
export interface HostedPet {
  pet: PetData;
  arrive?: Arrival;
}

export interface OverlayInit {
  /** The dinos on this monitor. */
  pets: HostedPet[];
  settings: Settings;
  species: unknown[];
  /** The monitor (Electron display id). */
  display: number;
  /** Work area size in CSS pixels. */
  width: number;
  height: number;
  test: boolean;
  smoke: boolean;
  now: number;
}

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
}

export interface PanelInit {
  /** The selected dino (the one the card is for). */
  pet: PetData | null;
  /** Every dino, in the order they hatched. */
  roster: Dino[];
  /** Ids of the dinos out on the desktop. */
  out: string[];
  selected: string | null;
  settings: Settings;
  species: unknown[];
  problems: ModProblem[];
  displays: DisplayInfo[];
  version: string;
  platform: string;
  modsDir: string;
  view: 'choose' | 'card' | 'dinos' | 'settings';
  /** Past pets, oldest first. */
  history: PastPet[];
  /** Whether Windows is in dark mode (for the 'auto' theme). */
  systemDark: boolean;
}
