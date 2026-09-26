// The egg chooser: a shelf of eggs (filtered by what they eat, or flyers), a preview of what
// hatches from the one you pick (as a baby or all grown up), its colours, a name, and a big Hatch
// button. A new egg joins My Dinos; nobody is replaced.

import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { palette, variantOf } from '../../pet/draw';
import type { Personality, SpeciesDef } from '../../pet/species';
import { OUT_MAX, ROSTER_MAX } from '../../shared/types';
import { confettiFrom } from '../fx';
import { Icon, type IconName } from '../icons';
import { randomName } from '../names';
import type { Scene, Subject } from '../scene';
import { sfx } from '../sfx';
import { api, out, pet, reducedMotion, roster, setView, settings, species } from '../state';
import { eggThumb } from '../thumbs';
import { Habitat, radioKeys, Segmented, SwitchRow, toast } from '../ui';
import { type FoodKind, foodOf, lengthText } from '../util';

const TRAITS: [keyof Personality, string][] = [
  ['speed', 'Speed'],
  ['jump', 'Jump'],
  ['curiosity', 'Curiosity'],
  ['playfulness', 'Playfulness'],
  ['stamina', 'Stamina'],
  ['vocal', 'Vocal'],
];

const FOOD_WORD: Record<FoodKind, string> = { meat: 'Meat', fish: 'Fish', leaf: 'Leaves', berry: 'Berries' };

type Filter = 'all' | 'meat' | 'plant' | 'sky' | 'mods';
const FILTERS: { id: Filter; label: string; icon: IconName; has: (s: SpeciesDef) => boolean }[] = [
  { id: 'all', label: 'All', icon: 'egg', has: () => true },
  { id: 'meat', label: 'Meat-eaters', icon: 'meat', has: (s) => s.diet === 'carnivore' },
  { id: 'plant', label: 'Plant-eaters', icon: 'leaf', has: (s) => s.diet === 'herbivore' },
  { id: 'sky', label: 'Flyers', icon: 'wing', has: (s) => !!s.features.wings },
  { id: 'mods', label: 'Custom', icon: 'puzzle', has: (s) => !!s.mod },
];

