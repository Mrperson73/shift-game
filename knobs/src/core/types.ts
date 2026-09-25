export type KnobKind = 'number' | 'color' | 'boolean';
/** UI grouping: named tunables, starting state, colors, CSS numbers, anonymous numbers in code. */
export type KnobGroup = 'tunable' | 'start' | 'color' | 'style' | 'code';
/** live: applies instantly. restart: applies after a restart. spawn: applies to newly created objects. */
export type Liveness = 'live' | 'restart' | 'spawn';
export type KnobValue = number | string | boolean;

export interface Knob {
  id: number;
  /** Stable identity across reloads (file + group + scope + label + occurrence). */
  key: string;
  label: string;
  scope: string;
  group: KnobGroup;
  kind: KnobKind;
  live: Liveness;
  /** Value as written in the source. */
  value: KnobValue;
  /** Exact source text of the literal (used to verify before baking). */
  raw: string;
  file: string;
  start: number;
  end: number;
  line: number;
  /** Trimmed source line, for tooltips and reports. */
  context: string;
  lang: 'js' | 'css';
  /** A negative number can replace the literal without parentheses. */
  negSafe?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export type SitePath = (string | number)[];
/** An object literal registered for live mutation: which knob sets which property path. */
export type Site = [knobId: number, path: SitePath][];

export interface InstrumentOptions {
  /** Expose anonymous numbers inside code (not just named constants/config). */
  codeNumbers: boolean;
  maxKnobs: number;
}

export interface InstrumentResult {
  entry: string;
  title: string;
  knobs: Knob[];
  sites: Site[];
  /** Instrumented output by relative path. */
  files: Record<string, string>;
  /** Original text by relative path (only files that were analyzed). */
  sources: Record<string, string>;
  warnings: string[];
}
