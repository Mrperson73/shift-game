// Panel state: what the main process told us, plus what's on screen. Components read these
// signals directly, so an update only re-renders the parts that use what changed.

import { computed, signal } from '@preact/signals';
import { growthOf } from '../pet/growth';
import type { SpeciesDef } from '../pet/species';
import type { DinoAction, PanelUpdate } from '../shared/api';
import { resolveTheme } from '../shared/themes';
import type { Command, CustomColors, Dino, DisplayInfo, ModProblem, PanelInit, PastPet, PetData, Settings, ToyKind, TrickName } from '../shared/types';
import { sfx } from './sfx';

export const api = window.panel;

export type Tab = 'pet' | 'colours' | 'dinos' | 'settings';
export const TABS: Tab[] = ['pet', 'colours', 'dinos', 'settings'];

export const info = signal<PanelInit | null>(null);
/** The selected dino (the one the card and the colours are for). */
export const pet = signal<PetData | null>(null);
export const roster = signal<Dino[]>([]);
/** Ids of the dinos out on the desktop. */
export const out = signal<string[]>([]);
export const selected = signal<string | null>(null);
export const displays = signal<DisplayInfo[]>([]);
export const settings = signal<Settings | null>(null);
export const species = signal<SpeciesDef[]>([]);
export const problems = signal<ModProblem[]>([]);
export const history = signal<PastPet[]>([]);
export const systemDark = signal(false);
/** The egg chooser is showing (first run, or "new egg"). */
export const choosing = signal(false);
export const tab = signal<Tab>('pet');

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = signal(motionQuery.matches);
motionQuery.addEventListener('change', () => (reducedMotion.value = motionQuery.matches));

export const theme = computed(() => resolveTheme(settings.value?.theme ?? 'auto', systemDark.value));
export const hasPet = computed(() => pet.value !== null);
export const growth = computed(() => (pet.value ? growthOf(pet.value.activeSeconds) : 0));
/** The selected dino is out on the desktop (not put away). */
export const petOut = computed(() => !!pet.value && out.value.includes(pet.value.id));

export function speciesOf(id: string): SpeciesDef {
  return species.value.find((s) => s.id === id) ?? species.value[0];
}

/** Colours being tried on in the Colours view (shown in the habitat before they're applied). */
export const colourPreview = signal<{ variant: number; colors: CustomColors | null } | null>(null);

// ---------------- the habitat's reactions to buttons ----------------

export type Reaction = 'feed' | 'play' | 'call' | 'sleep' | 'wake' | TrickName | 'sparkle' | 'treat' | 'special' | ToyKind;
type Listener = (r: Reaction) => void;
const listeners = new Set<Listener>();
export const reactions = {
  on(fn: Listener) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  emit(r: Reaction) {
    for (const fn of listeners) fn(r);
  },
};

// ---------------- actions ----------------

export function setView(v: PanelInit['view']) {
  if (v === 'choose') choosing.value = true;
  else {
    choosing.value = false;
    tab.value = v === 'settings' ? 'settings' : v === 'dinos' ? 'dinos' : 'pet';
  }
}

export function updateSettings(patch: Partial<Settings>) {
  const s = settings.value;
  if (!s) return;
  settings.value = { ...s, ...patch };
  sfx.configure(settings.value.sound, settings.value.volume);
  void api.setSettings(patch).then((v) => {
    settings.value = v;
    sfx.configure(v.sound, v.volume);
  });
}

/** A command for the selected dino. */
export function command(c: Command) {
  api.command({ ...c, pet: selected.value ?? undefined });
}

/** Roster actions (select, bring out, put away, release, move); resolves to an error message or null. */
export function dinoAction(a: DinoAction): Promise<string | null> {
  if (a.type === 'select') {
    selected.value = a.id;
    pet.value = roster.value.find((d) => d.pet.id === a.id)?.pet ?? pet.value;
  }
  return api.dino(a);
}

export function applyUpdate(u: PanelUpdate) {
  pet.value = u.pet;
  roster.value = u.roster ?? [];
  out.value = u.out ?? [];
  selected.value = u.selected;
  displays.value = u.displays ?? [];
  settings.value = u.settings;
  species.value = u.species;
  problems.value = u.problems;
  history.value = u.history ?? [];
  systemDark.value = !!u.systemDark;
  sfx.configure(u.settings.sound, u.settings.volume);
  if (!u.pet) choosing.value = true;
}
