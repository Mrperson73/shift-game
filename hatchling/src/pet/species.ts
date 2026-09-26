// Species definitions: body proportions for the procedural rig, looks, personality and sounds.
// Built-in species live here; players can add more as JSON files (see parseSpeciesMod).

import type { Voice, VoiceKind } from '../audio/types';
import { PATTERN_KINDS, type PatternKind } from '../shared/types';

export type { Voice } from '../audio/types';

/** Adult body proportions in rig units (an adult is roughly 90 units tall). */
export interface BodyParams {
  hipHeight: number;
  thigh: number;
  shin: number;
  meta: number;
  heel: number;
  toe: number;
  legW: number;
  bodyLen: number;
  hipR: number;
  chestR: number;
  bellyR: number;
  bellyDrop: number;
  pitch: number;
  neckLen: number;
  neckR: number;
  neckAngle: number;
  /** How much the neck curves forward from base to head (radians). */
  neckBend: number;
  /** 0 = as thick at the head as at the shoulders .. 0.6 = much thinner (sauropods). */
  neckTaper: number;
  headLen: number;
  headH: number;
  snoutH: number;
  jawD: number;
  headAngle: number;
  eyeR: number;
  eyeX: number;
  eyeY: number;
  tailLen: number;
  tailR: number;
  tailDroop: number;
  tailStiff: number;
  armUpper: number;
  armFore: number;
  armW: number;
  /** Upper arm angle relative to the body (radians, 0 = forward, negative = down). */
  armAngle: number;
  /** Elbow bend (radians). */
  armBend: number;
  /** Four-legged species: height of the chest when standing (0 for two-legged ones). */
  shoulderHeight: number;
  /** Four-legged species: upper arm, forearm and hand lengths, and front leg width. */
  fThigh: number;
  fShin: number;
  fMeta: number;
  fLegW: number;
}

export type BodyKey = keyof BodyParams;

export interface Features {
  teeth?: boolean;
  brow?: boolean;
  feathers?: boolean;
  crest?: boolean;
  dome?: boolean;
  horns?: boolean;
  sail?: boolean;
  spikes?: boolean;
  sickleClaw?: boolean;
  beak?: boolean;
  /** Ceratopsian neck frill. */
  frill?: boolean;
  /** Long horns above the eyes (Triceratops). */
  browHorns?: boolean;
  /** A horn on the nose. */
  noseHorn?: boolean;
  /** Plates along the back (Stegosaurus). */
  plates?: boolean;
  /** Spikes at the end of the tail (Stegosaurus). */
  thagomizer?: boolean;
  /** Bony armour and side spikes (Ankylosaurus). */
  armor?: boolean;
  /** A bony club at the end of the tail (Ankylosaurus). */
  club?: boolean;
  /** A long tube crest curving back from the head (Parasaurolophus). */
  tubeCrest?: boolean;
  /** Two thin crests on top of the head (Dilophosaurus). */
  twinCrests?: boolean;
  /** A long, low, crocodile-like snout (Spinosaurus). */
  crocSnout?: boolean;
  /** A broad duck-like bill (hadrosaurs). */
  duckBill?: boolean;
  /** A fin along the tail (Spinosaurus). */
  finTail?: boolean;
  /** A tall arch over the nose (Brachiosaurus). */
  nasalArch?: boolean;
  /** Wings: skin membranes (pterosaurs) or feathers (Microraptor). Winged species can fly. */
  wings?: 'membrane' | 'feather';
}

/** A species' signature moves (what the Special button and its own idle behaviour do). */
export type SignatureMove =
  | 'stomp' // big theropods: stomp and roar, a dust ring
  | 'headbutt' // dome heads: charge and bonk a wall or the screen edge
  | 'tailSwipe' // stegosaurs, ankylosaurs: swing the tail weapon
  | 'charge' // ceratopsians: head down, charge a short way, skid
  | 'fish' // Spinosaurus, Baryonyx, pterosaurs: fish in a puddle
  | 'honk' // crested hadrosaurs: a big honk with sound rings
  | 'display' // frills, sails, crests: show off (Pose.display)
  | 'browse' // long necks: reach up and eat leaves
  | 'dig' // scratch the ground, sometimes finds something
  | 'screech' // small theropods: head back, screech
  | 'fly' // winged species: take off and fly across the screen
  | 'rake' // Therizinosaurus: slash with the huge claws
  | 'whip' // Diplodocus: crack the tail like a whip
  | 'curl' // Ankylosaurus: hunker down in its armour
  | 'roll' // Deinosuchus: death roll (spins along its body, splashes)
  | 'gape'; // crocodilians: bask with the jaws wide open, very still

/** What it likes to eat when you feed it. */
export type Food = 'meat' | 'fish' | 'leaf' | 'berry';

export interface Personality {
  /** 0..1 how fast it walks and runs. */
  speed: number;
  /** 0..1 how high and how often it jumps between windows. */
  jump: number;
  /** 0..1 how much it watches and follows the cursor. */
  curiosity: number;
  /** 0..1 how long it stays awake. */
  stamina: number;
  /** 0..1 hops, tail chasing, zoomies. */
  playfulness: number;
  /** 0..1 how often it makes sounds. */
  vocal: number;
}

export interface Variant {
  id: string;
  name: string;
  body: string;
  belly: string;
  pattern: string;
  accent: string;
  iris: string;
  pattern_kind: PatternKind;
}

export type LineEvent =
  | 'hello'
  | 'welcome'
  | 'feed'
  | 'pet'
  | 'game'
  | 'gameOver'
  | 'sleepy'
  | 'night'
  | 'grow'
  | 'thrown'
  | 'poke'
  // 1.2 (the sim has fallback lines for these: src/sim/lines.ts)
  | 'full' // a growth treat while still full
  | 'treat' // ate a growth treat
  | 'video' // you started watching a video ({site} is filled in)
  | 'laugh' // reacting to the video
  | 'friend' // greeting another pet
  | 'found' // dug something up
  | 'fish' // caught a fish
  | 'fly' // taking off
  | 'tada' // popping back up after playing dead
  | 'toy'; // a new toy

export interface SpeciesDef {
  id: string;
  name: string;
  latin: string;
  blurb: string;
  diet: 'carnivore' | 'herbivore';
  /** Walks on two legs or on four. */
  stance: 'biped' | 'quad';
  /** Family, shown in the egg chooser (e.g. "Tyrannosaur"). */
  group: string;
  /** Length of a real adult, metres. */
  lengthM: number;
  /** A fun fact for the egg chooser. */
  fact: string;
  food: Food;
  body: BodyParams;
  /** Multipliers applied at hatch (growth 0) and eased out to 1 at adulthood. */
  baby: Partial<Record<BodyKey, number>>;
  features: Features;
  personality: Personality;
  variants: Variant[];
  /** The rare colours of a shiny hatchling. */
  shiny: Variant;
  voice: Voice;
  lines: Partial<Record<LineEvent, string[]>>;
  /** Signature moves; derived from its features when not given (see movesOf). */
  moves?: SignatureMove[];
  /** Set for species loaded from the mods folder. */
  mod?: string;
}

/** A species' signature moves: its own list, or ones that fit its features. */
export function movesOf(sp: SpeciesDef): SignatureMove[] {
  if (sp.moves?.length) return sp.moves;
  const f = sp.features;
  const out: SignatureMove[] = [];
  if (f.wings) out.push('fly');
  if (f.dome) out.push('headbutt');
  if (f.thagomizer || f.club) out.push('tailSwipe');
  if (f.frill || f.browHorns || f.noseHorn) out.push('charge');
  if (f.crocSnout) out.push('fish');
  if (f.tubeCrest) out.push('honk');
  if (f.sail || f.twinCrests) out.push('display');
  if (sp.stance === 'quad' && sp.body.neckLen > 40) out.push('browse');
  if (f.teeth && sp.body.hipHeight >= 40) out.push('stomp');
  if (f.sickleClaw) out.push('screech');
  if (!out.length) out.push(sp.diet === 'carnivore' ? 'screech' : 'dig');
  return out;
}

