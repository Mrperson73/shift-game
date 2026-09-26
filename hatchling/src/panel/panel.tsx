// The panel window: egg chooser, pet card, colours and settings.

import { batch, effect } from '@preact/signals';
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { type Palette, paletteFor } from '../pet/draw';
import { growthOf } from '../pet/growth';
import type { SpeciesDef } from '../pet/species';
import { newlyUnlocked } from '../shared/achievements';
import type { CustomColors, PetData } from '../shared/types';
import { confetti } from './fx';
import { Icon, type IconName } from './icons';
import type { Subject } from './scene';
import { sfx } from './sfx';
import {
  api,
  applyUpdate,
  choosing,
  colourPreview,
  displays,
  hasPet,
  history,
  info,
  out,
  pet,
  problems,
  roster,
  selected,
  settings,
  setView,
  species,
  speciesOf,
  systemDark,
  tab,
  type Tab,
  TABS,
  theme,
} from './state';
import { applyTheme, takeThemeOrigin } from './theme';
import { logo } from './thumbs';
import { clearToasts, Habitat, Toasts, toast } from './ui';
import { Choose } from './views/choose';
import { ColoursView } from './views/colours';
import { DinosView } from './views/dinos';
import { PetView } from './views/pet';
import { SettingsView } from './views/settings';

// ---------------- chrome ----------------

function SavedChip() {
  const p = pet.value;
  if (!p) return null;
  const when = new Date(p.lastSeen).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <span class="tb-saved" key={p.lastSeen} title={`Progress saves automatically. Last saved at ${when}.`}>
      <Icon name="cloud" size={15} />
      Saved
    </span>
  );
}

function TitleBar() {
  return (
    <header class="titlebar">
      <img class="tb-logo" src={logo(28)} alt="" width={28} height={28} />
      <span class="tb-name">Hatchling</span>
      <SavedChip />
    </header>
  );
}

const TAB_INFO: Record<Tab, { label: string; icon: IconName }> = {
  pet: { label: 'Pet', icon: 'footprint' },
  colours: { label: 'Colours', icon: 'palette' },
  dinos: { label: 'Dinos', icon: 'dino' },
  settings: { label: 'Settings', icon: 'gear' },
};

function goTab(id: Tab) {
  if (id === tab.value) return;
  sfx.play('tab');
  clearToasts();
  tab.value = id;
}

