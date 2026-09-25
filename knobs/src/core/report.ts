import type { Knob, KnobValue } from './types';
import { fmtNum } from './ranges';

export interface StackFrame { fn: string; file: string; line: number; col: number }

/** knobs-game://<host>/path/file.js → path/file.js ; runtime frames → null */
export function gameFile(url: string): string | null {
  const m = /^knobs-game:\/\/[^/]+\/(.*)$/.exec(url);
  if (!m) return null;
  const f = m[1].split(/[?#]/)[0];
  if (f.startsWith('__knobs__/')) return null;
  try { return decodeURIComponent(f); } catch { return f; }
}

export function parseStack(stack: string | undefined): StackFrame[] {
  const out: StackFrame[] = [];
  for (const line of (stack ?? '').split('\n')) {
    const m = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const file = gameFile(m[2]);
    if (file === null) continue;
    out.push({ fn: m[1] ?? '', file, line: +m[3], col: +m[4] });
  }
  return out;
}

/** Replace game URLs in a stack with project-relative paths and drop Knobs' own frames. */
export function cleanStack(stack: string | undefined): string {
  return (stack ?? '')
    .split('\n')
    .filter((l) => !l.includes('/__knobs__/'))
    .map((l) => l.replace(/knobs-game:\/\/[^/]+\//g, ''))
    .join('\n')
    .trim();
}

export function snippet(text: string, line: number, radius = 3): string {
  const lines = text.split('\n');
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const w = String(to).length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${i === line ? '>' : ' '} ${String(i).padStart(w)} | ${lines[i - 1].replace(/\r$/, '').replace(/\t/g, '  ')}`);
  return out.join('\n');
}

export function fmtValue(v: KnobValue): string {
  return typeof v === 'number' ? fmtNum(v) : String(v);
}

export function knobName(k: Knob): string {
  const label = k.label.includes('·') ? `\`${k.label.replace('·', fmtValue(k.value))}\`` : k.label;
  return k.scope ? `${label} (in ${k.scope})` : label;
}

export interface Tweak { knob: Knob; value: KnobValue }

export function tweaksReport(tweaks: Tweak[]): string {
  if (!tweaks.length) return '';
  const lines = tweaks.map(({ knob, value }) => `- ${knobName(knob)} — ${knob.file}:${knob.line}: ${fmtValue(knob.value)} → ${fmtValue(value)}`);
  return `I tuned these values while playtesting. Please use them in future versions of the code:\n${lines.join('\n')}`;
}

export interface ErrorInfo {
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  count: number;
  at: number;
}

export function errorReport(e: ErrorInfo, sources: Record<string, string>, tweaks: Tweak[]): string {
  const parts: string[] = [];
  const frames = parseStack(e.stack);
  const top = frames[0] ?? (e.file && e.line ? { fn: '', file: e.file, line: e.line, col: 0 } : undefined);
  parts.push('My game throws an error:', '', '```', e.message);
  const stack = cleanStack(e.stack)
    .split('\n')
    .filter((l) => /^\s*at /.test(l))
    .slice(0, 6)
    .join('\n');
  if (stack) parts.push(stack);
  parts.push('```');
  if (top && sources[top.file] !== undefined) {
    parts.push('', `${top.file}, around line ${top.line}:`, '```', snippet(sources[top.file], top.line), '```');
  }
  const when = `${(e.at / 1000).toFixed(1)}s after the game started`;
  parts.push('', e.count > 1 ? `It happened ${e.count} times, first ${when}.` : `It happened ${when}.`);
  if (tweaks.length) {
    parts.push(`Note: while testing I had changed some values: ${tweaks.map(({ knob, value }) => `${knob.label.replace(' = ·', '')} = ${fmtValue(value)} (source: ${fmtValue(knob.value)})`).join(', ')}.`);
  }
  parts.push('', 'Please find and fix the cause.');
  return parts.join('\n');
}