const BABY_COMMON: Partial<Record<BodyKey, number>> = {
  headLen: 1.85,
  headH: 2.3,
  snoutH: 2,
  jawD: 1.75,
  eyeR: 3.9,
  headAngle: 0.45,
  neckLen: 0.55,
  neckR: 1.35,
  tailLen: 0.5,
  tailR: 1.05,
  hipR: 1.12,
  chestR: 1.05,
  bellyR: 1.15,
  bodyLen: 0.78,
  hipHeight: 0.74,
  thigh: 0.75,
  shin: 0.7,
  meta: 0.75,
  heel: 0.7,
  legW: 1.2,
  armUpper: 1.2,
  armFore: 1.2,
  armW: 1.3,
  shoulderHeight: 0.76,
  fThigh: 0.76,
  fShin: 0.72,
  fMeta: 0.8,
  fLegW: 1.25,
};

/** Front-leg parameters of two-legged species (unused). */
const NO_FRONT = { shoulderHeight: 0, fThigh: 0, fShin: 0, fMeta: 0, fLegW: 0 };

export const REX: SpeciesDef = {
  id: 'rex',
  name: 'Rex',
  latin: 'Tyrannosaurus',
  blurb: 'Bold and loud. Loves meat and big stomps.',
  diet: 'carnivore',
  stance: 'biped',
  group: 'Tyrannosaur',
  lengthM: 12,
  fact: 'Its bite was the strongest of any land animal ever.',
  food: 'meat',
  body: {
    hipHeight: 42,
    thigh: 20,
    shin: 18,
    meta: 10,
    heel: 8,
    toe: 9,
    legW: 12,
    bodyLen: 32,
    hipR: 16.5,
    chestR: 14.5,
    bellyR: 14.5,
    bellyDrop: 5,
    pitch: 0.06,
    neckLen: 14,
    neckR: 9.5,
    neckAngle: 0.55,
    neckBend: 0.45,
    neckTaper: 0.25,
    headLen: 28,
    headH: 15,
    snoutH: 11.5,
    jawD: 8,
    headAngle: -0.45,
    eyeR: 2.5,
    eyeX: 0.32,
    eyeY: 0.74,
    tailLen: 68,
    tailR: 12.5,
    tailDroop: 0.12,
    tailStiff: 0.55,
    armUpper: 5,
    armFore: 4,
    armW: 2.6,
    armAngle: -1.15,
    armBend: 1.05,
    ...NO_FRONT,
  },
  baby: BABY_COMMON,
  features: { teeth: true, brow: true },
  personality: { speed: 0.45, jump: 0.3, curiosity: 0.55, stamina: 0.55, playfulness: 0.5, vocal: 0.8 },
  variants: [
    { id: 'forest', name: 'Forest', body: '#5f9150', belly: '#dcd59a', pattern: '#3f6a37', accent: '#c7643b', iris: '#e7b73c', pattern_kind: 'stripes' },
    { id: 'ember', name: 'Ember', body: '#c4643e', belly: '#f1d1a0', pattern: '#83382a', accent: '#f0b24a', iris: '#f3d35a', pattern_kind: 'stripes' },
    { id: 'ash', name: 'Ash', body: '#80848c', belly: '#dcd8d0', pattern: '#4d5159', accent: '#c9553f', iris: '#e8a53a', pattern_kind: 'stripes' },
    { id: 'midnight', name: 'Midnight', body: '#46557f', belly: '#bcc6e2', pattern: '#2a3356', accent: '#7fd1c9', iris: '#9fe07a', pattern_kind: 'stripes' },
    { id: 'sandstone', name: 'Sandstone', body: '#c9a36b', belly: '#f3e4c2', pattern: '#7b5431', accent: '#b9452e', iris: '#f0c24a', pattern_kind: 'saddle' },
    { id: 'albino', name: 'Albino', body: '#efe9e0', belly: '#ffffff', pattern: '#d8cdbf', accent: '#e58b9b', iris: '#e0445c', pattern_kind: 'none' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Gold', body: '#e2b23a', belly: '#fff2c4', pattern: '#a8701a', accent: '#fff6d8', iris: '#5fd0ff', pattern_kind: 'stripes' },
  voice: { pitch: 110, growl: 0.75, kind: 'roar' },
  lines: {
    hello: ['RAWR!', 'Hi!'],
    welcome: ['You\'re back!', 'RAWR! Missed you.'],
    feed: ['Nom!', 'MEAT!'],
    pet: ['...more.', 'Rrrr.'],
    game: ['Go get \'em!', 'RAWR! Good luck!'],
    gameOver: ['GG!', 'Did we win?'],
    sleepy: ['*yawn*'],
    night: ['It\'s late...'],
    grow: ['I\'m bigger!'],
    thrown: ['Hey!', 'Whoa!'],
    poke: ['?', 'Rrr!'],
  },
};

export const RAPTOR: SpeciesDef = {
  id: 'raptor',
  name: 'Raptor',
  latin: 'Utahraptor',
  blurb: 'Fast, curious and jumpy. Chases your cursor.',
  diet: 'carnivore',
  stance: 'biped',
  group: 'Raptor',
  lengthM: 6,
  fact: 'It had a 24 cm sickle claw on each foot.',
  food: 'meat',
  body: {
    hipHeight: 38,
    thigh: 17.5,
    shin: 19,
    meta: 11,
    heel: 10,
    toe: 8,
    legW: 9.5,
    bodyLen: 25,
    hipR: 12.5,
    chestR: 12,
    bellyR: 11.5,
    bellyDrop: 3,
    pitch: 0.1,
    neckLen: 18,
    neckR: 7,
    neckAngle: 0.85,
    neckBend: 0.45,
    neckTaper: 0.25,
    headLen: 24,
    headH: 10.5,
    snoutH: 7.5,
    jawD: 5.2,
    headAngle: -0.85,
    eyeR: 2.7,
    eyeX: 0.36,
    eyeY: 0.7,
    tailLen: 70,
    tailR: 8.5,
    tailDroop: -0.02,
    tailStiff: 0.85,
    armUpper: 11,
    armFore: 11,
    armW: 3.2,
    armAngle: -2.15,
    armBend: 2.05,
    ...NO_FRONT,
  },
  baby: { ...BABY_COMMON, tailLen: 0.7 },
  features: { teeth: true, feathers: true, crest: true, sickleClaw: true },
  personality: { speed: 0.85, jump: 0.85, curiosity: 0.9, stamina: 0.6, playfulness: 0.85, vocal: 0.55 },
  variants: [
    { id: 'sand', name: 'Sand', body: '#c7a06a', belly: '#f1e2c4', pattern: '#8a673c', accent: '#7c4a2a', iris: '#e0a93b', pattern_kind: 'bands' },
    { id: 'jungle', name: 'Jungle', body: '#6c9460', belly: '#e0e7c9', pattern: '#3d5c35', accent: '#d9a53a', iris: '#e7c24a', pattern_kind: 'bands' },
    { id: 'plum', name: 'Plum', body: '#7d5e93', belly: '#e6d7ec', pattern: '#4d3762', accent: '#eab94f', iris: '#f0d160', pattern_kind: 'bands' },
    { id: 'snow', name: 'Snow', body: '#d6dbe2', belly: '#ffffff', pattern: '#8791a1', accent: '#557aa7', iris: '#6fb2e8', pattern_kind: 'bands' },
    { id: 'fire', name: 'Fire', body: '#d9582b', belly: '#fbd9a8', pattern: '#7d2a17', accent: '#2f2b3a', iris: '#ffd84a', pattern_kind: 'bands' },
    { id: 'night', name: 'Night', body: '#343b4f', belly: '#8f99b0', pattern: '#171a26', accent: '#39c1d0', iris: '#b8f36a', pattern_kind: 'speckles' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Frost', body: '#9fdcf5', belly: '#f2fbff', pattern: '#4f8fc0', accent: '#ffffff', iris: '#ff7ad1', pattern_kind: 'bands' },
  voice: { pitch: 330, growl: 0.35, kind: 'screech' },
  lines: {
    hello: ['Hi hi hi!', 'Chirp!'],
    welcome: ['You\'re back!!', 'Chirp chirp!'],
    feed: ['Nom!', 'Mine!'],
    pet: ['Hehe.', 'Chirrr.'],
    game: ['Hunt time!', 'Let\'s go!'],
    gameOver: ['Again?', 'GG!'],
    sleepy: ['*yawn*'],
    night: ['Still awake?'],
    grow: ['Look, I\'m bigger!'],
    thrown: ['Wheee!', 'Again!'],
    poke: ['?', 'Hm?'],
  },
};

export const PACHY: SpeciesDef = {
  id: 'pachy',
  name: 'Pachy',
  latin: 'Pachycephalosaurus',
  blurb: 'Calm and stubborn, with a very hard head. Loves leaves.',
  diet: 'herbivore',
  stance: 'biped',
  group: 'Pachycephalosaur',
  lengthM: 4.5,
  fact: 'The dome on its head was up to 25 cm of solid bone.',
  food: 'leaf',
  body: {
    hipHeight: 37,
    thigh: 20,
    shin: 18,
    meta: 10,
    heel: 8,
    toe: 7,
    legW: 11,
    bodyLen: 28,
    hipR: 17,
    chestR: 14,
    bellyR: 16,
    bellyDrop: 6,
    pitch: 0.12,
    neckLen: 12,
    neckR: 9.5,
    neckAngle: 0.7,
    neckBend: 0.45,
    neckTaper: 0.25,
    headLen: 22,
    headH: 17,
    snoutH: 10,
    jawD: 6.5,
    headAngle: -0.35,
    eyeR: 2.7,
    eyeX: 0.42,
    eyeY: 0.52,
    tailLen: 52,
    tailR: 12,
    tailDroop: 0.18,
    tailStiff: 0.65,
    armUpper: 8,
    armFore: 7,
    armW: 3,
    armAngle: -1.2,
    armBend: 1.1,
    ...NO_FRONT,
  },
  baby: { ...BABY_COMMON, headH: 1.45 },
  features: { dome: true, beak: true },
  personality: { speed: 0.35, jump: 0.25, curiosity: 0.4, stamina: 0.45, playfulness: 0.45, vocal: 0.45 },
  variants: [
    { id: 'moss', name: 'Moss', body: '#7b9a59', belly: '#e9e3b9', pattern: '#55723b', accent: '#d8c49a', iris: '#8a5a2b', pattern_kind: 'spots' },
    { id: 'clay', name: 'Clay', body: '#b37a51', belly: '#f1d8ba', pattern: '#7e5034', accent: '#ecd6ad', iris: '#5b3a1f', pattern_kind: 'spots' },
    { id: 'sky', name: 'Sky', body: '#6f9dc2', belly: '#e1eef7', pattern: '#4a7495', accent: '#f1e7d3', iris: '#3d4f6b', pattern_kind: 'spots' },
    { id: 'rose', name: 'Rose', body: '#c17b8c', belly: '#f6e1e6', pattern: '#8d4f60', accent: '#f4e3c8', iris: '#5b2f3b', pattern_kind: 'spots' },
    { id: 'honey', name: 'Honey', body: '#d8a24a', belly: '#fbe8bf', pattern: '#9a6420', accent: '#6e4a2b', iris: '#4a2f14', pattern_kind: 'saddle' },
    { id: 'stone', name: 'Stone', body: '#8f8b83', belly: '#dcd8cd', pattern: '#5e5a52', accent: '#c7b28a', iris: '#3b3226', pattern_kind: 'speckles' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Opal', body: '#d9c8f5', belly: '#fbf6ff', pattern: '#9c7fd0', accent: '#ffe6a8', iris: '#2f9c8f', pattern_kind: 'spots' },
  voice: { pitch: 180, growl: 0.45, kind: 'hoot' },
  lines: {
    hello: ['Hmph. Hi.', 'Hoo!'],
    welcome: ['Oh. You\'re back.', 'Hoo!'],
    feed: ['Leaves!', 'Crunch.'],
    pet: ['Mm.', 'Nice.'],
    game: ['Headbutt them!', 'Good luck.'],
    gameOver: ['GG.', 'Nap time?'],
    sleepy: ['*yawn*'],
    night: ['Bedtime.'],
    grow: ['Harder head!'],
    thrown: ['Hmph!', 'Rude.'],
    poke: ['Hm?', 'Bonk?'],
  },
};

// ---------------- four-legged ----------------

export const TRIKE: SpeciesDef = {
  id: 'trike',
  name: 'Trike',
  latin: 'Triceratops',
  blurb: 'Gentle and stubborn. Three horns, one big frill, loves ferns.',
  diet: 'herbivore',
  stance: 'quad',
  group: 'Ceratopsian',
  lengthM: 9,
  fact: 'Its skull, frill included, was one of the biggest of any land animal.',
  food: 'leaf',
  body: {
    hipHeight: 35,
    thigh: 15.5,
    shin: 13.5,
    meta: 9,
    heel: 7,
    toe: 6,
    legW: 11,
    bodyLen: 33,
    hipR: 17,
    chestR: 16.5,
    bellyR: 19,
    bellyDrop: 5,
    pitch: -0.2,
    neckLen: 7,
    neckR: 11,
    neckAngle: -0.05,
    neckBend: 0.2,
    neckTaper: 0.1,
    headLen: 30,
    headH: 16,
    snoutH: 11,
    jawD: 7,
    headAngle: -0.35,
    eyeR: 2.4,
    eyeX: 0.44,
    eyeY: 0.62,
    tailLen: 38,
    tailR: 11,
    tailDroop: 0.32,
    tailStiff: 0.5,
    armUpper: 6,
    armFore: 5,
    armW: 2.6,
    armAngle: -1.2,
    armBend: 1,
    shoulderHeight: 30,
    fThigh: 12,
    fShin: 10.5,
    fMeta: 6,
    fLegW: 8,
  },
  baby: { ...BABY_COMMON, headLen: 1.35, headH: 1.6, snoutH: 1.5, neckLen: 0.8 },
  features: { beak: true, frill: true, browHorns: true, noseHorn: true },
  personality: { speed: 0.35, jump: 0.18, curiosity: 0.45, stamina: 0.6, playfulness: 0.45, vocal: 0.5 },
  variants: [
    { id: 'savanna', name: 'Savanna', body: '#b58a5a', belly: '#ecdcbc', pattern: '#7d5836', accent: '#c95b3a', iris: '#3a2a1a', pattern_kind: 'bands' },
    { id: 'moss', name: 'Moss', body: '#7f9a6a', belly: '#e2e6c8', pattern: '#57704a', accent: '#e0a13c', iris: '#3b2a15', pattern_kind: 'speckles' },
    { id: 'slate', name: 'Slate', body: '#6f7f94', belly: '#d7dee8', pattern: '#4a5669', accent: '#e35d5d', iris: '#2a2f3a', pattern_kind: 'saddle' },
    { id: 'clay', name: 'Clay', body: '#b8664a', belly: '#f2d2b8', pattern: '#7c3b28', accent: '#f2c14e', iris: '#2f1a12', pattern_kind: 'bands' },
    { id: 'sunburst', name: 'Sunburst', body: '#d9b24a', belly: '#fff0c2', pattern: '#9b7424', accent: '#3f8fd8', iris: '#3a2a10', pattern_kind: 'spots' },
    { id: 'obsidian', name: 'Obsidian', body: '#443e4b', belly: '#8e8797', pattern: '#25212b', accent: '#ff8a3d', iris: '#f0c050', pattern_kind: 'speckles' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Jade', body: '#5fcfa4', belly: '#e8fff5', pattern: '#2f9a7a', accent: '#ffd35a', iris: '#ff5ab0', pattern_kind: 'bands' },
  voice: { pitch: 90, growl: 0.5, kind: 'bellow' },
  lines: {
    hello: ['Hrrm! Hi!', 'Hmmph.'],
    welcome: ["You're back!", 'Hrrm hrrm!'],
    feed: ['Crunchy!', 'Ferns!'],
    pet: ['Mmm.', 'Behind the frill!'],
    game: ['Charge!', 'Good luck!'],
    gameOver: ['GG!', 'Snack break?'],
    sleepy: ['*yawn*'],
    night: ['Sleepy time.'],
    grow: ['Bigger horns!'],
    thrown: ['Hey!', 'Whoa!'],
    poke: ['Hm?', 'Hrrm?'],
  },
};

export const STEGO: SpeciesDef = {
  id: 'stego',
  name: 'Stego',
  latin: 'Stegosaurus',
  blurb: 'Slow, sweet and a bit forgetful. Big plates, spiky tail.',
  diet: 'herbivore',
  stance: 'quad',
  group: 'Stegosaur',
  lengthM: 9,
  fact: 'The four spikes on its tail are nicknamed the "thagomizer".',
  food: 'leaf',
  body: {
    hipHeight: 42,
    thigh: 19,
    shin: 17,
    meta: 9,
    heel: 7,
    toe: 5,
    legW: 10.5,
    bodyLen: 36,
    hipR: 18,
    chestR: 13.5,
    bellyR: 17,
    bellyDrop: 7,
    pitch: -0.45,
    neckLen: 12,
    neckR: 7,
    neckAngle: 0.08,
    neckBend: 0.3,
    neckTaper: 0.3,
    headLen: 16,
    headH: 8,
    snoutH: 5.5,
    jawD: 4.2,
    headAngle: -0.2,
    eyeR: 1.9,
    eyeX: 0.42,
    eyeY: 0.62,
    tailLen: 56,
    tailR: 12,
    tailDroop: 0.3,
    tailStiff: 0.78,
    armUpper: 6,
    armFore: 5,
    armW: 2.6,
    armAngle: -1.2,
    armBend: 1,
    shoulderHeight: 25,
    fThigh: 10,
    fShin: 8.9,
    fMeta: 5,
    fLegW: 7,
  },
  baby: { ...BABY_COMMON, headLen: 1.5, headH: 1.9, snoutH: 1.7, hipHeight: 0.72, shoulderHeight: 0.86 },
  features: { beak: true, plates: true, thagomizer: true },
  personality: { speed: 0.3, jump: 0.15, curiosity: 0.35, stamina: 0.5, playfulness: 0.4, vocal: 0.35 },
  variants: [
    { id: 'leaf', name: 'Leaf', body: '#6f9a5a', belly: '#e4ebc6', pattern: '#4a6d3c', accent: '#e0703a', iris: '#3a2a14', pattern_kind: 'spots' },
    { id: 'autumn', name: 'Autumn', body: '#b8864a', belly: '#f3e0bc', pattern: '#7f5a2e', accent: '#d9453a', iris: '#2f1d0e', pattern_kind: 'bands' },
    { id: 'teal', name: 'Teal', body: '#4f8a8c', belly: '#d6ecea', pattern: '#34605f', accent: '#f2b84a', iris: '#1f2f30', pattern_kind: 'speckles' },
    { id: 'dusk', name: 'Dusk', body: '#7a6a94', belly: '#e2dcee', pattern: '#524568', accent: '#ff8fa3', iris: '#2a2238', pattern_kind: 'saddle' },
    { id: 'granite', name: 'Granite', body: '#8a8a84', belly: '#dedcd2', pattern: '#5d5d57', accent: '#7ec3e0', iris: '#2a2a26', pattern_kind: 'speckles' },
    { id: 'crimson', name: 'Crimson', body: '#9e3b36', belly: '#f0c9b5', pattern: '#62201e', accent: '#ffd166', iris: '#20100e', pattern_kind: 'bands' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Aurora', body: '#7fd4e6', belly: '#f0fdff', pattern: '#4a9fc0', accent: '#ff7fd0', iris: '#7a3cff', pattern_kind: 'spots' },
  voice: { pitch: 120, growl: 0.35, kind: 'bellow' },
  lines: {
    hello: ['Hi...', 'Mrrrm.'],
    welcome: ['Oh! Hi!', "You're back."],
    feed: ['Leafy!', 'Munch.'],
    pet: ['Nice...', 'Plates, please.'],
    game: ["Thagomize 'em!", 'Go go!'],
    gameOver: ['GG.', 'Nap?'],
    sleepy: ['*yawn*'],
    night: ['Zzz soon.'],
    grow: ['Bigger plates!'],
    thrown: ['Wha-!', 'Oof.'],
    poke: ['Hm?', '...?'],
  },
};

export const ANKY: SpeciesDef = {
  id: 'anky',
  name: 'Anky',
  latin: 'Ankylosaurus',
  blurb: 'A calm little tank. Armoured back, clubbed tail, big appetite.',
  diet: 'herbivore',
  stance: 'quad',
  group: 'Ankylosaur',
  lengthM: 7,
  fact: 'It was armoured like a tank, and its tail club could break bones.',
  food: 'leaf',
  body: {
    hipHeight: 31,
    thigh: 13,
    shin: 11.5,
    meta: 7,
    heel: 6,
    toe: 5,
    legW: 10.5,
    bodyLen: 38,
    hipR: 17,
    chestR: 16,
    bellyR: 19,
    bellyDrop: 3,
    pitch: -0.06,
    neckLen: 7,
    neckR: 9,
    neckAngle: -0.12,
    neckBend: 0.2,
    neckTaper: 0.15,
    headLen: 18,
    headH: 11.5,
    snoutH: 8,
    jawD: 5,
    headAngle: -0.25,
    eyeR: 2,
    eyeX: 0.5,
    eyeY: 0.58,
    tailLen: 48,
    tailR: 10,
    tailDroop: 0.12,
    tailStiff: 0.82,
    armUpper: 6,
    armFore: 5,
    armW: 2.6,
    armAngle: -1.2,
    armBend: 1,
    shoulderHeight: 28,
    fThigh: 11.2,
    fShin: 10.2,
    fMeta: 5,
    fLegW: 8,
  },
  baby: { ...BABY_COMMON, headLen: 1.4, headH: 1.7, snoutH: 1.6 },
  features: { beak: true, armor: true, club: true },
  personality: { speed: 0.25, jump: 0.1, curiosity: 0.3, stamina: 0.55, playfulness: 0.35, vocal: 0.3 },
  variants: [
    { id: 'earth', name: 'Earth', body: '#8a7355', belly: '#dccdb0', pattern: '#5e4b35', accent: '#d8c49a', iris: '#2c2014', pattern_kind: 'speckles' },
    { id: 'olive', name: 'Olive', body: '#76804f', belly: '#dfe2bf', pattern: '#525a34', accent: '#e9d8a6', iris: '#2c2a14', pattern_kind: 'speckles' },
    { id: 'rust', name: 'Rust', body: '#a35a3a', belly: '#efcfb4', pattern: '#6c3620', accent: '#f0dca8', iris: '#2a140c', pattern_kind: 'bands' },
    { id: 'basalt', name: 'Basalt', body: '#4e525a', belly: '#b9bcc4', pattern: '#30333a', accent: '#d9dde6', iris: '#e0a030', pattern_kind: 'speckles' },
    { id: 'mossy', name: 'Mossy', body: '#5b7f5a', belly: '#d9e8cf', pattern: '#3c5a3c', accent: '#f4d27a', iris: '#2a2a14', pattern_kind: 'spots' },
    { id: 'sand', name: 'Sand', body: '#cfb07a', belly: '#f7ebcf', pattern: '#9a7c4a', accent: '#8a5a3a', iris: '#3a2a14', pattern_kind: 'saddle' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Bronze', body: '#c9894a', belly: '#ffe6c2', pattern: '#8a5a26', accent: '#fff1b8', iris: '#39d0c8', pattern_kind: 'speckles' },
  voice: { pitch: 100, growl: 0.6, kind: 'bellow' },
  lines: {
    hello: ['Hrmph.', 'Hi.'],
    welcome: ['Oh. Hi.', 'Hrmph!'],
    feed: ['Munch.', 'Yum.'],
    pet: ['...ok.', 'Nice.'],
    game: ['Smash!', "Club 'em!"],
    gameOver: ['GG.', 'Tank mode off.'],
    sleepy: ['*yawn*'],
    night: ['Bedtime.'],
    grow: ['Harder armour!'],
    thrown: ['Oof!', 'Heavy!'],
    poke: ['Clonk.', 'Hm?'],
  },
};

// ---------------- more two-legged ----------------

export const SPINO: SpeciesDef = {
  id: 'spino',
  name: 'Spino',
  latin: 'Spinosaurus',
  blurb: 'A huge sail and a crocodile snout. Loves fish and big splashes.',
  diet: 'carnivore',
  stance: 'biped',
  group: 'Spinosaur',
  lengthM: 15,
  fact: 'One of the longest meat-eaters ever, it hunted fish in rivers.',
  food: 'fish',
  body: {
    hipHeight: 37,
    thigh: 18,
    shin: 17,
    meta: 10,
    heel: 8,
    toe: 8,
    legW: 11,
    bodyLen: 36,
    hipR: 15,
    chestR: 14,
    bellyR: 14,
    bellyDrop: 4,
    pitch: 0.12,
    neckLen: 17,
    neckR: 8,
    neckAngle: 0.6,
    neckBend: 0.5,
    neckTaper: 0.3,
    headLen: 38,
    headH: 10,
    snoutH: 7,
    jawD: 6,
    headAngle: -0.6,
    eyeR: 2.3,
    eyeX: 0.24,
    eyeY: 0.74,
    tailLen: 72,
    tailR: 11,
    tailDroop: 0.05,
    tailStiff: 0.5,
    armUpper: 11,
    armFore: 9,
    armW: 3.4,
    armAngle: -1.6,
    armBend: 1.4,
    ...NO_FRONT,
  },
  baby: { ...BABY_COMMON, headLen: 1.25, headH: 1.95 },
  features: { teeth: true, sail: true, finTail: true, crocSnout: true },
  personality: { speed: 0.5, jump: 0.35, curiosity: 0.6, stamina: 0.6, playfulness: 0.55, vocal: 0.6 },
  variants: [
    { id: 'river', name: 'River', body: '#5f7f7a', belly: '#dfe9e0', pattern: '#3e5a56', accent: '#d9784a', iris: '#e8c040', pattern_kind: 'stripes' },
    { id: 'desert', name: 'Desert', body: '#c49a62', belly: '#f5e6c8', pattern: '#8a6438', accent: '#c0432f', iris: '#f0c24a', pattern_kind: 'bands' },
    { id: 'swamp', name: 'Swamp', body: '#667a45', belly: '#dde6bd', pattern: '#435429', accent: '#e5b640', iris: '#f2a93a', pattern_kind: 'speckles' },
    { id: 'deep', name: 'Deep', body: '#35506e', belly: '#b9cde0', pattern: '#1f3148', accent: '#4fd1c5', iris: '#f5d76e', pattern_kind: 'stripes' },
    { id: 'blood', name: 'Blood', body: '#7c2f2f', belly: '#e8c0b0', pattern: '#4a1818', accent: '#f09a3a', iris: '#ffe066', pattern_kind: 'saddle' },
    { id: 'sunset', name: 'Sunset', body: '#d9774a', belly: '#ffe2c4', pattern: '#9c4a2a', accent: '#7a4fd6', iris: '#ffd35a', pattern_kind: 'bands' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Pearl', body: '#e6e1f5', belly: '#ffffff', pattern: '#b6a8e0', accent: '#ff9ec7', iris: '#38c9ff', pattern_kind: 'stripes' },
  voice: { pitch: 95, growl: 0.6, kind: 'roar' },
  lines: {
    hello: ['Rrrah!', 'Hi!'],
    welcome: ['Back!', 'Fish time?'],
    feed: ['FISH!', 'Splashy!'],
    pet: ['Rrrr.', 'More!'],
    game: ['Rrrah! Go!', 'Hunt!'],
    gameOver: ['GG!', 'Swim break?'],
    sleepy: ['*yawn*'],
    night: ["It's late..."],
    grow: ['Bigger sail!'],
    thrown: ['Hey!', 'Splash?'],
    poke: ['?', 'Rrr?'],
  },
};

export const CARNO: SpeciesDef = {
  id: 'carno',
  name: 'Carno',
  latin: 'Carnotaurus',
  blurb: 'A horned speedster with tiny arms. Always ready to race.',
  diet: 'carnivore',
  stance: 'biped',
  group: 'Abelisaur',
  lengthM: 8,
  fact: 'Its name means "meat-eating bull", after the horns above its eyes.',
  food: 'meat',
  body: {
    hipHeight: 44,
    thigh: 21,
    shin: 21,
    meta: 12,
    heel: 10,
    toe: 8,
    legW: 11,
    bodyLen: 27,
    hipR: 14,
    chestR: 13,
    bellyR: 12.5,
    bellyDrop: 3,
    pitch: 0.06,
    neckLen: 14,
    neckR: 9,
    neckAngle: 0.55,
    neckBend: 0.45,
    neckTaper: 0.2,
    headLen: 23,
    headH: 14,
    snoutH: 11,
    jawD: 8,
    headAngle: -0.42,
    eyeR: 2.4,
    eyeX: 0.36,
    eyeY: 0.66,
    tailLen: 66,
    tailR: 11,
    tailDroop: 0.05,
    tailStiff: 0.72,
    armUpper: 3.6,
    armFore: 2.6,
    armW: 2.3,
    armAngle: -1,
    armBend: 0.5,
    ...NO_FRONT,
  },
  baby: BABY_COMMON,
  features: { teeth: true, horns: true, brow: true },
  personality: { speed: 0.95, jump: 0.6, curiosity: 0.6, stamina: 0.7, playfulness: 0.6, vocal: 0.7 },
  variants: [
    { id: 'crimson', name: 'Crimson', body: '#a8453a', belly: '#f2cdb4', pattern: '#6b241d', accent: '#3a3336', iris: '#ffd84a', pattern_kind: 'stripes' },
    { id: 'dune', name: 'Dune', body: '#c9a06a', belly: '#f5e5c6', pattern: '#8a6538', accent: '#6b3d24', iris: '#f2b233', pattern_kind: 'bands' },
    { id: 'charcoal', name: 'Charcoal', body: '#4a4a52', belly: '#a9a9b2', pattern: '#2a2a30', accent: '#e04a3a', iris: '#ff6a3a', pattern_kind: 'speckles' },
    { id: 'forest', name: 'Forest', body: '#5d7d4a', belly: '#dbe4c0', pattern: '#3a5230', accent: '#c7643b', iris: '#f0c030', pattern_kind: 'stripes' },
    { id: 'royal', name: 'Royal', body: '#5b4a8a', belly: '#d8d0ef', pattern: '#382c5e', accent: '#f2c94c', iris: '#9ef07a', pattern_kind: 'rosettes' },
    { id: 'tiger', name: 'Tiger', body: '#e0873a', belly: '#fff0d8', pattern: '#3a2014', accent: '#fff0d8', iris: '#9be35a', pattern_kind: 'stripes' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Onyx', body: '#2c2835', belly: '#6a6380', pattern: '#0f0d14', accent: '#ff4fd8', iris: '#40ffcf', pattern_kind: 'rosettes' },
  voice: { pitch: 140, growl: 0.8, kind: 'roar' },
  lines: {
    hello: ['RAH!', 'Hi!'],
    welcome: ['Back!', 'RAH!'],
    feed: ['MEAT!', 'Nom!'],
    pet: ['Grrr...', 'Heh.'],
    game: ['Charge!', 'Go fast!'],
    gameOver: ['GG!', 'Again!'],
    sleepy: ['*yawn*'],
    night: ['Still up?'],
    grow: ['Bigger horns!'],
    thrown: ['Wheee!', 'Hey!'],
    poke: ['?', 'Grr?'],
  },
};

export const DILO: SpeciesDef = {
  id: 'dilo',
  name: 'Dilo',
  latin: 'Dilophosaurus',
  blurb: 'A show-off with two fancy crests. Chatty, sneaky and quick.',
  diet: 'carnivore',
  stance: 'biped',
  group: 'Dilophosaur',
  lengthM: 7,
  fact: 'Its two thin head crests were probably for showing off, like a bird’s.',
  food: 'meat',
  body: {
    hipHeight: 36,
    thigh: 19,
    shin: 19,
    meta: 11,
    heel: 9,
    toe: 7,
    legW: 9,
    bodyLen: 26,
    hipR: 12,
    chestR: 11.5,
    bellyR: 11,
    bellyDrop: 3,
    pitch: 0.08,
    neckLen: 21,
    neckR: 6.5,
    neckAngle: 0.9,
    neckBend: 0.55,
    neckTaper: 0.3,
    headLen: 24,
    headH: 10,
    snoutH: 7.2,
    jawD: 5.5,
    headAngle: -0.85,
    eyeR: 2.4,
    eyeX: 0.36,
    eyeY: 0.7,
    tailLen: 68,
    tailR: 9,
    tailDroop: 0,
    tailStiff: 0.75,
    armUpper: 10,
    armFore: 9,
    armW: 3,
    armAngle: -1.9,
    armBend: 1.8,
    ...NO_FRONT,
  },
  baby: { ...BABY_COMMON, neckLen: 0.65 },
  features: { teeth: true, twinCrests: true },
  personality: { speed: 0.75, jump: 0.7, curiosity: 0.8, stamina: 0.55, playfulness: 0.75, vocal: 0.75 },
  variants: [
    { id: 'jungle', name: 'Jungle', body: '#6a8f4f', belly: '#e3ecc6', pattern: '#44642f', accent: '#e5533d', iris: '#f5c542', pattern_kind: 'stripes' },
    { id: 'canyon', name: 'Canyon', body: '#c08a5a', belly: '#f3dfc2', pattern: '#83592f', accent: '#f2d24a', iris: '#e89a2a', pattern_kind: 'bands' },
    { id: 'lagoon', name: 'Lagoon', body: '#4f8a9a', belly: '#d7eef2', pattern: '#2f5f6b', accent: '#ffb347', iris: '#f5e663', pattern_kind: 'spots' },
    { id: 'venom', name: 'Venom', body: '#8fb83a', belly: '#eef7c6', pattern: '#4f6b1d', accent: '#b03acf', iris: '#ff5a3a', pattern_kind: 'rosettes' },
    { id: 'ember', name: 'Ember', body: '#b54a3a', belly: '#f6d3c0', pattern: '#6e2419', accent: '#ffd166', iris: '#ffe066', pattern_kind: 'speckles' },
    { id: 'frost', name: 'Frost', body: '#b8c9d9', belly: '#f5f9fd', pattern: '#7890a8', accent: '#4a7ad9', iris: '#5ad1ff', pattern_kind: 'bands' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Neon', body: '#3ddcb0', belly: '#e8fff7', pattern: '#1a9a74', accent: '#ff4f9a', iris: '#fff04a', pattern_kind: 'stripes' },
  voice: { pitch: 420, growl: 0.5, kind: 'screech' },
  lines: {
    hello: ['Hssss!', 'Hi hi!'],
    welcome: ["You're back!", 'Chirr!'],
    feed: ['Nom!', 'Mine!'],
    pet: ['Chirrr.', 'Hehe.'],
    game: ['Hunt!', "Let's go!"],
    gameOver: ['GG!', 'Again?'],
    sleepy: ['*yawn*'],
    night: ['Still awake?'],
    grow: ['Look at my crests!'],
    thrown: ['Wheee!', 'Hss!'],
    poke: ['?', 'Hm?'],
  },
};

export const PARASAUR: SpeciesDef = {
  id: 'parasaur',
  name: 'Parasaur',
  latin: 'Parasaurolophus',
  blurb: 'Friendly and LOUD. Honks through its long crest like a trumpet.',
  diet: 'herbivore',
  stance: 'biped',
  group: 'Hadrosaur',
  lengthM: 9.5,
  fact: 'Air through its hollow crest made deep, trumpet-like calls.',
  food: 'leaf',
  body: {
    hipHeight: 40,
    thigh: 21,
    shin: 19,
    meta: 10,
    heel: 8,
    toe: 6,
    legW: 12,
    bodyLen: 32,
    hipR: 16,
    chestR: 14,
    bellyR: 16,
    bellyDrop: 5,
    pitch: 0,
    neckLen: 16,
    neckR: 8,
    neckAngle: 0.72,
    neckBend: 0.55,
    neckTaper: 0.25,
    headLen: 23,
    headH: 10.5,
    snoutH: 7,
    jawD: 5.5,
    headAngle: -0.72,
    eyeR: 2.3,
    eyeX: 0.4,
    eyeY: 0.66,
    tailLen: 62,
    tailR: 12.5,
    tailDroop: 0.05,
    tailStiff: 0.7,
    armUpper: 12,
    armFore: 11,
    armW: 3.6,
    armAngle: -1.8,
    armBend: 1.1,
    ...NO_FRONT,
  },
  baby: BABY_COMMON,
  features: { duckBill: true, tubeCrest: true },
  personality: { speed: 0.45, jump: 0.3, curiosity: 0.55, stamina: 0.6, playfulness: 0.5, vocal: 0.85 },
  variants: [
    { id: 'reef', name: 'Reef', body: '#5f8fb0', belly: '#e2eef6', pattern: '#3a6385', accent: '#f2a03a', iris: '#2a2a3a', pattern_kind: 'bands' },
    { id: 'meadow', name: 'Meadow', body: '#7fa25a', belly: '#eef2d2', pattern: '#56753a', accent: '#d9573d', iris: '#2f2a14', pattern_kind: 'stripes' },
    { id: 'coral', name: 'Coral', body: '#e07a5f', belly: '#ffe8dc', pattern: '#a54c36', accent: '#4fb3a8', iris: '#2a1a14', pattern_kind: 'spots' },
    { id: 'plum', name: 'Plum', body: '#8a5a8f', belly: '#f0dff2', pattern: '#5e3a63', accent: '#ffd166', iris: '#2a1a2e', pattern_kind: 'saddle' },
    { id: 'sunny', name: 'Sunny', body: '#e6bf4a', belly: '#fff4cf', pattern: '#a9852a', accent: '#e85d4a', iris: '#3a2a10', pattern_kind: 'bands' },
    { id: 'shadow', name: 'Shadow', body: '#3f4b5a', belly: '#aab6c4', pattern: '#262e38', accent: '#6fe0ff', iris: '#f0d060', pattern_kind: 'speckles' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Sky', body: '#a8d8ff', belly: '#ffffff', pattern: '#6aa9e0', accent: '#ffb3e6', iris: '#ff8a3d', pattern_kind: 'bands' },
  voice: { pitch: 150, growl: 0.2, kind: 'honk' },
  lines: {
    hello: ['HOONK!', 'Hi!'],
    welcome: ["HONK! You're back!", 'Toot!'],
    feed: ['Leaves!', 'Yum!'],
    pet: ['Hmmm.', 'Toot.'],
    game: ['HOOONK! Go!', 'Good luck!'],
    gameOver: ['GG!', 'Toot toot!'],
    sleepy: ['*yawn*'],
    night: ['Bedtime.'],
    grow: ['Longer crest!'],
    thrown: ['Hoonk?!', 'Whoa!'],
    poke: ['Toot?', 'Hm?'],
  },
};

export const GALLI: SpeciesDef = {
  id: 'galli',
  name: 'Galli',
  latin: 'Gallimimus',
  blurb: 'Long legs, big eyes, zero chill. The fastest runner of them all.',
  diet: 'herbivore',
  stance: 'biped',
  group: 'Ornithomimid',
  lengthM: 6,
  fact: 'Built like an ostrich, it was one of the fastest dinosaurs.',
  food: 'berry',
  body: {
    hipHeight: 42,
    thigh: 20,
    shin: 23,
    meta: 14,
    heel: 11,
    toe: 7,
    legW: 8,
    bodyLen: 22,
    hipR: 11,
    chestR: 11,
    bellyR: 10.5,
    bellyDrop: 3,
    pitch: 0.15,
    neckLen: 28,
    neckR: 5,
    neckAngle: 1,
    neckBend: 0.5,
    neckTaper: 0.35,
    headLen: 14,
    headH: 6.8,
    snoutH: 4.6,
    jawD: 3.5,
    headAngle: -1,
    eyeR: 2.4,
    eyeX: 0.36,
    eyeY: 0.66,
    tailLen: 56,
    tailR: 8,
    tailDroop: -0.02,
    tailStiff: 0.8,
    armUpper: 10,
    armFore: 10,
    armW: 2.6,
    armAngle: -1.9,
    armBend: 1.3,
    ...NO_FRONT,
  },
  baby: { ...BABY_COMMON, headLen: 1.4, headH: 1.85, neckLen: 0.6, eyeR: 2.5 },
  features: { beak: true, feathers: true },
  personality: { speed: 1, jump: 0.7, curiosity: 0.7, stamina: 0.5, playfulness: 0.8, vocal: 0.6 },
  variants: [
    { id: 'plains', name: 'Plains', body: '#c9a97a', belly: '#f6ecd8', pattern: '#8f7148', accent: '#5a7ad9', iris: '#e8a33a', pattern_kind: 'bands' },
    { id: 'emerald', name: 'Emerald', body: '#4f9a6a', belly: '#e0f2e4', pattern: '#306645', accent: '#ffcc4d', iris: '#f0b030', pattern_kind: 'speckles' },
    { id: 'flamingo', name: 'Flamingo', body: '#f09aa8', belly: '#fff0f3', pattern: '#c26577', accent: '#ffd166', iris: '#3a1a22', pattern_kind: 'none' },
    { id: 'ink', name: 'Ink', body: '#2f3542', belly: '#9aa3b5', pattern: '#161a22', accent: '#ff6b6b', iris: '#ffd84a', pattern_kind: 'speckles' },
    { id: 'lemon', name: 'Lemon', body: '#e8d35a', belly: '#fffbe0', pattern: '#a8962f', accent: '#3fa9f5', iris: '#2a2210', pattern_kind: 'spots' },
    { id: 'rusty', name: 'Rusty', body: '#b86a3a', belly: '#f7dcc4', pattern: '#7a4020', accent: '#2fb3a0', iris: '#2a1a0e', pattern_kind: 'bands' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Prism', body: '#b58cff', belly: '#f5eeff', pattern: '#7a4fe0', accent: '#5ff0d0', iris: '#ffe14a', pattern_kind: 'speckles' },
  voice: { pitch: 600, growl: 0.15, kind: 'trill' },
  lines: {
    hello: ['Hi hi hi!', 'Peep!'],
    welcome: ["You're back!", 'Peep peep!'],
    feed: ['Berries!', 'Yum!'],
    pet: ['Peep.', 'Hehe.'],
    game: ['Zoom!', 'Go go go!'],
    gameOver: ['GG!', 'Race?'],
    sleepy: ['*yawn*'],
    night: ['Still awake?'],
    grow: ['Longer legs!'],
    thrown: ['Wheee!', 'Again!'],
    poke: ['Peep?', '?'],
  },
};

export const BRACHIO: SpeciesDef = {
  id: 'brachio',
  name: 'Brachio',
  latin: 'Brachiosaurus',
  blurb: 'A gentle giant with a giraffe neck. Slow, calm, always reaching up.',
  diet: 'herbivore',
  stance: 'quad',
  group: 'Sauropod',
  lengthM: 22,
  fact: 'It held its head up to 12 m high to eat from the tops of trees.',
  food: 'leaf',
  body: {
    hipHeight: 40,
    thigh: 18.5,
    shin: 16.5,
    meta: 6,
    heel: 6,
    toe: 4,
    legW: 11,
    bodyLen: 36,
    hipR: 16,
    chestR: 17,
    bellyR: 19,
    bellyDrop: 7,
    pitch: 0.3,
    neckLen: 64,
    neckR: 7.5,
    neckAngle: 0.78,
    neckBend: 0.2,
    neckTaper: 0.5,
    headLen: 14,
    headH: 8,
    snoutH: 6,
    jawD: 3.6,
    headAngle: -1.25,
    eyeR: 1.8,
    eyeX: 0.34,
    eyeY: 0.66,
    tailLen: 48,
    tailR: 12,
    tailDroop: 0.28,
    tailStiff: 0.6,
    armUpper: 6,
    armFore: 5,
    armW: 2.6,
    armAngle: -1.2,
    armBend: 1,
    shoulderHeight: 50,
    fThigh: 23,
    fShin: 20,
    fMeta: 7,
    fLegW: 9,
  },
  baby: { ...BABY_COMMON, neckLen: 0.42, headLen: 1.7, headH: 2.1, snoutH: 1.9, shoulderHeight: 0.8, fThigh: 0.78, fShin: 0.74 },
  features: { nasalArch: true },
  personality: { speed: 0.2, jump: 0.03, curiosity: 0.5, stamina: 0.7, playfulness: 0.35, vocal: 0.5 },
  variants: [
    { id: 'canopy', name: 'Canopy', body: '#7d9a6e', belly: '#e3e8cf', pattern: '#586f4c', accent: '#c9b27a', iris: '#2c2a18', pattern_kind: 'speckles' },
    { id: 'savanna', name: 'Savanna', body: '#b89468', belly: '#efe0c4', pattern: '#86663f', accent: '#8a5a3a', iris: '#2f2012', pattern_kind: 'saddle' },
    { id: 'dusk', name: 'Dusk', body: '#6f7f98', belly: '#dbe2ec', pattern: '#4d5a70', accent: '#e8b86a', iris: '#262a36', pattern_kind: 'bands' },
    { id: 'clay', name: 'Clay', body: '#a86a4e', belly: '#f2d6c2', pattern: '#74432f', accent: '#f0cf8a', iris: '#2a160e', pattern_kind: 'spots' },
    { id: 'mossy', name: 'Mossy', body: '#60804f', belly: '#dfe9cf', pattern: '#3f5a33', accent: '#e3c86a', iris: '#2a2a14', pattern_kind: 'rosettes' },
    { id: 'ivory', name: 'Ivory', body: '#d8d0c0', belly: '#fbf8f1', pattern: '#a89c86', accent: '#8a9ab8', iris: '#3a3226', pattern_kind: 'speckles' },
  ],
  shiny: { id: 'shiny', name: 'Shiny Aqua', body: '#6fd0d8', belly: '#effdff', pattern: '#3f9aa6', accent: '#ffd36e', iris: '#ff6fb0', pattern_kind: 'speckles' },
  voice: { pitch: 60, growl: 0.3, kind: 'bellow' },
  lines: {
    hello: ['Hmmmm. Hello.', 'Hrooo.'],
    welcome: ["Oh, you're back.", 'Hrooo!'],
    feed: ['Treetop snack!', 'Munch munch.'],
    pet: ['Mmmmm.', 'Nice...'],
    game: ['Stomp them!', 'Good luck, small one.'],
    gameOver: ['GG.', 'Slow and steady.'],
    sleepy: ['*big yawn*'],
    night: ['Time to rest.'],
    grow: ['Taller!'],
    thrown: ['Whoooa!', 'Heavy!'],
    poke: ['Hm?', '...hello?'],
  },
};

export const BUILT_IN: SpeciesDef[] = [REX, RAPTOR, PACHY, TRIKE, STEGO, ANKY, SPINO, CARNO, DILO, PARASAUR, GALLI, BRACHIO];

// ---------------- mods ----------------

const BODY_KEYS = Object.keys(REX.body) as BodyKey[];
const FEATURE_KEYS: (keyof Features)[] = ['teeth', 'brow', 'feathers', 'crest', 'dome', 'horns', 'sail', 'spikes', 'sickleClaw', 'beak', 'frill', 'browHorns', 'noseHorn', 'plates', 'thagomizer', 'armor', 'club', 'tubeCrest', 'twinCrests', 'crocSnout', 'duckBill', 'finTail', 'nasalArch'];
const FOODS: Food[] = ['meat', 'fish', 'leaf', 'berry'];
const PERSONALITY_KEYS: (keyof Personality)[] = ['speed', 'jump', 'curiosity', 'stamina', 'playfulness', 'vocal'];
const LINE_EVENTS: LineEvent[] = ['hello', 'welcome', 'feed', 'pet', 'game', 'gameOver', 'sleepy', 'night', 'grow', 'thrown', 'poke', 'full', 'treat', 'video', 'laugh', 'friend', 'found', 'fish', 'fly', 'tada', 'toy'];
const HEX = /^#[0-9a-f]{6}$/i;

export class ModError extends Error {}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function text(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new ModError(`"${field}" must be some text`);
  return v.trim().slice(0, max);
}

/**
 * Validate a species mod. Mods start from a built-in species ("base") and change its
 * proportions (multipliers), features, personality, colours and lines. Mods are data only:
 * nothing in them can run code.
 */
export function parseSpeciesMod(raw: unknown, file: string): SpeciesDef {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ModError('The file must contain a JSON object');
  const m = raw as Record<string, unknown>;
  const baseId = m.base ?? 'rex';
  const base = BUILT_IN.find((s) => s.id === baseId);
  if (!base) throw new ModError(`"base" must be one of: ${BUILT_IN.map((s) => s.id).join(', ')}`);
  const id = text(m.id, 32, 'id').toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) throw new ModError('"id" may only contain a-z, 0-9 and -');
  if (BUILT_IN.some((s) => s.id === id)) throw new ModError(`"id" "${id}" is already a built-in species`);

  const body = { ...base.body };
  if (m.proportions !== undefined) {
    if (!m.proportions || typeof m.proportions !== 'object') throw new ModError('"proportions" must be an object of multipliers');
    for (const [k, v] of Object.entries(m.proportions as Record<string, unknown>)) {
      if (!BODY_KEYS.includes(k as BodyKey)) throw new ModError(`Unknown proportion "${k}". Known: ${BODY_KEYS.join(', ')}`);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ModError(`Proportion "${k}" must be a number`);
      const key = k as BodyKey;
      // Angles are offsets in radians; everything else is a size multiplier.
      if (key === 'pitch' || key === 'neckAngle' || key === 'headAngle' || key === 'tailDroop' || key === 'armAngle' || key === 'armBend') body[key] = base.body[key] + clamp(v, -0.8, 0.8);
      else if (base.stance === 'biped' && (key === 'shoulderHeight' || key === 'fThigh' || key === 'fShin' || key === 'fMeta' || key === 'fLegW')) continue;
      else if (key === 'tailStiff') body[key] = clamp(v, 0, 1);
      else if (key === 'eyeX' || key === 'eyeY') body[key] = clamp(v, 0.15, 0.85);
      else body[key] = base.body[key] * clamp(v, 0.4, 2.5);
    }
  }

  const features: Features = { ...base.features };
  if (m.features !== undefined) {
    if (!m.features || typeof m.features !== 'object') throw new ModError('"features" must be an object of true/false');
    for (const [k, v] of Object.entries(m.features as Record<string, unknown>)) {
      if (!FEATURE_KEYS.includes(k as keyof Features)) throw new ModError(`Unknown feature "${k}". Known: ${FEATURE_KEYS.join(', ')}`);
      if (k === 'wings') {
        if (v !== false && v !== 'membrane' && v !== 'feather') throw new ModError('Feature "wings" must be "membrane", "feather" or false');
        features.wings = v || undefined;
        continue;
      }
      if (typeof v !== 'boolean') throw new ModError(`Feature "${k}" must be true or false`);
      (features as Record<string, boolean>)[k] = v;
    }
  }

  const personality: Personality = { ...base.personality };
  if (m.personality !== undefined) {
    if (!m.personality || typeof m.personality !== 'object') throw new ModError('"personality" must be an object');
    for (const [k, v] of Object.entries(m.personality as Record<string, unknown>)) {
      if (!PERSONALITY_KEYS.includes(k as keyof Personality)) throw new ModError(`Unknown personality trait "${k}". Known: ${PERSONALITY_KEYS.join(', ')}`);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ModError(`Trait "${k}" must be a number from 0 to 1`);
      personality[k as keyof Personality] = clamp(v, 0, 1);
    }
  }

  let variants = base.variants;
  if (m.variants !== undefined) {
    if (!Array.isArray(m.variants) || !m.variants.length) throw new ModError('"variants" must be a non-empty list');
    variants = m.variants.slice(0, 8).map((v, i) => {
      if (!v || typeof v !== 'object') throw new ModError(`Variant ${i + 1} must be an object`);
      const o = v as Record<string, unknown>;
      const col = (k: string, fallback: string) => {
        if (o[k] === undefined) return fallback;
        if (typeof o[k] !== 'string' || !HEX.test(o[k] as string)) throw new ModError(`Variant ${i + 1}: "${k}" must be a colour like "#a1b2c3"`);
        return (o[k] as string).toLowerCase();
      };
      const kind = o.pattern_kind ?? base.variants[0].pattern_kind;
      if (!PATTERN_KINDS.includes(kind as PatternKind)) throw new ModError(`Variant ${i + 1}: "pattern_kind" must be one of ${PATTERN_KINDS.join(', ')}`);
      const d = base.variants[i % base.variants.length];
      return {
        id: `v${i}`,
        name: o.name === undefined ? `Colour ${i + 1}` : text(o.name, 24, 'name'),
        body: col('body', d.body),
        belly: col('belly', d.belly),
        pattern: col('pattern', d.pattern),
        accent: col('accent', d.accent),
        iris: col('iris', d.iris),
        pattern_kind: kind as Variant['pattern_kind'],
      };
    });
  }

  const lines: SpeciesDef['lines'] = { ...base.lines };
  if (m.lines !== undefined) {
    if (!m.lines || typeof m.lines !== 'object') throw new ModError('"lines" must be an object');
    for (const [k, v] of Object.entries(m.lines as Record<string, unknown>)) {
      if (!LINE_EVENTS.includes(k as LineEvent)) throw new ModError(`Unknown line event "${k}". Known: ${LINE_EVENTS.join(', ')}`);
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new ModError(`Lines for "${k}" must be a list of text`);
      const list = (v as string[]).map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
      if (list.length) lines[k as LineEvent] = list;
    }
  }

  let voice = base.voice;
  if (m.voice !== undefined) {
    const o = m.voice as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw new ModError('"voice" must be an object');
    const kinds: VoiceKind[] = ['roar', 'screech', 'honk', 'bellow', 'hoot', 'trill'];
    if (o.kind !== undefined && !kinds.includes(o.kind as VoiceKind)) throw new ModError(`"voice.kind" must be one of ${kinds.join(', ')}`);
    voice = {
      pitch: typeof o.pitch === 'number' ? clamp(o.pitch, 50, 900) : base.voice.pitch,
      growl: typeof o.growl === 'number' ? clamp(o.growl, 0, 1) : base.voice.growl,
      kind: (o.kind as VoiceKind | undefined) ?? base.voice.kind,
    };
  }

  const diet = m.diet === undefined ? base.diet : m.diet;
  if (diet !== 'carnivore' && diet !== 'herbivore') throw new ModError('"diet" must be carnivore or herbivore');
  const food = m.food === undefined ? (m.diet === undefined ? base.food : diet === 'carnivore' ? 'meat' : 'leaf') : m.food;
  if (!FOODS.includes(food as Food)) throw new ModError(`"food" must be one of ${FOODS.join(', ')}`);

  return {
    id,
    name: text(m.name, 24, 'name'),
    latin: m.latin === undefined ? base.latin : text(m.latin, 40, 'latin'),
    blurb: m.blurb === undefined ? `A custom ${base.name}.` : text(m.blurb, 90, 'blurb'),
    diet,
    stance: base.stance,
    group: base.group,
    lengthM: typeof m.lengthM === 'number' && Number.isFinite(m.lengthM) ? clamp(m.lengthM, 0.2, 60) : base.lengthM,
    fact: m.fact === undefined ? `Made by you, based on ${base.name}.` : text(m.fact, 120, 'fact'),
    food: food as Food,
    body,
    baby: base.baby,
    features,
    personality,
    variants,
    shiny: base.shiny,
    voice,
    lines,
    mod: file,
  };
}
