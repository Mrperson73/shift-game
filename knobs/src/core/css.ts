import type { Knob } from './types';
import { parseColor } from './colors';
import { inferRange } from './ranges';
import { applyEdits, type Edit, lineAt, lineStarts, lineText } from './text';
import type { JsCtx } from './js';

export interface CssSource {
  file: string;
  text: string;
  offset: number;
  /** Full text of `file`, for line numbers and context. */
  fileText: string;
}

const COLOR_PROPS = new Set([
  'color', 'background', 'background-color', 'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color', 'fill', 'stroke', 'caret-color', 'accent-color',
  'text-decoration-color', 'column-rule-color', 'stop-color', 'flood-color', 'lighting-color',
]);
const NUM_RE = /^(-?\d*\.?\d+)(px|em|rem|%|s|ms|deg|turn|vw|vh|vmin|vmax|fr|ch|ex|pt)?$/;

/** Blank out comments and string contents so braces/semicolons inside them are ignored (offsets preserved). */
function mask(text: string): string {
  return text.replace(/\/\*[\s\S]*?(\*\/|$)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) =>
    m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1],
  );
}

/**
 * Turn CSS custom properties and whole-value colors into knobs by rewriting them to
 * `var(--__kN)`; the runtime defines those variables on <html>, so updates are instant.
 */
export function instrumentCss(src: CssSource, ctx: JsCtx): string {
  const { text } = src;
  const masked = mask(text);
  const starts = lineStarts(src.fileText);
  const edits: Edit[] = [];
  const stack: string[] = [];
  let seg = 0;

  const decl = (s: number, e: number) => {
    const top = stack[stack.length - 1];
    if (top === undefined || top.startsWith('@')) return;
    const m = /^(\s*)(--[\w-]+|[a-zA-Z-]+)(\s*:\s*)([^]*?)\s*(!important)?\s*$/.exec(masked.slice(s, e));
    if (!m) return;
    const prop = m[2].toLowerCase();
    const vStart = s + m[1].length + m[2].length + m[3].length;
    const raw = text.slice(vStart, vStart + m[4].length);
    if (!raw || raw.includes('\n')) return;
    const custom = prop.startsWith('--');
    const color = parseColor(raw);
    let knob: Partial<Knob> | null = null;
    if (color && (custom || COLOR_PROPS.has(prop))) knob = { kind: 'color', group: 'color', value: raw };
    else if (custom) {
      const n = NUM_RE.exec(raw);
      if (n) knob = { kind: 'number', group: 'style', value: parseFloat(n[1]), unit: n[2] ?? '' };
    }
    if (!knob) return;
    const id = ctx.knobs.length;
    const selector = top.replace(/\s+/g, ' ').slice(0, 40);
    const label = custom ? prop : `${selector} › ${prop}`;
    const baseKey = `${src.file}|css|${selector}|${prop}`;
    const count = (ctx.keyCounts.get(baseKey) ?? 0) + 1;
    ctx.keyCounts.set(baseKey, count);
    const at = src.offset + vStart;
    const line = lineAt(starts, at);
    const full: Knob = {
      id, key: count > 1 ? `${baseKey}#${count}` : baseKey, label, scope: custom ? selector : '', group: knob.group!,
      kind: knob.kind!, live: 'live', value: knob.value!, raw, file: src.file, start: at, end: at + raw.length, line,
      context: lineText(src.fileText, starts, line), lang: 'css', unit: knob.unit,
    };
    if (full.kind === 'number') {
      const r = inferRange(full.value as number, prop, full.unit);
      if (full.unit === 'px' || full.unit === 'ms') r.step = Math.max(1, r.step);
      Object.assign(full, r);
    }
    ctx.knobs.push(full);
    edits.push({ start: vStart, end: vStart + raw.length, text: `var(--__k${id})` });
  };

  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') {
      stack.push(text.slice(seg, i).trim());
      seg = i + 1;
    } else if (c === '}') {
      decl(seg, i);
      stack.pop();
      seg = i + 1;
    } else if (c === ';') {
      decl(seg, i);
      seg = i + 1;
    }
  }
  return applyEdits(text, edits);
}
