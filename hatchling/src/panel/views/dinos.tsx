// My Dinos: every dino you keep. Up to OUT_MAX are out on the desktop at once; the others rest here,
// frozen in time. Tap one for its card, bring it out, put it away, move it to another screen, or
// release it (it's remembered in Past pets).

import { useState } from 'preact/hooks';
import { paletteFor } from '../../pet/draw';
import { growthOf, stageName, stageOf } from '../../pet/growth';
import { type Dino, OUT_MAX, type PetData, ROSTER_MAX } from '../../shared/types';
import { Icon } from '../icons';
import { sfx } from '../sfx';
import { api, dinoAction, displays, history, out, reactions, roster, selected, settings, speciesOf, tab } from '../state';
import { eggThumb, petThumb } from '../thumbs';
import { toast } from '../ui';
import { dateText, duration } from '../util';

/** A little picture of a dino (or its egg). */
export function dinoThumb(p: PetData, w: number, h: number): string {
  const sp = speciesOf(p.species);
  const pal = paletteFor(sp, p.variant, p.colors);
  return p.hatchedAt === null ? eggThumb(pal, h) : petThumb(sp, pal, growthOf(p.activeSeconds), w, h);
}

async function act(a: Parameters<typeof dinoAction>[0], sound: 'open' | 'click' | 'select') {
  const err = await dinoAction(a);
  if (err) {
    sfx.play('error');
    toast("That didn't work", { icon: 'warn', sub: err });
  } else sfx.play(sound);
  return !err;
}

