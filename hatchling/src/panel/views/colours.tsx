// Colours: try on the species' colours (and the shiny ones, if you're lucky) or mix your own.
// The habitat shows the pet in whatever you're trying; Apply puts it on the desktop.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { palette, variantOf } from '../../pet/draw';
import type { Variant } from '../../pet/species';
import { type CustomColors, PATTERN_KINDS, type PatternKind } from '../../shared/types';
import { Icon } from '../icons';
import { sfx } from '../sfx';
import { colourPreview, command, growth, pet, reactions, speciesOf } from '../state';
import { petThumb } from '../thumbs';
import { radioKeys, toast } from '../ui';

type Pick = { variant: number; colors: CustomColors | null };

const FIELDS: [keyof Omit<CustomColors, 'pattern_kind'>, string][] = [
  ['body', 'Body'],
  ['belly', 'Belly'],
  ['pattern', 'Pattern'],
  ['accent', 'Accent'],
  ['iris', 'Eyes'],
];

const PATTERN_NAMES: Record<PatternKind, string> = {
  stripes: 'Stripes',
  bands: 'Bands',
  spots: 'Spots',
  rosettes: 'Rosettes',
  speckles: 'Speckles',
  saddle: 'Saddle',
  none: 'None',
};

function fromVariant(v: Variant): CustomColors {
  return { body: v.body, belly: v.belly, pattern: v.pattern, accent: v.accent, iris: v.iris, pattern_kind: v.pattern_kind };
}

const same = (a: CustomColors | null, b: CustomColors | null) => JSON.stringify(a) === JSON.stringify(b);

// ---------------- a pleasing random palette ----------------

function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Harmonious random colours: a body hue, a soft belly, a deeper pattern and a contrasting accent. */
export function surprisePalette(): CustomColors {
  const h = Math.random() * 360;
  const scheme = pick(['analogous', 'complement', 'triad', 'split']);
  const accentHue = scheme === 'complement' ? h + 180 : scheme === 'triad' ? h + 120 : scheme === 'split' ? h + 150 : h + 45;
  return {
    body: hsl(h, rnd(0.34, 0.62), rnd(0.42, 0.58)),
    belly: hsl(h + rnd(15, 45), rnd(0.25, 0.55), rnd(0.83, 0.92)),
    pattern: hsl(h + rnd(-18, 18), rnd(0.3, 0.55), rnd(0.22, 0.34)),
    accent: hsl(accentHue, rnd(0.6, 0.85), rnd(0.5, 0.64)),
    iris: hsl(pick([48, 56, 95, 185, 200, h + 180]), rnd(0.7, 0.92), rnd(0.5, 0.62)),
    pattern_kind: pick(PATTERN_KINDS.filter((k) => k !== 'none')),
  };
}

// ---------------- the view ----------------

