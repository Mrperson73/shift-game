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
species ("base") and changes its shape, looks and personality. Hatchling picks up changes
right away; new species show up as eggs when you hatch a new pet.

Fields (all optional except id and name):
  id           short id, a-z 0-9 and - (not one of the built-in ids)
  name         shown on the egg
  base         two legs: rex | raptor | pachy | spino | carno | dilo | parasaur | galli | allo |
                         therizino | compy | ovi | micro
               four legs: trike | stego | anky | brachio | diplo | styraco | iguano | kentro |
                          amarga | corytho | deino
               winged (they fly): ptera | quetzal | micro
  latin        its scientific name
  blurb        one line about it
  fact         a fun fact for the egg chooser
  lengthM      real length in metres
  diet         carnivore | herbivore
  food         meat | fish | leaf | berry
  scale        size next to other species, 0.5 .. 1.4 (1 = normal; Compsognathus is 0.6)
  proportions  size multipliers, e.g. { "headLen": 1.2, "tailLen": 0.8, "armUpper": 0.5 }
  features     true/false: teeth, brow, feathers, featherCoat, crest, dome, horns, sail, spikes,
               sickleClaw, beak, frill, frillSpikes, browHorns, noseHorn, longNoseHorn, plates,
               spikeRow, shoulderSpikes, thagomizer, armor, club, osteoderms, tubeCrest,
               helmetCrest, twinCrests, neckFrill, crocSnout, duckBill, longBeak, pteroCrest,
               parrotBeak, casque, horseHead, lowSnout, finTail, nasalArch, lacrimal,
               scytheClaws, thumbSpike, dorsalSpines, neckSpines, whipTail
               and wings: "membrane" | "feather" | false (winged species can fly)
  moves        its special moves, e.g. ["stomp", "display"]: stomp, headbutt, tailSwipe, charge,
               fish, honk, display, browse, dig, screech, fly, rake, whip, curl, roll, gape
  personality  0..1: speed, jump, curiosity, stamina, playfulness, vocal
  variants     colours: [{ "name": "Red", "body": "#a83a2c", "belly": "#f0d0b0",
                            "pattern": "#5a1d16", "accent": "#e8b04a", "iris": "#f3d35a",
                            "pattern_kind": "stripes" }]
               pattern_kind: stripes | bands | spots | rosettes | speckles | saddle | none
  voice        { "pitch": 120, "growl": 0.8, "kind": "roar" }
               kind: roar | screech | honk | bellow | hoot | trill | chitter | croak | rumble |
                     grunt | coo
  lines        what it says in "chatty" mode, per event:
               hello, welcome, feed, pet, game, gameOver, sleepy, night, grow, thrown, poke

See ceratosaurus.json.example for a complete example (rename it to .json to use it).
Tip: ask an AI to "write a Hatchling species JSON for a Giganotosaurus" and paste this file in.
`;

const EXAMPLE = {
  id: 'cerato',
  name: 'Cerato',
  latin: 'Ceratosaurus',
  base: 'carno',
  blurb: 'A horned hunter with a row of bumps down its back.',
  fact: 'It had a blade-like horn on its nose and a row of bony bumps along its back.',
  lengthM: 6,
  diet: 'carnivore',
  food: 'meat',
  proportions: { headLen: 1.25, headH: 0.9, armUpper: 1.8, armFore: 2, hipHeight: 0.9, thigh: 0.92, shin: 0.9 },
  features: { noseHorn: true, horns: true, spikes: true, brow: true, teeth: true },
  personality: { speed: 0.7, jump: 0.5, curiosity: 0.6, stamina: 0.6, playfulness: 0.6, vocal: 0.7 },
  variants: [
    { name: 'Crimson', body: '#b0473a', belly: '#f0d2b4', pattern: '#6b231c', accent: '#f2c14e', iris: '#f5d76e', pattern_kind: 'stripes' },
    { name: 'Dusk', body: '#5d4a78', belly: '#d9cde8', pattern: '#352848', accent: '#f08a5d', iris: '#ffd166', pattern_kind: 'rosettes' },
  ],
  voice: { pitch: 130, growl: 0.85, kind: 'roar' },
  lines: { hello: ['Hrrk!'], game: ['Charge!'], feed: ['Nom nom.'] },
};

export function ensureModsFolder(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  // The README is ours: keep it up to date with this version's bases and features.
  const readme = path.join(dir, 'README.txt');
  let old = '';
  try {
    old = fs.readFileSync(readme, 'utf8');
  } catch {}
  if (old !== README) fs.writeFileSync(readme, README);
  const ex = path.join(dir, 'ceratosaurus.json.example');
  if (!fs.existsSync(ex)) fs.writeFileSync(ex, JSON.stringify(EXAMPLE, null, 2));
}

export const _test = { EXAMPLE };
