// The APIs the preload scripts expose to the two renderers.

import type { SpeciesDef } from '../pet/species';
import type { EdgeKind } from '../sim/pet';
import type { Activity, DisplayInfo, Dino, HostedPet, ModProblem, OverlayInit, PanelInit, PastPet, PetCommand, PetData, Platform, Settings, Wall } from './types';

/** A rectangle in an overlay's coordinates (CSS pixels). */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldUpdate {
  width: number;
  height: number;
  platforms: Platform[];
  walls: Wall[];
  /** Whether the left and right screen edges lead to the next monitor ('exit') or not ('wall'). */
  edges: { left: EdgeKind; right: EdgeKind };
  /** The other monitors' work areas in this overlay's coordinates: a dino dropped there moves over. */
  others: Area[];
}

/** A dino leaving an overlay, with its latest data. */
export type Leave =
  /** It walked off the `side` edge towards the monitor there; `y` is where its feet were. */
  | { how: 'exit'; pet: PetData; side: 'left' | 'right'; y: number; ground: boolean }
  /** It was dropped at (x, y), outside this monitor (overlay coordinates). */
  | { how: 'drop'; pet: PetData; x: number; y: number }
  /** The main process asked for it (put away, released, or moving to another monitor). */
  | { how: 'removed'; pet: PetData };

export interface OverlayApi {
  init(): Promise<OverlayInit>;
  /** Listening for updates now (sent once, right after init). */
  ready(): void;
  onWorld(cb: (w: WorldUpdate) => void): void;
  onCursor(cb: (p: { x: number; y: number } | null) => void): void;
  onActivity(cb: (a: Activity) => void): void;
  onHidden(cb: (hidden: boolean) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onCommand(cb: (c: PetCommand) => void): void;
  onSpecies(cb: (list: SpeciesDef[]) => void): void;
  /** A dino comes to this monitor (hatched, brought out, or from another monitor). */
  onAdd(cb: (p: HostedPet) => void): void;
  /** A dino should leave this monitor: answer with leave({ how: 'removed' }). */
  onRemove(cb: (id: string) => void): void;
  setCapture(on: boolean): void;
  save(p: PetData): void;
  leave(l: Leave): void;
  /** Tells the main process what's going on (tray tooltip, notifications, how often to poll). */
  notify(e: { type: 'hatched' | 'grew' | 'status'; pet: string; text?: string; asleep?: boolean }): void;
  openCard(id?: string): void;
  menu(id?: string): void;
  error(msg: string): void;
  smoke(report: Record<string, unknown>): void;
}

/** Something to do with a dino in the roster. */
export type DinoAction =
  | { type: 'select' | 'out' | 'away' | 'release'; id: string }
  /** Move it to another monitor. */
  | { type: 'move'; id: string; display: number };

export interface PanelUpdate {
  /** The selected dino. */
  pet: PetData | null;
  roster: Dino[];
  out: string[];
  selected: string | null;
  settings: Settings;
  species: SpeciesDef[];
  problems: ModProblem[];
  history: PastPet[];
  displays: DisplayInfo[];
  systemDark: boolean;
}

export interface PanelApi {
  init(): Promise<PanelInit>;
  hatch(o: { species: string; variant: number; name: string; startWithWindows: boolean }): Promise<void>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  command(c: PetCommand): void;
  /** Roster actions; resolves to a message when it couldn't be done (e.g. too many dinos out). */
  dino(a: DinoAction): Promise<string | null>;
  newEgg(): Promise<void>;
  openModsFolder(): void;
  openExternal(url: string): void;
  close(): void;
  /** Colour the window's title bar (and its minimise/close buttons) to match the theme. */
  titleBar(o: { color: string; symbolColor: string }): void;
  onUpdate(cb: (u: PanelUpdate) => void): void;
  onView(cb: (view: PanelInit['view']) => void): void;
}

declare global {
  interface Window {
    hatch: OverlayApi;
    panel: PanelApi;
  }
}
