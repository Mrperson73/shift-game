import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { decimalsOf, snap } from '../core/ranges';

// ---------------- icons ----------------
const paths: Record<string, JSX.Element> = {
  restart: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 3.5v5h5" /></>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
  play: <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" />,
  step: <><path d="M5 5.5v13l9.5-6.5z" /><path d="M18.5 5v14" /></>,
  gauge: <><path d="M12 14l4.5-4.5" /><path d="M3.8 18a9 9 0 1 1 16.4 0" /></>,
  alert: <><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></>,
  terminal: <><path d="M4.5 17 10 12 4.5 7" /><path d="M12.5 18.5h7" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M15 4v16" /></>,
  drawer: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 14.5h18" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  pin: <><path d="M9 3.5h6l-.9 6.2 3.9 3.3H6l3.9-3.3z" /><path d="M12 13v7.5" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7" /><path d="M4 4v4.7h4.7" /></>,
  copy: <><rect x="9" y="9" width="11.5" height="11.5" rx="2.5" /><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" /></>,
  flame: <path d="M12 2.8c.7 3.2 4.9 5 4.9 10.2a4.9 4.9 0 0 1-9.8 0c0-2 .9-3.6 2.1-4.6.3 2 1.3 3 2.4 3.1-.9-3.2.1-6.1.4-8.7z" />,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.6 0 1.2.3 1.6.7L11.5 7h7A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" />,
  file: <><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" /><path d="M14 3v5h5" /></>,
  clipboard: <><rect x="5.5" y="4.5" width="13" height="16.5" rx="2.5" /><path d="M9 4.5V3.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8v.7" /><path d="M9 11h6M9 15h4" /></>,
  x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 3.5v5h5" /><path d="M12 7.5V12l3 2" /></>,
  activity: <path d="M3 12h3.5l2.5-7 5 14 2.5-7H21" />,
  sliders: <><path d="M4 6.5h9M18 6.5h2M4 12h3M11 12h9M4 17.5h11M19 17.5h1" /><circle cx="15.5" cy="6.5" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17.5" r="2" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12.5" rx="2.5" /><path d="M8.5 20.5h7M12 16.5v4" /></>,
  gamepad: <><path d="M7.5 7.5h9a5 5 0 0 1 4.9 6l-.6 3a2.6 2.6 0 0 1-4.6 1.1l-1.6-2.1h-5.2l-1.6 2.1a2.6 2.6 0 0 1-4.6-1.1l-.6-3a5 5 0 0 1 4.9-6z" /><path d="M8 10.5v3M6.5 12h3" /><path d="M15.5 11h.01M17.5 13h.01" /></>,
  expand: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  sparkle: <path d="M12 3.5 13.8 10 20.5 12l-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z" />,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" /></>,
  code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4" /></>,
  more: <><circle cx="5.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18.5" cy="12" r="1" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="kg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffb35c" />
          <stop offset="1" stop-color="#ff7a2e" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="21" fill="url(#kg)" />
      <circle cx="32" cy="32" r="14" fill="#1a1510" opacity=".22" />
      <path d="M32 32 44 20" stroke="#1b130c" stroke-width="5" stroke-linecap="round" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const a = ((135 + i * 45) * Math.PI) / 180;
        return <circle cx={32 + Math.cos(a) * 28} cy={32 + Math.sin(a) * 28} r="2.4" fill={i < 5 ? '#ff9a3c' : '#4a4f5c'} />;
      })}
    </svg>
  );
}

export const Kbd = ({ children }: { children: ComponentChildren }) => <kbd class="kbd">{children}</kbd>;

export function IconButton(props: { icon: string; title: string; onClick: () => void; active?: boolean; disabled?: boolean; children?: ComponentChildren; class?: string }) {
  return (
    <button class={`ibtn ${props.active ? 'active' : ''} ${props.class ?? ''}`} title={props.title} aria-label={props.title} disabled={props.disabled} onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}

// ---------------- formatting ----------------
export function fmtNumber(v: number, step: number): string {
  if (!Number.isFinite(v)) return String(v);
  const d = Math.max(decimalsOf(step), Number.isInteger(v) ? 0 : Math.min(4, (String(v).split('.')[1] ?? '').length));
  return String(Number(v.toFixed(Math.min(d, 6))));
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Subsequence fuzzy match. Returns a score (higher is better) or -1. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 - t.length * 0.1 + (direct === 0 || /\W/.test(t[direct - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    run = found === ti ? run + 1 : 0;
    score += 10 + run * 5 - Math.min(found - ti, 10) + (found === 0 || /\W/.test(t[found - 1]) ? 8 : 0);
    ti = found + 1;
  }
  return score - t.length * 0.1;
}

// ---------------- slider ----------------
interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  origin?: number;
  disabled?: boolean;
  onInput: (v: number) => void;
  onCommit?: () => void;
}

/** Custom slider: drag anywhere on it; Shift = fine control; wheel nudges by step. */
export function Slider({ value, min, max, step, origin, disabled, onInput, onCommit }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number; fine: boolean } | null>(null);
  const span = max - min || 1;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const zero = min < 0 && max > 0 ? pct(0) : pct(min);
  const cur = pct(value);

  const fromEvent = (e: PointerEvent) => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const d = drag.current!;
    if (e.shiftKey !== d.fine) {
      d.fine = e.shiftKey;
      d.x = e.clientX;
      d.v = value;
    }
    const raw = d.fine ? d.v + ((e.clientX - d.x) / r.width) * span * 0.1 : min + ((e.clientX - r.left) / r.width) * span;
    onInput(snap(Math.min(max, Math.max(min, raw)), d.fine ? step / 10 : step));
  };

  return (
    <div
      ref={ref}
      class={`slider ${disabled ? 'disabled' : ''}`}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, fine: e.shiftKey };
        if (!e.shiftKey) fromEvent(e);
      }}
      onPointerMove={(e) => drag.current && fromEvent(e)}
      onPointerUp={() => {
        if (drag.current) onCommit?.();
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
      onWheel={(e) => {
        if (disabled) return;
        e.preventDefault();
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const dir = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
        onInput(snap(value + dir * step * mult, mult < 1 ? step / 10 : step));
      }}
    >
      <div class="slider-track">
        <div class="slider-fill" style={{ left: `${Math.min(zero, cur)}%`, width: `${Math.abs(cur - zero)}%` }} />
        {origin !== undefined && origin !== value && <div class="slider-origin" style={{ left: `${pct(origin)}%` }} />}
      </div>
      <div class="slider-thumb" style={{ left: `${cur}%` }} />
    </div>
  );
}
