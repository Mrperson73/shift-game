export interface Edit { start: number; end: number; text: string }

/** Apply non-overlapping edits. Insertions (start === end) at a position go before a replacement at that position. */
export function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  let out = '';
  let pos = 0;
  for (const e of sorted) {
    if (e.start < pos) continue; // overlapping edit: skip defensively
    out += text.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + text.slice(pos);
}

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line number for an offset. */
export function lineAt(starts: number[], offset: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

export function lineText(text: string, starts: number[], line: number, max = 140): string {
  const s = starts[line - 1] ?? 0;
  const e = starts[line] ?? text.length;
  const t = text.slice(s, e).trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** POSIX-style path helpers for project-relative paths. */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function normalizePath(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}

/** Resolve a URL reference found in `fromFile` to a project-relative path, or null if external. */
export function resolveRef(fromFile: string, ref: string): string | null {
  const clean = ref.trim().split(/[?#]/)[0];
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return null;
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep raw */ }
  if (decoded.startsWith('/')) return normalizePath(decoded);
  const base = dirname(fromFile);
  return normalizePath(base ? `${base}/${decoded}` : decoded);
}

export function looksMinified(text: string): boolean {
  if (text.length < 20000) return false;
  const lines = text.split('\n').length;
  return text.length / lines > 400;
}
