/**
 * Injected as the first script of every game page. Owns the live knob values (__K),
 * reports console output, errors and frame timing to the Knobs UI, and implements
 * pause / step / slow motion by virtualizing requestAnimationFrame, timers and clocks.
 */
import { createRegistry } from './registry';
import type { KnobValue, Site } from '../core/types';

interface Init {
  values: KnobValue[];
  sites: Site[];
  /** knob id → CSS unit ('' for colors) for CSS-backed knobs */
  css: Record<string, string>;
  parent: string;
  time: { paused: boolean; scale: number };
}

interface Entry { level: string; text: string; stack?: string; file?: string; line?: number; col?: number; t: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
const W = window as any;

W.__knobsBoot = function boot(init: Init) {
  if (W.__knobsReady) return;
  W.__knobsReady = true;

  const reg = createRegistry(init.values, init.sites);
  W.__K = reg.K;
  W.__KO = reg.KO;
  W.__KP = reg.KP;

  const root = document.documentElement;
  const cssVal = (id: number, v: KnobValue) => (typeof v === 'number' ? v + (init.css[id] ?? '') : String(v));
  for (const id of Object.keys(init.css)) root.style.setProperty('--__k' + id, cssVal(+id, reg.K[+id]));

  const parentWin = window.parent;
  const post = (m: object) => {
    try {
      parentWin.postMessage({ __knobs: 1, ...m }, init.parent);
    } catch { /* parent gone */ }
  };

  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now;
  const realRAF: (cb: FrameRequestCallback) => number = W.requestAnimationFrame.bind(W);
  const realST: typeof setTimeout = W.setTimeout.bind(W);
  const realSI: typeof setInterval = W.setInterval.bind(W);
  const t0 = realNow();

  // ---------------- console & errors ----------------
  let queue: Entry[] = [];
  let dropped = 0;
  let flushTimer: ReturnType<typeof setTimeout> | 0 = 0;
  const flush = () => {
    flushTimer = 0;
    if (queue.length || dropped) post({ type: 'log', entries: queue, dropped });
    queue = [];
    dropped = 0;
  };
  const push = (e: Entry) => {
    if (queue.length >= 200) dropped++;
    else queue.push(e);
    if (!flushTimer) flushTimer = realST(flush, 80);
  };
  const clip = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + '…' : s);
  const fmt = (v: unknown, depth = 0): string => {
    if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
    if (v === null || v === undefined || typeof v !== 'object') {
      return typeof v === 'function' ? `ƒ ${(v as () => void).name || 'anonymous'}()` : String(v);
    }
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    if (typeof Element !== 'undefined' && v instanceof Element) {
      const cls = typeof v.className === 'string' && v.className.trim() ? '.' + v.className.trim().split(/\s+/).join('.') : '';
      return `<${v.tagName.toLowerCase()}${v.id ? '#' + v.id : ''}${cls}>`;
    }
    if (depth > 2) return Array.isArray(v) ? '[…]' : '{…}';
    try {
      if (Array.isArray(v)) {
        const items = v.slice(0, 20).map((x) => fmt(x, depth + 1));
        return `[${items.join(', ')}${v.length > 20 ? `, …+${v.length - 20}` : ''}]`;
      }
      const keys = Object.keys(v);
      const name = (v as { constructor?: { name?: string } }).constructor?.name;
      const body = keys.slice(0, 20).map((k) => `${k}: ${fmt((v as any)[k], depth + 1)}`).join(', ');
      return `${name && name !== 'Object' ? name + ' ' : ''}{${body}${keys.length > 20 ? ', …' : ''}}`;
    } catch {
      return '[object]';
    }
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[level];
    console[level] = function (this: Console, ...args: unknown[]) {
      try {
        const err = args.find((a) => a instanceof Error) as Error | undefined;
        const stack = err?.stack ?? (level === 'warn' || level === 'error' ? new Error().stack : undefined);
        push({ level: level === 'info' || level === 'debug' ? 'log' : level, text: clip(args.map((a) => fmt(a)).join(' ')), stack, t: realNow() - t0 });
      } catch { /* never break the game's logging */ }
      return orig.apply(this, args);
    };
  }
  addEventListener(
    'error',
    (e: Event) => {
      if (e instanceof ErrorEvent) {
        push({ level: 'error', text: clip(e.message || 'Error'), stack: e.error?.stack, file: e.filename, line: e.lineno, col: e.colno, t: realNow() - t0 });
      } else {
        const el = e.target as { src?: string; href?: string; tagName?: string } | null;
        if (el && el !== (window as unknown) && (el.src || el.href)) {
          push({ level: 'error', text: `Failed to load ${el.tagName?.toLowerCase() ?? 'resource'}: ${el.src || el.href}`, t: realNow() - t0 });
        }
      }
    },
    true,
  );
  addEventListener('unhandledrejection', (e) => {
    push({ level: 'error', text: clip('Uncaught (in promise) ' + fmt(e.reason)), stack: e.reason?.stack, t: realNow() - t0 });
  });
  const rethrow = (err: unknown) => {
    if (typeof W.reportError === 'function') W.reportError(err);
    else realST(() => { throw err; });
  };

  // ---------------- virtual time ----------------
  let paused = !!init.time.paused;
  let scale = init.time.scale > 0 ? init.time.scale : 1;
  let manual = false;
  let offset = 0;
  let vclock = 0;
  const vnow = () => (manual ? vclock : realNow() - offset);
  const setManual = (m: boolean) => {
    if (m && !manual) { vclock = realNow() - offset; manual = true; }
    else if (!m && manual) { offset = realNow() - vclock; manual = false; }
  };
  setManual(paused || scale !== 1);
  performance.now = vnow;
  Date.now = () => Math.round(realDateNow() - (realNow() - vnow()));

