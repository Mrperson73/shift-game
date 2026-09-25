// Applies the colour theme (CSS palettes live in panel.css) and describes each theme's habitat:
// every theme is also a little biome for the pet's scene.

import type { Theme } from '../shared/themes';
import { api, reducedMotion } from './state';

type ThemeKey = Theme['id'];

export type PlantKind = 'fern' | 'palm' | 'cycad' | 'bush' | 'flowers' | 'rock' | 'acacia' | 'tuft' | 'crystal' | 'mushroom' | 'lolly' | 'starfish' | 'shell';

export interface PlantSpec {
  kind: PlantKind;
  /** Position as a fraction of the scene width. */
  x: number;
  /** Size multiplier. */
  s: number;
  flip?: boolean;
}

export interface Biome {
  id: ThemeKey;
  /** Mixed into the sky of the current hour. */
  tint: string;
  tintAmt: number;
  far: string;
  mid: string;
  ground: string;
  ground2: string;
  grass: string;
  leaf: string;
  leaf2: string;
  trunk: string;
  flowers: string[];
  rock: string;
  cloud: string;
  /** Fireflies at night (embers on the volcano). */
  glow: string;
  prop: 'none' | 'volcano' | 'sea';
  /** Stars show at least this much, even by day (0 = only at night). */
  stars: number;
  /** Behind the pet. */
  back: PlantSpec[];
  /** In front of the pet, near the edges. */
  front: PlantSpec[];
}

export const BIOMES: Record<ThemeKey, Biome> = {
  meadow: {
    id: 'meadow',
    tint: '#ffffff',
    tintAmt: 0,
    far: '#a4d2b4',
    mid: '#86c270',
    ground: '#82bf5e',
    ground2: '#5f9d45',
    grass: '#5f9f40',
    leaf: '#4f9a45',
    leaf2: '#3a7a36',
    trunk: '#8a6a4a',
    flowers: ['#ff8fb1', '#ffd966', '#ffffff', '#b99cff'],
    rock: '#bdb6a8',
    cloud: '#ffffff',
    glow: '#eaff8f',
    prop: 'none',
    stars: 0,
    back: [
      { kind: 'bush', x: 0.1, s: 1 },
      { kind: 'fern', x: 0.33, s: 0.75 },
      { kind: 'flowers', x: 0.56, s: 0.8 },
      { kind: 'bush', x: 0.87, s: 0.8, flip: true },
    ],
    front: [
      { kind: 'fern', x: 0.02, s: 1.25 },
      { kind: 'flowers', x: 0.9, s: 1 },
      { kind: 'rock', x: 0.985, s: 1 },
    ],
  },
  jungle: {
    id: 'jungle',
    tint: '#b8f0d0',
    tintAmt: 0.2,
    far: '#4f8f6e',
    mid: '#387d4f',
    ground: '#3f7d3b',
    ground2: '#2a5a29',
    grass: '#2f6d2f',
    leaf: '#2f8a40',
    leaf2: '#1f5f2d',
    trunk: '#6b4f36',
    flowers: ['#ff6b8a', '#ffb347'],
    rock: '#6f7a6a',
    cloud: '#eafff2',
    glow: '#c8ff7a',
    prop: 'none',
    stars: 0,
    back: [
      { kind: 'palm', x: 0.08, s: 1.15 },
      { kind: 'fern', x: 0.3, s: 0.85 },
      { kind: 'fern', x: 0.62, s: 0.75, flip: true },
      { kind: 'palm', x: 0.84, s: 1, flip: true },
    ],
    front: [
      { kind: 'fern', x: 0.0, s: 1.45 },
      { kind: 'fern', x: 1.0, s: 1.35, flip: true },
    ],
  },
  sunset: {
    id: 'sunset',
    tint: '#ffb07a',
    tintAmt: 0.22,
    far: '#e6ad86',
    mid: '#d99462',
    ground: '#dcad6b',
    ground2: '#bb8849',
    grass: '#b98a3f',
    leaf: '#8ea34c',
    leaf2: '#6b7f35',
    trunk: '#6b4a33',
    flowers: ['#ffd166', '#ff7b54'],
    rock: '#c9a07f',
    cloud: '#fff1e0',
    glow: '#ffe38a',
    prop: 'none',
    stars: 0,
    back: [
      { kind: 'acacia', x: 0.14, s: 1.05 },
      { kind: 'rock', x: 0.56, s: 0.7 },
      { kind: 'acacia', x: 0.86, s: 0.75, flip: true },
    ],
    front: [
      { kind: 'tuft', x: 0.03, s: 1.3 },
      { kind: 'rock', x: 0.95, s: 1.05 },
    ],
  },
  volcano: {
    id: 'volcano',
    tint: '#ff7a4a',
    tintAmt: 0.3,
    far: '#6e3d3b',
    mid: '#4e2e2f',
    ground: '#48332f',
    ground2: '#2b1d1e',
    grass: '#6a4630',
    leaf: '#6d8a3e',
    leaf2: '#4a632b',
    trunk: '#4a3024',
    flowers: ['#ff9f43'],
    rock: '#5d4849',
    cloud: '#ffd3c2',
    glow: '#ffac5c',
    prop: 'volcano',
    stars: 0,
    back: [
      { kind: 'cycad', x: 0.12, s: 0.95 },
      { kind: 'rock', x: 0.42, s: 0.75 },
    ],
    front: [
      { kind: 'rock', x: 0.03, s: 1.25 },
      { kind: 'cycad', x: 0.95, s: 1.15, flip: true },
    ],
  },
  ocean: {
    id: 'ocean',
    tint: '#a8e6ff',
    tintAmt: 0.12,
    far: '#3d9fd6',
    mid: '#efd6a0',
    ground: '#f2dba6',
    ground2: '#dcbc7c',
    grass: '#cdb57c',
    leaf: '#46ad66',
    leaf2: '#2e8a4f',
    trunk: '#9a7652',
    flowers: ['#ff8a80', '#ffd166'],
    rock: '#b9b3a8',
    cloud: '#ffffff',
    glow: '#d2fbff',
    prop: 'sea',
    stars: 0,
    back: [
      { kind: 'palm', x: 0.1, s: 1.2 },
      { kind: 'palm', x: 0.87, s: 0.95, flip: true },
    ],
    front: [
      { kind: 'shell', x: 0.07, s: 1 },
      { kind: 'starfish', x: 0.9, s: 1 },
      { kind: 'rock', x: 0.99, s: 0.9 },
    ],
  },
  midnight: {
    id: 'midnight',
    tint: '#8a78ff',
    tintAmt: 0.3,
    far: '#5b56a0',
    mid: '#46418a',
    ground: '#403c80',
    ground2: '#272556',
    grass: '#4d4895',
    leaf: '#6a62c8',
    leaf2: '#4a43a0',
    trunk: '#3a3470',
    flowers: ['#ffe38a', '#9ff0ff'],
    rock: '#5a568f',
    cloud: '#d9d2ff',
    glow: '#b8f3ff',
    prop: 'none',
    stars: 0.35,
    back: [
      { kind: 'crystal', x: 0.12, s: 1 },
      { kind: 'mushroom', x: 0.68, s: 0.75 },
      { kind: 'crystal', x: 0.88, s: 0.7, flip: true },
    ],
    front: [
      { kind: 'mushroom', x: 0.03, s: 1.1 },
      { kind: 'crystal', x: 0.965, s: 1.15, flip: true },
    ],
  },
  candy: {
    id: 'candy',
    tint: '#ffc4e1',
    tintAmt: 0.26,
    far: '#f5bcd9',
    mid: '#f2a2c8',
    ground: '#f7aed0',
    ground2: '#e487b5',
    grass: '#ee92c0',
    leaf: '#8fdcb9',
    leaf2: '#63c49a',
    trunk: '#f3cf9f',
    flowers: ['#fff27a', '#8fd8ff', '#ffffff'],
    rock: '#e9b8d8',
    cloud: '#ffffff',
    glow: '#fff6a8',
    prop: 'none',
    stars: 0,
    back: [
      { kind: 'lolly', x: 0.1, s: 1 },
      { kind: 'lolly', x: 0.86, s: 0.8, flip: true },
    ],
    front: [
      { kind: 'flowers', x: 0.04, s: 1.1 },
      { kind: 'mushroom', x: 0.96, s: 1.05, flip: true },
    ],
  },
};