function Tabs() {
  const t = tab.value;
  const idx = TABS.indexOf(t);
  const onKey = (e: KeyboardEvent) => {
    let n = idx;
    if (e.key === 'ArrowRight') n = idx + 1;
    else if (e.key === 'ArrowLeft') n = idx - 1;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    else return;
    e.preventDefault();
    const next = TABS[(n + TABS.length) % TABS.length];
    goTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <nav class="tabs" aria-label="Sections">
      <div class="tabs-list" role="tablist" aria-label="Sections" style={{ '--i': idx, '--n': TABS.length }}>
        <span class="tabs-pill" aria-hidden="true" />
        {TABS.map((id) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={id === t}
            aria-controls="view"
            tabIndex={id === t ? 0 : -1}
            class={`tab ${id === t ? 'on' : ''}`}
            onClick={() => goTab(id)}
            onKeyDown={onKey}
          >
            <Icon name={TAB_INFO[id].icon} size={19} />
            <span>{TAB_INFO[id].label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---------------- the habitat for the current pet ----------------

let palMemo: { sp: SpeciesDef; variant: number; colors: CustomColors | null; pal: Palette } | null = null;

function petSubject(): Subject {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const pick = tab.value === 'colours' ? colourPreview.value : null;
  const variant = pick ? pick.variant : p.variant;
  const colors = pick ? pick.colors : p.colors;
  if (!palMemo || palMemo.sp !== sp || palMemo.variant !== variant || palMemo.colors !== colors) {
    palMemo = { sp, variant, colors, pal: paletteFor(sp, variant, colors) };
  }
  return { key: p.id, species: sp, pal: palMemo.pal, growth: growthOf(p.activeSeconds), egg: p.hatchedAt === null, energy: p.energy, shiny: p.shiny };
}

function PetHabitat() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const t = tab.value;
  const folded = t === 'settings' || t === 'dinos';
  return (
    <div class={`habitat-wrap ${folded ? 'folded' : ''}`}>
      <Habitat
        subject={petSubject}
        active={!folded}
        label={p.hatchedAt === null ? `${p.name}'s egg in its nest` : `${p.name} the ${sp.name} in its habitat. Click it to say hi.`}
        onPet={() => sfx.call(speciesOf(pet.value!.species).voice, growthOf(pet.value!.activeSeconds))}
        onEgg={() => sfx.play('click')}
        onHatch={(x, y) => {
          sfx.play('hatch');
          const pal = petSubject().pal;
          confetti(x, y, { count: 80, power: 420, colors: [pal.body, pal.belly, pal.accent, '#ffd23f', '#ffffff'] });
        }}
      />
    </div>
  );
}

// ---------------- views ----------------

let lastTab: Tab = 'pet';

function Main() {
  const t = tab.value;
  const scroller = useRef<HTMLElement>(null);
  const dir = TABS.indexOf(t) >= TABS.indexOf(lastTab) ? 'from-right' : 'from-left';
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    lastTab = t;
  }, [t]);
  return (
    <div class={`shell tab-${t}`}>
      <TitleBar />
      <Tabs />
      <PetHabitat />
      <main id="view" ref={scroller} class="content" role="tabpanel" aria-labelledby={`tab-${t}`}>
        <div key={t} class={`view view-${t} ${t === lastTab ? '' : dir}`}>
          {t === 'pet' ? <PetView /> : t === 'colours' ? <ColoursView /> : t === 'dinos' ? <DinosView /> : <SettingsView />}
        </div>
      </main>
      <Toasts />
    </div>
  );
}

function App() {
  if (!info.value || !settings.value) return null;
  if (choosing.value || !hasPet.value) {
    return (
      <div class="shell">
        <TitleBar />
        <Choose />
        <Toasts />
      </div>
    );
  }
  return <Main />;
}

// ---------------- start ----------------

effect(() => {
  const t = theme.value;
  if (!settings.value) return;
  applyTheme(t, takeThemeOrigin());
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
darkQuery.addEventListener('change', () => (systemDark.value = darkQuery.matches));

/** Celebrate badges unlocked while you're looking. */
function celebrate(before: PetData | null, now: PetData | null) {
  if (!before || !now || before.id !== now.id || document.hidden) return;
  const fresh = newlyUnlocked(before, now);
  if (!fresh.length) return;
  const party = () => {
    sfx.play('coin');
    for (const a of fresh) toast('Badge unlocked!', { icon: 'trophy', tone: 'gold', sub: `${a.name}: ${a.description}` });
    confetti(window.innerWidth / 2, window.innerHeight * 0.45, { count: 70, power: 460, colors: ['#ffe991', '#f2a516', '#ffffff', '#ff9cc0', '#8fd8ff'] });
  };
  // Let the hatching play out first.
  if (before.hatchedAt === null && now.hatchedAt !== null) setTimeout(party, 2300);
  else party();
}

render(<App />, document.getElementById('app')!);

void api.init().then((i) => {
  batch(() => {
    info.value = i;
    species.value = i.species as SpeciesDef[];
    problems.value = i.problems;
    history.value = i.history ?? [];
    systemDark.value = !!i.systemDark;
    pet.value = i.pet;
    roster.value = i.roster ?? [];
    out.value = i.out ?? [];
    selected.value = i.selected;
    displays.value = i.displays ?? [];
    settings.value = i.settings;
    setView(i.pet ? i.view : 'choose');
  });
  sfx.configure(i.settings.sound, i.settings.volume);
  if (i.pet) sfx.play('open');
});
api.onUpdate((u) => {
  const before = pet.value;
  batch(() => applyUpdate(u));
  celebrate(before, u.pet);
});
api.onView((v) => {
  setView(v);
  sfx.play('open');
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const t = e.target;
  const typing = (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type)) || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  if (!typing) api.close();
});
