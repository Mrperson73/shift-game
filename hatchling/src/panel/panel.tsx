import { computed, signal } from '@preact/signals';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { growthOf, hoursToNextStage, STAGES, stageName, stageOf } from '../pet/growth';
import type { PoseName } from '../pet/poses';
import type { SpeciesDef } from '../pet/species';
import type { ModProblem, PanelInit, PetData, Settings } from '../shared/types';
import { animate, type PortraitOpts } from './portrait';

const api = window.panel;

const info = signal<PanelInit | null>(null);
const view = signal<PanelInit['view']>('card');
const pet = signal<PetData | null>(null);
const settings = signal<Settings | null>(null);
const species = signal<SpeciesDef[]>([]);
const problems = signal<ModProblem[]>([]);

const speciesOf = (id: string) => species.value.find((s) => s.id === id) ?? species.value[0];
const growth = computed(() => (pet.value ? growthOf(pet.value.activeSeconds) : 0));

const DEFAULT_NAMES: Record<string, string[]> = {
  rex: ['Rexy', 'Chomper', 'Tiny', 'Sue'],
  raptor: ['Blue', 'Zip', 'Echo', 'Dash'],
  pachy: ['Bonk', 'Dome', 'Pebble', 'Nugget'],
};
const pickName = (id: string) => {
  const list = DEFAULT_NAMES[id] ?? ['Hatch'];
  return list[Math.floor(Math.random() * list.length)];
};

