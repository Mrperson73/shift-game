// Speech: the species' own lines, with fallbacks for events a species (or a mod) has no lines for,
// and a few lines that name the game or video site you're on.

import type { LineEvent, SpeciesDef } from '../pet/species';

/** Used when a species has no lines of its own for an event. */
export const FALLBACK_LINES: Record<LineEvent, string[]> = {
  hello: ['Hi!'],
  welcome: ["You're back!"],
  feed: ['Yum!'],
  pet: ['...more.'],
  game: ['Good luck!', 'Go go go!'],
  gameOver: ['GG!', 'Good game!'],
  sleepy: ['*yawn*'],
  night: ["It's late..."],
  grow: ["I'm bigger!"],
  thrown: ['Whoa!'],
  poke: ['?'],
  full: ["I'm full!", 'No more, thanks!'],
  treat: ['Golden!', 'Magic snack!', 'I feel bigger!'],
  video: ['Ooh, a video!', 'What are we watching?'],
  laugh: ['Haha!', 'Hehe!', 'Ooh!', 'Whoa!'],
  friend: ['Hi friend!', 'Hey you!', 'Friend!'],
  found: ['Ooh, look!', 'Treasure!', 'I found something!'],
  fish: ['Got one!', 'Fishy!', 'Gulp!'],
  fly: ['Wheee!', 'Up we go!', 'Look, I can fly!'],
  tada: ['Ta-da!', 'Gotcha!', 'Not really!'],
  toy: ['A toy!', 'Mine!', 'Play time!'],
};

/** Lines that name what you're doing ({game}, {site}); mixed in when the name is known. */
const NAMED: Partial<Record<LineEvent, string[]>> = {
  game: ['Good luck in {game}!', '{game}! Let\'s go!', 'Go win {game}!'],
  gameOver: ['GG!', 'Good game!', 'GG! How was {game}?'],
  video: ['Ooh, {site}!', 'Ooh, {site}! What is it?', '{site} time!'],
};

/** Fills {name} placeholders; null when a placeholder has no value. */
export function fill(text: string, vars?: Record<string, string>): string | null {
  let ok = true;
  const out = text.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = vars?.[k];
    if (!v) ok = false;
    return v ?? '';
  });
  return ok ? out : null;
}

/** A line for an event, or null when there's nothing fitting to say. */
export function pickLine(sp: SpeciesDef, ev: LineEvent, rand: () => number, vars?: Record<string, string>): string | null {
  const named = vars ? NAMED[ev] : undefined;
  const own = sp.lines[ev];
  const pool = named && (!own?.length || rand() < 0.6) ? named : own?.length ? own : FALLBACK_LINES[ev];
  const usable = pool.map((l) => fill(l, vars)).filter((l): l is string => !!l);
  if (!usable.length) return null;
  return usable[Math.floor(rand() * usable.length)];
}
