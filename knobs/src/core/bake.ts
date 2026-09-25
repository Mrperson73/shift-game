import type { InstrumentResult, Knob, KnobValue } from './types';
import { fmtNum } from './ranges';
import { applyEdits, type Edit } from './text';

export interface BakeOutcome {
  /** New text for every file that changed. */
  files: Record<string, string>;
  applied: Knob[];
  skipped: { knob: Knob; reason: string }[];
}

export function formatLiteral(knob: Knob, v: KnobValue): string | null {
  if (knob.kind === 'boolean') return String(!!v);
  if (knob.kind === 'color') {
    const s = String(v);
    if (/["'`\\\n<>]/.test(s)) return null;
    if (knob.lang === 'css') return s;
    const q = knob.raw[0];
    return /["'`]/.test(q) ? q + s + q : s;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const s = fmtNum(v);
  if (knob.lang === 'css') return s + (knob.unit ?? '');
  if (v < 0 && !knob.negSafe && !knob.raw.startsWith('-')) return `(${s})`;
  return s;
}

/** Write tuned values back into the original sources. `values` is keyed by knob key. */
export function bake(res: InstrumentResult, values: Record<string, KnobValue>): BakeOutcome {
  const edits = new Map<string, Edit[]>();
  const applied: Knob[] = [];
  const skipped: BakeOutcome['skipped'] = [];
  for (const knob of res.knobs) {
    if (!(knob.key in values)) continue;
    const v = values[knob.key];
    if (v === knob.value) continue;
    const text = res.sources[knob.file];
    if (text === undefined || text.slice(knob.start, knob.end) !== knob.raw) {
      skipped.push({ knob, reason: 'the code changed' });
      continue;
    }
    const lit = formatLiteral(knob, v);
    if (lit === null) {
      skipped.push({ knob, reason: 'invalid value' });
      continue;
    }
    const list = edits.get(knob.file) ?? [];
    list.push({ start: knob.start, end: knob.end, text: lit });
    edits.set(knob.file, list);
    applied.push(knob);
  }
  const files: Record<string, string> = {};
  for (const [file, list] of edits) files[file] = applyEdits(res.sources[file], list);
  return { files, applied, skipped };
}