/** The shelf is one list: arrow keys move along it (it scrolls sideways in two rows). */
function shelfKeys(e: KeyboardEvent) {
  const me = e.currentTarget as HTMLElement;
  const radios = [...(me.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
  const i = radios.indexOf(me);
  let n = i;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = i + 1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = i - 1;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = radios.length - 1;
  else return;
  e.preventDefault();
  n = (n + radios.length) % radios.length;
  radios[n].focus();
  radios[n].click();
}

function Traits(props: { sp: SpeciesDef }) {
  return (
    <ul class="traits" aria-label="Personality">
      {TRAITS.map(([k, label], i) => {
        const v = props.sp.personality[k];
        const pips = Math.max(1, Math.round(v * 5));
        return (
          <li key={k} class="trait" aria-label={`${label}: ${pips} of 5`}>
            <span class="trait-name">{label}</span>
            <span class="pips" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((n) => (
                <i key={`${props.sp.id}-${n}`} class={n < pips ? 'on' : ''} style={{ '--d': `${i * 40 + n * 45}ms` } as JSX.CSSProperties} />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Choose() {
  const all = species.value;
  const has = pet.value !== null;
  const [filter, setFilter] = useState<Filter>('all');
  const filters = FILTERS.filter((f) => f.id === 'all' || all.some(f.has));
  const list = all.filter((FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).has);
  const [selId, setSelId] = useState(all[0].id);
  const sp = all.find((s) => s.id === selId) ?? all[0];
  const [variant, setVariant] = useState(0);
  const [adult, setAdult] = useState(false);
  const [name, setName] = useState(() => randomName(sp.id));
  const [named, setNamed] = useState(false);
  const [autostart, setAutostart] = useState(settings.value?.startWithWindows ?? true);
  const [busy, setBusy] = useState(false);
  const hatchBtn = useRef<HTMLButtonElement>(null);
  const scene = useRef<Scene | null>(null);
  const v = variantOf(sp, variant);
  const pal = useMemo(() => palette(v), [v]);
  const display = name.trim() || sp.name;
  const food = foodOf(sp);
  const full = roster.value.length >= ROSTER_MAX;
  // Only so many can be out: the one out longest goes for a rest when a new egg comes.
  const bumped = out.value.length >= OUT_MAX ? roster.value.find((d) => d.pet.id === out.value[0])?.pet.name : undefined;

  const choose = (next: SpeciesDef) => {
    if (next.id === sp.id) return;
    setSelId(next.id);
    setVariant(0);
    if (!named) setName(randomName(next.id));
    sfx.play('select');
    sfx.call(next.voice, adult ? 1 : 0);
  };

  const pickFilter = (f: Filter) => {
    setFilter(f);
    const shown = all.filter((FILTERS.find((x) => x.id === f) ?? FILTERS[0]).has);
    if (shown.length && !shown.some((s) => s.id === sp.id)) {
      const next = shown[0];
      setSelId(next.id);
      setVariant(0);
      if (!named) setName(randomName(next.id));
    }
  };

  const hatch = async () => {
    if (busy || full) return;
    setBusy(true);
    sfx.play('hatch');
    confettiFrom(hatchBtn.current, { count: 90, colors: [v.body, v.belly, v.accent, v.pattern, '#ffd23f', '#ffffff'] });
    scene.current?.react('dance');
    await new Promise((r) => setTimeout(r, reducedMotion.value ? 120 : 900));
    try {
      await api.hatch({ species: sp.id, variant, name: display, startWithWindows: autostart });
      // The window normally closes now; if it stays open, show the new egg's card.
      setView('card');
    } catch {
      sfx.play('error');
      toast("That didn't work", { icon: 'warn', sub: 'The egg could not be hatched. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const subject = (): Subject => ({ key: `preview:${sp.id}`, species: sp, pal, growth: adult ? 1 : 0, egg: false, energy: 1, shiny: false });

  return (
    <div class="choose">
      <div class="choose-scroll">
        <header class="choose-head">
          <h1>{has ? 'Choose a new egg' : 'Choose your egg'}</h1>
          <p>{has ? 'It joins your dinos: nobody is replaced. It hatches on your taskbar.' : 'It hatches on your taskbar and grows up while you use your PC.'}</p>
        </header>

        {filters.length > 2 && (
          <div class="egg-filters" role="radiogroup" aria-label="Show">
            {filters.map((f) => {
              const on = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  class={`egg-filter ${on ? 'on' : ''}`}
                  onClick={() => {
                    if (on) return;
                    sfx.play('tab');
                    pickFilter(f.id);
                  }}
                  onKeyDown={(e) => radioKeys(e)}
                >
                  <Icon name={f.icon} size={15} />
                  {f.label}
                  <span class="egg-filter-n">{all.filter(f.has).length}</span>
                </button>
              );
            })}
          </div>
        )}

        <div
          class={`eggs ${list.length > 8 ? 'scrolls' : ''}`}
          role="radiogroup"
          aria-label="Species"
          onWheel={(e) => {
            // A mouse wheel scrolls the shelf sideways.
            const el = e.currentTarget;
            if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }}
        >
          {list.map((s) => {
            const on = s.id === sp.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={s.name}
                tabIndex={on ? 0 : -1}
                class={`egg-tile ${on ? 'on' : ''}`}
                title={`${s.name} (${s.latin})`}
                onClick={() => choose(s)}
                onKeyDown={(e) => shelfKeys(e)}
              >
                <span class="egg-nest" aria-hidden="true">
                  <img src={eggThumb(palette(on ? v : s.variants[0]), 60)} alt="" width={60} height={60} />
                </span>
                <span class="egg-name">{s.name}</span>
                <span class={`egg-diet ${s.features.wings ? 'flyer' : s.diet}`} aria-hidden="true">
                  <Icon name={s.features.wings ? 'wing' : s.diet === 'carnivore' ? 'meat' : 'leaf'} size={12} />
                </span>
                {s.mod && <span class="egg-mod">Mod</span>}
              </button>
            );
          })}
        </div>

        <section class="card preview" aria-label={`${sp.name} preview`}>
          <div class="preview-stage">
            <Habitat preview subject={subject} label={`${adult ? 'An adult' : 'A hatchling'} ${sp.name} in the colour ${v.name}`} class="preview-canvas" onScene={(s) => (scene.current = s)} />
            <div class="preview-age">
              <Segmented
                small
                label="Age"
                value={adult ? 'adult' : 'baby'}
                options={[
                  ['baby', 'Hatchling'],
                  ['adult', 'Adult'],
                ]}
                onChange={(a) => {
                  setAdult(a === 'adult');
                  sfx.call(sp.voice, a === 'adult' ? 1 : 0);
                }}
              />
            </div>
          </div>
          <div class="preview-body">
            <div class="preview-title">
              <h2>{sp.name}</h2>
              <span class="latin">{sp.latin}</span>
            </div>
            <div class="chips">
              <span class={`chip diet ${sp.diet}`}>
                <Icon name={sp.diet === 'carnivore' ? 'meat' : 'leaf'} size={15} />
                {sp.diet === 'carnivore' ? 'Carnivore' : 'Herbivore'}
                {food !== 'meat' && food !== 'leaf' && <span class="chip-sub">· {FOOD_WORD[food]}</span>}
              </span>
              <span class="chip">
                <Icon name="ruler" size={15} />
                {lengthText(sp.lengthM)}
              </span>
              <span class="chip">
                <Icon name="footprint" size={15} />
                {sp.group}
              </span>
              {sp.mod && (
                <span class="chip mod">
                  <Icon name="puzzle" size={15} />
                  Custom
                </span>
              )}
            </div>
            <p class="blurb">{sp.blurb}</p>
            <p class="fact">
              <span class="fact-icon">
                <Icon name="info" size={16} />
              </span>
              <span>
                <b>Fun fact:</b> {sp.fact}
              </span>
            </p>
            <Traits sp={sp} />
            <div class="colours">
              <div class="colours-head">
                <span>Colour</span>
                <strong>{v.name}</strong>
              </div>
              <div class="swatches" role="radiogroup" aria-label="Colour">
                {sp.variants.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={i === variant}
                    aria-label={c.name}
                    title={c.name}
                    tabIndex={i === variant ? 0 : -1}
                    class={`swatch ${i === variant ? 'on' : ''}`}
                    style={{ '--b': c.body, '--l': c.belly, '--p': c.pattern, '--a': c.accent } as JSX.CSSProperties}
                    onClick={() => {
                      if (i === variant) return;
                      setVariant(i);
                      sfx.play('select');
                    }}
                    onKeyDown={(e) => radioKeys(e)}
                  />
                ))}
              </div>
              <p class="shiny-hint">
                <Icon name="sparkle" size={14} />
                <span>
                  About 1 egg in 20 hatches <b>shiny</b>, with rare colours
                </span>
                <Icon name="sparkle" size={14} />
              </p>
            </div>
          </div>
        </section>

        <section class="card name-card">
          <label class="field-label" for="egg-name">
            Name
          </label>
          <div class="name-field">
            <input
              id="egg-name"
              value={name}
              maxLength={24}
              autoComplete="off"
              spellcheck={false}
              onInput={(e) => {
                setName(e.currentTarget.value);
                setNamed(true);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void hatch()}
            />
            <button
              type="button"
              class="dice"
              aria-label="Roll the dice"
              title="Pick a random name"
              onClick={(e) => {
                const b = e.currentTarget;
                b.classList.remove('rolling');
                void b.offsetWidth;
                b.classList.add('rolling');
                sfx.play('click');
                setName(randomName(sp.id, name));
                setNamed(false);
              }}
            >
              <Icon name="dice" size={20} />
            </button>
          </div>
          <SwitchRow label="Start Hatchling when Windows starts" checked={autostart} onChange={setAutostart} />
        </section>
      </div>

      <footer class="choose-foot">
        {(full || bumped) && (
          <p class={`choose-note ${full ? 'bad' : ''}`}>
            <Icon name={full ? 'warn' : 'home'} size={15} />
            {full ? `You have ${ROSTER_MAX} dinos. Release one in My Dinos to make room.` : `${bumped} will rest in My Dinos to make room (${OUT_MAX} can be out at once).`}
          </p>
        )}
        {has && (
          <button
            type="button"
            class="btn ghost"
            onClick={() => {
              sfx.play('click');
              setView('card');
            }}
          >
            Cancel
          </button>
        )}
        <button ref={hatchBtn} type="button" class={`btn primary big hatch-btn ${busy ? 'hatching' : ''}`} disabled={busy || full} onClick={() => void hatch()}>
          <Icon name="eggCrack" size={22} />
          Hatch {display}!
        </button>
      </footer>
    </div>
  );
}
