import * as espree from 'espree';
import { analyze } from 'eslint-scope';
import { KEYS } from 'eslint-visitor-keys';
import type { InstrumentOptions, Knob, KnobGroup, KnobKind, KnobValue, Liveness, Site, SitePath } from './types';
import { isColorLiteral, isNamedColor } from './colors';
import { inferRange } from './ranges';
import { applyEdits, type Edit, lineAt, lineStarts, resolveRef } from './text';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
type Ref = any;
type Var = any;

const VK = KEYS as unknown as Record<string, readonly string[]>;

export interface JsSource {
  file: string;
  text: string;
  /** Offset of `text` inside `file` (non-zero for inline scripts). */
  offset: number;
  /** Lines in `file` before `text` starts. */
  lineOffset: number;
  module: boolean;
  jsx: boolean;
  /** A standalone .js file: gets a one-line prelude so it also runs outside the page (workers). */
  external: boolean;
}

export interface JsCtx {
  opts: InstrumentOptions;
  knobs: Knob[];
  sites: Site[];
  warnings: string[];
  keyCounts: Map<string, number>;
}

const PARENT = Symbol('parent');

interface Parsed {
  src: JsSource;
  ast: N;
  sm: any;
  refByIdent: Map<N, Ref>;
  edits: Edit[];
  lines: string[];
  siteOf: Map<N, number>;
  constByVar: Map<Var, number>;
  memberWrites: Map<string, number>;
  literals: N[];
  usedIds: Set<number>;
  starts: number[];
}

interface Spec {
  group: KnobGroup;
  label: string;
  scope: string;
  live: Liveness;
  /** Named things (constants, config fields) are always shown; anonymous code numbers are filtered. */
  named: boolean;
  /** Register the owning instance: `__KP(this, prop, id)`. */
  kp?: string;
  site?: { root: N; path: SitePath };
  constVar?: Var;
  constRefs?: { p: Parsed; r: Ref }[];
  constInFn?: boolean;
}

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const STATE_RE =
  /^(x|y|z|vx|vy|vz|dx|dy|dz|pos|position|vel|velocity|angle|rotation|rot|t|time|timer|elapsed|frame|frames|tick|ticks|age|life|alive|dead|dying|active|visible|state|mode|id|index|idx|i|j|k|n|count|score|combo|health|hp|grounded|onground|jumping|falling|dir|direction|facing|cooldown|shake|invulnerable|invuln|flash|hit|lives|coins|level|wave)$/i;
const COLOR_CTX = /(color|colour|fill|stroke|background|bg|tint|shadow|palette|theme|hue|glow|outline)/i;
const EXCLUDED_CALLS = new Set([
  'slice', 'splice', 'substr', 'substring', 'charAt', 'charCodeAt', 'codePointAt', 'toFixed', 'toPrecision',
  'toString', 'padStart', 'padEnd', 'at', 'repeat', 'indexOf', 'lastIndexOf', 'includes', 'fromCharCode',
  'fromCodePoint', 'toLocaleString', 'subarray', 'getItem', 'setItem', 'removeItem', 'item', 'key', 'parseInt',
  'parseFloat', 'log', 'warn', 'error', 'info', 'debug', 'assert', 'trace', 'table', 'time', 'timeEnd',
]);
const KEYISH = new Set(['keyCode', 'which', 'button', 'buttons', 'charCode', 'location', 'readyState', 'status', 'nodeType', 'code', 'key', 'type', 'length']);
const NEG_SAFE_PARENTS = new Set([
  'VariableDeclarator', 'Property', 'AssignmentExpression', 'ArrayExpression', 'CallExpression', 'NewExpression',
  'ReturnStatement', 'AssignmentPattern', 'PropertyDefinition', 'ConditionalExpression', 'SequenceExpression',
  'TemplateLiteral', 'JSXExpressionContainer', 'SpreadElement',
]);

const compact = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

function around(s: string, max = 48): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const i = t.indexOf('·');
  const start = Math.max(0, Math.min(i - 22, t.length - max));
  const end = Math.min(t.length, start + max);
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
}