function DinoRow(props: { d: Dino }) {
  const { d } = props;
  const p = d.pet;
  const sp = speciesOf(p.species);
  const isOut = out.value.includes(p.id);
  const on = selected.value === p.id;
  const full = out.value.length >= OUT_MAX;
  const [confirm, setConfirm] = useState(false);
  const g = growthOf(p.activeSeconds);
  const stage = p.hatchedAt === null ? 'Egg' : `${stageName(stageOf(g))} ${Math.floor(g * 100)}%`;
  const screens = displays.value;
  const multi = screens.length > 1 && settings.value?.monitors === 'all';
  const here = screens.find((s) => s.id === d.display) ?? screens.find((s) => s.primary);
  return (
    <li class={`dino ${on ? 'on' : ''} ${isOut ? 'is-out' : 'is-away'} ${confirm ? 'confirming' : ''}`}>
      <button
        type="button"
        class="dino-main"
        aria-label={`${p.name}: show card`}
        onClick={() => {
          sfx.play('select');
          void dinoAction({ type: 'select', id: p.id });
          tab.value = 'pet';
        }}
      >
        <span class="dino-img">
          <img src={dinoThumb(p, 64, 48)} alt="" width={64} height={48} />
        </span>
        <span class="dino-text">
          <strong>
            {p.name}
            {p.shiny && <Icon name="sparkle" size={13} class="past-shiny" />}
          </strong>
          <span>
            {sp.id === p.species ? sp.name : p.species} · {stage}
          </span>
          <span class={`dino-state ${isOut ? 'out' : 'away'}`}>
            <i aria-hidden="true" />
            {isOut ? (multi && here ? `Out on ${here.primary ? 'your main screen' : here.label}` : 'Out on your desktop') : 'Resting'}
          </span>
        </span>
      </button>
      <div class="dino-actions">
        {isOut ? (
          <button type="button" class="btn small soft" aria-label={`Put ${p.name} away`} onClick={() => void act({ type: 'away', id: p.id }, 'click')}>
            <Icon name="home" size={16} />
            Put away
          </button>
        ) : (
          <button
            type="button"
            class="btn small primary"
            aria-label={`Bring ${p.name} out`}
            title={full ? `${OUT_MAX} dinos are out already: put one away first` : undefined}
            disabled={full}
            onClick={async () => {
              if (await act({ type: 'out', id: p.id }, 'open')) reactions.emit('sparkle');
            }}
          >
            <Icon name="monitor" size={16} />
            Bring out
          </button>
        )}
        {isOut && multi && (
          <span class="select-wrap small">
            <select
              aria-label={`${p.name}'s screen`}
              value={String(here?.id ?? '')}
              onChange={(e) => void act({ type: 'move', id: p.id, display: Number(e.currentTarget.value) }, 'click')}
            >
              {screens.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.label}
                  {s.primary ? ' (main)' : ''}
                </option>
              ))}
            </select>
          </span>
        )}
        {!isOut && !confirm && (
          <button
            type="button"
            class="btn small ghost"
            aria-label={`Release ${p.name}`}
            onClick={() => {
              sfx.play('open');
              setConfirm(true);
            }}
          >
            Release
          </button>
        )}
      </div>
      {confirm && (
        <div class="confirm dino-confirm" role="alertdialog" aria-label={`Release ${p.name}?`}>
          <p class="card-text">
            <b>Release {p.name}?</b> They'll be remembered in your past pets, but you can't bring them back.
          </p>
          <div class="btn-row">
            <button
              type="button"
              class="btn small ghost"
              autoFocus
              onClick={() => {
                sfx.play('click');
                setConfirm(false);
              }}
            >
              Keep {p.name}
            </button>
            <button type="button" class="btn small danger" onClick={() => void act({ type: 'release', id: p.id }, 'click')}>
              Release
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function PastPets() {
  const list = history.value;
  if (!list.length) return null;
  return (
    <section class="card past-card">
      <h2 class="card-title">
        <Icon name="history" size={18} />
        Past pets
        <span class="card-count">{list.length}</span>
      </h2>
      <ul class="past">
        {list
          .slice()
          .reverse()
          .map((h, i) => {
            const sp = speciesOf(h.species);
            const known = sp.id === h.species;
            const g = growthOf(h.activeSeconds);
            const pal = paletteFor(sp, h.variant, h.colors ?? null);
            return (
              <li key={`${h.retiredAt}-${i}`}>
                <img class="past-img" src={petThumb(sp, pal, g, 64, 48)} alt="" width={64} height={48} />
                <div class="past-text">
                  <strong>
                    {h.name}
                    {h.shiny && <Icon name="sparkle" size={13} class="past-shiny" />}
                  </strong>
                  <span>
                    {known ? sp.name : h.species} · {h.hatchedAt === null ? 'Egg' : stageName(stageOf(g))} · {duration(h.activeSeconds / 3600)} together
                  </span>
                  <span class="past-dates">
                    {h.hatchedAt ? dateText(h.hatchedAt) : 'Never hatched'} – {dateText(h.retiredAt)}
                  </span>
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

export function DinosView() {
  const list = roster.value;
  const outs = out.value;
  const outList = list.filter((d) => outs.includes(d.pet.id));
  const resting = list.filter((d) => !outs.includes(d.pet.id));
  const full = list.length >= ROSTER_MAX;
  return (
    <>
      <section class="view-head dinos-head">
        <div>
          <h1>My Dinos</h1>
          <p>
            Up to {OUT_MAX} can be out at once. The others rest here, frozen in time: no growing, no getting hungry.
          </p>
        </div>
        <button
          type="button"
          class="btn primary small"
          disabled={full}
          title={full ? `You have ${ROSTER_MAX} dinos. Release one to make room.` : undefined}
          onClick={() => {
            sfx.play('open');
            void api.newEgg();
          }}
        >
          <Icon name="plus" size={16} />
          New egg
        </button>
      </section>
      <section class="card dinos-card">
        <h2 class="card-title">
          <Icon name="monitor" size={18} />
          On your desktop
          <span class="card-count">
            {outList.length} / {OUT_MAX}
          </span>
        </h2>
        {outList.length ? (
          <ul class="dinos">
            {outList.map((d) => (
              <DinoRow key={d.pet.id} d={d} />
            ))}
          </ul>
        ) : (
          <p class="card-text dinos-empty">Nobody's out right now. Bring a dino out to play.</p>
        )}
      </section>
      {resting.length > 0 && (
        <section class="card dinos-card">
          <h2 class="card-title">
            <Icon name="home" size={18} />
            Resting
            <span class="card-count">{resting.length}</span>
          </h2>
          <ul class="dinos">
            {resting.map((d) => (
              <DinoRow key={d.pet.id} d={d} />
            ))}
          </ul>
        </section>
      )}
      <p class="card-note dinos-count">
        {list.length} of {ROSTER_MAX} dinos
      </p>
      <PastPets />
    </>
  );
}
