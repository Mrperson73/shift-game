// The egg chooser: a shelf of eggs, a preview of what hatches from the one you pick (as a baby
// or all grown up), its colours, a name, and a big Hatch button.

import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { palette, variantOf } from '../../pet/draw';
import type { Personality, SpeciesDef } from '../../pet/species';
import { confettiFrom } from '../fx';
import { Icon } from '../icons';
import { randomName } from '../names';
import type { Scene, Subject } from '../scene';
import { sfx } from '../sfx';
import { api, pet, reducedMotion, setView, settings, species } from '../state';
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
  const list = species.value;
  const has = pet.value !== null;
  const [selId, setSelId] = useState(list[0].id);
  const sp = list.find((s) => s.id === selId) ?? list[0];
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

  const choose = (next: SpeciesDef) => {
    if (next.id === sp.id) return;
    setSelId(next.id);
    setVariant(0);
    if (!named) setName(randomName(next.id));
    sfx.play('select');
    sfx.call(next.voice, adult ? 1 : 0);
  };

  const hatch = async () => {
    if (busy) return;
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
          <p>It hatches on your taskbar and grows up while you use your PC.</p>
        </header>

        <div class="eggs" role="radiogroup" aria-label="Species">
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
                onKeyDown={(e) => radioKeys(e)}
              >
                <span class="egg-nest" aria-hidden="true">
                  <img src={eggThumb(palette(on ? v : s.variants[0]), 60)} alt="" width={60} height={60} />
                </span>
                <span class="egg-name">{s.name}</span>
                <span class={`egg-diet ${s.diet}`} aria-hidden="true">
                  <Icon name={s.diet === 'carnivore' ? 'meat' : 'leaf'} size={12} />
                </span>
                {s.mod && <span class="egg-mod">Mod</span>}
              </button>
            );
          })}
        </div>

        <section class="card preview" aria-label={`${sp.name} preview`}>
          <div class="preview-stage">
            <Habitat preview subject={subject} label={`A ${adult ? 'grown-up' : 'baby'} ${sp.name} in the colour ${v.name}`} class="preview-canvas" onScene={(s) => (scene.current = s)} />
            <div class="preview-age">
              <Segmented
                small
                label="Age"
                value={adult ? 'adult' : 'baby'}
                options={[
                  ['baby', 'Baby'],
                  ['adult', 'Grown-up'],
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
        <button ref={hatchBtn} type="button" class={`btn primary big hatch-btn ${busy ? 'hatching' : ''}`} disabled={busy} onClick={() => void hatch()}>
          <Icon name="eggCrack" size={22} />
          Hatch {display}!
        </button>
      </footer>
    </div>
  );
}
