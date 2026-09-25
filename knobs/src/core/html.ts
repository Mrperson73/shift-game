import { parse } from 'parse5';

export interface HtmlScript {
  kind: 'classic' | 'module' | 'babel';
  src?: string;
  start?: number;
  end?: number;
}

export interface HtmlScan {
  scripts: HtmlScript[];
  styles: { start: number; end: number }[];
  sheets: string[];
  injectAt: number;
  title: string;
}

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-javascript']);

/* eslint-disable @typescript-eslint/no-explicit-any */
export function scanHtml(html: string): HtmlScan {
  const doc: any = parse(html, { sourceCodeLocationInfo: true });
  const out: HtmlScan = { scripts: [], styles: [], sheets: [], injectAt: -1, title: '' };
  let head = -1;
  let htmlTag = -1;
  let doctype = -1;

  const inner = (node: any) => {
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag) return null;
    return { start: loc.startTag.endOffset as number, end: (loc.endTag ? loc.endTag.startOffset : loc.endOffset) as number };
  };

  const visit = (node: any) => {
    const tag: string | undefined = node.tagName;
    if (node.nodeName === '#documentType' && node.sourceCodeLocation) doctype = node.sourceCodeLocation.endOffset;
    if (tag) {
      const attr = (n: string) => node.attrs.find((a: any) => a.name === n)?.value as string | undefined;
      if (tag === 'head' && node.sourceCodeLocation?.startTag) head = node.sourceCodeLocation.startTag.endOffset;
      if (tag === 'html' && node.sourceCodeLocation?.startTag) htmlTag = node.sourceCodeLocation.startTag.endOffset;
      if (tag === 'title' && !out.title) out.title = (node.childNodes ?? []).map((c: any) => c.value ?? '').join('').trim();
      if (tag === 'script') {
        const type = (attr('type') ?? '').trim().toLowerCase();
        let kind: HtmlScript['kind'] | null = null;
        if (JS_TYPES.has(type)) kind = 'classic';
        else if (type === 'module') kind = 'module';
        else if (type === 'text/babel' || type === 'text/jsx') kind = 'babel';
        const src = attr('src');
        if (kind && src !== undefined) out.scripts.push({ kind, src });
        else if (kind) {
          const r = inner(node);
          if (r) out.scripts.push({ kind, ...r });
        }
      } else if (tag === 'style') {
        const r = inner(node);
        if (r) out.styles.push(r);
      } else if (tag === 'link') {
        const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/);
        const href = attr('href');
        if (rel.includes('stylesheet') && href) out.sheets.push(href);
      }
      if (tag === 'template') return;
    }
    for (const c of node.childNodes ?? []) visit(c);
  };
  visit(doc);
  out.injectAt = head >= 0 ? head : htmlTag >= 0 ? htmlTag : doctype >= 0 ? doctype : 0;
  return out;
}
