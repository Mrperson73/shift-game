// The pet card: who it is, how grown it is, how it feels, what you can do together, and what
// it has achieved.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { paletteFor, variantOf } from '../../pet/draw';
import { growthOf, hoursToNextStage, STAGES, stageName, stageOf } from '../../pet/growth';
import { type Achievement, type AchievementIcon, achievementsOf } from '../../shared/achievements';
import type { TrickName } from '../../shared/types';
import { Icon, type IconName } from '../icons';
import { sfx } from '../sfx';
import { command, growth, history, pet, reactions, type Reaction, speciesOf } from '../state';
import { eggThumb, petThumb } from '../thumbs';
import { CountUp, Meter } from '../ui';
import { ago, dateText, duration, type FoodKind, foodOf, shortDuration } from '../util';

const FOOD_ICON: Record<FoodKind, IconName> = { meat: 'meat', fish: 'fish', leaf: 'leaf', berry: 'berry' };

/** Replays a CSS "pop" animation on the element that was pressed. */
function pop(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ---------------- header ----------------

function PetHeader() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const colour = p.colors ? 'Custom colours' : variantOf(sp, p.variant).name;
  const commit = () => {
    const n = draft.trim();
    setEditing(false);
    if (!n) sfx.play('error');
    if (!n || n === p.name) return;
    command({ type: 'rename', name: n });
    pet.value = { ...p, name: n };
    sfx.play('select');
  };
  return (
    <section class="pet-head">
      <div class="pet-title">
        {editing ? (
          <input
            class="name-edit"
            value={draft}
            maxLength={24}
            aria-label="New name"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
        ) : (
          <h1 class="pet-name">
            <button
              class="name"
              title="Rename"
              aria-label={`${p.name} (rename)`}
              onClick={() => {
                setDraft(p.name);
                setEditing(true);
                sfx.play('click');
              }}
            >
              <span class="name-text">{p.name}</span>
              <span class="name-pencil">
                <Icon name="pencil" size={15} />
              </span>
            </button>
          </h1>
        )}
        {p.shiny && (
          <span class="shiny-badge" title="A rare shiny: about 1 egg in 20">
            <Icon name="sparkle" size={14} />
            Shiny
          </span>
        )}
      </div>
      <p class="pet-sub">
        <span>{sp.id === p.species ? sp.name : p.species.charAt(0).toUpperCase() + p.species.slice(1)}</span>
        <span class="dot" aria-hidden="true" />
        <span>{colour}</span>
        <span class="dot" aria-hidden="true" />
        <span>{p.hatchedAt ? `hatched ${ago(Date.now() - p.hatchedAt)}` : 'still in its egg'}</span>
      </p>
    </section>
  );
}

// ---------------- growth ----------------

const TRACK: { id: string; name: string; icon: IconName }[] = [
  { id: 'egg', name: 'Egg', icon: 'egg' },
  { id: 'hatchling', name: 'Hatchling', icon: 'sprout' },
  { id: 'juvenile', name: 'Juvenile', icon: 'footprint' },
  { id: 'subadult', name: 'Sub-adult', icon: 'dino' },
  { id: 'adult', name: 'Adult', icon: 'crown' },
];

