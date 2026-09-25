// Custom species from JSON files in Documents\Hatchling\species. Data only: mods can't run code.

import fs from 'node:fs';
import path from 'node:path';
import { BUILT_IN, parseSpeciesMod, type SpeciesDef } from '../pet/species';
import type { ModProblem } from '../shared/types';

export function loadMods(dir: string): { species: SpeciesDef[]; problems: ModProblem[] } {
  const species: SpeciesDef[] = [];
  const problems: ModProblem[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort().slice(0, 50);
  } catch {
    return { species, problems };
  }
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      if (fs.statSync(full).size > 64 * 1024) throw new Error('File is too big (64 KB max)');
      const s = parseSpeciesMod(JSON.parse(fs.readFileSync(full, 'utf8')), f);
      if (species.some((x) => x.id === s.id)) throw new Error(`Another file already uses the id "${s.id}"`);
      species.push(s);
    } catch (e) {
      problems.push({ file: f, error: e instanceof SyntaxError ? `Not valid JSON: ${e.message}` : (e as Error).message });
    }
  }
  return { species, problems };
}

export function allSpecies(dir: string) {
  const m = loadMods(dir);
  return { species: [...BUILT_IN, ...m.species], problems: m.problems };
}

const README = `Hatchling species mods
======================

Put .json files in this folder to add your own species. Each one starts from a built-in
species ("base": "rex", "raptor" or "pachy") and changes its shape, looks and personality.
Hatchling picks up changes right away; new species show up as eggs when you hatch a new pet.

Fields (all optional except id and name):
  id           short id, a-z 0-9 and -
  name         shown on the egg
  base         rex | raptor | pachy
  blurb        one line about it
  diet         carnivore | herbivore
  proportions  size multipliers, e.g. { "headLen": 1.2, "tailLen": 0.8, "armUpper": 0.5 }
  features     true/false: teeth, brow, feathers, crest, dome, horns, sail, spikes, sickleClaw, beak
  personality  0..1: speed, jump, curiosity, stamina, playfulness, vocal
  variants     colours: [{ "name": "Red", "body": "#a83a2c", "belly": "#f0d0b0",
                            "pattern": "#5a1d16", "accent": "#e8b04a", "iris": "#f3d35a",
                            "pattern_kind": "stripes" }]   (stripes | spots | bands | none)
  voice        { "pitch": 120, "growl": 0.8 }
  lines        what it says in "chatty" mode, per event:
               hello, welcome, feed, pet, game, gameOver, sleepy, night, grow, thrown, poke

See carnotaurus.json.example for a complete example (rename it to .json to use it).
Tip: ask an AI to "write a Hatchling species JSON for a Spinosaurus" and paste this file in.
`;

const EXAMPLE = {
  id: 'carno',
  name: 'Carno',
  latin: 'Carnotaurus',
  base: 'rex',
  blurb: 'Horned, fast and a little dramatic.',
  diet: 'carnivore',
  proportions: { headLen: 0.78, headH: 1.05, armUpper: 0.6, armFore: 0.5, thigh: 1.1, shin: 1.15, tailLen: 1.1 },
  features: { horns: true, brow: true, teeth: true },
  personality: { speed: 0.8, jump: 0.5, curiosity: 0.6, stamina: 0.6, playfulness: 0.6, vocal: 0.7 },
  variants: [
    { name: 'Crimson', body: '#b0473a', belly: '#f0d2b4', pattern: '#6b231c', accent: '#f2c14e', iris: '#f5d76e', pattern_kind: 'stripes' },
    { name: 'Dusk', body: '#5d4a78', belly: '#d9cde8', pattern: '#352848', accent: '#f08a5d', iris: '#ffd166', pattern_kind: 'spots' },
  ],
  voice: { pitch: 140, growl: 0.8 },
  lines: { hello: ['Hrrk!'], game: ['Charge!'], feed: ['Nom nom.'] },
};

export function ensureModsFolder(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  const ex = path.join(dir, 'carnotaurus.json.example');
  if (!fs.existsSync(ex)) fs.writeFileSync(ex, JSON.stringify(EXAMPLE, null, 2));
}

export const _test = { EXAMPLE };