function Portrait(props: { opts: PortraitOpts; height: number; class?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const opts = useRef(props.opts);
  opts.current = props.opts;
  useEffect(() => animate(ref.current!, () => opts.current), []);
  return <canvas ref={ref} class={props.class} style={{ width: '100%', height: `${props.height}px`, display: 'block' }} />;
}

function Header() {
  const has = !!pet.value;
  const v = view.value;
  return (
    <header>
      <div class="brand">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 2.5c4.2 0 7.5 5.6 7.5 10.4 0 4.6-3.3 8.6-7.5 8.6s-7.5-4-7.5-8.6C4.5 8.1 7.8 2.5 12 2.5z" fill="var(--egg)" stroke="var(--ink)" stroke-width="1.6" />
          <circle cx="9.5" cy="10" r="1.6" fill="var(--accent)" />
          <circle cx="14.5" cy="14.5" r="1.3" fill="var(--accent)" />
          <circle cx="11" cy="17" r="1" fill="var(--accent)" />
        </svg>
        Hatchling
      </div>
      {has && v !== 'choose' && (
        <nav>
          <button class={v === 'card' ? 'on' : ''} onClick={() => (view.value = 'card')}>
            {pet.value!.name}
          </button>
          <button class={v === 'settings' ? 'on' : ''} onClick={() => (view.value = 'settings')}>
            Settings
          </button>
        </nav>
      )}
    </header>
  );
}

// ---------------- choose an egg ----------------

function Choose() {
  const list = species.value;
  const [sel, setSel] = useState(0);
  const sp = list[Math.min(sel, list.length - 1)];
  const [variant, setVariant] = useState(() => Math.floor(Math.random() * sp.variants.length));
  const [name, setName] = useState(() => pickName(sp.id));
  const [named, setNamed] = useState(false);
  const [autostart, setAutostart] = useState(settings.value?.startWithWindows ?? true);
  const [busy, setBusy] = useState(false);
  const choose = (i: number) => {
    setSel(i);
    setVariant(Math.floor(Math.random() * list[i].variants.length));
    if (!named) setName(pickName(list[i].id));
  };
  const hatch = async () => {
    setBusy(true);
    await api.hatch({ species: sp.id, variant, name: name.trim() || pickName(sp.id), startWithWindows: autostart });
    setBusy(false);
  };
  return (
    <main class="choose">
      <h1>{pet.value ? 'Choose a new egg' : 'Choose your egg'}</h1>
      <p class="lead">It hatches on your taskbar and grows up while you use your PC.</p>
      <div class="eggs" role="radiogroup" aria-label="Species">
        {list.map((s, i) => (
          <button key={s.id} role="radio" aria-checked={i === sel} class={`egg ${i === sel ? 'on' : ''}`} onClick={() => choose(i)} title={s.name}>
            <Portrait opts={{ species: s, variant: i === sel ? variant : 0, growth: 0, egg: true, zoom: 1, wobble: i === sel }} height={86} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <section class="about">
        <div class="latin">{sp.latin}</div>
        <p>{sp.blurb}</p>
        <div class="swatches" role="radiogroup" aria-label="Colour">
          {sp.variants.map((v, i) => (
            <button key={v.id} role="radio" aria-checked={i === variant} class={i === variant ? 'on' : ''} title={v.name} onClick={() => setVariant(i)} style={{ background: `linear-gradient(135deg, ${v.body} 55%, ${v.belly} 55%)` }}>
              <span class="sr">{v.name}</span>
            </button>
          ))}
          <span class="vname">{sp.variants[variant % sp.variants.length].name}</span>
        </div>
      </section>
      <label class="field">
        <span>Name</span>
        <input
          value={name}
          maxLength={24}
          onInput={(e) => {
            setName((e.target as HTMLInputElement).value);
            setNamed(true);
          }}
          onKeyDown={(e) => e.key === 'Enter' && !busy && hatch()}
        />
      </label>
      <label class="check">
        <input type="checkbox" checked={autostart} onChange={(e) => setAutostart((e.target as HTMLInputElement).checked)} />
        <span>Start Hatchling when Windows starts</span>
      </label>
      {pet.value && <p class="note">{pet.value.name} will be remembered in your pet history.</p>}
      <div class="row end">
        {pet.value && (
          <button class="ghost" onClick={() => (view.value = 'card')}>
            Cancel
          </button>
        )}
        <button class="primary big" disabled={busy} onClick={hatch}>
          Hatch {name.trim() || sp.name}!
        </button>
      </div>
    </main>
  );
}

// ---------------- the pet card ----------------

function Bar(props: { label: string; value: number; hint: string }) {
  return (
    <div class="bar" title={props.hint}>
      <span>{props.label}</span>
      <div class="track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(props.value * 100)} aria-label={props.label}>
        <div class="fill" style={{ width: `${Math.max(3, props.value * 100)}%` }} />
      </div>
      <em>{props.hint}</em>
    </div>
  );
}

function ago(ms: number) {
  const d = Math.floor(ms / 86400000);
  if (d >= 2) return `${d} days ago`;
  if (d === 1) return 'yesterday';
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return 'just now';
}

function hours(h: number) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h`;
}

function Card() {
  const p = pet.value;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p?.name ?? '');
  if (!p) return <Choose />;
  const sp = speciesOf(p.species);
  const g = growth.value;
  const st = stageOf(g);
  const next = hoursToNextStage(p.activeSeconds);
  const nextStage = STAGES.find((s) => s.from > g);
  const egg = p.hatchedAt === null;
  const cmd = (type: 'feed' | 'play' | 'call' | 'sleep' | 'wake' | 'hatch-now') => api.command({ type });
  const rename = () => {
    const n = draft.trim();
    if (n && n !== p.name) api.command({ type: 'rename', name: n });
    setEditing(false);
  };
  const mood = p.happiness > 0.75 ? 'Very happy' : p.happiness > 0.5 ? 'Happy' : p.happiness > 0.3 ? 'Okay' : 'Bored';
  const pose: PoseName = p.energy < 0.2 ? 'lie' : p.happiness > 0.8 ? 'happy' : 'stand';
  return (
    <main class="card">
      <div class="portrait">
        <Portrait opts={{ species: sp, variant: p.variant, growth: g, egg, zoom: 1.25, pose, wobble: true, fit: true }} height={170} />
      </div>
      <div class="title">
        {editing ? (
          <input
            class="name-edit"
            value={draft}
            maxLength={24}
            autoFocus
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <h1>
            <button
              class="name"
              title="Rename"
              aria-label={`${p.name} (rename)`}
              onClick={() => {
                setDraft(p.name);
                setEditing(true);
              }}
            >
              {p.name}
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              </svg>
            </button>
          </h1>
        )}
        <div class="sub">
          {sp.name} · {sp.variants[p.variant % sp.variants.length].name}
          {!egg && p.hatchedAt ? ` · hatched ${ago(Date.now() - p.hatchedAt)}` : ''}
        </div>
      </div>
      {egg ? (
        <section class="egg-note">
          <p>
            Your egg is on your taskbar. <strong>Click it</strong> to help it hatch — or wait, it'll hatch on its own in a minute.
          </p>
          <button class="primary" onClick={() => cmd('hatch-now')}>
            Hatch now
          </button>
        </section>
      ) : (
        <>
          <section class="growth">
            <div class="stage">
              <strong>{stageName(st)}</strong>
              <span>{Math.floor(g * 100)}% grown</span>
            </div>
            <div class="track big" role="meter" aria-label="Growth" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(g * 100)}>
              <div class="fill" style={{ width: `${Math.max(2, g * 100)}%` }} />
              {STAGES.slice(1, -1).map((s) => (
                <i key={s.id} style={{ left: `${s.from * 100}%` }} title={s.name} />
              ))}
            </div>
            <p class="hint">{next === null ? 'Fully grown. It still loves attention.' : `${nextStage ? stageName(nextStage.id) : ''} in about ${hours(next)} of time together (it grows while you're at your PC).`}</p>
          </section>
          <section class="bars">
            <Bar label="Mood" value={p.happiness} hint={mood} />
            <Bar label="Energy" value={p.energy} hint={p.energy < 0.25 ? 'Sleepy' : p.energy < 0.6 ? 'Rested' : 'Lively'} />
            <Bar label="Full" value={1 - p.hunger} hint={p.hunger > 0.75 ? 'Hungry!' : p.hunger > 0.4 ? 'Peckish' : 'Full'} />
          </section>
          <section class="actions">
            <button onClick={() => cmd('feed')}>🍖 Feed</button>
            <button onClick={() => cmd('play')}>⚽ Play</button>
            <button onClick={() => cmd('call')}>👋 Come here</button>
            <button onClick={() => cmd('sleep')}>💤 Nap</button>
            <button onClick={() => cmd('wake')}>☀️ Wake</button>
          </section>
          <section class="stats">
            <div>
              <b>{p.stats.pets}</b>
              <span>pets</span>
            </div>
            <div>
              <b>{p.stats.meals}</b>
              <span>meals</span>
            </div>
            <div>
              <b>{p.stats.naps}</b>
              <span>naps</span>
            </div>
            <div>
              <b>{p.stats.games}</b>
              <span>games</span>
            </div>
            <div>
              <b>{hours(p.activeSeconds / 3600)}</b>
              <span>together</span>
            </div>
          </section>
          <p class="tips">Drag it around, rub it with your cursor, double-click it for this card, right-click it for the menu.</p>
        </>
      )}
    </main>
  );
}

// ---------------- settings ----------------

function Toggle(props: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="toggle">
      <span>
        {props.label}
        {props.hint && <em>{props.hint}</em>}
      </span>
      <input type="checkbox" role="switch" checked={props.value} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

function Segmented<T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg-row">
      <span>{props.label}</span>
      <div class="seg" role="radiogroup" aria-label={props.label}>
        {props.options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={v === props.value} class={v === props.value ? 'on' : ''} onClick={() => props.onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsView() {
  const s = settings.value!;
  const i = info.value!;
  const set = (patch: Partial<Settings>) => {
    settings.value = { ...s, ...patch };
    void api.setSettings(patch).then((v) => (settings.value = v));
  };
  const [confirmNew, setConfirmNew] = useState(false);
  const mods = species.value.filter((x) => x.mod);
  return (
    <main class="settings">
      <Segmented label="Size" value={s.size} options={[['S', 'Small'], ['M', 'Medium'], ['L', 'Large']]} onChange={(size) => set({ size })} />
      <Segmented label="Energy" value={s.activity} options={[['calm', 'Calm'], ['normal', 'Normal'], ['lively', 'Lively']]} onChange={(activity) => set({ activity })} />
      <Segmented label="Speech" value={s.speech} options={[['off', 'Off'], ['emotes', 'Emotes'], ['chatty', 'Chatty']]} onChange={(speech) => set({ speech })} />
      <Toggle label="Sounds" value={s.sound} onChange={(sound) => set({ sound })} />
      {s.sound && (
        <label class="slider">
          <span>Volume</span>
          <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })} />
        </label>
      )}
      <Toggle label="Climb and walk on windows" hint="Otherwise it stays on the taskbar." value={s.explore} onChange={(explore) => set({ explore })} />
      <Toggle label="Hide during full-screen apps" hint="Games, videos and presentations." value={s.hideFullscreen} onChange={(hideFullscreen) => set({ hideFullscreen })} />
      <Toggle label="React to games" hint="The Isle, Brawlhalla and Minecraft." value={s.gameReactions} onChange={(gameReactions) => set({ gameReactions })} />
      <Toggle label="Start with Windows" value={s.startWithWindows} onChange={(startWithWindows) => set({ startWithWindows })} />
      {i.displays.length > 1 && (
        <label class="select">
          <span>Screen</span>
          <select value={String(s.display ?? i.displays.find((d) => d.primary)?.id ?? '')} onChange={(e) => set({ display: Number((e.target as HTMLSelectElement).value) })}>
            {i.displays.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.label}
                {d.primary ? ' — main' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <section class="box">
        <h2>Custom species</h2>
        <p>Add your own dinosaurs as small JSON files. The folder has a guide and an example you can hand to an AI.</p>
        {mods.length > 0 && <p class="ok">Loaded: {mods.map((m) => m.name).join(', ')}</p>}
        {problems.value.map((p) => (
          <p key={p.file} class="bad">
            {p.file}: {p.error}
          </p>
        ))}
        <button onClick={() => api.openModsFolder()}>Open species folder</button>
      </section>
      <section class="box">
        <h2>New egg</h2>
        {confirmNew ? (
          <>
            <p>Start over with a new egg? {pet.value?.name} will be remembered in your pet history, but you can't bring them back.</p>
            <div class="row">
              <button class="ghost" onClick={() => setConfirmNew(false)}>
                Keep {pet.value?.name}
              </button>
              <button class="danger" onClick={() => void api.newEgg()}>
                Choose a new egg
              </button>
            </div>
          </>
        ) : (
          <button onClick={() => setConfirmNew(true)}>Hatch a new egg…</button>
        )}
      </section>
      <footer>
        Hatchling {i.version} · works offline, no tracking ·{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), api.openExternal('https://github.com/Mrperson73/shift-game'))}>
          source
        </a>
      </footer>
    </main>
  );
}

function App() {
  if (!info.value || !settings.value) return null;
  const v = view.value;
  return (
    <>
      <Header />
      {v === 'choose' || !pet.value ? <Choose /> : v === 'settings' ? <SettingsView /> : <Card />}
    </>
  );
}

render(<App />, document.getElementById('app')!);

void api.init().then((i) => {
  info.value = i;
  pet.value = i.pet;
  settings.value = i.settings;
  species.value = i.species as SpeciesDef[];
  problems.value = i.problems;
  view.value = i.view;
});
api.onUpdate((u) => {
  pet.value = u.pet;
  settings.value = u.settings;
  species.value = u.species;
  problems.value = u.problems;
});
api.onView((v) => (view.value = v));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) api.close();
});