type ThemeListener = () => void;
const themeListeners = new Set<ThemeListener>();
/** Called right after the theme changes (inside a view transition's update, so canvases can redraw first). */
export function onThemeChange(fn: ThemeListener) {
  themeListeners.add(fn);
  return () => void themeListeners.delete(fn);
}

let current: ThemeKey | null = null;
let origin: { x: number; y: number } | null = null;

/** Where the next theme change starts spreading from (the swatch that was clicked). */
export function setThemeOrigin(p: { x: number; y: number }) {
  origin = p;
}

export function takeThemeOrigin() {
  const o = origin;
  origin = null;
  return o ?? undefined;
}

function paintTitleBar(t: Theme) {
  api.titleBar({ color: t.bar, symbolColor: t.barInk });
}

/**
 * Switches the page to a theme. With `from` (a point on screen), the new theme spreads out from
 * there in a circle, like paint.
 */
export function applyTheme(t: Theme, from?: { x: number; y: number }) {
  const root = document.documentElement;
  if (current === t.id) return;
  const first = current === null;
  current = t.id;
  const update = () => {
    root.dataset.theme = t.id;
    root.dataset.dark = t.dark ? 'true' : 'false';
    for (const fn of themeListeners) fn();
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };
  if (first || !from || reducedMotion.value || !doc.startViewTransition) {
    update();
    paintTitleBar(t);
    return;
  }
  const vt = doc.startViewTransition(update);
  const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  void vt.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
        { duration: 620, easing: 'cubic-bezier(.3,.7,.2,1)', pseudoElement: '::view-transition-new(root)' },
      );
      // The native title bar can't be animated: switch it when the circle reaches the
      // minimise/close buttons (top right). The easing is fast early, hence the power.
      const d = Math.hypot(innerWidth - 70 - from.x, 20 - from.y);
      setTimeout(() => paintTitleBar(t), 620 * Math.pow(Math.min(1, d / r), 1.6));
    })
    .catch(() => paintTitleBar(t));
}
