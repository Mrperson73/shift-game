// What tricks, toys and signature moves are called in the panel and the tray menu.

import type { SignatureMove } from '../pet/species';
import type { ToyKind, TrickName } from './types';

const TRICKS: Partial<Record<TrickName, string>> = { playdead: 'Play dead' };
const TOYS: Partial<Record<ToyKind, string>> = { duck: 'Rubber duck', laser: 'Laser dot' };
const MOVES: Partial<Record<SignatureMove, string>> = {
  headbutt: 'Head-butt',
  tailSwipe: 'Tail swipe',
  fish: 'Go fishing',
  display: 'Show off',
  rake: 'Claw rake',
  whip: 'Tail whip',
  curl: 'Curl up',
  roll: 'Death roll',
  gape: 'Bask',
};

/** "tailSwipe" -> "Tail swipe" for anything without a name of its own. */
const words = (id: string) => {
  const s = id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const trickName = (t: TrickName) => TRICKS[t] ?? words(t);
export const toyName = (t: ToyKind) => TOYS[t] ?? words(t);
export const moveName = (m: SignatureMove) => MOVES[m] ?? words(m);