  // ---------------- requestAnimationFrame pump ----------------
  let cbs = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let pumping = 0;
  let last = 0;
  let interval = 1000 / 60;
  let acc = 0;
  let stepReq = false;
  let frames: number[] = [];
  let work: number[] = [];
  W.__knobsFrames = 0;

  const schedule = () => {
    if (!pumping && cbs.size && (!paused || stepReq)) pumping = realRAF(pump);
  };
  function pump(ts: number) {
    pumping = 0;
    const dt = last ? ts - last : 0;
    last = ts;
    if (dt > 0 && dt < 100) interval += (dt - interval) * 0.1;
    let runs = 1;
    if (paused) {
      runs = stepReq ? 1 : 0;
      stepReq = false;
    } else if (scale !== 1) {
      acc += scale;
      runs = Math.min(4, Math.floor(acc));
      acc -= runs;
    }
    const start = realNow();
    for (let r = 0; r < runs; r++) {
      if (manual) vclock += interval;
      const batch = cbs;
      cbs = new Map();
      const v = vnow();
      batch.forEach((cb) => {
        try { cb(v); } catch (err) { rethrow(err); }
      });
      W.__knobsFrames++;
    }
    if (runs) {
      frames.push(dt);
      work.push(realNow() - start);
    }
    schedule();
  }
  W.requestAnimationFrame = W.webkitRequestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    cbs.set(id, cb);
    schedule();
    return id;
  };
  W.cancelAnimationFrame = W.webkitCancelAnimationFrame = (id: number) => {
    cbs.delete(id);
  };

  // ---------------- timers ----------------
  let held: (() => void)[] = [];
  const scaled = (d: unknown) => (scale !== 1 && !paused ? (Number(d) || 0) / scale : d);
  W.setTimeout = (fn: unknown, d?: number, ...args: unknown[]) => {
    if (typeof fn !== 'function') return realST(fn as () => void, d, ...args);
    return realST(() => {
      if (paused) held.push(() => fn(...args));
      else fn(...args);
    }, scaled(d) as number);
  };
  W.setInterval = (fn: unknown, d?: number, ...args: unknown[]) => {
    if (typeof fn !== 'function') return realSI(fn as () => void, d, ...args);
    return realSI(() => {
      if (!paused) fn(...args);
    }, scaled(d) as number);
  };

  // ---------------- audio (silenced while paused) ----------------
  const contexts: WeakRef<AudioContext>[] = [];
  const media: WeakRef<HTMLMediaElement>[] = [];
  const AC = W.AudioContext || W.webkitAudioContext;
  if (AC) {
    const Tracked = class extends AC {
      constructor(...a: unknown[]) {
        super(...a);
        contexts.push(new WeakRef(this as unknown as AudioContext));
      }
    };
    W.AudioContext = Tracked;
    if (W.webkitAudioContext) W.webkitAudioContext = Tracked;
  }
  const proto = HTMLMediaElement.prototype;
  const realPlay = proto.play;
  proto.play = function (this: HTMLMediaElement) {
    if (media.length > 64) media.splice(0, 16);
    media.push(new WeakRef(this));
    return realPlay.call(this);
  };
  let frozenCtx: AudioContext[] = [];
  let frozenMedia: HTMLMediaElement[] = [];
  const freezeAudio = () => {
    frozenCtx = contexts.map((r) => r.deref()).filter((c): c is AudioContext => !!c && c.state === 'running');
    frozenCtx.forEach((c) => c.suspend().catch(() => {}));
    const els = new Set([...document.querySelectorAll('audio,video'), ...media.map((r) => r.deref())] as (HTMLMediaElement | undefined)[]);
    frozenMedia = [...els].filter((m): m is HTMLMediaElement => !!m && !m.paused);
    frozenMedia.forEach((m) => m.pause());
  };
  const thawAudio = () => {
    frozenCtx.forEach((c) => c.resume().catch(() => {}));
    frozenMedia.forEach((m) => realPlay.call(m).catch(() => {}));
    frozenCtx = [];
    frozenMedia = [];
  };

  const setTime = (p: boolean, s: number) => {
    const was = paused;
    paused = p;
    scale = s > 0 ? s : 1;
    acc = 0;
    last = 0;
    setManual(paused || scale !== 1);
    if (paused && !was) freezeAudio();
    else if (!paused && was) {
      thawAudio();
      const h = held;
      held = [];
      h.forEach((f) => {
        try { f(); } catch (err) { rethrow(err); }
      });
    }
    schedule();
  };

  // ---------------- perf ----------------
  let tick = 0;
  const flushPerf = () => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (frames.length || tick % 4 === 0) post({ type: 'perf', frames, work, heap: mem ? mem.usedJSHeapSize : 0, loop: cbs.size > 0 || pumping > 0 });
    tick++;
    frames = [];
    work = [];
    realST(flushPerf, 250);
  };
  realST(flushPerf, 250);

  // ---------------- messages from Knobs ----------------
  addEventListener(
    'message',
    (e) => {
      if (e.source !== parentWin) return;
      const m = e.data;
      if (!m || m.__knobs !== 1) return;
      e.stopImmediatePropagation();
      if (m.type === 'set') {
        for (const [id, v] of m.values as [number, KnobValue][]) {
          reg.set(id, v);
          if (id in init.css) root.style.setProperty('--__k' + id, cssVal(id, v));
        }
      } else if (m.type === 'time') setTime(!!m.paused, Number(m.scale));
      else if (m.type === 'step') {
        stepReq = true;
        schedule();
      }
    },
    true,
  );

  post({ type: 'ready' });
  addEventListener('load', () => post({ type: 'loaded' }));
};
