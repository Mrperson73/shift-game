import type { InstrumentOptions, InstrumentResult } from './types';
import { scanHtml } from './html';
import { JsInstrumenter, type JsCtx, type JsSource } from './js';
import { instrumentCss } from './css';
import { applyEdits, type Edit, lineAt, lineStarts, looksMinified, resolveRef } from './text';

export const RUNTIME_PATH = '/__knobs__/runtime.js';

const LIBRARY_RE = /(^|\/)(vendor|vendors|node_modules|third[-_]?party)\/|(^|\/)(three|phaser|pixi|matter|p5|howler|babylon|kaboom|kaplay|jquery|lodash|gsap|tone|cannon|ammo|planck|box2d|excalibur|melonjs|playcanvas|tween|stats|dat\.gui|lil-gui)([.-][\w.-]*)?\.m?js$|\.min\.m?js$/i;

/** Engine/library files are huge and not the user's tuning surface: serve them untouched. */
export function isLibrary(file: string, text: string): boolean {
  return LIBRARY_RE.test(file) || text.length > 400_000;
}
export const DEFAULT_OPTIONS: InstrumentOptions = { codeNumbers: true, maxKnobs: 1500 };

/**
 * Analyze an HTML game (and the local scripts/stylesheets it references), turning tunable
 * literals into knobs. Line numbers are preserved in every rewritten file so error reports
 * point at the user's real source.
 */
export function instrumentProject(
  entry: string,
  read: (path: string) => string | null,
  options: Partial<InstrumentOptions> = {},
): InstrumentResult {
  const html = read(entry);
  if (html == null) throw new Error(`Can't read ${entry}`);
  const ctx: JsCtx = { opts: { ...DEFAULT_OPTIONS, ...options }, knobs: [], sites: [], warnings: [], keyCounts: new Map() };
  const scan = scanHtml(html);
  const starts = lineStarts(html);
  const sources: Record<string, string> = { [entry]: html };
  const files: Record<string, string> = {};

  const loadJs = (file: string, module: boolean): JsSource | null => {
    const text = read(file);
    if (text == null) {
      ctx.warnings.push(`Missing file: ${file}`);
      return null;
    }
    if (looksMinified(text) || isLibrary(file, text)) return null;
    sources[file] = text;
    return { file, text, offset: 0, lineOffset: 0, module, jsx: false, external: true };
  };

  const jsSources: JsSource[] = [];
  const inline = new Map<JsSource, { start: number; end: number }>();
  for (const s of scan.scripts) {
    const module = s.kind === 'module';
    if (s.src !== undefined) {
      const file = resolveRef(entry, s.src);
      if (!file || s.kind === 'babel' || !/\.(m?js)$/i.test(file) || jsSources.some((j) => j.file === file)) continue;
      const src = loadJs(file, module);
      if (src) jsSources.push(src);
    } else if (s.start !== undefined && s.end !== undefined) {
      if (looksMinified(html.slice(s.start, s.end))) continue;
      const src: JsSource = {
        file: entry, text: html.slice(s.start, s.end), offset: s.start, lineOffset: lineAt(starts, s.start) - 1,
        module, jsx: s.kind === 'babel', external: false,
      };
      jsSources.push(src);
      inline.set(src, { start: s.start, end: s.end });
    }
  }

  const js = new JsInstrumenter(ctx).run(jsSources, (file) => (/\.m?js$/i.test(file) ? loadJs(file, true) : null));

  const htmlEdits: Edit[] = [];
  for (const [src, out] of js) {
    const range = inline.get(src);
    if (range) htmlEdits.push({ start: range.start, end: range.end, text: out });
    else files[src.file] = out;
  }
  for (const st of scan.styles) {
    const out = instrumentCss({ file: entry, text: html.slice(st.start, st.end), offset: st.start, fileText: html }, ctx);
    htmlEdits.push({ start: st.start, end: st.end, text: out });
  }
  for (const href of scan.sheets) {
    const file = resolveRef(entry, href);
    if (!file || !/\.css$/i.test(file) || files[file] !== undefined) continue;
    const text = read(file);
    if (text == null) continue;
    sources[file] = text;
    files[file] = instrumentCss({ file, text, offset: 0, fileText: text }, ctx);
  }
  htmlEdits.push({ start: scan.injectAt, end: scan.injectAt, text: `<script src="${RUNTIME_PATH}"></script>` });
  files[entry] = applyEdits(html, htmlEdits);

  return { entry, title: scan.title, knobs: ctx.knobs, sites: ctx.sites, files, sources, warnings: ctx.warnings };
}

/**
 * Like instrumentProject, but never throws for a readable game: if analysis itself fails,
 * the game is served with just the runtime (console, errors, timing) and no knobs.
 */
export function safeInstrumentProject(
  entry: string,
  read: (path: string) => string | null,
  options: Partial<InstrumentOptions> = {},
): InstrumentResult {
  try {
    return instrumentProject(entry, read, options);
  } catch (e) {
    const html = read(entry);
    if (html == null) throw e;
    let files: Record<string, string>;
    let title = '';
    try {
      const scan = scanHtml(html);
      title = scan.title;
      files = { [entry]: applyEdits(html, [{ start: scan.injectAt, end: scan.injectAt, text: `<script src="${RUNTIME_PATH}"></script>` }]) };
    } catch {
      files = { [entry]: html };
    }
    const msg = `Knobs couldn't analyze this game (${(e as Error).message}). It runs normally, but without knobs.`;
    return { entry, title, knobs: [], sites: [], files, sources: { [entry]: html }, warnings: [msg] };
  }
}