function fmtPath(path: SitePath): string {
  return path
    .map((k) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`))
    .join('');
}

const lastSeg = (label: string) => label.replace(/\s*[-+*/%]?=\s*·$/, '').split(/[.[\]"'\s]+/).filter(Boolean).pop() ?? label;

function walk(root: N, visit: (node: N, parent: N | null) => void) {
  const stack: [N, N | null][] = [[root, null]];
  while (stack.length) {
    const [node, par] = stack.pop()!;
    visit(node, par);
    const keys = VK[node.type] ?? Object.keys(node).filter((k) => k !== 'loc' && k !== 'range' && k !== 'parent');
    for (let i = keys.length - 1; i >= 0; i--) {
      const child = node[keys[i]];
      if (Array.isArray(child)) {
        for (let j = child.length - 1; j >= 0; j--) if (child[j] && typeof child[j].type === 'string') stack.push([child[j], node]);
      } else if (child && typeof child.type === 'string') stack.push([child, node]);
    }
  }
}

const inFunction = (scope: any) => {
  const vs = scope?.variableScope;
  return !!vs && vs.type !== 'global' && vs.type !== 'module';
};

export class JsInstrumenter {
  private parsed: Parsed[] = [];
  private gDecls = new Map<string, { p: Parsed; v: Var }[]>();
  private gThrough = new Map<string, { p: Parsed; r: Ref }[]>();

  constructor(private ctx: JsCtx) {}

  /** Instrument `sources`; `load` supplies modules discovered through static imports. */
  run(sources: JsSource[], load: (file: string) => JsSource | null): Map<JsSource, string> {
    const queue = [...sources];
    const seen = new Set(sources.filter((s) => s.external).map((s) => s.file));
    while (queue.length) {
      const src = queue.shift()!;
      const p = this.parse(src);
      if (!p) continue;
      this.parsed.push(p);
      if (!src.module) continue;
      for (const spec of moduleSpecifiers(p.ast)) {
        const file = resolveRef(src.file, spec);
        if (!file || seen.has(file)) continue;
        seen.add(file);
        const dep = load(file);
        if (dep) queue.push(dep);
      }
    }
    for (const p of this.parsed) {
      if (p.src.module) continue;
      for (const v of p.sm.globalScope.variables) push(this.gDecls, v.name, { p, v });
      for (const r of p.sm.globalScope.through) push(this.gThrough, r.identifier.name, { p, r });
    }
    for (const p of this.parsed) this.classifyAll(p);
    this.linkModules();

    const out = new Map<JsSource, string>();
    for (const p of this.parsed) {
      if (p.src.external && p.usedIds.size) p.edits.push(this.prelude(p));
      out.set(p.src, applyEdits(p.src.text, p.edits));
    }
    return out;
  }

  private parse(src: JsSource): Parsed | null {
    const sourceType = src.module ? 'module' : 'script';
    const where = src.lineOffset ? `${src.file} (script at line ${src.lineOffset + 1})` : src.file;
    let ast: N;
    let sm: any;
    try {
      ast = espree.parse(src.text, { ecmaVersion: 'latest', sourceType, range: true, loc: false, ecmaFeatures: { jsx: src.jsx } } as any);
      // Custom visitor keys make esrecurse copy its key table for every pattern it visits (slow on big
      // files); unknown node types are still handled by the 'iteration' fallback, so only pass them for JSX.
      sm = analyze(ast, { ecmaVersion: 2022, sourceType, childVisitorKeys: src.jsx ? VK : undefined, fallback: 'iteration', jsx: src.jsx } as any);
    } catch (e: any) {
      this.ctx.warnings.push(`${where}: couldn't read this script (${e.message}); it runs untouched, without knobs.`);
      return null;
    }
    const p: Parsed = {
      src, ast, sm, refByIdent: new Map(), edits: [], lines: src.text.split('\n'), starts: lineStarts(src.text),
      siteOf: new Map(), constByVar: new Map(), memberWrites: new Map(), literals: [], usedIds: new Set(),
    };
    for (const s of sm.scopes) for (const r of s.references) p.refByIdent.set(r.identifier, r);
    walk(ast, (node, par) => {
      if (par) node[PARENT] = par;
      if (node.type === 'Literal') {
        const t = typeof node.value;
        if (t === 'number' || t === 'boolean' || t === 'string') p.literals.push(node);
      } else if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        p.literals.push(node);
      } else if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
        const target = node.type === 'AssignmentExpression' ? node.left : node.argument;
        if (target.type === 'MemberExpression' && !target.computed && target.property.name) {
          const n = target.property.name;
          p.memberWrites.set(n, (p.memberWrites.get(n) ?? 0) + 1);
        }
      }
    });
    p.literals.sort((a, b) => a.range[0] - b.range[0]);
    return p;
  }

  private P = (_p: Parsed, n: N): N | undefined => n[PARENT];

  private classifyAll(p: Parsed) {
    for (const lit of p.literals) {
      let node = lit;
      let value: KnobValue;
      let kind: KnobKind;
      if (lit.type === 'TemplateLiteral') {
        value = lit.quasis[0].value.cooked ?? '';
        kind = 'color';
      } else {
        value = lit.value;
        kind = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'color';
      }
      if (kind === 'number') {
        if (lit.bigint !== undefined) continue;
        const par = this.P(p, lit);
        if (par?.type === 'UnaryExpression' && par.operator === '-' && par.argument === lit) {
          node = par;
          value = -(value as number);
        }
      } else if (kind === 'color') {
        const s = value as string;
        if (s.length > 40 || !(isColorLiteral(s) || (isNamedColor(s) && this.colorContext(p, node)))) continue;
      }
      const spec = this.classify(p, node, kind);
      if (!spec) continue;
      if (!spec.named && kind === 'boolean') continue;
      if (spec.group === 'code') {
        if (!this.ctx.opts.codeNumbers || this.ctx.knobs.length >= this.ctx.opts.maxKnobs) continue;
        if (kind === 'number' && this.excluded(p, node, value as number)) continue;
      } else if (this.ctx.knobs.length >= this.ctx.opts.maxKnobs * 2) continue;
      this.addKnob(p, node, kind, value, spec);
    }
  }

  private classify(p: Parsed, node: N, kind: KnobKind): Spec | null {
    const par = this.P(p, node);
    if (!par) return null;
    if ((par.type === 'Property' || par.type === 'PropertyDefinition' || par.type === 'MethodDefinition') && par.key === node) return null;
    if (par.type === 'MemberExpression' && par.property === node) return null;
    if (par.type === 'SwitchCase' || par.type === 'TaggedTemplateExpression') return null;
    if (par.type.startsWith('Import') || (par.type.startsWith('Export') && par.type !== 'ExportDefaultDeclaration')) return null;
    if (par.type === 'ExpressionStatement' && typeof node.value === 'string') return null; // directive
    if (par.type === 'JSXAttribute' && kind !== 'color') return null;

    const fn = this.fnAncestor(p, node);
    const scope = this.scopeName(p, node);
    const g = (group: KnobGroup): KnobGroup => (kind === 'color' ? 'color' : group);

    // const NAME = <literal>
    if (par.type === 'VariableDeclarator' && par.init === node && par.id.type === 'Identifier') {
      const name = par.id.name;
      const v = p.sm.getDeclaredVariables(par)[0];
      if (v) {
        const refs = this.allRefs(p, v);
        const ambiguous = this.isClassicGlobal(p, v) && (this.gDecls.get(name)?.length ?? 0) > 1;
        const writes = refs.filter(({ r }) => r.isWrite() && r.identifier !== par.id);
        if (!ambiguous && writes.length === 0) {
          return { group: g('tunable'), label: name, scope, live: 'live', named: true, constVar: v, constRefs: refs.filter(({ r }) => r.isRead()), constInFn: !!fn };
        }
      }
      if (!fn) return { group: g('start'), label: name, scope, live: 'restart', named: true };
      return { group: g('code'), label: `${name} = ·`, scope, live: 'live', named: false };
    }

    // { key: <literal> } and [<literal>, ...]
    if ((par.type === 'Property' && par.value === node) || par.type === 'ArrayExpression') {
      const r = this.objectRoot(p, node);
      if (!r) return null;
      const last = r.path[r.path.length - 1];
      const state = typeof last === 'string' && this.isState(p, last, 0);
      const rootFn = this.fnAncestor(p, r.root);
      const registrable = !r.frozen && (!rootFn || r.perInstance);
      const live: Liveness = registrable ? 'live' : rootFn ? 'spawn' : 'restart';
      const where = r.hint ? (scope ? `${scope} › ${r.hint}` : r.hint) : scope;
      return { group: g(state ? 'start' : 'tunable'), label: r.label, scope: where, live, named: true, site: registrable ? { root: r.root, path: r.path } : undefined };
    }

    // class fields: `speed = 5;` / `static G = 0.5;`
    if (par.type === 'PropertyDefinition' && par.value === node) {
      const name = keyName(par.key, par.computed);
      if (!name) return null;
      const priv = name.startsWith('#');
      return {
        group: g(this.isState(p, name, 0) ? 'start' : 'tunable'), label: name, scope: this.className(p, par),
        live: priv ? (par.static ? 'restart' : 'spawn') : 'live', named: true, kp: priv ? undefined : name,
      };
    }

    if (par.type === 'AssignmentExpression' && par.right === node) {
      const left = par.left;
      if (par.operator !== '=') {
        return { group: g('code'), label: `${compact(this.src(p, left), 32)} ${par.operator} ·`, scope, live: fn ? 'live' : 'restart', named: false };
      }
      // this.speed = 5 inside a constructor: register the instance so existing objects update live
      if (left.type === 'MemberExpression' && left.object.type === 'ThisExpression' && !left.computed && left.property.type === 'Identifier' && this.isCtor(p, fn)) {
        const name = left.property.name;
        return { group: g(this.isState(p, name, 1) ? 'start' : 'tunable'), label: name, scope, live: 'live', named: true, kp: name };
      }
      if (left.type === 'Identifier') {
        const ref = p.refByIdent.get(left);
        let owner = p;
        let v = ref?.resolved;
        if (!v && !p.src.module) {
          const d = this.gDecls.get(left.name);
          if (d?.length === 1) ({ p: owner, v } = d[0]);
        }
        if (v) {
          const refs = this.allRefs(owner, v);
          const writes = refs.filter(({ r }) => r.isWrite());
          const single = writes.length === 1 && writes[0].r.identifier === left && v.defs.every((d: any) => d.type === 'Variable' && !d.node.init);
          if (single) {
            return { group: g('tunable'), label: left.name, scope, live: 'live', named: true, constVar: v, constRefs: refs.filter(({ r }) => r.isRead()), constInFn: !!fn };
          }
        }
        if (!fn) return { group: g('start'), label: left.name, scope, live: 'restart', named: true };
        return { group: g('code'), label: `${left.name} = ·`, scope, live: 'live', named: false };
      }
      const target = compact(this.src(p, left), 40);
      if (!fn) return { group: g('start'), label: target, scope, live: 'restart', named: true };
      return { group: g('code'), label: `${target} = ·`, scope, live: 'live', named: false };
    }

    if (par.type === 'AssignmentPattern' && par.right === node) {
      const name = par.left.type === 'Identifier' ? par.left.name : compact(this.src(p, par.left), 24);
      return { group: g('code'), label: `${name} = ·`, scope, live: fn ? 'live' : 'restart', named: false };
    }

    return { group: g('code'), label: this.contextLabel(p, node), scope, live: fn ? 'live' : 'restart', named: false };
  }

  private addKnob(p: Parsed, node: N, kind: KnobKind, value: KnobValue, spec: Spec) {
    const { ctx } = this;
    const id = ctx.knobs.length;
    const baseKey = `${p.src.file}|${spec.group}|${spec.scope}|${spec.label}`;
    const n = (ctx.keyCounts.get(baseKey) ?? 0) + 1;
    ctx.keyCounts.set(baseKey, n);
    const ln = lineAt(p.starts, node.range[0]);
    const knob: Knob = {
      id, key: n > 1 ? `${baseKey}#${n}` : baseKey, label: spec.label, scope: spec.scope, group: spec.group, kind,
      live: spec.live, value, raw: p.src.text.slice(node.range[0], node.range[1]), file: p.src.file,
      start: p.src.offset + node.range[0], end: p.src.offset + node.range[1], line: p.src.lineOffset + ln,
      context: compact(p.lines[ln - 1] ?? '', 140), lang: 'js', negSafe: this.negSafe(p, node),
    };
    if (kind === 'number') Object.assign(knob, inferRange(value as number, lastSeg(spec.label)));
    ctx.knobs.push(knob);
    p.usedIds.add(id);

    const par = this.P(p, node);
    const k = `__K[${id}]`;
    const text = spec.kp ? `__KP(this,${JSON.stringify(spec.kp)},${id})` : par?.type === 'JSXAttribute' ? `{${k}}` : k;
    p.edits.push({ start: node.range[0], end: node.range[1], text });
    if (spec.site) this.ctx.sites[this.siteFor(p, spec.site.root)].push([id, spec.site.path]);
    if (spec.constVar) {
      p.constByVar.set(spec.constVar, id);
      let live = !!spec.constInFn;
      for (const { p: rp, r } of spec.constRefs ?? []) {
        if (this.replaceRef(rp, r.identifier, id)) live ||= inFunction(r.from);
      }
      knob.live = live ? 'live' : 'restart';
    }
  }

  /** Rewrite a read of a constant-like binding to `__K[id]`. Also registers it when it seeds a config object. */
  private replaceRef(rp: Parsed, ident: N, id: number): boolean {
    const par = this.P(rp, ident);
    if (!par || par.type === 'ExportSpecifier') return false;
    rp.usedIds.add(id);
    if (par.type === 'Property' && par.shorthand && par.value === ident) {
      rp.edits.push({ start: par.range[0], end: par.range[1], text: `${ident.name}:__K[${id}]` });
    } else {
      rp.edits.push({ start: ident.range[0], end: ident.range[1], text: `__K[${id}]` });
    }
    if ((par.type === 'Property' && par.value === ident) || par.type === 'ArrayExpression') {
      const r = this.objectRoot(rp, ident);
      if (r && !r.frozen && (!this.fnAncestor(rp, r.root) || r.perInstance)) this.ctx.sites[this.siteFor(rp, r.root)].push([id, r.path]);
    }
    return true;
  }

  private siteFor(p: Parsed, root: N): number {
    let sid = p.siteOf.get(root);
    if (sid === undefined) {
      sid = this.ctx.sites.length;
      this.ctx.sites.push([]);
      p.siteOf.set(root, sid);
      p.edits.push({ start: root.range[0], end: root.range[0], text: '__KO(' }, { start: root.range[1], end: root.range[1], text: `,${sid})` });
    }
    return sid;
  }

  /** Cross-module: exported constants read through imports become live too. */
  private linkModules() {
    const exportsByFile = new Map<string, Map<string, number>>();
    for (const p of this.parsed) {
      if (!p.src.module || !p.src.external) continue;
      const map = new Map<string, number>();
      const modScope = p.sm.scopes.find((s: any) => s.type === 'module');
      for (const st of p.ast.body) {
        if (st.type !== 'ExportNamedDeclaration') continue;
        if (st.declaration?.type === 'VariableDeclaration') {
          for (const d of st.declaration.declarations) {
            const v = p.sm.getDeclaredVariables(d)[0];
            const kid = v && p.constByVar.get(v);
            if (kid !== undefined) map.set(v.name, kid);
          }
        } else if (!st.source) {
          for (const s of st.specifiers) {
            const v = modScope?.set.get(s.local.name ?? s.local.value);
            const kid = v && p.constByVar.get(v);
            if (kid !== undefined) map.set(s.exported.name ?? s.exported.value, kid);
          }
        }
      }
      if (map.size) exportsByFile.set(p.src.file, map);
    }
    if (!exportsByFile.size) return;
    for (const p of this.parsed) {
      if (!p.src.module) continue;
      for (const st of p.ast.body) {
        if (st.type !== 'ImportDeclaration') continue;
        const target = resolveRef(p.src.file, String(st.source.value));
        const ex = target ? exportsByFile.get(target) : undefined;
        if (!ex) continue;
        for (const s of st.specifiers) {
          const v = p.sm.getDeclaredVariables(s)[0];
          if (!v) continue;
          if (s.type === 'ImportSpecifier') {
            const kid = ex.get(s.imported.name ?? s.imported.value);
            if (kid === undefined) continue;
            for (const r of v.references) {
              if (r.isRead() && this.replaceRef(p, r.identifier, kid) && inFunction(r.from)) this.ctx.knobs[kid].live = 'live';
            }
          } else if (s.type === 'ImportNamespaceSpecifier') {
            for (const r of v.references) {
              const mem = this.P(p, r.identifier);
              if (mem?.type !== 'MemberExpression' || mem.object !== r.identifier || mem.computed) continue;
              const kid = ex.get(mem.property.name);
              const up = this.P(p, mem);
              if (kid === undefined || (up?.type === 'CallExpression' && up.callee === mem)) continue;
              p.edits.push({ start: mem.range[0], end: mem.range[1], text: `__K[${kid}]` });
              p.usedIds.add(kid);
              if (inFunction(r.from)) this.ctx.knobs[kid].live = 'live';
            }
          }
        }
      }
    }
  }

  private prelude(p: Parsed): Edit {
    const defaults: Record<number, KnobValue> = {};
    for (const id of p.usedIds) defaults[id] = this.ctx.knobs[id].value;
    let pos = 0;
    for (const st of p.ast.body) {
      if (st.type === 'ExpressionStatement' && typeof st.directive === 'string') pos = st.range[1];
      else break;
    }
    if (pos === 0 && p.src.text.startsWith('#!')) {
      const nl = p.src.text.indexOf('\n');
      pos = nl < 0 ? p.src.text.length : nl + 1;
    }
    const text =
      `;(function(g){var K=g.__K||(g.__K=[]),d=${JSON.stringify(defaults)};for(var i in d)if(K[i]===void 0)K[i]=d[i];` +
      `g.__KO||(g.__KO=function(o){return o});g.__KP||(g.__KP=function(o,p,i){return K[i]})})(globalThis);`;
    return { start: pos, end: pos, text };
  }

  // ---------- helpers ----------

  private isClassicGlobal = (p: Parsed, v: Var) => !p.src.module && v.scope.type === 'global';

  private allRefs(owner: Parsed, v: Var): { p: Parsed; r: Ref }[] {
    const out = v.references.map((r: Ref) => ({ p: owner, r }));
    if (this.isClassicGlobal(owner, v)) {
      const seen = new Set(out.map((x: { r: Ref }) => x.r.identifier));
      for (const t of this.gThrough.get(v.name) ?? []) if (!seen.has(t.r.identifier)) out.push(t);
    }
    return out;
  }

  private isState(p: Parsed, name: string, selfWrites: number) {
    return STATE_RE.test(name) || (p.memberWrites.get(name) ?? 0) > selfWrites;
  }

  private src(p: Parsed, n: N): string {
    return p.src.text.slice(n.range[0], n.range[1]);
  }

  private fnAncestor(p: Parsed, node: N): N | null {
    let child = node;
    let cur = this.P(p, node);
    while (cur) {
      if (FN_TYPES.has(cur.type) || cur.type === 'StaticBlock') return cur;
      if (cur.type === 'PropertyDefinition' && cur.value === child) return cur;
      child = cur;
      cur = this.P(p, cur);
    }
    return null;
  }

  private isCtor(p: Parsed, fn: N | null): boolean {
    if (!fn || fn.type === 'ArrowFunctionExpression' || fn.type === 'StaticBlock' || fn.type === 'PropertyDefinition') return false;
    const par = this.P(p, fn);
    if (par?.type === 'MethodDefinition') return par.kind === 'constructor';
    if (fn.id && /^[A-Z]/.test(fn.id.name)) return true;
    return par?.type === 'VariableDeclarator' && par.id.type === 'Identifier' && /^[A-Z]/.test(par.id.name);
  }

  private className(p: Parsed, node: N): string {
    let cur = this.P(p, node);
    while (cur && cur.type !== 'ClassDeclaration' && cur.type !== 'ClassExpression') cur = this.P(p, cur);
    if (!cur) return '';
    if (cur.id) return cur.id.name;
    const par = this.P(p, cur);
    return par?.type === 'VariableDeclarator' && par.id.type === 'Identifier' ? par.id.name : 'class';
  }

  private fnName(p: Parsed, fn: N): string | null {
    const par = this.P(p, fn);
    if (par?.type === 'MethodDefinition') {
      const cls = this.className(p, par);
      const k = keyName(par.key, par.computed) ?? '?';
      return cls ? `${cls}.${k}` : k;
    }
    if (fn.id) return fn.id.name;
    if (!par) return null;
    if (par.type === 'VariableDeclarator' && par.id.type === 'Identifier') return par.id.name;
    if (par.type === 'Property' && par.value === fn) return keyName(par.key, par.computed);
    if (par.type === 'PropertyDefinition') return `${this.className(p, par)}.${keyName(par.key, par.computed) ?? '?'}`;
    if (par.type === 'AssignmentExpression' && par.right === fn) {
      return compact(this.src(p, par.left).replace(/\.prototype\./, '.').replace(/^this\./, ''), 32);
    }
    return null;
  }

  private scopeName(p: Parsed, node: N): string {
    let cur = this.P(p, node);
    while (cur) {
      if (FN_TYPES.has(cur.type)) {
        const n = this.fnName(p, cur);
        if (n) return n;
      } else if (cur.type === 'PropertyDefinition' || cur.type === 'StaticBlock') return this.className(p, cur);
      cur = this.P(p, cur);
    }
    return '';
  }

  private objectRoot(p: Parsed, node: N) {
    const path: SitePath = [];
    let cur = node;
    let par = this.P(p, cur);
    for (;;) {
      if (par?.type === 'Property' && par.value === cur) {
        if (par.kind !== 'init' || par.method) return null;
        const key = par.computed ? (par.key.type === 'Literal' ? String(par.key.value) : null) : keyName(par.key, false);
        if (key == null) return null;
        path.unshift(key);
        cur = this.P(p, par);
        par = this.P(p, cur);
      } else if (par?.type === 'ArrayExpression') {
        if (par.elements.length > 16 || this.P(p, par)?.type === 'ArrayExpression') return null;
        path.unshift(par.elements.indexOf(cur));
        cur = par;
        par = this.P(p, cur);
      } else break;
      if (path.length > 8) return null;
    }
    const root = cur;
    let frozen = false;
    if (par?.type === 'CallExpression' && par.arguments[0] === root && this.src(p, par.callee) === 'Object.freeze') {
      frozen = true;
      cur = par;
      par = this.P(p, par);
    }
    let base = '';
    let hint = '';
    let perInstance = false;
    if (par?.type === 'VariableDeclarator' && par.init === cur) base = par.id.type === 'Identifier' ? par.id.name : compact(this.src(p, par.id), 20);
    else if (par?.type === 'AssignmentExpression' && par.right === cur) {
      base = compact(this.src(p, par.left), 32);
      const l = par.left;
      perInstance = l.type === 'MemberExpression' && l.object.type === 'ThisExpression' && this.isCtor(p, this.fnAncestor(p, par));
    } else if (par?.type === 'PropertyDefinition' && par.value === cur) {
      base = keyName(par.key, par.computed) ?? '';
      perInstance = !base.startsWith('#');
    } else if (par?.type === 'ReturnStatement') hint = 'return';
    else if ((par?.type === 'CallExpression' || par?.type === 'NewExpression') && par.arguments.includes(cur)) hint = compact(this.src(p, par.callee), 24) + '(…)';
    else if (par?.type === 'ExportDefaultDeclaration') base = 'default';
    const label = base ? base + fmtPath(path) : fmtPath(path).replace(/^\./, '');
    return { root, path, frozen, perInstance, label: label || '·', hint };
  }

  private colorContext(p: Parsed, node: N): boolean {
    let cur = node;
    for (let depth = 0; depth < 4; depth++) {
      const par = this.P(p, cur);
      if (!par) return false;
      let name = '';
      if (par.type === 'AssignmentExpression') name = this.src(p, par.left);
      else if (par.type === 'Property' && par.value === cur) name = keyName(par.key, par.computed) ?? '';
      else if (par.type === 'VariableDeclarator') name = par.id.name ?? '';
      else if (par.type === 'PropertyDefinition') name = keyName(par.key, par.computed) ?? '';
      else if (par.type === 'JSXAttribute') name = par.name?.name ?? '';
      else if (par.type === 'CallExpression') name = this.src(p, par.callee);
      if (name && COLOR_CTX.test(name)) return true;
      if (par.type !== 'ObjectExpression' && par.type !== 'ArrayExpression' && par.type !== 'Property' && par.type !== 'ConditionalExpression' && par.type !== 'LogicalExpression') return false;
      cur = par;
    }
    return false;
  }

  private contextLabel(p: Parsed, node: N): string {
    let ctxNode = this.P(p, node);
    if (!ctxNode) return '·';
    if (ctxNode.type === 'ReturnStatement') return 'return ·';
    if (/Statement$/.test(ctxNode.type)) return '·';
    for (;;) {
      const up = this.P(p, ctxNode);
      const climb =
        (ctxNode.type === 'BinaryExpression' || ctxNode.type === 'LogicalExpression' || ctxNode.type === 'UnaryExpression') &&
        up && /^(BinaryExpression|LogicalExpression|AssignmentExpression|VariableDeclarator)$/.test(up.type) &&
        up.range[1] - up.range[0] <= 56;
      if (!climb) break;
      ctxNode = up;
    }
    const t = p.src.text;
    return around(t.slice(ctxNode.range[0], node.range[0]) + '·' + t.slice(node.range[1], ctxNode.range[1]));
  }

  private excluded(p: Parsed, node: N, value: number): boolean {
    const a = Math.abs(value);
    if (a === 0 || a === 1 || a >= 1e6 || !Number.isFinite(value)) return true;
    const par = this.P(p, node);
    if (!par) return true;
    if (par.type === 'BinaryExpression') {
      if (['%', '|', '&', '^', '<<', '>>', '>>>'].includes(par.operator)) return true;
      const other = par.left === node ? par.right : par.left;
      if (other.type === 'MemberExpression' && this.src(p, other) === 'Math.PI') return true;
      if ((par.operator === '/' && a === 1000) || (par.operator === '*' && a === 0.001)) return true;
      if (par.operator === '/' && a === 2 && par.right === node) return true;
      if (/^[!=]==?$/.test(par.operator) && other.type === 'MemberExpression' && !other.computed && KEYISH.has(other.property.name)) return true;
    }
    if ((par.type === 'CallExpression' || par.type === 'NewExpression') && par.arguments.includes(node)) {
      const c = par.callee;
      const name = c.type === 'MemberExpression' && !c.computed ? c.property.name : c.type === 'Identifier' ? c.name : '';
      if (EXCLUDED_CALLS.has(name)) return true;
    }
    return false;
  }

  private negSafe(p: Parsed, node: N): boolean {
    const par = this.P(p, node);
    if (!par) return false;
    if (NEG_SAFE_PARENTS.has(par.type)) return true;
    if (par.type === 'BinaryExpression') {
      if (par.operator === '**') return false;
      if (par.left === node) return true;
      return /[\s(]/.test(p.src.text[node.range[0] - 1] ?? ' ');
    }
    return false;
  }
}

function keyName(key: N, computed: boolean): string | null {
  if (!key) return null;
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateIdentifier') return '#' + key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
}

function moduleSpecifiers(ast: N): string[] {
  const out: string[] = [];
  for (const st of ast.body) {
    if ((st.type === 'ImportDeclaration' || st.type === 'ExportAllDeclaration' || st.type === 'ExportNamedDeclaration') && st.source) {
      out.push(String(st.source.value));
    }
  }
  return out;
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const list = map.get(k);
  if (list) list.push(v); else map.set(k, [v]);
}
