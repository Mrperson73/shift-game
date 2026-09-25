// The APIs the preload scripts expose to the two renderers.

import type { SpeciesDef } from '../pet/species';
import type { Activity, Command, ModProblem, OverlayInit, PanelInit, PastPet, PetData, Platform, Settings, Wall } from './types';

export interface WorldUpdate {
  width: number;
  height: number;
  platforms: Platform[];
  walls: Wall[];
}

export interface OverlayApi {
  init(): Promise<OverlayInit>;
  onWorld(cb: (w: WorldUpdate) => void): void;
  onCursor(cb: (p: { x: number; y: number } | null) => void): void;
  onActivity(cb: (a: Activity) => void): void;
  onHidden(cb: (hidden: boolean) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onCommand(cb: (c: Command) => void): void;
  onSpecies(cb: (list: SpeciesDef[]) => void): void;
  onPet(cb: (p: PetData) => void): void;
  setCapture(on: boolean): void;
  save(p: PetData): void;
  /** Tells the main process what's going on (tray tooltip, notifications, how often to poll). */
  notify(e: { type: 'hatched' | 'grew' | 'status'; text?: string; asleep?: boolean }): void;
  openCard(): void;
  menu(): void;
  error(msg: string): void;
  smoke(report: Record<string, unknown>): void;
}

export interface PanelUpdate {
  pet: PetData | null;
  settings: Settings;
  species: SpeciesDef[];
  problems: ModProblem[];
  history: PastPet[];
  systemDark: boolean;
}

export interface PanelApi {
  init(): Promise<PanelInit>;
  hatch(o: { species: string; variant: number; name: string; startWithWindows: boolean }): Promise<void>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  command(c: Command): void;
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
