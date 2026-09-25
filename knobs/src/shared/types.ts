import type { Knob, KnobValue } from '../core/types';

export interface GameInfo {
  id: string;
  name: string;
  /** What the user opened: an .html file or a folder. */
  path: string;
  /** Absolute project root that files are served from. */
  root: string;
  /** Entry HTML, relative to root. */
  entry: string;
  kind: 'file' | 'folder';
  pasted: boolean;
}

export interface KnobState {
  knobs: Knob[];
  /** Current value per knob id. */
  values: KnobValue[];
  pinned: string[];
  ranges: Record<string, [number, number]>;
  warnings: string[];
  /** Labels of tweaks dropped because the code's value changed underneath them. */
  dropped: string[];
}

export type LoadReason = 'open' | 'change' | 'paste' | 'restore' | 'bake' | 'settings';

export interface GamePayload {
  game: GameInfo;
  url: string;
  state: KnobState;
  reason: LoadReason;
  /** Changed file that triggered a reload. */
  file?: string;
}

export interface RecentGame {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  thumb?: number;
}

export interface Settings {
  autoRestart: boolean;
  codeNumbers: boolean;
}

export interface VersionInfo {
  id: string;
  ts: number;
  reason: string;
  lines: number;
  bytes: number;
  files: string[];
  current?: boolean;
}

export interface BakeResult {
  applied: { label: string; file: string; line: number }[];
  skipped: { label: string; reason: string }[];
}

export interface InitInfo {
  recents: RecentGame[];
  settings: Settings;
  platform: string;
  version: string;
  gamesDir: string;
  openAtStart: string | null;
}

export type Shortcut = 'help' | 'restart' | 'pause' | 'step' | 'slower' | 'faster' | 'focus' | 'palette';

export interface Rect { x: number; y: number; width: number; height: number }

export interface KnobsApi {
  init(): Promise<InitInfo>;
  open(path: string): Promise<GamePayload>;
  openDialog(kind: 'file' | 'folder'): Promise<GamePayload | null>;
  openDemo(): Promise<GamePayload>;
  paste(html: string): Promise<{ payload: GamePayload; updated: boolean; undo: string | null }>;
  close(): Promise<void>;
  setKnobs(values: [string, KnobValue][]): void;
  resetKnobs(keys: string[] | null): Promise<KnobState>;
  setPinned(key: string, pinned: boolean): void;
  setRange(key: string, range: [number, number] | null): void;
  restart(scale: number): Promise<string>;
  bake(): Promise<{ result: BakeResult; payload: GamePayload; reload: boolean }>;
  source(file: string): Promise<string | null>;
  versions(): Promise<VersionInfo[]>;
  previewVersion(id: string): Promise<{ url: string; state: KnobState } | null>;
  restoreVersion(id: string): Promise<void>;
  diffVersion(id: string): Promise<string>;
  captureThumb(rect: Rect): void;
  reveal(): void;
  openGamesFolder(): void;
  openExternal(url: string): void;
  removeRecent(id: string): Promise<RecentGame[]>;
  recents(): Promise<RecentGame[]>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  toggleDevTools(): void;
  setFullscreen(on: boolean): void;
  pathForFile(file: File): string;
  on(channel: 'reloaded' | 'opened', cb: (p: GamePayload) => void): () => void;
  on(channel: 'shortcut', cb: (s: Shortcut) => void): () => void;
  on(channel: 'error', cb: (message: string) => void): () => void;
  on(channel: 'recents', cb: (list: RecentGame[]) => void): () => void;
}
