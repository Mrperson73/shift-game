import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cleanStack, snippet } from '../core/report';
import * as S from './state';
import { Icon, timeAgo } from './ui';

export function Drawer() {
  const tab = S.drawerTab.value;
  const errors = S.errorCount.value;
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'log'>('all');
  const setTab = (t: typeof tab) => {
    S.drawerTab.value = t;
    S.persist('drawerTab', t);
  };
  return (
    <section class="drawer" style={{ height: `${S.drawerHeight.value}px` }}>
      <Resizer />
      <div class="drawer-tabs" role="tablist">
        <button role="tab" class={`tab ${tab === 'console' ? 'on' : ''}`} onClick={() => setTab('console')}>
          <Icon name="terminal" size={14} />Console{errors > 0 && <span class="pill red">{errors > 999 ? '999+' : errors}</span>}
        </button>
        <button role="tab" class={`tab ${tab === 'perf' ? 'on' : ''}`} onClick={() => setTab('perf')}>
          <Icon name="activity" size={14} />Performance
        </button>
        <button role="tab" class={`tab ${tab === 'versions' ? 'on' : ''}`} onClick={() => setTab('versions')}>
          <Icon name="history" size={14} />Versions
        </button>
        <div class="tab-spacer" />
        {tab === 'console' && (
          <>
            {(['all', 'error', 'warn', 'log'] as const).map((f) => (
              <button class={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'error' ? 'Errors' : f === 'warn' ? 'Warnings' : 'Logs'}
              </button>
            ))}
            <button class="chip" onClick={() => (S.logs.value = [])} title="Clear console">Clear</button>
          </>
        )}
      </div>
      <div class="drawer-body">
        {tab === 'console' && <Console filter={filter} />}
        {tab === 'perf' && <Perf />}
        {tab === 'versions' && <Versions />}
      </div>
    </section>
  );
}

function Resizer() {
  return (
    <div
      class="resizer-h"
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startH = S.drawerHeight.value;
        const move = (ev: PointerEvent) => {
          S.drawerHeight.value = Math.round(Math.min(window.innerHeight * 0.7, Math.max(120, startH + startY - ev.clientY)));
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          S.persist('drawerHeight', S.drawerHeight.value);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up, { once: true });
      }}
    />
  );
}

// ---------------- console ----------------

function Console({ filter }: { filter: string }) {
  const list = S.logs.value.filter((e) => filter === 'all' || e.level === filter || e.level === 'sep');
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = list[list.length - 1];
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list.length, last?.count]);
  return (
    <div
      class="console"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {!list.some((e) => e.level !== 'sep') && <div class="empty">No messages yet. <code>console.log</code> output and errors from your game show up here.</div>}
      {list.map((e) => (e.level === 'sep' ? <div class="log-sep" key={e.id}><span>{e.text}</span></div> : <LogRow key={e.id} e={e} />))}
    </div>
  );
}

