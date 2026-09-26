// Colour themes for the panel window. The main process only needs the window colours; the panel
// builds its full palette from these.

export type ThemeId = 'auto' | 'meadow' | 'jungle' | 'sunset' | 'volcano' | 'ocean' | 'midnight' | 'candy';

export interface Theme {
  id: Exclude<ThemeId, 'auto'>;
  name: string;
  dark: boolean;
  /** Window background. */
  bg: string;
  /** Title bar background and the colour of its buttons' symbols. */
  bar: string;
  barInk: string;
  accent: string;
}

export const THEMES: Theme[] = [
  { id: 'meadow', name: 'Meadow', dark: false, bg: '#f3f7ea', bar: '#e4eed3', barInk: '#2e3a22', accent: '#5a9e3c' },
  { id: 'jungle', name: 'Jungle', dark: true, bg: '#122019', bar: '#0d1812', barInk: '#d6ecd7', accent: '#6cc76a' },
  { id: 'sunset', name: 'Sunset', dark: false, bg: '#fff3e8', bar: '#ffe2cb', barInk: '#4a2a1a', accent: '#f07a3a' },
  { id: 'volcano', name: 'Volcano', dark: true, bg: '#1d1213', bar: '#160d0e', barInk: '#f7d9cc', accent: '#ff6a3d' },
  { id: 'ocean', name: 'Ocean', dark: false, bg: '#edf5fb', bar: '#d8eaf6', barInk: '#1c3446', accent: '#2f8fd8' },
  { id: 'midnight', name: 'Midnight', dark: true, bg: '#15142a', bar: '#0f0e21', barInk: '#e1def7', accent: '#8f7cff' },
  { id: 'candy', name: 'Candy', dark: false, bg: '#fff0f5', bar: '#ffdeeb', barInk: '#4a1f33', accent: '#ff5c9a' },
];

export const THEME_IDS: ThemeId[] = ['auto', ...THEMES.map((t) => t.id)];

/** 'auto' follows Windows: Meadow in light mode, Midnight in dark mode. */
export function resolveTheme(id: ThemeId, systemDark: boolean): Theme {
  const want = id === 'auto' ? (systemDark ? 'midnight' : 'meadow') : id;
  return THEMES.find((t) => t.id === want) ?? THEMES[0];
}
