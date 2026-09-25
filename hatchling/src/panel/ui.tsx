// Building blocks of the panel: switches, segmented controls, sliders, meters, counters, toasts
// and the habitat canvas.

import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { type Subject, Scene } from './scene';
import { sfx } from './sfx';
import { reactions, reducedMotion, theme } from './state';
import { BIOMES, onThemeChange } from './theme';
import { Icon, type IconName } from './icons';

// ---------------- keyboard ----------------

/** Arrow keys (and Home/End) move through a radio group, selecting as they go. Up and down
 * move by a row when the group is laid out as a grid. */
export function radioKeys(e: KeyboardEvent) {
  const me = e.currentTarget as HTMLElement;
  const group = me.closest<HTMLElement>('[role="radiogroup"]');
  if (!group) return;
  const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = radios.indexOf(me);
  const css = getComputedStyle(group);
  const grid = css.display.includes('grid') ? css.gridTemplateColumns.split(' ').filter(Boolean).length : 1;
  // A single row (like a segmented control) moves one step either way.
  const cols = radios.length > grid ? grid : 1;
  let n = i;
  if (e.key === 'ArrowRight') n = i + 1;
  else if (e.key === 'ArrowLeft') n = i - 1;
  else if (e.key === 'ArrowDown') n = Math.min(radios.length - 1, i + cols);
  else if (e.key === 'ArrowUp') n = Math.max(0, i - cols);
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = radios.length - 1;
  else return;
  e.preventDefault();
  n = (n + radios.length) % radios.length;
  radios[n].focus();
  radios[n].click();
}

// ---------------- controls ----------------