function GrowthCard() {
  const p = pet.value!;
  const g = growth.value;
  const egg = p.hatchedAt === null;
  const st = stageOf(g);
  const si = STAGES.findIndex((s) => s.id === st);
  const node = egg ? 0 : si + 1;
  let fill = 0;
  if (!egg) {
    const from = STAGES[si].from;
    const to = STAGES[si + 1]?.from;
    fill = to === undefined ? 1 : (si + 1 + (g - from) / (to - from)) / 4;
  }
  const pct = Math.floor(g * 100);
  const next = hoursToNextStage(p.activeSeconds);
  const nextStage = STAGES.find((s) => s.from > g);
  const stageLabel = egg ? 'Egg' : stageName(st);
  return (
    <section class="card growth-card">
      <div class="stage">
        <span class="stage-icon">
          <Icon name={TRACK[node].icon} size={20} />
        </span>
        <span class="stage-text">
          <span class="stage-kicker">Stage</span>
          <strong>{stageLabel}</strong>
        </span>
        <span class="stage-pct">
          <b>{pct}%</b> grown
        </span>
      </div>
      <div class="track" role="meter" aria-label="Growth" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${stageLabel}, ${pct}% grown`}>
        <div class="track-rail">
          <div class="track-fill" style={{ '--f': fill } as JSX.CSSProperties} />
        </div>
        <ol class="track-nodes">
          {TRACK.map((t, i) => (
            <li key={t.id} class={i < node ? 'past' : i === node ? 'now' : 'next'} style={{ '--i': i } as JSX.CSSProperties}>
              <span class="track-dot">
                <Icon name={i < node ? 'check' : t.icon} size={i === node ? 18 : 15} />
              </span>
              <span class="track-name">{t.name}</span>
            </li>
          ))}
        </ol>
      </div>
      <p class="growth-next">
        {egg ? (
          <>Hatching soon. Then it grows while you're at your PC.</>
        ) : next === null ? (
          <>Fully grown! It still loves attention.</>
        ) : (
          <>
            <b>{nextStage ? stageName(nextStage.id) : ''}</b> in about <b>{duration(next)}</b> together. It grows while you're at your PC.
          </>
        )}
      </p>
      <p class="saved-note">
        <Icon name="cloud" size={16} />
        <span>Progress saves automatically</span>
        <span class="saved-when" key={p.lastSeen}>
          saved {ago(Math.max(0, Date.now() - p.lastSeen))}
        </span>
      </p>
    </section>
  );
}

// ---------------- the egg ----------------

function EggCard() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const pal = paletteFor(sp, p.variant, p.colors);
  return (
    <section class="card egg-card">
      <img class="egg-card-art" src={eggThumb(pal, 72)} alt="" width={72} height={72} />
      <div class="egg-card-text">
        <h2>Your egg is on the taskbar</h2>
        <p>Click it there a few times to help it hatch, or just wait: it hatches on its own in a minute.</p>
        <button
          class="btn primary"
          onClick={(e) => {
            pop(e.currentTarget);
            sfx.play('hatch');
            command({ type: 'hatch-now' });
          }}
        >
          <Icon name="eggCrack" size={18} />
          Hatch now
        </button>
      </div>
    </section>
  );
}

// ---------------- needs ----------------

function NeedsCard() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const mood = p.happiness > 0.75 ? 'Very happy' : p.happiness > 0.5 ? 'Happy' : p.happiness > 0.3 ? 'Okay' : 'Bored';
  const energy = p.energy < 0.25 ? 'Sleepy' : p.energy < 0.6 ? 'Rested' : 'Lively';
  const full = p.hunger > 0.75 ? 'Hungry!' : p.hunger > 0.4 ? 'Peckish' : 'Full';
  return (
    <section class="card needs">
      <Meter label="Mood" value={p.happiness} text={mood} tone="mood" icon="smile" />
      <Meter label="Energy" value={p.energy} text={energy} tone="energy" icon="bolt" />
      <Meter label="Full" value={1 - p.hunger} text={full} tone="food" icon={FOOD_ICON[foodOf(sp)]} />
    </section>
  );
}

// ---------------- actions and tricks ----------------

function ActionsCard() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const actions: { id: 'feed' | 'play' | 'call' | 'sleep' | 'wake'; label: string; icon: IconName; tone: string }[] = [
    { id: 'feed', label: 'Feed', icon: FOOD_ICON[foodOf(sp)], tone: 'orange' },
    { id: 'play', label: 'Play', icon: 'ball', tone: 'blue' },
    { id: 'call', label: 'Come here', icon: 'wave', tone: 'yellow' },
    { id: 'sleep', label: 'Nap', icon: 'moon', tone: 'indigo' },
    { id: 'wake', label: 'Wake', icon: 'sun', tone: 'amber' },
  ];
  const tricks: { id: TrickName; label: string; icon: IconName }[] = [
    { id: 'dance', label: 'Dance', icon: 'note' },
    { id: 'roar', label: 'Roar', icon: 'roar' },
    { id: 'spin', label: 'Spin', icon: 'spin' },
    { id: 'sit', label: 'Sit', icon: 'sit' },
    { id: 'shake', label: 'Shake', icon: 'shake' },
  ];
  const [busy, setBusy] = useState<TrickName | null>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const doAction = (id: (typeof actions)[number]['id'], el: EventTarget | null) => {
    pop(el);
    sfx.play('click');
    command({ type: id });
    reactions.emit(id as Reaction);
  };
  const doTrick = (id: TrickName, el: EventTarget | null) => {
    if (busy) return;
    pop(el);
    sfx.play('click');
    command({ type: 'trick', name: id });
    reactions.emit(id);
    setBusy(id);
    timer.current = window.setTimeout(() => setBusy(null), 1800);
  };
  return (
    <section class="card actions-card">
      <h2 class="card-title">
        <Icon name="paw" size={18} />
        Together
      </h2>
      <div class="actions">
        {actions.map((a) => (
          <button key={a.id} class={`action tone-${a.tone}`} onClick={(e) => doAction(a.id, e.currentTarget)}>
            <span class="action-icon">
              <Icon name={a.icon} size={26} />
            </span>
            <span class="action-label">{a.label}</span>
          </button>
        ))}
      </div>
      <div class="tricks-row">
        <span class="tricks-title" id="tricks-title">
          Tricks
        </span>
        <div class="tricks" role="group" aria-labelledby="tricks-title">
          {tricks.map((t) => (
            <button key={t.id} class={`trick ${busy === t.id ? 'doing' : ''}`} aria-disabled={busy !== null} onClick={(e) => doTrick(t.id, e.currentTarget)}>
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------- stats ----------------

function StatsCard() {
  const p = pet.value!;
  const sp = speciesOf(p.species);
  const tiles: { label: string; icon: IconName; value: number; fmt?: (n: number) => string; tone: string }[] = [
    { label: 'pets', icon: 'heart', value: p.stats.pets, tone: 'pink' },
    { label: 'meals', icon: FOOD_ICON[foodOf(sp)], value: p.stats.meals, tone: 'orange' },
    { label: 'naps', icon: 'moon', value: p.stats.naps, tone: 'indigo' },
    { label: 'games', icon: 'game', value: p.stats.games, tone: 'blue' },
    { label: 'together', icon: 'clock', value: p.activeSeconds, fmt: (n) => shortDuration(n), tone: 'green' },
  ];
  return (
    <section class="stats" aria-label="Stats">
      {tiles.map((t) => (
        <div key={t.label} class={`stat tone-${t.tone}`}>
          <span class="stat-icon">
            <Icon name={t.icon} size={18} />
          </span>
          <b class="stat-value">
            <CountUp value={t.value} format={t.fmt} />
          </b>
          <span class="stat-label">{t.label}</span>
        </div>
      ))}
    </section>
  );
}

// ---------------- badges ----------------

const BADGE_ICON: Record<AchievementIcon, IconName> = {
  egg: 'eggCrack',
  meal: 'meat',
  feast: 'bowl',
  banquet: 'cake',
  pet: 'heart',
  hearts: 'hearts',
  game: 'game',
  nap: 'moon',
  sprout: 'sprout',
  dino: 'dino',
  crown: 'crown',
  clock: 'clock',
  sun: 'sun',
  infinity: 'infinity',
  plane: 'plane',
  sparkle: 'sparkle',
};

function progressText(a: Achievement): string {
  if (a.done) return 'Unlocked';
  if (a.target === 1) return 'Not yet';
  if (a.kind === 'growth') return `${a.current}% of ${a.target}%`;
  if (a.kind === 'time') return `${a.current} of ${a.target} h`;
  return `${a.current} of ${a.target}`;
}

function BadgesCard() {
  const list = achievementsOf(pet.value!);
  const done = list.filter((a) => a.done).length;
  return (
    <section class="card badges-card">
      <h2 class="card-title">
        <Icon name="trophy" size={18} />
        Badges
        <span class="card-count">
          {done} / {list.length}
        </span>
      </h2>
      <ul class="badges">
        {list.map((a) => (
          <li key={a.id} class={`badge kind-${a.kind} ${a.done ? 'done' : 'locked'}`} data-empty={a.progress <= 0 ? '' : undefined} title={`${a.name}: ${a.description}`}>
            <span class="medal" style={{ '--p': a.progress } as JSX.CSSProperties}>
              <svg class="medal-ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="20" />
                <circle class="medal-progress" cx="22" cy="22" r="20" pathLength={100} />
              </svg>
              <span class="medal-face">
                <Icon name={BADGE_ICON[a.icon]} size={22} />
              </span>
              {!a.done && (
                <span class="medal-lock">
                  <Icon name="lock" size={11} />
                </span>
              )}
            </span>
            <span class="badge-name">{a.name}</span>
            <span class="badge-sub">{progressText(a)}</span>
            <span class="sr">{a.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- past pets ----------------

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

export function PetView() {
  const egg = pet.value!.hatchedAt === null;
  return (
    <>
      <PetHeader />
      {egg && <EggCard />}
      <GrowthCard />
      {!egg && (
        <>
          <NeedsCard />
          <ActionsCard />
          <StatsCard />
          <BadgesCard />
        </>
      )}
      <PastPets />
      <p class="tips">
        <Icon name="info" size={15} />
        Drag it around, rub it with your cursor, double-click it for this card, right-click it for the menu.
      </p>
    </>
  );
}
