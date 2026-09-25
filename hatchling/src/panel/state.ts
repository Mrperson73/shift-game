// Panel state: what the main process told us, plus what's on screen. Components read these
// signals directly, so an update only re-renders the parts that use what changed.

import { computed, signal } from '@preact/signals';
import { growthOf } from '../pet/growth';
import type { SpeciesDef } from '../pet/species';
import type { PanelUpdate } from '../shared/api';
import { resolveTheme } from '../shared/themes';
import type { Command, CustomColors, ModProblem, PanelInit, PastPet, PetData, Settings, TrickName } from '../shared/types';
import { sfx } from './sfx';

export const api = window.panel;

export type Tab = 'pet' | 'colours' | 'settings';
export const TABS: Tab[] = ['pet', 'colours', 'settings'];

export const info = signal<PanelInit | null>(null);
export const pet = signal<PetData | null>(null);
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

export function speciesOf(id: string): SpeciesDef {
  return species.value.find((s) => s.id === id) ?? species.value[0];
}

/** Colours being tried on in the Colours view (shown in the habitat before they're applied). */
export const colourPreview = signal<{ variant: number; colors: CustomColors | null } | null>(null);

// ---------------- the habitat's reactions to buttons ----------------

export type Reaction = 'feed' | 'play' | 'call' | 'sleep' | 'wake' | TrickName | 'sparkle';
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
    tab.value = v === 'settings' ? 'settings' : 'pet';
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

export function command(c: Command) {
  api.command(c);
}

export function applyUpdate(u: PanelUpdate) {
  pet.value = u.pet;
  settings.value = u.settings;
  species.value = u.species;
  problems.value = u.problems;
  history.value = u.history ?? [];
  systemDark.value = !!u.systemDark;
  sfx.configure(u.settings.sound, u.settings.volume);
  if (!u.pet) choosing.value = true;
}
