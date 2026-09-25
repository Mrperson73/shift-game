import { useEffect, useRef, useState } from 'preact/hooks';
import type { Knob } from '../core/types';
import { formatColor, parseColor, toHex6 } from '../core/colors';
import { niceCeil, snap } from '../core/ranges';
import * as S from './state';
import { Icon, fmtNumber, Slider } from './ui';
import { Menu } from './menu';

const GROUPS: [Knob['group'], string][] = [
  ['tunable', 'Tunables'],
  ['start', 'Starting values'],
  ['color', 'Colors'],
  ['style', 'Styles'],
  ['code', 'Numbers in code'],
];
const PAGE = 150;

const LIVE_HINT = {
  restart: 'Applies when the game restarts (Knobs restarts it for you after you let go)',
  spawn: 'Applies to objects created after the change',
};

function useCollapsed() {
  const [state, set] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('collapsed') ?? '{}');
    } catch {
      return {};
    }
  });
  const toggle = (g: string, now: boolean) => {
    const next = { ...state, [g]: !now };
    set(next);
    S.persist('collapsed', next);
  };
  return [state, toggle] as const;
}

export function KnobPanel() {
  const all = S.knobs.value;
  const filter = S.knobFilter.value.trim().toLowerCase();
  const pins = S.pinned.value;
  const [collapsed, toggle] = useCollapsed();
  const [pages, setPages] = useState<Record<string, number>>({});
  const terms = filter.split(/\s+/).filter(Boolean);
  const shown = terms.length ? all.filter((k) => terms.every((t) => `${k.label} ${k.scope} ${k.context} ${k.file}`.toLowerCase().includes(t))) : all;
  const groups: [string, string, Knob[]][] = [['pinned', 'Pinned', shown.filter((k) => pins.has(k.key))]];
  for (const [g, title] of GROUPS) groups.push([g, title, shown.filter((k) => k.group === g && !pins.has(k.key))]);
  const mod = S.modified.value.length;
  const ro = !!S.preview.value;

  return (
    <aside class="panel" aria-label="Knobs">
      <div class="panel-head">
        <label class="search">
          <Icon name="search" size={14} />
          <input
            id="knob-filter"
            placeholder="Filter knobs"
            value={S.knobFilter.value}
            spellcheck={false}
            onInput={(e) => (S.knobFilter.value = e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (S.knobFilter.value) S.knobFilter.value = '';
                else e.currentTarget.blur();
                e.stopPropagation();
              } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                (document.querySelector('.knob') as HTMLElement | null)?.focus();
              }
            }}
          />
          <span class="count">{terms.length ? `${shown.length}/${all.length}` : all.length}</span>
        </label>
        <Menu
          icon="sliders"
          title="Knob settings"
          items={[
            { label: 'Auto-restart for ↻ knobs', value: 'autoRestart', checked: S.settings.value.autoRestart },
            { label: 'Show numbers in code', value: 'codeNumbers', checked: S.settings.value.codeNumbers },
            { label: 'Reset all changes', value: 'reset', disabled: !mod },
          ]}
          onSelect={(v) => {
            if (v === 'reset') S.resetKnobs(null);
            else S.setSetting({ [v]: !S.settings.value[v as 'autoRestart' | 'codeNumbers'] });
          }}
        />
      </div>
      {ro && <div class="panel-note"><Icon name="history" size={14} /> Previewing an older version — knobs are read-only.</div>}
      {S.warnings.value.map((w) => (
        <div class="panel-warn" title={w}>
          <Icon name="alert" size={14} />
          <span>{w}</span>
        </div>
      ))}
      <div class="knob-list">
        {groups.map(([g, title, list]) => {
          if (!list.length) return null;
          const isCollapsed = !terms.length && (collapsed[g] ?? (g === 'code' && list.length > 12));
          const limit = pages[g] ?? PAGE;
          return (
            <section class="group" key={g}>
              <button class="group-head" onClick={() => toggle(g, isCollapsed)} aria-expanded={!isCollapsed}>
                <span class={`chev ${isCollapsed ? '' : 'open'}`}><Icon name="chevron" size={12} /></span>
                <span>{title}</span>
                <span class="group-count">{list.length}</span>
              </button>
              {!isCollapsed && list.slice(0, limit).map((k) => <KnobRow key={k.key} knob={k} ro={ro} />)}
              {!isCollapsed && list.length > limit && (
                <button class="more" onClick={() => setPages({ ...pages, [g]: limit + PAGE })}>Show {Math.min(PAGE, list.length - limit)} more</button>
              )}
            </section>
          );
        })}
        {!all.length && (
          <div class="empty-knobs">
            <Icon name="sliders" size={28} />
            <p>No knobs found yet.</p>
            <p class="muted">Knobs looks for numbers and colors in your game's scripts and styles. Named constants like <code>const GRAVITY = 0.5</code> and config objects work best.</p>
          </div>
        )}
        {all.length > 0 && !shown.length && <div class="empty-knobs"><p class="muted">No knobs match “{S.knobFilter.value}”.</p></div>}
      </div>
      <div class="panel-foot">
        <button class="btn" onClick={S.copyTweaks} disabled={!mod} title="Copy your changes as a message for your AI chat (Ctrl+Shift+C)">
          <Icon name="copy" size={14} />Copy for AI
        </button>
        <button class="btn primary grow" onClick={S.bake} disabled={!mod || ro} title="Write the tuned values into your source files (Ctrl+S)">
          <Icon name="flame" size={14} />
          {mod ? `Bake ${mod} change${mod > 1 ? 's' : ''}` : 'Bake'}
        </button>
      </div>
    </aside>
  );
}

