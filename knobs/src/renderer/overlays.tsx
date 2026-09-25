import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as S from './state';
import { fuzzy, Icon, Kbd, timeAgo } from './ui';

interface Item { id: string; label: string; section: string; hint?: string; kbd?: string; run: () => void }

export const VIEWPORTS: [string, string][] = [
  ['fill', 'Fill window'],
  ['1280x720', '1280 × 720'],
  ['1920x1080', '1920 × 1080'],
  ['800x600', '800 × 600'],
  ['390x844', 'Phone 390 × 844'],
];

export function setViewport(v: string) {
  S.viewport.value = v;
  S.persist('viewport', v);
}

export function toggleDrawer(tab?: 'console' | 'perf' | 'versions') {
  if (tab && (!S.drawerOpen.value || S.drawerTab.value !== tab)) {
    S.drawerTab.value = tab;
    S.drawerOpen.value = true;
  } else S.drawerOpen.value = !S.drawerOpen.value;
  S.persist('drawerOpen', S.drawerOpen.value);
  S.persist('drawerTab', S.drawerTab.value);
}

export function togglePanel() {
  S.panelOpen.value = !S.panelOpen.value;
  S.persist('panelOpen', S.panelOpen.value);
}

export function toggleFocusMode() {
  if (S.view.value !== 'game') return;
  S.focusMode.value = !S.focusMode.value;
  S.api.setFullscreen(S.focusMode.value);
}

export function focusFilter() {
  if (!S.panelOpen.value) togglePanel();
  requestAnimationFrame(() => (document.getElementById('knob-filter') as HTMLInputElement | null)?.select());
}

export async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) S.pasteGame(text);
    else S.toast('The clipboard is empty.', 'error');
  } catch {
    S.toast('Press Ctrl+V to paste.', 'error');
  }
}

function commands(): Item[] {
  const inGame = S.view.value === 'game';
  const list: Item[] = [];
  const add = (section: string, id: string, label: string, run: () => void, kbd?: string, hint?: string) => list.push({ id, label, section, run, kbd, hint });
  if (inGame) {
    add('Game', 'restart', 'Restart game', S.restart, 'F5');
    add('Game', 'pause', S.paused.value ? 'Resume' : 'Pause', S.togglePause, 'F6');
    add('Game', 'step', 'Step one frame', S.step, 'F7');
    add('Game', 'slower', 'Slow motion (cycle)', S.slower, 'F8');
    for (const s of [2, 1, 0.5, 0.25, 0.1]) add('Game', `speed${s}`, `Speed ${s}×`, () => S.setScale(s), undefined, S.scale.value === s ? 'current' : undefined);
    add('Knobs', 'bake', 'Bake tuned values into source files', S.bake, 'Ctrl S');
    add('Knobs', 'copy', 'Copy changes for AI chat', S.copyTweaks, 'Ctrl Shift C');
    add('Knobs', 'reset', 'Reset all knobs', () => S.resetKnobs(null));
    add('Knobs', 'filter', 'Filter knobs', focusFilter, 'Ctrl F');
    add('Knobs', 'autoRestart', `${S.settings.value.autoRestart ? 'Disable' : 'Enable'} auto-restart for ↻ knobs`, () => S.setSetting({ autoRestart: !S.settings.value.autoRestart }));
    add('Knobs', 'codeNumbers', `${S.settings.value.codeNumbers ? 'Hide' : 'Show'} numbers in code`, () => S.setSetting({ codeNumbers: !S.settings.value.codeNumbers }));
    add('View', 'drawer', 'Toggle console & tools', () => toggleDrawer(), 'Ctrl J');
    add('View', 'panel', 'Toggle knobs panel', togglePanel, 'Ctrl B');
    add('View', 'console', 'Show console', () => toggleDrawer('console'));
    add('View', 'perf', 'Show performance', () => toggleDrawer('perf'));
    add('View', 'versions', 'Show versions', () => toggleDrawer('versions'));
    add('View', 'focus', 'Focus mode (game only, fullscreen)', toggleFocusMode, 'F11');
    for (const [v, label] of VIEWPORTS) add('View', `vp${v}`, `Viewport: ${label}`, () => setViewport(v), undefined, S.viewport.value === v ? 'current' : undefined);
    add('File', 'reveal', 'Show game file in folder', S.api.reveal);
    add('File', 'close', 'Close game', S.closeGame, 'Ctrl W');
    add('Tools', 'devtools', 'Open DevTools', S.api.toggleDevTools, 'F12');
  }
  add('File', 'paste', 'Paste game from clipboard', pasteFromClipboard, 'Ctrl V');
  add('File', 'open', 'Open HTML file…', () => S.openDialog('file'), 'Ctrl O');
  add('File', 'openFolder', 'Open game folder…', () => S.openDialog('folder'), 'Ctrl Shift O');
  add('File', 'demo', 'Open the demo game', S.openDemo);
  add('File', 'gamesFolder', 'Open the Knobs games folder', S.api.openGamesFolder);
  add('Help', 'help', 'Keyboard shortcuts & tips', () => (S.helpOpen.value = true), 'F1');
  return list;
}