function LogRow({ e }: { e: S.LogEntry }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const expandable = !!(e.stack || (e.file && e.line));
  const toggle = async () => {
    if (!expandable) return;
    const next = !open;
    setOpen(next);
    if (next && code === null && e.file && e.line) {
      const src = await S.api.source(e.file).catch(() => null);
      setCode(src ? snippet(src, e.line, 3) : '');
    }
  };
  const frames = e.stack ? cleanStack(e.stack).split('\n').filter((l) => /^\s*at /.test(l)).slice(0, 8).join('\n') : '';
  return (
    <div class={`log log-${e.level} ${open ? 'open' : ''}`}>
      <span class="log-icon">{e.level === 'error' ? <Icon name="alert" size={13} /> : e.level === 'warn' ? '!' : '›'}</span>
      <div class={`log-main ${expandable ? 'clickable' : ''}`} onClick={toggle}>
        <div class="log-text">{e.text}</div>
        {open && code && <pre class="log-code">{code}</pre>}
        {open && frames && <pre class="log-stack">{frames}</pre>}
      </div>
      <div class="log-side">
        {e.count > 1 && <span class="log-count">{e.count}</span>}
        {e.file && (
          <span class="log-loc" title="Show code">
            {e.file}{e.line ? `:${e.line}` : ''}
          </span>
        )}
        {e.level === 'error' && (
          <button class="btn tiny" onClick={() => S.copyError(e)} title="Copy a ready-to-paste bug report for your AI chat">
            <Icon name="copy" size={12} />Copy for AI
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- performance ----------------

function Perf() {
  S.perfTick.value;
  const frames = S.recentFrames(600);
  const work = S.recentFrames(600, S.workBuf);
  const n = frames.length;
  const sorted = [...frames].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(q * (n - 1)))] ?? 0;
  const avg = n ? frames.reduce((a, b) => a + b, 0) / n : 0;
  const median = pick(0.5);
  const p99 = pick(0.99);
  const worst = sorted[n - 1] ?? 0;
  const hitches = frames.filter((f) => f > Math.max(median * 2, 25)).length;
  const avgWork = n ? work.reduce((a, b) => a + b, 0) / n : 0;
  const fps = S.fps.value;
  const tone = (v: number, good: number, ok: number) => (v >= good ? 'good' : v >= ok ? 'ok' : 'bad');
  return (
    <div class="perf">
      <div class="stats">
        <Stat label="FPS" value={n ? String(fps) : '–'} tone={n ? tone(fps, 55, 30) : ''} />
        <Stat label="Avg frame" value={n ? `${avg.toFixed(1)} ms` : '–'} />
        <Stat label="1% low" value={n ? `${Math.round(1000 / Math.max(p99, 0.001))} fps` : '–'} tone={n ? tone(1000 / p99, 50, 25) : ''} />
        <Stat label="Worst frame" value={n ? `${worst.toFixed(0)} ms` : '–'} tone={n ? (worst < 34 ? 'good' : worst < 100 ? 'ok' : 'bad') : ''} />
        <Stat label="Hitches" value={n ? String(hitches) : '–'} tone={n ? (hitches === 0 ? 'good' : hitches < 5 ? 'ok' : 'bad') : ''} hint="Frames that took over twice the usual time (last 600 frames)" />
        <Stat label="Game code" value={n ? `${avgWork.toFixed(2)} ms` : '–'} hint="Average time spent inside your requestAnimationFrame callbacks per frame" />
        <Stat label="JS heap" value={S.heapMB.value ? `${S.heapMB.value.toFixed(1)} MB` : '–'} />
      </div>
      <FrameGraph frames={frames} work={work} />
      {!S.hasLoop.value && !n && <div class="perf-note">No <code>requestAnimationFrame</code> loop detected, so there's no frame timing to show.</div>}
      {S.paused.value && <div class="perf-note">Paused</div>}
    </div>
  );
}

function Stat({ label, value, tone = '', hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div class={`stat ${tone}`} title={hint}>
      <div class="stat-value">{value}</div>
      <div class="stat-label">{label}</div>
    </div>
  );
}

function FrameGraph({ frames, work }: { frames: number[]; work: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(c);
    const col = (v: string) => css.getPropertyValue(v).trim();
    const maxMs = 50;
    const y = (ms: number) => h - (Math.min(ms, maxMs) / maxMs) * (h - 4);
    g.font = '10px ' + col('--mono');
    for (const [ms, label] of [[16.7, '60 fps'], [33.3, '30 fps']] as const) {
      g.strokeStyle = col('--line2');
      g.setLineDash([3, 4]);
      g.beginPath();
      g.moveTo(0, Math.round(y(ms)) + 0.5);
      g.lineTo(w, Math.round(y(ms)) + 0.5);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = col('--muted');
      g.fillText(label, w - 44, y(ms) - 4);
    }
    const bar = 3;
    const count = Math.min(frames.length, Math.floor(w / bar));
    const sorted = frames.slice(-120).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 16.7;
    for (let i = 0; i < count; i++) {
      const f = frames[frames.length - count + i];
      const wk = work[work.length - count + i] ?? 0;
      const x = w - (count - i) * bar;
      g.fillStyle = f > Math.max(median * 2, 25) ? col('--red') : f > median * 1.35 ? col('--amber') : col('--cyan-dim');
      g.fillRect(x, y(f), bar - 1, h - y(f));
      if (wk > 0.05) {
        g.fillStyle = col('--cyan');
        g.fillRect(x, y(wk), bar - 1, h - y(wk));
      }
    }
  });
  return <canvas class="graph" ref={ref} aria-label="Frame time graph" />;
}

// ---------------- versions ----------------

function Versions() {
  const tick = S.versionsTick.value;
  const gid = S.game.value?.id;
  const [sel, setSel] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  useEffect(() => {
    S.loadVersions();
  }, [tick, gid]);
  useEffect(() => {
    setDiff('');
    if (sel) S.api.diffVersion(sel).then(setDiff).catch(() => setDiff(''));
  }, [sel, tick]);
  const list = S.versions.value;
  const playing = S.preview.value?.id;
  return (
    <div class="versions">
      <div class="ver-list">
        {!list.length && <div class="empty">No versions yet. Knobs saves one every time the game's code changes.</div>}
        {list.map((v) => (
          <div key={v.id} class={`ver ${sel === v.id ? 'sel' : ''}`} onClick={() => setSel(v.id)}>
            <div class="ver-top">
              <span class="ver-time">{new Date(v.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span class="ver-ago">{timeAgo(v.ts)}</span>
              {v.current && <span class="pill">current</span>}
              {playing === v.id && <span class="pill accent">playing</span>}
            </div>
            <div class="ver-bottom">
              <span class="ver-reason">{v.reason}</span>
              <span class="ver-lines">{v.lines} lines</span>
              <span class="ver-actions">
                <button class="btn tiny" onClick={(e) => { e.stopPropagation(); S.previewVersion(v); }} title="Play this version without changing your files">
                  <Icon name="play" size={11} />Play
                </button>
                {!v.current && (
                  <button class="btn tiny" onClick={(e) => { e.stopPropagation(); S.restoreVersion(v.id); }} title="Write this version back to disk (the current one is saved first)">
                    <Icon name="restart" size={11} />Restore
                  </button>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div class="ver-diff">
        {sel ? <Diff text={diff} /> : <div class="empty">Select a version to see what changed in it.</div>}
      </div>
    </div>
  );
}

function Diff({ text }: { text: string }) {
  if (!text) return <div class="empty">No changes in this version's source files.</div>;
  const lines = text.split('\n').filter((l) => !l.startsWith('====') && !/^(Index:|\\ No newline)/.test(l));
  return (
    <pre class="diff">
      {lines.slice(0, 3000).map((l) => {
        const cls = l.startsWith('+++') || l.startsWith('---') ? 'file' : l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : '';
        return <div class={cls}>{l || ' '}</div>;
      })}
    </pre>
  );
}