export function ColoursView() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const current: Pick = { variant: p.variant, colors: p.colors };
  const [sel, setSel] = useState<Pick>(current);
  const [custom, setCustom] = useState<CustomColors>(p.colors ?? fromVariant(variantOf(sp, p.variant)));
  const [applied, setApplied] = useState(false);
  const timer = useRef(0);
  const g = growth.value;

  useEffect(() => {
    colourPreview.value = sel;
  }, [sel]);
  useEffect(
    () => () => {
      colourPreview.value = null;
      clearTimeout(timer.current);
    },
    [],
  );

  const dirty = sel.variant !== p.variant || !same(sel.colors, p.colors);
  const choices: { index: number; v: Variant; shiny?: boolean }[] = sp.variants.map((v, index) => ({ index, v }));
  // The rare shiny colours come first: they're the special ones.
  if (p.shiny) choices.unshift({ index: -1, v: sp.shiny, shiny: true });

  const choose = (index: number) => {
    if (!sel.colors && sel.variant === index) return;
    sfx.play('select');
    setApplied(false);
    setSel({ variant: index, colors: null });
    setCustom(fromVariant(variantOf(sp, index)));
  };
  const edit = (next: CustomColors) => {
    setApplied(false);
    setCustom(next);
    setSel({ variant: sel.variant, colors: next });
  };
  const apply = () => {
    if (!dirty) return;
    command({ type: 'recolor', variant: sel.variant, colors: sel.colors });
    pet.value = { ...p, variant: sel.variant, colors: sel.colors };
    sfx.play('coin');
    reactions.emit('sparkle');
    const name = sel.colors ? 'Custom colours' : variantOf(sp, sel.variant).name;
    toast(`${p.name} has a new look`, { icon: 'palette', sub: `${name} applied` });
    setApplied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setApplied(false), 1800);
  };
  const reset = () => {
    sfx.play('click');
    setSel(current);
    setCustom(p.colors ?? fromVariant(variantOf(sp, p.variant)));
  };
  const selectedName = sel.colors ? 'Custom' : variantOf(sp, sel.variant).name;

  return (
    <>
      <section class="view-head">
        <h1>Colours</h1>
        <p>
          Try a look on <b>{p.name}</b> in the scene above, then press Apply.
        </p>
      </section>
      <section class="card">
        <h2 class="card-title">
          <Icon name="palette" size={18} />
          {sp.name} colours
          <span class="card-count">{selectedName}</span>
        </h2>
        <div class="variants" role="radiogroup" aria-label="Colours">
          {choices.map((c) => {
            const on = !sel.colors && sel.variant === c.index;
            return (
              <button
                key={c.v.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on || (sel.colors && c.index === choices[0].index) ? 0 : -1}
                class={`variant ${on ? 'on' : ''} ${c.shiny ? 'shiny' : ''}`}
                onClick={() => choose(c.index)}
                onKeyDown={(e) => radioKeys(e)}
              >
                <img src={petThumb(sp, palette(c.v), g, 96, 64)} alt="" width={96} height={64} />
                <span class="variant-name">
                  {c.shiny && <Icon name="sparkle" size={13} />}
                  {c.v.name}
                </span>
                {p.variant === c.index && !p.colors && <span class="variant-now">Now</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section class={`card custom-card ${sel.colors ? 'on' : ''}`}>
        <h2 class="card-title">
          <Icon name="brush" size={18} />
          Mix your own
          <button
            type="button"
            class="btn small soft surprise"
            onClick={(e) => {
              const b = e.currentTarget;
              b.classList.remove('rolling');
              void b.offsetWidth;
              b.classList.add('rolling');
              sfx.play('select');
              edit(surprisePalette());
            }}
          >
            <Icon name="dice" size={16} />
            Surprise me
          </button>
        </h2>
        <div class="pickers">
          {FIELDS.map(([k, label]) => (
            <label key={k} class="picker">
              <span class="picker-swatch" style={{ '--c': custom[k] } as JSX.CSSProperties}>
                <input type="color" value={custom[k]} aria-label={`${label} colour`} onInput={(e) => edit({ ...custom, [k]: e.currentTarget.value })} />
              </span>
              <span class="picker-label">{label}</span>
            </label>
          ))}
        </div>
        <div class="patterns" role="radiogroup" aria-label="Pattern style">
          {PATTERN_KINDS.map((k) => {
            const on = custom.pattern_kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                class={`pattern ${on ? 'on' : ''}`}
                style={{ '--b': custom.body, '--p': custom.pattern } as JSX.CSSProperties}
                onClick={() => {
                  if (on && sel.colors) return;
                  sfx.play('click');
                  edit({ ...custom, pattern_kind: k });
                }}
                onKeyDown={(e) => radioKeys(e)}
              >
                <span class={`pattern-swatch pk-${k}`} aria-hidden="true" />
                {PATTERN_NAMES[k]}
              </button>
            );
          })}
        </div>
      </section>
      {(dirty || applied) && (
        <div class="apply-bar">
          <span class="apply-text">{applied ? 'Saved.' : `Trying on: ${selectedName}`}</span>
          {!applied && (
            <button type="button" class="btn ghost" onClick={reset}>
              Reset
            </button>
          )}
          <button type="button" class={`btn primary ${applied ? 'applied' : ''}`} onClick={apply}>
            <Icon name={applied ? 'check' : 'sparkle'} size={18} />
            {applied ? 'Applied!' : 'Apply'}
          </button>
        </div>
      )}
    </>
  );
}
