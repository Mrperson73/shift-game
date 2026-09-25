// Species definitions: body proportions for the procedural rig, looks, personality and sounds.
// Built-in species live here; players can add more as JSON files (see parseSpeciesMod).

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
}

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
  pattern_kind: 'stripes' | 'spots' | 'bands' | 'none';
}

export interface Voice {
  /** Base pitch in Hz for an adult; hatchlings are about an octave higher. */
  pitch: number;
  /** 0..1 how growly (noise) versus tonal the calls are. */
  growl: number;
}

export type LineEvent = 'hello' | 'welcome' | 'feed' | 'pet' | 'game' | 'gameOver' | 'sleepy' | 'night' | 'grow' | 'thrown' | 'poke';

export interface SpeciesDef {
  id: string;
  name: string;
  latin: string;
  blurb: string;
  diet: 'carnivore' | 'herbivore';
  body: BodyParams;
  /** Multipliers applied at hatch (growth 0) and eased out to 1 at adulthood. */
  baby: Partial<Record<BodyKey, number>>;
  features: Features;
  personality: Personality;
  variants: Variant[];
  voice: Voice;
  lines: Partial<Record<LineEvent, string[]>>;
  /** Set for species loaded from the mods folder. */
  mod?: string;
}

const BABY_COMMON: Partial<Record<BodyKey, number>> = {
  headLen: 1.62,
  headH: 2.05,
  snoutH: 1.8,
  jawD: 1.6,
  eyeR: 3.05,
  headAngle: 0.45,
  neckLen: 0.55,
  neckR: 1.35,
  tailLen: 0.55,
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
};

export const REX: SpeciesDef = {
  id: 'rex',
  name: 'Rex',
  latin: 'Tyrannosaurus',
  blurb: 'Bold and loud. Loves meat and big stomps.',
  diet: 'carnivore',
  body: {
    hipHeight: 42,
    thigh: 22,
    shin: 20,
    meta: 12,
    heel: 9,
    toe: 9,
    legW: 12,
    bodyLen: 30,
    hipR: 17,
    chestR: 15,
    bellyR: 15,
    bellyDrop: 5,
    pitch: 0.06,
    neckLen: 13,
    neckR: 10.5,
    neckAngle: 0.55,
    headLen: 36,
    headH: 18,
    snoutH: 13,
    jawD: 9,
    headAngle: -0.45,
    eyeR: 3.4,
    eyeX: 0.34,
    eyeY: 0.72,
    tailLen: 56,
    tailR: 13,
    tailDroop: 0.12,
    tailStiff: 0.55,
    armUpper: 6,
    armFore: 5,
    armW: 2.6,
    armAngle: -1.15,
    armBend: 1.05,
  },
  baby: BABY_COMMON,
  features: { teeth: true, brow: true },
  personality: { speed: 0.45, jump: 0.3, curiosity: 0.55, stamina: 0.55, playfulness: 0.5, vocal: 0.8 },
  variants: [
    { id: 'forest', name: 'Forest', body: '#5f9150', belly: '#dcd59a', pattern: '#3f6a37', accent: '#c7643b', iris: '#e7b73c', pattern_kind: 'stripes' },
    { id: 'ember', name: 'Ember', body: '#c4643e', belly: '#f1d1a0', pattern: '#83382a', accent: '#f0b24a', iris: '#f3d35a', pattern_kind: 'stripes' },
    { id: 'ash', name: 'Ash', body: '#80848c', belly: '#dcd8d0', pattern: '#4d5159', accent: '#c9553f', iris: '#e8a53a', pattern_kind: 'stripes' },
    { id: 'midnight', name: 'Midnight', body: '#46557f', belly: '#bcc6e2', pattern: '#2a3356', accent: '#7fd1c9', iris: '#9fe07a', pattern_kind: 'stripes' },
  ],
  voice: { pitch: 110, growl: 0.75 },
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
  body: {
    hipHeight: 38,
    thigh: 19,
    shin: 20,
    meta: 12,
    heel: 11,
    toe: 8,
    legW: 9.5,
    bodyLen: 25,
    hipR: 12.5,
    chestR: 12,
    bellyR: 11.5,
    bellyDrop: 3,
    pitch: 0.1,
    neckLen: 17,
    neckR: 7,
    neckAngle: 0.85,
    headLen: 29,
    headH: 12,
    snoutH: 8.5,
    jawD: 6,
    headAngle: -0.85,
    eyeR: 3.6,
    eyeX: 0.36,
    eyeY: 0.7,
    tailLen: 62,
    tailR: 8.5,
    tailDroop: -0.02,
    tailStiff: 0.85,
    armUpper: 11,
    armFore: 11,
    armW: 3.2,
    armAngle: -2.15,
    armBend: 2.05,
  },
  baby: { ...BABY_COMMON, tailLen: 0.7 },
  features: { teeth: true, feathers: true, crest: true, sickleClaw: true },
  personality: { speed: 0.85, jump: 0.85, curiosity: 0.9, stamina: 0.6, playfulness: 0.85, vocal: 0.55 },
  variants: [
    { id: 'sand', name: 'Sand', body: '#c7a06a', belly: '#f1e2c4', pattern: '#8a673c', accent: '#7c4a2a', iris: '#e0a93b', pattern_kind: 'bands' },
    { id: 'jungle', name: 'Jungle', body: '#6c9460', belly: '#e0e7c9', pattern: '#3d5c35', accent: '#d9a53a', iris: '#e7c24a', pattern_kind: 'bands' },
    { id: 'plum', name: 'Plum', body: '#7d5e93', belly: '#e6d7ec', pattern: '#4d3762', accent: '#eab94f', iris: '#f0d160', pattern_kind: 'bands' },
    { id: 'snow', name: 'Snow', body: '#d6dbe2', belly: '#ffffff', pattern: '#8791a1', accent: '#557aa7', iris: '#6fb2e8', pattern_kind: 'bands' },
  ],
  voice: { pitch: 330, growl: 0.35 },
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
    headLen: 25,
    headH: 19,
    snoutH: 10,
    jawD: 6.5,
    headAngle: -0.35,
    eyeR: 3.6,
    eyeX: 0.42,
    eyeY: 0.52,
    tailLen: 46,
    tailR: 12,
    tailDroop: 0.18,
    tailStiff: 0.65,
    armUpper: 8,
    armFore: 7,
    armW: 3,
    armAngle: -1.2,
    armBend: 1.1,
  },
  baby: { ...BABY_COMMON, headH: 1.45 },
  features: { dome: true, beak: true },
  personality: { speed: 0.35, jump: 0.25, curiosity: 0.4, stamina: 0.45, playfulness: 0.45, vocal: 0.45 },
  variants: [
    { id: 'moss', name: 'Moss', body: '#7b9a59', belly: '#e9e3b9', pattern: '#55723b', accent: '#d8c49a', iris: '#8a5a2b', pattern_kind: 'spots' },
    { id: 'clay', name: 'Clay', body: '#b37a51', belly: '#f1d8ba', pattern: '#7e5034', accent: '#ecd6ad', iris: '#5b3a1f', pattern_kind: 'spots' },
    { id: 'sky', name: 'Sky', body: '#6f9dc2', belly: '#e1eef7', pattern: '#4a7495', accent: '#f1e7d3', iris: '#3d4f6b', pattern_kind: 'spots' },
    { id: 'rose', name: 'Rose', body: '#c17b8c', belly: '#f6e1e6', pattern: '#8d4f60', accent: '#f4e3c8', iris: '#5b2f3b', pattern_kind: 'spots' },
  ],
  voice: { pitch: 180, growl: 0.45 },
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

