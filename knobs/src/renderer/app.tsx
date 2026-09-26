import { useEffect, useRef, useState } from 'preact/hooks';
import * as S from './state';
import type { Shortcut } from '../shared/types';
import { Icon, IconButton, Kbd, Logo, timeAgo } from './ui';
import { Menu } from './menu';
import { KnobPanel } from './knobs';
import { Drawer } from './drawer';
import { DropOverlay, focusFilter, Help, Palette, pasteFromClipboard, setViewport, Toasts, toggleDrawer, toggleFocusMode, togglePanel, VIEWPORTS } from './overlays';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

const FKEYS: Record<string, Shortcut | 'devtools'> = { F1: 'help', F5: 'restart', F6: 'pause', F7: 'step', F8: 'slower', F11: 'focus', F12: 'devtools' };

let lastShortcut = { s: '', t: 0 };

function runShortcut(s: Shortcut | 'devtools') {
  // The same key can arrive twice (main-process hook + page fallback); act once.
  const now = performance.now();
  if (lastShortcut.s === s && now - lastShortcut.t < 60 && s !== 'step') return;
  lastShortcut = { s, t: now };
  if (s === 'palette') S.paletteOpen.value = !S.paletteOpen.value;
  else if (s === 'help') S.helpOpen.value = !S.helpOpen.value;
  else if (s === 'devtools') S.api.toggleDevTools();
  else if (S.view.value !== 'game') return;
  else if (s === 'restart') S.restart();
  else if (s === 'pause') S.togglePause();
  else if (s === 'step') S.step();
  else if (s === 'slower') S.slower();
  else if (s === 'faster') S.faster();
  else if (s === 'focus') toggleFocusMode();
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const inGame = S.view.value === 'game';
      if (e.key === 'Escape') {
        if (S.paletteOpen.value) S.paletteOpen.value = false;
        else if (S.helpOpen.value) S.helpOpen.value = false;
        else if (S.focusMode.value) toggleFocusMode();
        else if (isTyping(e.target)) (e.target as HTMLElement).blur();
        return;
      }
      if (!mod) {
        // F-keys normally arrive via the main process (so they work while the game has focus);
        // this is the fallback for synthetic key events that bypass it.
        const fkey = FKEYS[e.key];
        if (fkey && !e.altKey) {
          e.preventDefault();
          runShortcut(e.key === 'F8' && e.shiftKey ? 'faster' : fkey);
          return;
        }
        if (e.key === '/' && inGame && !isTyping(e.target)) {
          e.preventDefault();
          focusFilter();
        }
        return;
      }
      const k = e.key.toLowerCase();
      const act = (fn: () => unknown) => {
        e.preventDefault();
        fn();
      };
      if (k === 'o') act(() => S.openDialog(e.shiftKey ? 'folder' : 'file'));
      else if (k === 'k' && !e.shiftKey) act(() => runShortcut('palette'));
      if (!inGame) return;
      if (k === 's') act(S.bake);
      else if (k === 'r') act(S.restart);
      else if (k === 'j') act(() => toggleDrawer());
      else if (k === 'b') act(togglePanel);
      else if (k === 'f') act(focusFilter);
      else if (k === 'w') act(S.closeGame);
      else if (k === 'p') act(S.togglePause);
      else if (k === 'c' && e.shiftKey) act(S.copyTweaks);
      else if (k === 'e' && e.shiftKey) {
        const last = [...S.logs.value].reverse().find((l) => l.level === 'error');
        act(() => (last ? S.copyError(last) : S.toast('No errors to copy.')));
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || S.paletteOpen.value) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      S.pasteGame(text);
    };
    const onBlur = () => setTimeout(() => (S.gameFocused.value = document.activeElement === S.getFrame() && !!S.getFrame()), 0);
    const onFocus = () => (S.gameFocused.value = false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    const off = S.api.on('shortcut', runShortcut);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, []);
}

export function App() {
  useGlobalKeys();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragging(true);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    return () => window.removeEventListener('dragenter', enter);
  }, []);
  return (
    <div class={`app ${S.focusMode.value ? 'focus-mode' : ''}`}>
      {!S.focusMode.value && <Titlebar />}
      {S.view.value === 'home' ? <Home /> : <Workspace />}
      {S.paletteOpen.value && <Palette />}
      {S.helpOpen.value && <Help />}
      {dragging && <DropOverlay onDone={() => setDragging(false)} />}
      {S.loading.value && <div class="loading-bar" />}
      <Toasts />
    </div>
  );
}