export function SwitchRow(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; icon?: IconName }) {
  const id = useId();
  return (
    <label class="setting switch-row">
      {props.icon && (
        <span class="setting-icon">
          <Icon name={props.icon} size={18} />
        </span>
      )}
      <span class="setting-text">
        <span class="setting-label">{props.label}</span>
        {props.hint && (
          <span class="setting-hint" id={id}>
            {props.hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        class="switch"
        aria-label={props.label}
        aria-describedby={props.hint ? id : undefined}
        checked={props.checked}
        onChange={(e) => {
          sfx.play('toggle');
          props.onChange(e.currentTarget.checked);
        }}
      />
    </label>
  );
}

export function Segmented<T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; small?: boolean }) {
  const i = Math.max(0, props.options.findIndex(([v]) => v === props.value));
  return (
    <div class={`seg ${props.small ? 'seg-small' : ''}`} role="radiogroup" aria-label={props.label} style={{ '--n': props.options.length, '--i': i } as JSX.CSSProperties}>
      <span class="seg-thumb" aria-hidden="true" />
      {props.options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === props.value}
          tabIndex={v === props.value ? 0 : -1}
          class={v === props.value ? 'on' : ''}
          onClick={() => {
            if (v === props.value) return;
            sfx.play('click');
            props.onChange(v);
          }}
          onKeyDown={(e) => radioKeys(e)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function SettingRow(props: { label: string; hint?: string; icon?: IconName; children: ComponentChildren; stack?: boolean }) {
  return (
    <div class={`setting ${props.stack ? 'stack' : ''}`}>
      {props.icon && (
        <span class="setting-icon">
          <Icon name={props.icon} size={18} />
        </span>
      )}
      <span class="setting-text">
        <span class="setting-label">{props.label}</span>
        {props.hint && <span class="setting-hint">{props.hint}</span>}
      </span>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}

export function Slider(props: { label: string; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <input
      type="range"
      class="slider"
      min={0}
      max={1}
      step={0.05}
      value={v}
      aria-label={props.label}
      aria-valuetext={`${Math.round(v * 100)}%`}
      style={{ '--p': `${v * 100}%` } as JSX.CSSProperties}
      onInput={(e) => setV(Number(e.currentTarget.value))}
      onChange={(e) => props.onCommit(Number(e.currentTarget.value))}
    />
  );
}

// ---------------- meters and numbers ----------------

export function Meter(props: { label: string; value: number; text: string; tone: string; icon: IconName }) {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <div class={`need tone-${props.tone}`}>
      <span class="need-icon">
        <Icon name={props.icon} size={18} />
      </span>
      <div class="need-body">
        <div class="need-head">
          <span class="need-label">{props.label}</span>
          <span class="need-text">{props.text}</span>
        </div>
        <div class="meter" role="meter" aria-label={props.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${props.text}, ${pct}%`}>
          <div class="meter-fill" style={{ '--v': Math.max(0.03, pct / 100) } as JSX.CSSProperties}>
            <span class="meter-shine" key={pct} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A number that counts up (or down) to its new value. */
export function CountUp(props: { value: number; format?: (n: number) => string }) {
  const fmt = props.format ?? ((n: number) => Math.round(n).toLocaleString());
  const [shown, setShown] = useState(reducedMotion.value ? props.value : 0);
  const from = useRef(shown);
  useEffect(() => {
    const a = from.current;
    const b = props.value;
    if (a === b) return;
    if (reducedMotion.value || document.hidden) {
      from.current = b;
      setShown(b);
      return;
    }
    const start = performance.now();
    const dur = Math.min(1100, 450 + Math.abs(b - a) * 30);
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      const v = a + (b - a) * e;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [props.value]);
  return <>{fmt(shown)}</>;
}

// ---------------- toasts ----------------

interface Toast {
  id: number;
  text: string;
  sub?: string;
  icon: IconName;
  tone: 'good' | 'gold';
}

const toastList = signal<Toast[]>([]);
let toastId = 0;

export function toast(text: string, opts: { icon?: IconName; tone?: Toast['tone']; sub?: string } = {}) {
  const t: Toast = { id: ++toastId, text, sub: opts.sub, icon: opts.icon ?? 'check', tone: opts.tone ?? 'good' };
  toastList.value = [...toastList.value.slice(-2), t];
  setTimeout(() => (toastList.value = toastList.value.filter((x) => x.id !== t.id)), 3400);
}

export function clearToasts() {
  toastList.value = [];
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toastList.value.map((t) => (
        <div key={t.id} class={`toast tone-${t.tone}`}>
          <span class="toast-icon">
            <Icon name={t.icon} size={20} />
          </span>
          <span class="toast-text">
            <strong>{t.text}</strong>
            {t.sub && <span>{t.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------- the habitat canvas ----------------

export function Habitat(props: {
  subject: () => Subject;
  label: string;
  active?: boolean;
  preview?: boolean;
  class?: string;
  /** Gets the scene once it's running (and null when it's gone), to trigger reactions. */
  onScene?: (s: Scene | null) => void;
  onPet?: () => void;
  onEgg?: () => void;
  onHatch?: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cur = useRef(props);
  cur.current = props;
  const scene = useRef<Scene | null>(null);
  useEffect(() => {
    const s = new Scene(ref.current!, {
      subject: () => cur.current.subject(),
      biome: () => BIOMES[theme.value.id],
      calm: () => reducedMotion.value,
      onPet: () => cur.current.onPet?.(),
      onEgg: () => cur.current.onEgg?.(),
      onHatch: (x, y) => {
        const r = ref.current!.getBoundingClientRect();
        cur.current.onHatch?.(r.left + x, r.top + y);
      },
      preview: props.preview,
    });
    scene.current = s;
    props.onScene?.(s);
    const offReact = props.preview ? () => {} : reactions.on((r) => s.react(r));
    const offTheme = onThemeChange(() => s.redraw());
    return () => {
      offReact();
      offTheme();
      s.destroy();
      scene.current = null;
      cur.current.onScene?.(null);
    };
  }, []);
  useEffect(() => {
    if (props.active === false) scene.current?.stop();
    else scene.current?.start();
  }, [props.active]);
  return <canvas ref={ref} class={`habitat ${props.class ?? ''}`} role="img" aria-label={props.label} />;
}