export const BUILT_IN: SpeciesDef[] = [REX, RAPTOR, PACHY];

// ---------------- mods ----------------

const BODY_KEYS = Object.keys(REX.body) as BodyKey[];
const FEATURE_KEYS: (keyof Features)[] = ['teeth', 'brow', 'feathers', 'crest', 'dome', 'horns', 'sail', 'spikes', 'sickleClaw', 'beak'];
const PERSONALITY_KEYS: (keyof Personality)[] = ['speed', 'jump', 'curiosity', 'stamina', 'playfulness', 'vocal'];
const LINE_EVENTS: LineEvent[] = ['hello', 'welcome', 'feed', 'pet', 'game', 'gameOver', 'sleepy', 'night', 'grow', 'thrown', 'poke'];
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
      if (typeof v !== 'boolean') throw new ModError(`Feature "${k}" must be true or false`);
      features[k as keyof Features] = v;
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
      if (!['stripes', 'spots', 'bands', 'none'].includes(kind as string)) throw new ModError(`Variant ${i + 1}: "pattern_kind" must be stripes, spots, bands or none`);
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
    voice = {
      pitch: typeof o.pitch === 'number' ? clamp(o.pitch, 50, 900) : base.voice.pitch,
      growl: typeof o.growl === 'number' ? clamp(o.growl, 0, 1) : base.voice.growl,
    };
  }

  const diet = m.diet === undefined ? base.diet : m.diet;
  if (diet !== 'carnivore' && diet !== 'herbivore') throw new ModError('"diet" must be carnivore or herbivore');

  return {
    id,
    name: text(m.name, 24, 'name'),
    latin: m.latin === undefined ? base.latin : text(m.latin, 40, 'latin'),
    blurb: m.blurb === undefined ? `A custom ${base.name}.` : text(m.blurb, 90, 'blurb'),
    diet,
    body,
    baby: base.baby,
    features,
    personality,
    variants,
    voice,
    lines,
    mod: file,
  };
}