function Label({ knob }: { knob: Knob }) {
  const [a, b] = knob.label.split('·');
  return (
    <span class="knob-label" title={`${knob.file}:${knob.line}\n${knob.context}`}>
      <span class="knob-name">
        {b !== undefined ? <>{a}<b class="dot">·</b>{b}</> : knob.label}
      </span>
      {knob.scope && <span class="knob-scope">{knob.scope}</span>}
    </span>
  );
}

function KnobRow({ knob, ro }: { knob: Knob; ro: boolean }) {
  const sig = S.values.value[knob.id];
  const rowRef = useRef<HTMLDivElement>(null);
  const focus = S.focusKnob.value;
  useEffect(() => {
    if (focus?.id !== knob.id || !rowRef.current) return;
    rowRef.current.scrollIntoView({ block: 'center' });
    rowRef.current.focus();
    rowRef.current.classList.remove('flash');
    void rowRef.current.offsetWidth;
    rowRef.current.classList.add('flash');
  }, [focus]);
  if (!sig) return null;
  const v = sig.value;
  const modified = v !== knob.value;
  const isPinned = S.pinned.value.has(knob.key);

  const reset = () => S.setKnob(knob.id, knob.value);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== rowRef.current) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>('.knob')];
      rows[rows.indexOf(rowRef.current!) + (k === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (ro) return;
    else if (knob.kind === 'number' && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault();
      const step = (knob.step ?? 0.1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      S.setKnob(knob.id, snap((v as number) + (k === 'ArrowRight' ? step : -step), e.altKey ? step : knob.step ?? 0.1));
    } else if (knob.kind === 'boolean' && (k === ' ' || k === 'Enter')) {
      e.preventDefault();
      S.setKnob(knob.id, !v);
    } else if (k === 'Enter') {
      e.preventDefault();
      rowRef.current!.querySelector<HTMLInputElement>('.knob-value')?.focus();
    } else if (k === 'Backspace' || k === 'Delete') reset();
    else if (k.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) S.togglePin(knob.key);
  };

  return (
    <div ref={rowRef} class={`knob kind-${knob.kind} ${modified ? 'mod' : ''}`} tabIndex={0} onKeyDown={onKeyDown} data-key={knob.key}>
      <div class="knob-head">
        <Label knob={knob} />
        {knob.live !== 'live' && (
          <span class={`live live-${knob.live}`} title={LIVE_HINT[knob.live]}>
            {knob.live === 'restart' ? <Icon name="restart" size={12} /> : <Icon name="sparkle" size={12} />}
          </span>
        )}
        <span class="knob-actions">
          <button class={`kact ${isPinned ? 'on' : ''}`} title={isPinned ? 'Unpin (P)' : 'Pin to top (P)'} onClick={() => S.togglePin(knob.key)} tabIndex={-1}>
            <Icon name="pin" size={13} />
          </button>
          {modified && !ro && (
            <button class="kact" title={`Reset to ${String(knob.value)} (Del)`} onClick={reset} tabIndex={-1}>
              <Icon name="reset" size={13} />
            </button>
          )}
        </span>
        {knob.kind === 'number' && <NumberInput knob={knob} value={v as number} ro={ro} />}
        {knob.kind === 'boolean' && (
          <button class={`toggle ${v ? 'on' : ''}`} role="switch" aria-checked={!!v} disabled={ro} onClick={() => S.setKnob(knob.id, !v)} tabIndex={-1}>
            <span />
          </button>
        )}
        {knob.kind === 'color' && <ColorInput knob={knob} value={String(v)} ro={ro} />}
      </div>
      {knob.kind === 'number' && <NumberSlider knob={knob} value={v as number} ro={ro} />}
      {knob.kind === 'color' && <AlphaSlider knob={knob} value={String(v)} ro={ro} />}
    </div>
  );
}

function rangeOf(knob: Knob, v: number): [number, number] {
  const custom = S.ranges.value[knob.key];
  let min = custom?.[0] ?? knob.min ?? 0;
  let max = custom?.[1] ?? knob.max ?? 1;
  if (v > max) max = niceCeil(v);
  if (v < min) min = -niceCeil(-v);
  return [min, max];
}

function NumberSlider({ knob, value, ro }: { knob: Knob; value: number; ro: boolean }) {
  const [min, max] = rangeOf(knob, value);
  return (
    <Slider
      value={value}
      min={min}
      max={max}
      step={knob.step ?? 0.01}
      origin={knob.value as number}
      disabled={ro}
      onInput={(n) => S.setKnob(knob.id, n)}
    />
  );
}

function NumberInput({ knob, value, ro }: { knob: Knob; value: number; ro: boolean }) {
  const editing = useRef<string | null>(null);
  const [, force] = useState(0);
  const step = knob.step ?? 0.01;
  const commit = () => {
    const t = editing.current;
    editing.current = null;
    force((n) => n + 1);
    if (t === null || !t.trim()) return;
    const n = Number(t.trim());
    if (!Number.isFinite(n)) return S.toast(`“${t}” isn't a number`, 'error');
    const [min, max] = rangeOf(knob, value);
    if (n > max || n < min) S.setRange(knob.key, [Math.min(min, n < 0 ? -niceCeil(-n * 1.5) : min), Math.max(max, n > 0 ? niceCeil(n * 1.5) : max)]);
    S.setKnob(knob.id, n);
  };
  return (
    <input
      class="knob-value"
      value={editing.current ?? fmtNumber(value, step)}
      disabled={ro}
      spellcheck={false}
      inputMode="decimal"
      tabIndex={-1}
      onFocus={(e) => {
        editing.current = fmtNumber(value, step);
        e.currentTarget.select();
      }}
      onInput={(e) => (editing.current = e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.currentTarget.closest('.knob') as HTMLElement | null)?.focus();
        } else if (e.key === 'Escape') {
          editing.current = null;
          e.stopPropagation();
          (e.currentTarget.closest('.knob') as HTMLElement | null)?.focus();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          const n = snap(value + d, e.altKey ? step / 10 : step);
          S.setKnob(knob.id, n);
          editing.current = fmtNumber(n, step);
        }
      }}
    />
  );
}