export function Palette() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => inputRef.current?.focus(), []);
  const items = useMemo(() => {
    const all: Item[] = [...commands()];
    if (S.view.value === 'game') {
      for (const k of S.knobs.value) {
        all.push({
          id: `k${k.id}`, section: 'Knobs', label: k.label.replace('·', String(S.values.value[k.id]?.value ?? k.value)),
          hint: k.scope || k.file, run: () => {
            if (!S.panelOpen.value) togglePanel();
            S.knobFilter.value = '';
            requestAnimationFrame(() => (S.focusKnob.value = { id: k.id, n: Date.now() }));
          },
        });
      }
    }
    for (const r of S.recents.value) {
      if (r.id !== S.game.value?.id) all.push({ id: `r${r.id}`, section: 'Recent games', label: r.name, hint: timeAgo(r.lastOpened), run: () => S.openPath(r.path) });
    }
    if (!q.trim()) return all.filter((i) => i.section !== 'Knobs').slice(0, 80);
    return all
      .map((i) => ({ i, s: fuzzy(q.trim(), `${i.label} ${i.hint ?? ''}`) }))
      .filter((x) => x.s >= 0)
      .map((x) => ({ ...x, s: x.s + (x.i.section === 'Knobs' ? 0 : 5) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.i);
  }, [q]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const close = () => (S.paletteOpen.value = false);
  const run = (i: Item | undefined) => {
    if (!i) return;
    close();
    i.run();
  };
  let lastSection = '';
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="palette" role="dialog" aria-label="Command palette">
        <div class="pal-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            placeholder="Search commands, knobs and games…"
            value={q}
            spellcheck={false}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            }}
          />
        </div>
        <div class="pal-list" ref={listRef}>
          {!items.length && <div class="empty">Nothing matches.</div>}
          {items.map((it, idx) => {
            const head = it.section !== lastSection ? <div class="pal-section">{it.section}</div> : null;
            lastSection = it.section;
            return (
              <>
                {head}
                <button class={`pal-item ${idx === sel ? 'sel' : ''}`} onMouseMove={() => idx !== sel && setSel(idx)} onClick={() => run(it)}>
                  <span class="pal-label">{it.label}</span>
                  {it.hint && <span class="pal-hint">{it.hint}</span>}
                  {it.kbd && <span class="pal-kbd">{it.kbd.split(' ').map((k) => <Kbd>{k}</Kbd>)}</span>}
                </button>
              </>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['F5', 'Restart the game'],
  ['F6', 'Pause / resume'],
  ['F7', 'Step one frame (hold to crawl)'],
  ['F8 / Shift F8', 'Slow motion: slower / faster'],
  ['F11', 'Focus mode (game only, fullscreen)'],
  ['F12', 'DevTools'],
  ['Ctrl K', 'Command palette: commands, knobs, games'],
  ['Ctrl V', 'Paste a game (or a new version of this one)'],
  ['Ctrl O / Ctrl Shift O', 'Open a file / folder'],
  ['Ctrl S', 'Bake tuned values into the source'],
  ['Ctrl Shift C', 'Copy your changes for an AI chat'],
  ['Ctrl F or /', 'Filter knobs'],
  ['Ctrl J / Ctrl B', 'Toggle console / knobs panel'],
  ['Ctrl W', 'Close the game'],
];
const KNOB_KEYS: [string, string][] = [
  ['↑ ↓', 'Move between knobs'],
  ['← →', 'Nudge value (Shift ×10, Alt ×0.1)'],
  ['Enter', 'Type a value'],
  ['Del', 'Reset to the source value'],
  ['P', 'Pin knob to the top'],
  ['Shift + drag', 'Fine slider control'],
];

export function Help() {
  const close = () => (S.helpOpen.value = false);
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="help" role="dialog" aria-label="Keyboard shortcuts">
        <div class="help-head">
          <h2>Keyboard shortcuts</h2>
          <button class="ibtn" onClick={close} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div class="help-cols">
          <div>
            {SHORTCUTS.map(([k, d]) => (
              <div class="help-row"><span class="help-keys">{k.split(' / ').map((c, i) => <>{i > 0 && <span class="muted"> / </span>}{c.split(' ').map((x) => <Kbd>{x}</Kbd>)}</>)}</span><span>{d}</span></div>
            ))}
          </div>
          <div>
            <h3>In the knobs panel</h3>
            {KNOB_KEYS.map(([k, d]) => (
              <div class="help-row"><span class="help-keys"><Kbd>{k}</Kbd></span><span>{d}</span></div>
            ))}
            <h3>Tips</h3>
            <ul class="tips">
              <li>F-keys work even while the game has keyboard focus. Other shortcuts work after you click outside the game.</li>
              <li><Icon name="restart" size={12} /> knobs are read once at startup; Knobs restarts the game for you. <Icon name="sparkle" size={12} /> knobs apply to newly created objects.</li>
              <li>Chatting with an AI? <b>Copy for AI</b> tells it your tuned values so the next version keeps them.</li>
              <li>Every code change is saved under <b>Versions</b> — play or restore any of them.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {S.toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.kind === 'error' ? <Icon name="alert" size={15} /> : t.kind === 'success' ? <Icon name="check" size={15} /> : null}
          <span>{t.text}</span>
          {t.action && (
            <button class="toast-act" onClick={() => { t.action!.run(); S.toasts.value = S.toasts.value.filter((x) => x !== t); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function DropOverlay({ onDone }: { onDone: () => void }) {
  return (
    <div
      class="drop"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) onDone();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDone();
        const f = e.dataTransfer?.files[0];
        if (f) {
          const p = S.api.pathForFile(f);
          if (p) S.openPath(p);
          return;
        }
        const text = e.dataTransfer?.getData('text/plain');
        if (text) S.pasteGame(text);
      }}
    >
      <div class="drop-card">
        <Icon name="file" size={32} />
        <div>Drop an .html file or a game folder</div>
      </div>
    </div>
  );
}
