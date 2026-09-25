// Small helpers for the panel: wording for times, and species facts.

import type { SpeciesDef } from '../pet/species';

export type FoodKind = 'meat' | 'fish' | 'leaf' | 'berry';

/** What the species eats, for the food it gets and the Feed button's icon. */
export function foodOf(sp: SpeciesDef): FoodKind {
  const f = (sp as SpeciesDef & { food?: unknown }).food;
  if (f === 'meat' || f === 'fish' || f === 'leaf' || f === 'berry') return f;
  return sp.diet === 'carnivore' ? 'meat' : 'leaf';
}

/** "3 days ago", "yesterday", "2 hours ago", "just now". */
export function ago(ms: number): string {
  const d = Math.floor(ms / 86_400_000);
  if (d >= 2) return `${d} days ago`;
  if (d === 1) return 'yesterday';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const m = Math.floor(ms / 60_000);
  if (m >= 2) return `${m} min ago`;
  return 'just now';
}

/** A duration in hours as "45 min", "2 h 10 min", "34 h". */
export function duration(hours: number): string {
  const mins = Math.max(0, Math.round(hours * 60));
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 10 || m === 0) return `${Math.round(hours)} h`;
  return `${h} h ${m} min`;
}

/** Compact time together for a stat tile: "12m", "3h 20m", "54h". */
export function shortDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h >= 10) return `${h}h`;
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function dateText(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Metres, with a friendly comparison. */
export function lengthText(m: number): string {
  const v = m >= 10 ? Math.round(m) : Math.round(m * 10) / 10;
  return `${v} m long`;
}