function ColorInput({ knob, value, ro }: { knob: Knob; value: string; ro: boolean }) {
  const c = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const editing = useRef<string | null>(null);
  const [, force] = useState(0);
  const commit = () => {
    const t = editing.current?.trim();
    editing.current = null;
    force((n) => n + 1);
    if (!t || t === value) return;
    if (!parseColor(t)) return S.toast(`“${t}” isn't a color`, 'error');
    S.setKnob(knob.id, t);
  };
  return (
    <span class="color-ctl">
      <label class="swatch" title="Pick a color">
        <span style={{ background: value }} />
        <input
          type="color"
          value={toHex6(c)}
          disabled={ro}
          tabIndex={-1}
          onInput={(e) => {
            const p = parseColor(e.currentTarget.value)!;
            S.setKnob(knob.id, formatColor({ ...p, a: c.a }, String(knob.value)));
          }}
        />
      </label>
      <input
        class="knob-value color-text"
        value={editing.current ?? value}
        disabled={ro}
        spellcheck={false}
        tabIndex={-1}
        onFocus={(e) => {
          editing.current = value;
          e.currentTarget.select();
        }}
        onInput={(e) => (editing.current = e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            editing.current = null;
            e.stopPropagation();
            (e.currentTarget.closest('.knob') as HTMLElement | null)?.focus();
          }
        }}
      />
    </span>
  );
}

function AlphaSlider({ knob, value, ro }: { knob: Knob; value: string; ro: boolean }) {
  const orig = parseColor(String(knob.value));
  const c = parseColor(value);
  if (!orig || !c || (!orig.hasAlpha && c.a === 1)) return null;
  return (
    <div class="alpha-row">
      <span class="alpha-label">alpha</span>
      <Slider value={c.a} min={0} max={1} step={0.01} origin={orig.a} disabled={ro} onInput={(a) => S.setKnob(knob.id, formatColor({ ...c, a }, String(knob.value)))} />
    </div>
  );
}