function Titlebar() {
  const g = S.game.value;
  return (
    <header class="titlebar">
      <button class="brand" onClick={() => g && S.closeGame()} title={g ? 'Back to home (Ctrl W)' : 'Knobs'}>
        <Logo size={20} />
        <span>Knobs</span>
      </button>
      {g && (
        <>
          <span class="crumb">/</span>
          <button class="game-name" onClick={() => (S.paletteOpen.value = true)} title={g.path}>
            {g.name}
          </button>
          {S.preview.value && <span class="pill accent">old version</span>}
        </>
      )}
      <div class="drag" />
      <button class="cmdk" onClick={() => (S.paletteOpen.value = true)} title="Command palette">
        <Icon name="search" size={14} />
        <span>Search</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>
      <button class="ibtn tb-help" onClick={() => (S.helpOpen.value = true)} title="Keyboard shortcuts (F1)" aria-label="Keyboard shortcuts">
        <Icon name="keyboard" />
      </button>
    </header>
  );
}

function Home() {
  const list = S.recents.value;
  return (
    <main class="home">
      <div class="home-inner">
        <section class="hero">
          <Logo size={64} />
          <div>
            <h1>Knobs</h1>
            <p>Tune your HTML games while they run.</p>
          </div>
        </section>
        <section class="dropzone">
          <div class="dz-title">
            Paste a game <Kbd>Ctrl</Kbd><Kbd>V</Kbd>
          </div>
          <p class="dz-sub">
            Copy the code of any single-file HTML game, such as a Claude artifact, and paste it here. You can also drop in an <code>.html</code> file or a game folder. Every number and color in its code becomes a live slider.
          </p>
          <div class="dz-actions">
            <button class="btn primary" onClick={pasteFromClipboard}>
              <Icon name="clipboard" size={15} />Paste from clipboard
            </button>
            <button class="btn" onClick={() => S.openDialog('file')}>
              <Icon name="file" size={15} />Open file…
            </button>
            <button class="btn" onClick={() => S.openDialog('folder')}>
              <Icon name="folder" size={15} />Open folder…
            </button>
            <button class="btn ghost" onClick={S.openDemo}>
              <Icon name="gamepad" size={15} />Try the demo
            </button>
          </div>
        </section>
        {!list.length && (
          <section class="steps">
            {[
              ['clipboard', 'Bring a game', 'Paste HTML from any AI chat, open a file, or drop a folder. Knobs finds every number and color in its code.'],
              ['sliders', 'Tune while you play', 'Drag sliders and the game changes instantly. Pause, step frames or slow it down to judge the feel.'],
              ['flame', 'Keep what works', 'Bake the values into your file, or copy them as a message so your AI keeps them in the next version.'],
            ].map(([icon, title, text], i) => (
              <div class="step" key={title}>
                <div class="step-num">{i + 1}</div>
                <Icon name={icon} size={18} />
                <div class="step-title">{title}</div>
                <p>{text}</p>
              </div>
            ))}
          </section>
        )}
        {list.length > 0 && (
          <section class="recents">
            <div class="recents-head">
              <h2>Recent</h2>
              <button class="link" onClick={() => S.api.openGamesFolder()}>Open games folder</button>
            </div>
            <div class="grid">
              {list.map((r) => (
                <div class="card" tabIndex={0} key={r.id} onClick={() => S.openPath(r.path)} onKeyDown={(e) => e.key === 'Enter' && S.openPath(r.path)} title={r.path}>
                  <div class="thumb">
                    {r.thumb ? <img src={`knobs-app://ui/thumbs/${r.id}.jpg?t=${r.thumb}`} alt="" loading="lazy" /> : <Icon name="gamepad" size={30} />}
                  </div>
                  <div class="card-body">
                    <div class="card-title">{r.name}</div>
                    <div class="card-sub">{timeAgo(r.lastOpened)}</div>
                  </div>
                  <button
                    class="card-x"
                    title="Remove from recent"
                    aria-label="Remove from recent"
                    onClick={async (e) => {
                      e.stopPropagation();
                      S.recents.value = await S.api.removeRecent(r.id);
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        <footer class="home-foot">
          <span><Kbd>F1</Kbd> shortcuts</span>
          <span><Kbd>Ctrl</Kbd><Kbd>K</Kbd> commands</span>
          <span class="muted">Runs 100% offline · v{S.info.value?.version}</span>
        </footer>
      </div>
    </main>
  );
}

function Workspace() {
  const focus = S.focusMode.value;
  const panel = S.panelOpen.value && !focus;
  return (
    <div class="workspace" style={{ gridTemplateColumns: panel ? `minmax(0, 1fr) ${S.panelWidth.value}px` : 'minmax(0, 1fr)' }}>
      <div class="center">
        {!focus && <Toolbar />}
        <Stage />
        {!focus && S.drawerOpen.value && <Drawer />}
      </div>
      {panel && (
        <div class="panel-wrap">
          <PanelResizer />
          <KnobPanel />
        </div>
      )}
    </div>
  );
}

function PanelResizer() {
  return (
    <div
      class="resizer-v"
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const w0 = S.panelWidth.value;
        const move = (ev: PointerEvent) => (S.panelWidth.value = Math.round(Math.min(640, Math.max(280, w0 + x0 - ev.clientX))));
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', () => {
          el.removeEventListener('pointermove', move);
          S.persist('panelWidth', S.panelWidth.value);
        }, { once: true });
      }}
    />
  );
}

function Toolbar() {
  const paused = S.paused.value;
  const scale = S.scale.value;
  const errors = S.errorCount.value;
  const fps = S.fps.value;
  const vp = VIEWPORTS.find(([v]) => v === S.viewport.value) ?? VIEWPORTS[0];
  return (
    <div class="toolbar">
      <IconButton icon="restart" title="Restart (F5)" onClick={S.restart} />
      <IconButton icon={paused ? 'play' : 'pause'} title={paused ? 'Resume (F6)' : 'Pause (F6)'} onClick={S.togglePause} active={paused} />
      <IconButton icon="step" title="Step one frame (F7)" onClick={S.step} />
      <Menu
        title="Game speed (F8)"
        label={<span class={`speed ${scale !== 1 ? 'on' : ''}`}>{scale}×</span>}
        items={[2, 1, 0.5, 0.25, 0.1].map((s) => ({ label: `${s}×`, value: String(s), active: s === scale, hint: s === 1 ? 'normal' : s < 1 ? 'slow motion' : 'fast' }))}
        onSelect={(v) => S.setScale(Number(v))}
        align="left"
      />
      <span class="tb-sep" />
      <Menu
        icon="monitor"
        title="Viewport size"
        label={<span class="tb-label">{vp[0] === 'fill' ? 'Fill' : vp[1]}</span>}
        items={VIEWPORTS.map(([v, label]) => ({ label, value: v, active: v === vp[0] }))}
        onSelect={setViewport}
        align="left"
      />
      <div class="tb-spacer" />
      {S.gameFocused.value && <span class="focus-hint">Keys go to the game · F-keys still work</span>}
      <button class={`fps ${fps >= 55 ? 'good' : fps >= 30 ? 'ok' : fps > 0 ? 'bad' : ''}`} onClick={() => toggleDrawer('perf')} title="Frames per second: click for performance details">
        <Icon name="gauge" size={14} />
        {paused ? 'paused' : fps ? `${fps} fps` : '– fps'}
      </button>
      <button class={`errs ${errors ? 'has' : ''}`} onClick={() => toggleDrawer('console')} title="Console">
        <Icon name={errors ? 'alert' : 'terminal'} size={14} />
        {errors ? `${errors} error${errors > 1 ? 's' : ''}` : 'Console'}
      </button>
      <IconButton icon="drawer" title="Console & tools (Ctrl J)" onClick={() => toggleDrawer()} active={S.drawerOpen.value} />
      <IconButton icon="panel" title="Knobs panel (Ctrl B)" onClick={togglePanel} active={S.panelOpen.value} />
    </div>
  );
}

function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vp = S.viewport.value;
  let wrapStyle: Record<string, string> = {};
  let fixed = false;
  if (vp !== 'fill' && box.w) {
    const [w, h] = vp.split('x').map(Number);
    const s = Math.min((box.w - 24) / w, (box.h - 24) / h);
    wrapStyle = { width: `${w}px`, height: `${h}px`, transform: `translate(-50%, -50%) scale(${s})` };
    fixed = true;
  }
  const pv = S.preview.value;
  return (
    <div class={`stage ${S.gameFocused.value ? 'focused' : ''}`} ref={ref}>
      <div class={`frame-wrap ${fixed ? 'fixed' : ''}`} style={wrapStyle}>
        {S.gameUrl.value && (
          <iframe
            ref={S.setFrame}
            src={S.gameUrl.value}
            title="Game"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-modals allow-popups allow-downloads"
            allow="fullscreen; gamepad; autoplay; clipboard-write"
          />
        )}
      </div>
      {pv && (
        <div class="preview-banner">
          <Icon name="history" size={15} />
          <span>Playing the version from {new Date(pv.ts).toLocaleString()}</span>
          <button class="btn tiny" onClick={() => S.restoreVersion(pv.id)}>Restore it</button>
          <button class="btn tiny primary" onClick={S.exitPreview}>Back to current</button>
        </div>
      )}
      {S.paused.value && (
        <div class="paused-badge">
          <Icon name="pause" size={13} /> Paused · <Kbd>F6</Kbd> resume · <Kbd>F7</Kbd> step
        </div>
      )}
      {S.scale.value !== 1 && !S.paused.value && <div class="paused-badge slow">{S.scale.value}× speed · <Kbd>F8</Kbd></div>}
    </div>
  );
}
