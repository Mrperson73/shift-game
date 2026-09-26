// The pet's voice: every sound from its throat for every VoiceKind, scaled by growth — squeaky
// hatchlings, booming adults — and coloured per species by its pitch and growl. Most sounds come in a few
// shapes picked at random (a species favours its own) and every play varies a little. The vocal model
// is in vox.ts; footsteps, splashes, toys and the other non-vocal sounds are in foley.ts.

import * as foley from './foley';
import { bell, burst, clamp, dB, glide, type Grain, grains, lerp, line, type Partials, type Patch, perc, pings, type Pts } from './synth';
import type { SoundName, Voice, VoiceKind } from './types';
import { air, BARK, BASE, BLIP, boom, CAW, croc, GRUNT, hiss, HOOT, HUM, type Note, nose, rattle, set, tame, TICK, ticks, type Vowel, type Vowels, vox, type Vox } from './vox';

// ---------------- who is calling ----------------

/** Species colours within a kind, 0..1, from its pitch and growl. */
interface Colours {
  bark: number; // Carnotaurus: gruff, barking roars
  croc: number; // Spinosaurus: a croc-like rumble and a hiss
  shriek: number; // Allosaurus: a raspier, screaming roar
  rattle: number; // Dilophosaurus: a clicking rattle
  grunt: number; // Ankylosaurus: grunts before its bellow
  gentle: number; // Stegosaurus, Brachiosaurus: a softer bellow
  round: number; // Corythosaurus: a rounder, lower honk than Parasaurolophus'
  click: number; // Compsognathus: clicky chatter (Microraptor whistles and chirrups)
  huge: number; // Quetzalcoatlus: deep, slow croaks (Pteranodon caws quickly and clatters its bill)
  nasal: number; // Amargasaurus: a nasal drone in its rumble (Diplodocus is deeper and plainer)
  deep: number; // Iguanodon: long honking grunts
  quick: number; // Kentrosaurus: quick huffing grunts (Styracosaurus, between the two, snorts)
  boom: number; // Therizinosaurus: deep booms (Oviraptor coos and rolls like a pigeon)
}

export interface Who {
  kind: VoiceKind;
  v: Vox;
  /** 1 for a hatchling .. 0 for an adult, and its opposite. */
  baby: number;
  big: number;
  /** Duration scale: hatchlings are quicker, and so are the smaller species of a kind. */
  len: number;
  /** Frequency scale for noises: 1 for an adult of a typical species, higher for small ones. */
  size: number;
  c: Colours;
}

/** A typical adult pitch per kind: a species pitched above it is a smaller animal. */
const REF: Record<VoiceKind, number> = { roar: 115, screech: 360, hoot: 180, bellow: 95, honk: 135, trill: 600, chitter: 620, croak: 200, rumble: 65, grunt: 118, coo: 200 };

/** Loudness of each kind as [hatchling, adult] in dB, balanced with scripts/sounds.mjs. */
const KIND_DB: Record<VoiceKind, readonly [number, number]> = {
  roar: [2.6, -0.7],
  screech: [6.0, 4.6],
  hoot: [-8.3, -9.7],
  bellow: [0.9, 0.6],
  honk: [4.7, 4.5],
  trill: [-3.9, -2.1],
  chitter: [-3.4, -2.9],
  croak: [4.6, 2.4],
  rumble: [-2.9, -3.2],
  grunt: [-0.3, -1.2],
  coo: [-8.3, -9.7],
};

function colours(kind: VoiceKind, pitch: number, g: number): Colours {
  const c: Colours = { bark: 0, croc: 0, shriek: 0, rattle: 0, grunt: 0, gentle: 0, round: 0, click: 0, huge: 0, nasal: 0, deep: 0, quick: 0, boom: 0 };
  switch (kind) {
    case 'roar':
      c.bark = clamp((pitch - 128) / 10);
      c.croc = clamp((104 - pitch) / 8);
      c.shriek = clamp((pitch - 114) / 8) * (1 - c.bark);
      break;
    case 'screech':
      c.rattle = clamp((g - 0.4) / 0.08);
      break;
    case 'bellow':
      c.grunt = clamp((g - 0.53) / 0.06);
      c.gentle = clamp((0.45 - g) / 0.08);
      break;
    case 'honk':
      c.round = clamp((140 - pitch) / 18);
      break;
    case 'chitter':
      c.click = clamp((pitch - 600) / 80);
      break;
    case 'croak':
      c.huge = clamp((230 - pitch) / 60);
      break;
    case 'rumble':
      c.nasal = clamp((pitch - 62) / 12);
      break;
    case 'grunt':
      c.deep = clamp((108 - pitch) / 12);
      c.quick = clamp((pitch - 130) / 15);
      break;
    case 'coo':
      c.boom = clamp((220 - pitch) / 60);
      break;
  }
  return c;
}

/** The voice for one play, with a little random variation (`vary` is the pitch spread). */
function who(p: Patch, voice: Voice, growth: number, vary = 0.06): Who {
  const g = clamp(voice.growl);
  const baby = (1 - clamp(growth)) ** 1.6;
  const big = 1 - baby;
  const pitch = clamp(voice.pitch, 30, 1200);
  // (An unknown kind, say from a newer mod, roars.)
  const kind: VoiceKind = voice.kind in KIND_DB ? voice.kind : 'roar';
  // Within a kind a higher voice belongs to a smaller animal: a smaller throat, quicker calls.
  const small = 2 ** (0.4 * clamp(Math.log2(pitch / REF[kind]), -1, 1));
  const f = p.vary(pitch * 2 ** (1.25 * baby), vary);
  // Small throats resonate higher.
  const ts = 2 ** (0.8 * baby) * Math.sqrt(small) * p.vary(1, 0.05);
  const [lb, la] = KIND_DB[kind];
  const c = colours(kind, pitch, g);
  const w: Who = {
    kind,
    v: { ...BASE, f, tract: ts, level: dB(lerp(lb, la, big)) },
    baby,
    big,
    len: p.vary(0.55 + 0.45 * big, 0.07) * clamp(small ** -0.6, 0.85, 1.1),
    size: 2 ** (0.8 * baby) * small,
    c,
  };
  const v = w.v;
  switch (kind) {
    case 'roar':
      // Deep and gritty: a saw through low formants, sub-bass, flutter and a hoarse, period-doubled
      // growl in it. Allosaurus' higher roar rasps (fast pitch wobble) and screams more.
      set(v, {
        wave: 'sawtooth',
        thick: 0.7,
        sub: 0.45 * big,
        tract: (0.6 + 0.06 * c.bark + 0.06 * c.shriek) * ts,
        q: 1 + 0.6 * c.croc,
        body: 0.5,
        noise: 0.12 + 0.6 * g,
        grit: (0.2 + 0.75 * g) * (0.4 + 0.6 * big),
        rough: (0.2 + 0.45 * g) * (0.35 + 0.65 * big),
        roughHz: 120,
        subh: 0.35 * g * big,
        flutter: 0.1 + 0.35 * g,
        flutterHz: lerp(38, 24, big),
        rasp: 30 * c.shriek,
        raspHz: 70,
        jitter: 45,
        drift: 35,
      });
      break;
    case 'screech':
      // Raspy and high: a bright saw with fast pitch rasp, like a bird of prey.
      set(v, {
        wave: 'sawtooth',
        tract: 1.15 * ts,
        q: 1.2,
        body: 0.15,
        noise: 0.06 + 0.3 * g,
        grit: 0.2 + 0.5 * g,
        rough: 0.1 + 0.3 * g,
        roughHz: 150,
        rasp: 40 + 90 * g,
        raspHz: lerp(120, 85, big),
        jitter: 25,
        drift: 30,
        lp: 7500,
      });
      break;
    case 'hoot':
      // Hollow and round: an ocarina-like tone with a ringing fundamental and a breathy "hoo".
      set(v, {
        wave: 'hollow',
        tract: 0.85 * ts,
        q: 1.3,
        fmt: 0.8,
        body: 0.7,
        ring: 0.6,
        noise: 0.05 + 0.25 * g,
        grit: 0.12 * g,
        vib: 10,
        vibHz: 4.5,
        vibDelay: 0.15,
        jitter: 10,
        drift: 15,
        lp: 3200,
      });
      break;
    case 'bellow':
      // Low and nasal like a cow or elephant: a narrow pulse through "mmoo" formants, slow swell.
      set(v, {
        wave: 'nasal',
        thick: 0.5,
        sub: 0.4 * big,
        tract: 0.6 * ts,
        body: 0.55,
        noise: 0.06 + 0.3 * g,
        grit: (0.08 + 0.5 * g) * (0.5 + 0.5 * big),
        rough: (0.08 + 0.3 * g) * (0.5 + 0.5 * big),
        roughHz: 70,
        subh: 0.2 * g * big,
        flutter: 0.06 + 0.2 * g,
        flutterHz: lerp(18, 13, big),
        vib: 9,
        vibHz: 4,
        vibDelay: 0.35,
        jitter: 18,
        drift: 25,
        lp: 3000,
      });
      v.level *= 1 - 0.2 * c.gentle;
      break;
    case 'honk': {
      // Brassy: a saw into a tuned tube, the tone opening as it swells, vibrato on long notes.
      // Corythosaurus' rounder crest: a softer wave, darker and more "oo", a slower vibrato.
      const r = c.round;
      set(v, {
        wave: r > 0.5 ? 'glottal' : 'sawtooth',
        thick: 0.3 * r,
        sub: 0.25 * r * big,
        tract: (0.72 - 0.1 * r) * ts,
        fmt: 0.7,
        body: 0.35 + 0.2 * r,
        noise: 0.03 + 0.1 * g,
        grit: 0.08 + 0.2 * g,
        comb: 0.55 - 0.1 * r,
        vib: 22 - 6 * r,
        vibHz: 5.3 - 0.8 * r,
        vibDelay: 0.3,
        jitter: 8,
        drift: 12,
        lp: Math.min(f * (9 - 3.5 * r), 7000),
        brass: 1 - 0.4 * r,
      });
      // The rounder tube resonates more: as loud as the others.
      v.level *= dB(-6.5 * r);
      break;
    }
    case 'trill':
      // Bright and birdlike: nearly pure tones with fast trills and quick chirps.
      set(v, {
        wave: 'triangle',
        tract: 1.6 * ts,
        fmt: 0.35,
        body: 0.9,
        noise: 0.02 + 0.15 * g,
        grit: 0.1 * g,
        trill: 0.9,
        trillHz: lerp(34, 24, big),
        jitter: 15,
        drift: 15,
        lp: 9000,
      });
      break;
    case 'chitter':
      // Tiny and quick: near-pure whistles that sweep within a few hundredths of a second, and clicks
      // (accent()). Compsognathus chatters; Microraptor whistles and chirrups.
      set(v, {
        wave: 'triangle',
        tract: 1.9 * ts,
        fmt: 0.3,
        body: 0.9,
        noise: 0.04 + 0.2 * g,
        grit: 0.1 * g,
        rasp: 10 + 40 * g,
        raspHz: 110,
        trillHz: lerp(48, 38, big),
        jitter: 20,
        drift: 20,
        lp: 11000,
      });
      break;
    case 'croak':
      // Harsh and hoarse from a throat pouch: a buzzy pulse, rough and period-doubled, through narrow
      // "honky" formants, a beak click on each caw. Quetzalcoatlus croaks deeper and slower.
      set(v, {
        wave: 'nasal',
        thick: 0.35,
        sub: 0.25 * big,
        tract: (0.85 - 0.1 * c.huge) * ts,
        q: 1.7,
        fmt: 1.1,
        body: 0.2,
        noise: 0.12 + 0.35 * g,
        grit: (0.3 + 0.5 * g) * (0.55 + 0.45 * big),
        rough: (0.35 + 0.35 * g) * (0.5 + 0.5 * big),
        roughHz: 140,
        subh: (0.2 + 0.35 * c.huge) * big,
        rasp: 20 + 40 * g,
        raspHz: 60,
        flutter: 0.1,
        flutterHz: lerp(40, 30, big),
        jitter: 35,
        drift: 45,
        lp: 6500,
      });
      break;
    case 'rumble':
      // A closed-mouth hum from a huge chest: a soft pulse through "mm" formants, slowly pulsing, with
      // a deep body and air rumbling under it. Amargasaurus adds a nasal drone (a tuned tube).
      set(v, {
        wave: 'glottal',
        thick: 0.45,
        sub: 0.35 * big,
        tract: 0.45 * ts,
        q: 0.9,
        fmt: 0.85,
        body: 0.95,
        noise: 0.04 + 0.15 * g,
        grit: (0.05 + 0.3 * g) * (0.5 + 0.5 * big),
        rough: 0.1 + 0.25 * g,
        roughHz: 50,
        subh: 0.12 * big,
        flutter: 0.18 + 0.2 * g,
        flutterHz: lerp(15, 9, big),
        vib: 6,
        vibHz: 3.2,
        vibDelay: 0.4,
        jitter: 12,
        drift: 25,
        comb: 0.3 * c.nasal,
        lp: lerp(1500, 750, big) * (1 + 0.4 * c.nasal),
      });
      // The drone rings: as loud as the plain rumble.
      v.level *= dB(-2 * c.nasal);
      break;
    case 'grunt':
      // Short, rough and nasal: a glottal pulse, rough and period-doubled, through "uh-o" formants, with
      // snorts. Iguanodon honks long grunts through a nasal tube; Kentrosaurus huffs quick ones.
      set(v, {
        wave: 'glottal',
        thick: 0.5,
        sub: 0.35 * big,
        tract: (0.62 - 0.05 * c.deep) * ts,
        q: 1.1,
        body: 0.55,
        noise: 0.14 + 0.35 * g,
        grit: (0.15 + 0.55 * g) * (0.5 + 0.5 * big),
        rough: (0.3 + 0.4 * g) * (0.5 + 0.5 * big),
        roughHz: 80,
        subh: (0.15 + 0.3 * g) * big,
        flutter: 0.08 + 0.2 * g,
        flutterHz: lerp(30, 21, big),
        jitter: 30,
        drift: 40,
        comb: 0.25 * c.deep,
        lp: 4500,
      });
      break;
    case 'coo':
      // Closed-mouth and soft like a dove or an emu: an ocarina tone with a ringing throat pouch, faint
      // formants and a gentle vibrato; rolled "rr" onsets are per-note trills. Therizinosaurus booms.
      set(v, {
        wave: 'hollow',
        sub: 0.3 * big,
        tract: 0.7 * ts,
        q: 1.4,
        fmt: 0.4,
        body: 0.9,
        ring: 0.55,
        noise: 0.03 + 0.12 * g,
        grit: 0.06 * g,
        trillHz: lerp(30, 22, big),
        vib: 9,
        vibHz: 5.5,
        vibDelay: 0.15,
        jitter: 10,
        drift: 15,
        lp: lerp(2400, 1300, big),
      });
      break;
  }
  return w;
}

/** Hatchlings end their calls on an upturn: cuter. */
function cute(w: Who, pts: Pts): Pts {
  if (w.baby < 0.3) return pts;
  return pts.map(([x, y]) => [x, y * (1 + 0.15 * w.baby * x * x)] as const);
}

/** Mouth shapes for small noises per kind: [start, end]. */
const MOUTH: Record<VoiceKind, readonly [Vowel, Vowel]> = {
  roar: ['o', 'a'],
  screech: ['e', 'i'],
  hoot: ['u', 'u'],
  bellow: ['m', 'o'],
  honk: ['o', 'a'],
  trill: ['e', 'i'],
  chitter: ['e', 'i'],
  croak: ['ae', 'a'],
  rumble: ['m', 'u'],
  grunt: ['uh', 'o'],
  coo: ['u', 'u'],
};

/** Tempo of small noises per kind (higher = slower). */
const TEMPO: Record<VoiceKind, number> = { roar: 1, screech: 0.9, hoot: 1.15, bellow: 1.2, honk: 1.1, trill: 0.8, chitter: 0.55, croak: 0.95, rumble: 1.35, grunt: 0.9, coo: 1.15 };

/** The onsets a kind puts on its small calls: a chitterer's tick, a beak's click, a grunter's snort. */
function accent(p: Patch, w: Who, t: number, times: readonly number[] = [0], lv = 1) {
  switch (w.kind) {
    case 'chitter':
      ticks(p, t, times, 5200 * w.size, 0.55 * lv, 2);
      break;
    case 'croak':
      ticks(p, t, times, lerp(2400, 1600, w.c.huge) * w.size, 0.65 * lv, 3, 0.01);
      break;
    case 'grunt':
      grains(p, p.out, t, times.slice(0, 3).map((at): Grain => [at, 0.45 * lv, 0.05, 850 * w.size]), 'bandpass', 1.4, 0.008);
      break;
  }
}

// ---------------- signature calls ----------------

/** Big theropods: T. rex rolls and rumbles, Allosaurus snarls, Carnotaurus barks, Spinosaurus croaks. */
function roarCall(p: Patch, w: Who, t: number, lv: number) {
  const { v, len, c } = w;
  switch (p.choose([1.2, 0.9, 0.3 + 2.5 * c.bark, 0.4 + 1.5 * c.shriek])) {
    case 0:
      // "hrOAWR": a short roar that opens and falls away, rattling.
      vox(p, v, [{ at: 0, dur: 0.85 * len, p: cute(w, [[0, 0.82], [0.2, p.vary(1.08, 0.04)], [0.5, 1], [1, 0.72]]), a: [[0, 0], [0.12, 1], [0.5, 0.85], [0.85, 0.45], [1, 0]], v: [[0, 'o'], [0.2, 'a'], [0.7, 'o'], [1, 'u']], fl: [[0, v.flutter * 0.6], [1, v.flutter * 1.4]], ro: [[0, 0.7], [1, 1.4]], lv }], t);
      break;
    case 1:
      // "grrr-HUH": a low rumbling growl that ends in a huff of a bark.
      vox(p, v, [
        { at: 0, dur: 0.42 * len, p: [[0, 0.62], [1, 0.7]], a: [[0, 0], [0.4, 0.7], [1, 0.55]], v: [[0, 'u'], [1, 'o']], fl: clamp(v.flutter + 0.35, 0, 0.85), ro: 1.5, nz: 1.5, lv: 0.8 * lv },
        { at: 0.45 * len, dur: 0.36 * len, p: cute(w, [[0, 0.9], [0.15, p.vary(1.12, 0.04)], [1, 0.8]]), a: BARK, v: [[0, 'a'], [1, 'uh']], ro: 1.2, lv },
      ], t);
      break;
    case 2: {
      // A gruff double bark.
      const b = { ...v, grit: clamp(v.grit * 1.15), flutter: clamp(v.flutter * 1.2), level: v.level * 0.85 };
      vox(p, b, [
        { at: 0, dur: 0.24 * len, p: [[0, 0.95], [0.2, 1.15], [1, 0.85]], a: BARK, v: [[0, 'a'], [1, 'o']], lv },
        { at: 0.32 * len, dur: 0.38 * len, p: cute(w, [[0, 1], [0.15, 1.1], [1, 0.7]]), a: BARK, v: [[0, 'a'], [0.6, 'o'], [1, 'u']], lv },
      ], t);
      break;
    }
    default:
      // "rrrRAAH": a snarl rising into a rasping scream.
      vox(p, { ...v, rasp: v.rasp + 25 * w.big }, [{ at: 0, dur: 0.8 * len, p: cute(w, [[0, 0.75], [0.35, p.vary(1.2, 0.04)], [0.6, 1.15], [1, 0.85]]), a: [[0, 0], [0.3, 0.8], [0.45, 1], [0.8, 0.7], [1, 0]], v: [[0, 'u'], [0.35, 'ae'], [0.75, 'a'], [1, 'o']], fl: [[0, v.flutter * 1.6], [0.4, v.flutter * 0.6], [1, v.flutter]], lv }], t);
  }
  if (c.croc > 0) {
    croc(p, t, 0.9 * len, v.f, 0.5 * c.croc * lv);
    hiss(p, t + 0.5 * len, 0.47 * len, 0.1 * c.croc * lv);
  }
}

/** Birds of prey and raptors: "kee-YAHH", hunting chatter, a hiss and a shriek, a rising rasp. */
function screechCall(p: Patch, w: Who, t: number, lv0: number) {
  const { v, len, c } = w;
  // A hatchling's shriek is piercing enough.
  const lv = lv0 * lerp(0.75, 1, w.big);
  switch (p.choose([1.3, 0.9, 0.7, 0.8])) {
    case 0:
      // "kee-YAHH": a quick rising note, then a shriek that bends up and slides down.
      vox(p, v, [
        { at: 0, dur: 0.11 * len, p: [[0, 1.05], [0.4, 1.4], [1, 1.3]], a: BLIP, v: 'i', lv: 0.75 * lv },
        { at: 0.15 * len, dur: 0.42 * len, p: cute(w, [[0, 1.3], [0.12, p.vary(1.5, 0.04)], [0.45, 1.25], [1, 0.85]]), a: [[0, 0], [0.06, 1], [0.5, 0.75], [1, 0]], v: [[0, 'e'], [0.3, 'ae'], [1, 'a']], lv },
      ], t);
      break;
    case 1: {
      // "kak-kak-kak": a hunting chatter of short barks.
      const n = p.pick([3, 3, 4]);
      const gap = 0.13 * len * p.vary(1, 0.1);
      vox(p, v, Array.from({ length: n }, (_, i): Note => ({ at: i * gap, dur: 0.08 * len, p: [[0, 1.25 - 0.04 * i], [0.3, 1.32 - 0.04 * i], [1, 1.05 - 0.04 * i]], a: BARK, v: [[0, 'ae'], [1, 'a']], ro: 1.3, lv: 1.5 * lv * (i === n - 1 ? 1 : 0.8) })), t);
      break;
    }
    case 2:
      // "hsss-KRAA": a hiss through the teeth, then a shriek.
      hiss(p, t, 0.28 * len, 0.1 * lv, 2600);
      vox(p, v, [{ at: 0.24 * len, dur: 0.36 * len, p: cute(w, [[0, 1.2], [0.15, p.vary(1.45, 0.04)], [1, 0.9]]), a: CAW, v: [[0, 'ae'], [0.5, 'a'], [1, 'o']], lv }], t);
      break;
    default:
      // "krrrEEE": a rattling rasp that climbs into a screech.
      vox(p, { ...v, rasp: v.rasp * 1.4, flutter: 0.6, flutterHz: 34 }, [{ at: 0, dur: 0.5 * len, p: cute(w, [[0, 0.95], [0.6, p.vary(1.5, 0.04)], [1, 1.42]]), a: [[0, 0], [0.2, 0.7], [0.6, 1], [0.85, 0.8], [1, 0]], v: [[0, 'a'], [0.5, 'e'], [1, 'i']], fl: [[0, 0.7], [0.45, 0.6], [0.6, 0], [1, 0]], lv }], t);
  }
  if (c.rattle > 0) rattle(p, t + 0.2 * len, 0.55 * len, lerp(55, 38, w.big), 1.6 * c.rattle * lv);
}

/** Pachycephalosaurus: hollow hoots, rising, falling or in a row. */
function hootCall(p: Patch, w: Who, t: number, lv: number) {
  const { v, len } = w;
  switch (p.choose([1.2, 0.9, 0.7, 0.8])) {
    case 0:
      // "hoo-HOO".
      vox(p, v, [
        { at: 0, dur: 0.24 * len, p: [[0, 0.94], [0.3, 1], [1, 0.97]], a: HOOT, v: 'u', lv: 0.85 * lv },
        { at: 0.36 * len, dur: 0.38 * len, p: cute(w, [[0, 1.06], [0.25, p.vary(1.13, 0.03)], [1, 1.04]]), a: HOOT, v: 'u', lv },
      ], t);
      break;
    case 1:
      // "hoo-hoo-hoo", stepping down.
      vox(p, v, [0, 1, 2].map((i): Note => ({ at: i * 0.26 * len, dur: 0.18 * len, p: [[0, 1.12 - 0.07 * i], [0.3, 1.16 - 0.07 * i], [1, 1.1 - 0.07 * i]], a: HOOT, v: 'u', lv: lv * (1 - 0.1 * i) })), t);
      break;
    case 2:
      // A long "hoooOO" that slides up.
      vox(p, { ...v, vibDelay: 0.3 * len }, [{ at: 0, dur: 0.7 * len, p: cute(w, [[0, 0.9], [0.6, p.vary(1.12, 0.03)], [1, 1.1]]), a: [[0, 0], [0.3, 0.8], [0.75, 1], [1, 0]], v: [[0, 'u'], [0.7, 'o'], [1, 'u']], lv }], t);
      break;
    default:
      // "HOO-hoo", falling.
      vox(p, v, [
        { at: 0, dur: 0.32 * len, p: [[0, 1.08], [0.25, 1.15], [1, 1.08]], a: HOOT, v: 'u', lv },
        { at: 0.42 * len, dur: 0.26 * len, p: [[0, 0.95], [1, 0.9]], a: HOOT, v: 'u', lv: 0.75 * lv },
      ], t);
  }
}

/** Ceratopsians, stegosaurs, ankylosaurs, long necks: nasal moos; Ankylosaurus grunts first. */
function bellowCall(p: Patch, w: Who, t: number, lv: number) {
  const { v, len, c } = w;
  let at = 0;
  const notes: Note[] = [];
  if (c.grunt > 0.5) {
    for (let i = 0; i < 2; i++) notes.push({ at: i * 0.17 * len, dur: 0.1 * len, p: [[0, 0.88], [1, 0.72]], a: GRUNT, v: 'u', nz: 2.5, ro: 1.5, lv: 0.7 * lv });
    at = 0.36 * len;
  }
  const d = len;
  const swell: Pts = [[0, 0], [0.3 + 0.1 * c.gentle, 1], [0.7, 0.85], [1, 0]];
  const k = p.choose([1.3, 0.9, 0.7, 0.6]);
  if (w.baby > 0.6) {
    // A calf's "mweh" (or two).
    const n = k === 1 ? 2 : 1;
    for (let i = 0; i < n; i++) notes.push({ at: at + i * 0.42 * d, dur: (n === 2 ? 0.36 : 0.6) * d, p: [[0, 1], [0.3, 1.15 + 0.04 * i], [1, 0.92]], a: [[0, 0], [0.2, 1], [0.7, 0.8], [1, 0]], v: [[0, 'm'], [0.3, 'a'], [1, 'e']], lv: lv * (1 - 0.15 * (n - 1 - i)) });
  } else if (k === 0) {
    // "mmMOOoo".
    notes.push({ at, dur: d, p: [[0, 0.9], [0.3, p.vary(1.04, 0.03)], [0.7, 1], [1, 0.82]], a: swell, v: [[0, 'm'], [0.22, 'u'], [0.5, 'o'], [0.8, 'u'], [1, 'm']], lv });
  } else if (k === 1) {
    // "mm-MOOO".
    notes.push({ at, dur: 0.22 * d, p: [[0, 0.85], [1, 0.9]], a: GRUNT, v: 'm', lv: 0.6 * lv }, { at: at + 0.3 * d, dur: 0.75 * d, p: [[0, 0.95], [0.3, p.vary(1.06, 0.03)], [1, 0.84]], a: swell, v: [[0, 'm'], [0.2, 'o'], [0.8, 'u'], [1, 'm']], lv });
  } else if (k === 2) {
    // "MOOoo-oo": a long moo that wavers down.
    notes.push({ at, dur: 0.95 * d, p: [[0, 1], [0.2, 1.06], [0.45, 0.96], [0.6, 1], [0.8, 0.9], [1, 0.84]], a: swell, v: [[0, 'm'], [0.15, 'o'], [0.55, 'u'], [0.7, 'o'], [1, 'u']], lv });
  } else {
    // "mmOOH?": short and asking.
    notes.push({ at, dur: 0.6 * d, p: [[0, 0.9], [0.5, 0.95], [1, 1.15]], a: [[0, 0], [0.3, 1], [0.8, 0.9], [1, 0]], v: [[0, 'm'], [0.4, 'o'], [1, 'u']], lv });
  }
  vox(p, v, notes, t);
}

/** Crested hadrosaurs: brassy honks through the crest; Corythosaurus' are rounder and lower. */
function honkCall(p: Patch, w: Who, t: number, lv0: number) {
  const { v, len, c } = w;
  // A hatchling's honk rings enough.
  const lv = lv0 * lerp(0.8, 1, w.big);
  const r = c.round;
  const o: Vowel = r > 0.5 ? 'u' : 'o';
  switch (p.choose([1.2 - 0.6 * r, 0.9 - 0.4 * r, 0.5 + 1.2 * r, 0.5 + r])) {
    case 0:
      // One brassy "HWONK" with a scoop up into the note.
      vox(p, { ...v, vibDelay: 0.35 * len }, [{ at: 0, dur: 0.95 * len, p: cute(w, [[0, 0.93], [0.07, 1], [0.85, 1], [1, 0.9]]), a: [[0, 0], [0.06, 1], [0.3, 0.85], [0.85, 0.75], [1, 0]], v: o, lv }], t);
      break;
    case 1:
      // "hon-HONK": a pickup a fourth below.
      vox(p, { ...v, vibDelay: 0.6 * len }, [
        { at: 0, dur: 0.2 * len, p: [[0, 0.72], [0.15, 0.75], [1, 0.75]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], v: o, lv: 0.7 * lv },
        { at: 0.26 * len, dur: 0.7 * len, p: cute(w, [[0, 0.95], [0.06, 1], [0.85, 1], [1, 0.9]]), a: [[0, 0], [0.05, 1], [0.3, 0.85], [0.85, 0.75], [1, 0]], v: [[0, o], [0.5, 'a'], [1, o]], lv },
      ], t);
      break;
    case 2:
      // "HONK-onk": the second lower and softer, like an echo in the crest.
      vox(p, { ...v, vibDelay: 1 }, [
        { at: 0, dur: 0.45 * len, p: [[0, 0.95], [0.08, 1.02], [1, 0.97]], a: [[0, 0], [0.06, 1], [0.6, 0.8], [1, 0]], v: o, lv },
        { at: 0.55 * len, dur: 0.35 * len, p: cute(w, [[0, 0.84], [0.1, 0.86], [1, 0.8]]), a: [[0, 0], [0.08, 1], [0.6, 0.7], [1, 0]], v: 'u', lv: 0.65 * lv },
      ], t);
      break;
    default:
      // "whooOONK": sliding up into it.
      vox(p, { ...v, vibDelay: 0.5 * len }, [{ at: 0, dur: 0.85 * len, p: cute(w, [[0, 0.78], [0.35, 1.02], [0.85, 1], [1, 0.92]]), a: [[0, 0], [0.3, 0.8], [0.4, 1], [0.85, 0.8], [1, 0]], v: [[0, 'u'], [0.4, o], [1, o]], lv }], t);
  }
}

/** Gallimimus: trills, tumbles, chips and slurred whistles. */
function trillCall(p: Patch, w: Who, t: number, lv0: number) {
  const { v, len } = w;
  const lv = 0.7 * lv0;
  switch (p.choose([1.2, 0.8, 0.8, 0.7])) {
    case 0:
      // "prrrree-EET".
      vox(p, v, [
        { at: 0, dur: 0.32 * len, p: [[0, 0.92], [1, 1.06]], a: [[0, 0], [0.1, 1], [0.85, 0.9], [1, 0]], tr: 0.95, v: 'e', lv: 0.85 * lv },
        { at: 0.37 * len, dur: Math.max(0.07, 0.1 * len), p: [[0, 1.15], [1, p.vary(1.6, 0.04)]], a: BLIP, tr: 0, v: 'i', lv },
      ], t);
      break;
    case 1:
      // "trrrrrr", tumbling down.
      vox(p, v, [{ at: 0, dur: 0.5 * len, p: [[0, 1.3], [1, 0.95]], a: [[0, 0], [0.08, 1], [0.8, 0.8], [1, 0]], tr: 0.95, v: [[0, 'i'], [1, 'e']], lv }], t);
      break;
    case 2:
      // "chip-chip-prrreee".
      vox(p, v, [
        { at: 0, dur: 0.06 * len + 0.02, p: [[0, 1.3], [1, 1.1]], a: TICK, tr: 0, v: 'i', lv: 0.7 * lv },
        { at: 0.13 * len, dur: 0.06 * len + 0.02, p: [[0, 1.35], [1, 1.12]], a: TICK, tr: 0, v: 'i', lv: 0.75 * lv },
        { at: 0.28 * len, dur: 0.3 * len, p: cute(w, [[0, 1], [1, 1.2]]), a: [[0, 0], [0.1, 1], [0.8, 0.85], [1, 0]], tr: [[0, 0.95], [1, 0.5]], v: [[0, 'e'], [1, 'i']], lv },
      ], t);
      break;
    default:
      // "pee-oo": a slurred whistle.
      vox(p, v, [{ at: 0, dur: 0.4 * len, p: [[0, 1.45], [0.3, p.vary(1.5, 0.03)], [1, 1.05]], a: [[0, 0], [0.12, 1], [0.6, 0.8], [1, 0]], tr: 0, v: [[0, 'i'], [1, 'u']], lv }], t);
  }
}

/** A tiny chitter syllable: a quick sweep from `from` to `to` (times the pitch). */
const chip = (at: number, dur: number, from: number, to: number, lv: number, v: Vowels = [[0, 'i'], [1, 'e']]): Note => ({ at, dur: Math.max(0.018, dur), p: [[0, from], [0.35, lerp(from, to, 0.7)], [1, to]], a: TICK, v, lv });

/** Compsognathus, Microraptor: chips, chirrups, clicks and chatter. */
function chitterCall(p: Patch, w: Who, t: number, lv0: number) {
  const { v, len, c } = w;
  // Tiny syllables: each one louder, so the call carries.
  const lv = 1.6 * lv0;
  const s = Math.max(0.75, len) * lerp(1, 0.85, c.click);
  const onsets: number[] = [];
  const notes: Note[] = [];
  let voice = v;
  switch (p.choose([1 + c.click, 1.8 - c.click, 1.4 - 0.8 * c.click, 0.5 + 1.2 * c.click])) {
    case 0: {
      // "chit-chit-chit".
      const n = 3 + Math.floor(p.r(0, 2.99) * (0.5 + 0.5 * c.click));
      const gap = 0.075 * s * p.vary(1, 0.1);
      for (let i = 0; i < n; i++) {
        notes.push(chip(i * gap, 0.032 * s, 1.3 * p.vary(1, 0.03), 0.92, lv * (0.8 + 0.2 * (i % 2))));
        onsets.push(i * gap);
      }
      break;
    }
    case 1:
      // "chirrup": up, a quick trill, and down.
      voice = { ...v, trill: 0.85 };
      notes.push(
        { at: 0, dur: 0.07 * s, p: [[0, 0.85], [1, 1.28]], a: BLIP, tr: 0, v: [[0, 'e'], [1, 'i']], lv: 0.8 * lv },
        { at: 0.08 * s, dur: 0.15 * s, p: cute(w, [[0, 1.25], [1, 1.15]]), a: [[0, 0], [0.1, 1], [0.8, 0.9], [1, 0]], tr: 0.9, v: 'i', lv },
        { at: 0.25 * s, dur: 0.06 * s, p: [[0, 1.2], [1, 0.9]], a: TICK, tr: 0, v: [[0, 'i'], [1, 'e']], lv: 0.7 * lv },
      );
      onsets.push(0);
      break;
    case 2:
      // "tik-tik-tsweeet": two dry clicks, then a whistle sweeping up.
      onsets.push(0, 0.07 * s);
      notes.push({ at: 0.15 * s, dur: 0.17 * s, p: cute(w, [[0, 0.9], [0.7, p.vary(1.5, 0.03)], [1, 1.45]]), a: BLIP, v: 'i', lv });
      break;
    default: {
      // Chatter: quicker and quicker, bouncing between two notes.
      const n = 6 + Math.floor(p.r(0, 3.99));
      let at = 0;
      let gap = 0.075 * s;
      for (let i = 0; i < n; i++) {
        notes.push(chip(at, 0.026 * s, i % 2 ? 1.12 : 1.28, i % 2 ? 0.98 : 1.05, lv * (0.7 + 0.3 * (i / n))));
        onsets.push(at);
        at += gap;
        gap = Math.max(0.038 * s, gap * 0.88);
      }
    }
  }
  if (notes.length) vox(p, voice, notes, t);
  accent(p, w, t, onsets, lv);
}

/** Pterosaurs: harsh caws, low knocking croaks and a clattering bill. */
function croakCall(p: Patch, w: Who, t: number, lv: number) {
  const { v, len, c } = w;
  const h = c.huge;
  const d = 0.3 * len * (1 + 0.3 * h);
  const caw = (at: number, dur: number, top: number, l: number): Note => ({ at, dur, p: cute(w, [[0, top * 0.95], [0.15, top * p.vary(1.08, 0.03)], [1, top * 0.8]]), a: CAW, v: [[0, 'ae'], [0.35, 'a'], [1, 'o']], ro: [[0, 1.2], [1, 0.9]], lv: l });
  switch (p.choose([1 + h, 1.4 - 0.8 * h, 0.5 + 1.2 * h, 1.5 - h])) {
    case 0:
      // "KRAAK".
      vox(p, v, [caw(0, d, 1, lv)], t);
      accent(p, w, t, [0], lv);
      break;
    case 1: {
      // "kraa-kraa", the second lower.
      const gap = d * 1.2;
      vox(p, v, [caw(0, d * 0.8, 1.02, 0.85 * lv), caw(gap, d * 0.9, 0.95, lv)], t);
      accent(p, w, t, [0, gap], lv);
      break;
    }
    case 2: {
      // "grok-grok-grok": low knocking croaks, period-doubled.
      const gap = 0.16 * len;
      vox(p, { ...v, subh: clamp(v.subh + 0.3) }, [0, 1, 2].map((i): Note => ({ at: i * gap, dur: 0.1 * len, p: [[0, 0.85], [1, 0.75]], a: GRUNT, v: [[0, 'o'], [1, 'u']], ro: 1.4, lv: 1.4 * lv * (1 - 0.08 * i) })), t);
      break;
    }
    default:
      // A clattering bill (like a stork's), then a caw.
      rattle(p, t, 0.3 * len, p.r(13, 18), 1.4 * lv, lerp(1900, 1300, h) * w.size, 4);
      vox(p, v, [caw(0.34 * len, d * 0.8, 1, lv)], t);
      accent(p, w, t, [0.34 * len], lv);
  }
}

/** Sauropods: closed-mouth hums and booms, felt as much as heard, with air rumbling in the chest. */
function rumbleCall(p: Patch, w: Who, t: number, lv: number) {
  const { v, len, c } = w;
  const baby = w.baby > 0.5;
  let end: number;
  switch (p.choose([1.2, 0.9, 0.6 + 0.8 * c.nasal])) {
    case 0: {
      // "mmmMMMmmm", a long swell; a hatchling's is a short "mm?".
      const d = (baby ? 0.5 : 1.15) * len;
      const pts: Pts = baby ? [[0, 0.95], [0.6, 1], [1, 1.22]] : [[0, 0.92], [0.4, p.vary(1.04, 0.02)], [1, 0.88]];
      end = vox(p, v, [{ at: 0, dur: d, p: pts, a: HUM, v: [[0, 'm'], [0.4, 'u'], [1, 'm']], fl: [[0, v.flutter * 0.5], [0.5, v.flutter], [1, v.flutter * 1.3]], lv }], t);
      break;
    }
    case 1: {
      // "hmm-HMMMM" (a hatchling's "mm-hm").
      const d = (baby ? 0.45 : 1) * len;
      end = vox(p, v, [
        { at: 0, dur: 0.28 * d, p: [[0, 0.9], [1, 0.95]], a: GRUNT, v: 'm', lv: 0.7 * lv },
        { at: 0.36 * d, dur: 0.8 * d, p: cute(w, [[0, 0.95], [0.3, 1.06], [1, 0.86]]), a: HUM, v: [[0, 'm'], [0.5, 'u'], [1, 'm']], lv },
      ], t);
      break;
    }
    default: {
      // "mmm-hrrOOO": the mouth opening a little, breathy, as it rises.
      const d = (baby ? 0.55 : 1.1) * len;
      end = vox(p, v, [{ at: 0, dur: d, p: cute(w, [[0, 0.9], [0.45, 1], [0.7, 1.12], [1, 1]]), a: [[0, 0], [0.3, 0.8], [0.7, 1], [1, 0]], v: [[0, 'm'], [0.45, 'u'], [0.7, 'o'], [1, 'u']], nz: [[0, 1], [0.5, 2.2], [1, 1]], lv }], t);
    }
  }
  if (w.big > 0.3) air(p, t, end - t, 0.3 * w.big * lv * (1 - 0.4 * c.nasal), 90 + 60 * c.nasal);
}

/** A grunt: quick onset, falling, rough. */
const grunt1 = (w: Who, at: number, dur: number, top: number, lv: number, v: Vowels = [[0, 'uh'], [1, 'o']]): Note => ({ at, dur, p: cute(w, [[0, top], [0.2, top * 1.04], [1, top * 0.8]]), a: GRUNT, v, nz: 1.4, ro: 1.2, lv });

/** Ceratopsians, stegosaurs, iguanodonts: grunts and snorts. */
function gruntCall(p: Patch, w: Who, t: number, lv0: number) {
  const { v, len, c } = w;
  // Short syllables: each one louder, so the call carries.
  const lv = 1.4 * lv0;
  const snorty = clamp(1 - c.deep - c.quick);
  switch (p.choose([1, 0.5 + 1.5 * snorty, 0.4 + 2 * c.quick, 0.4 + 2 * c.deep])) {
    case 0:
      // "hunh-hunh".
      vox(p, v, [grunt1(w, 0, 0.14 * len, 1, 0.85 * lv), grunt1(w, 0.24 * len, 0.16 * len, 0.9, lv)], t);
      break;
    case 1:
      // A snort, then a grunt.
      nose(p, t, [[0, 0.13 * len, 0.9 * lv]], w.size, 0.4);
      vox(p, v, [grunt1(w, 0.2 * len, 0.2 * len, 0.95, lv)], t);
      break;
    case 2: {
      // "huh-huh-huh-hunh": quick huffing grunts.
      const n = p.pick([3, 4, 4]);
      const gap = 0.12 * len;
      vox(p, v, Array.from({ length: n }, (_, i) => grunt1(w, i * gap, (i === n - 1 ? 0.11 : 0.075) * len, 1.05 - 0.03 * i, lv * (i === n - 1 ? 1 : 0.75), 'uh')), t);
      break;
    }
    default:
      // "HUUUNNH": a long honking grunt.
      vox(p, { ...v, subh: clamp(v.subh + 0.2) }, [{ at: 0, dur: 0.5 * len, p: cute(w, [[0, 0.9], [0.3, p.vary(1.05, 0.03)], [1, 0.8]]), a: [[0, 0], [0.12, 1], [0.6, 0.8], [1, 0]], v: [[0, 'u'], [0.4, 'o'], [1, 'n']], ro: [[0, 1], [1, 1.4]], lv: 0.67 * lv }], t);
  }
}

/** Feathered herbivores: dove-like coos, rolled coos and deep booms. */
function cooCall(p: Patch, w: Who, t: number, lv: number) {
  const { v, len, c } = w;
  const b = c.boom;
  switch (p.choose([1, 1.7 - 1.2 * b, 0.4 + 1.8 * b, 1.5 - b])) {
    case 0:
      // "coo-COOOO-coo".
      vox(p, v, [
        { at: 0, dur: 0.13 * len, p: [[0, 0.95], [1, 1]], a: HOOT, v: 'u', lv: 0.7 * lv },
        { at: 0.2 * len, dur: 0.38 * len, p: cute(w, [[0, 1.02], [0.3, p.vary(1.14, 0.03)], [1, 1.02]]), a: HOOT, v: [[0, 'u'], [0.5, 'o'], [1, 'u']], lv },
        { at: 0.64 * len, dur: 0.16 * len, p: [[0, 0.95], [1, 0.9]], a: HOOT, v: 'u', lv: 0.65 * lv },
      ], t);
      break;
    case 1:
      // "crrr-OOO": a rolled onset opening into a coo.
      vox(p, { ...v, trill: 0.85 }, [{ at: 0, dur: 0.5 * len, p: cute(w, [[0, 0.9], [0.3, p.vary(1.1, 0.03)], [1, 0.96]]), a: [[0, 0], [0.1, 0.8], [0.4, 1], [1, 0]], tr: [[0, 0.9], [0.3, 0.85], [0.4, 0], [1, 0]], v: [[0, 'u'], [0.5, 'o'], [1, 'u']], lv }], t);
      break;
    case 2: {
      // "hoom... hoom": deep booms from the throat pouch.
      const d = 0.28 * len;
      vox(p, v, [
        { at: 0, dur: d, p: [[0, 0.85], [0.3, 0.9], [1, 0.84]], a: HOOT, v: 'u', lv },
        { at: d * 1.6, dur: d, p: cute(w, [[0, 0.82], [0.3, 0.87], [1, 0.8]]), a: HOOT, v: 'u', lv: 0.9 * lv },
      ], t);
      if (w.big > 0.3) {
        boom(p, t, d, v.f * 0.43, 0.45 * w.big * lv);
        boom(p, t + d * 1.6, d, v.f * 0.41, 0.4 * w.big * lv);
      }
      break;
    }
    default:
      // "coo-roo-coo-coo": a pigeon's rhythm.
      vox(p, { ...v, trill: 0.8 }, [
        { at: 0, dur: 0.12 * len, p: [[0, 1], [1, 1.02]], a: HOOT, v: 'u', tr: 0, lv: 0.8 * lv },
        { at: 0.16 * len, dur: 0.24 * len, p: [[0, 0.95], [0.4, 1.1], [1, 1]], a: HOOT, v: [[0, 'u'], [0.5, 'o'], [1, 'u']], tr: [[0, 0.8], [0.35, 0], [1, 0]], lv },
        { at: 0.46 * len, dur: 0.11 * len, p: [[0, 0.98], [1, 0.95]], a: HOOT, v: 'u', tr: 0, lv: 0.7 * lv },
        { at: 0.62 * len, dur: 0.11 * len, p: cute(w, [[0, 0.96], [1, 0.92]]), a: HOOT, v: 'u', tr: 0, lv: 0.6 * lv },
      ], t);
  }
}

const CALLS: Record<VoiceKind, (p: Patch, w: Who, t: number, lv: number) => void> = {
  roar: roarCall,
  screech: screechCall,
  hoot: hootCall,
  bellow: bellowCall,
  honk: honkCall,
  trill: trillCall,
  chitter: chitterCall,
  croak: croakCall,
  rumble: rumbleCall,
  grunt: gruntCall,
  coo: cooCall,
};

/** The short signature call of the species. */
function call(p: Patch, w: Who, t = p.t, lv = 1) {
  CALLS[w.kind](p, w, t, lv);
}

// ---------------- big calls ----------------

/** The long body of a big roar: rises, opens wide, holds, then falls away rattling. */
function bigRoar(v: Vox, at: number, dur: number, peak: number, lv = 1): Note {
  return {
    at,
    dur,
    p: [[0, 0.7], [0.1, 0.92], [0.25, peak], [0.5, 1.04], [0.75, 0.9], [1, 0.6]],
    a: [[0, 0], [0.12, 0.75], [0.25, 1], [0.6, 0.9], [0.85, 0.5], [1, 0]],
    v: [[0, 'u'], [0.18, 'a'], [0.6, 'a'], [0.85, 'o'], [1, 'u']],
    fl: [[0, v.flutter * 0.7], [0.6, v.flutter], [1, clamp(v.flutter * 1.6, 0, 0.9)]],
    ro: [[0, 0.8], [0.5, 1], [1, 1.6]],
    lv,
  };
}

/** The scream riding on top of a big roar, like an elephant's trumpet: a higher, rasping second voice. */
function scream(p: Patch, w: Who, t: number, dur: number, lv: number) {
  const v = w.v;
  const s: Vox = { ...v, f: v.f * p.vary(2.4, 0.05), thick: 0, sub: 0, subh: 0, body: 0.1, tract: v.tract * 1.5, q: 1.3, noise: v.noise * 0.5, grit: clamp(v.grit + 0.15), rough: clamp(v.rough + 0.2), rasp: 45 + 40 * w.c.shriek, raspHz: 85, flutter: 0, drift: 40, level: v.level * lv };
  vox(p, s, [{ at: 0, dur, p: [[0, 0.85], [0.3, 1.08], [0.6, 1], [1, 0.8]], a: [[0, 0], [0.35, 1], [0.6, 0.7], [1, 0]], v: [[0, 'ae'], [0.5, 'a'], [1, 'o']] }], t);
}

/** A chest thump under the start of an adult's big call: felt more than heard. */
function thump(p: Patch, w: Who, t: number, f: number, lv: number) {
  boom(p, t, 0.45, Math.max(45, f), lv * w.big, [[0, 0], [0.05, 1], [0.35, 0.35], [1, 0]], [[0, 1.15], [1, 0.75]]);
}

function roarRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const notes: Note[] = [];
  if (w.baby > 0.6) {
    // A hatchling's best try: a squeaky "rawr" whose voice cracks, two little ones, or a grumble first.
    const b = { ...v, rough: v.rough * 0.6 };
    switch (p.choose([1, 1, 0.8])) {
      case 0:
        notes.push({ at: 0, dur: 0.75 * len, p: [[0, 0.85], [0.2, 1.15], [0.52, 1.05], [0.58, 1.55], [0.7, 1.25], [1, 0.9]], a: [[0, 0], [0.12, 1], [0.5, 0.85], [0.6, 1], [1, 0]], v: [[0, 'u'], [0.2, 'a'], [0.55, 'ae'], [0.7, 'a'], [1, 'o']] });
        break;
      case 1:
        notes.push(bigRoar(b, 0, 0.5 * len, 1.15, 0.85), bigRoar(b, 0.62 * len, 0.7 * len, 1.2));
        break;
      default:
        notes.push({ at: 0, dur: 0.4 * len, p: [[0, 0.7], [1, 0.78]], a: [[0, 0], [0.4, 0.6], [1, 0.5]], v: 'u', fl: 0.6, lv: 0.8 }, bigRoar(b, 0.42 * len, 0.9 * len, 1.25));
    }
    vox(p, { ...b, flutter: Math.max(0.2, b.flutter) }, notes, t);
    return;
  }
  // Adults: one long roar, a shorter roar then the big one, a growl swelling into it, or Carnotaurus'
  // bark first.
  let at = 0;
  let dur = 2.2 * len;
  switch (p.choose([1.2, 0.8 + 1.2 * c.shriek, 0.9, 0.2 + 3 * c.bark])) {
    case 1:
      notes.push(bigRoar(v, 0, 0.6 * len, 1.05, 0.8));
      at = 0.7 * len;
      dur = 1.65 * len;
      break;
    case 2:
      notes.push({ at: 0, dur: 0.55 * len, p: [[0, 0.6], [0.7, 0.66], [1, 0.7]], a: [[0, 0], [0.5, 0.55], [1, 0.7]], v: [[0, 'u'], [1, 'o']], fl: clamp(v.flutter + 0.4, 0, 0.9), ro: 1.5, nz: 1.4, lv: 0.85 });
      at = 0.55 * len;
      dur = 1.8 * len;
      break;
    case 3:
      notes.push({ at: 0, dur: 0.3 * len, p: [[0, 0.95], [0.2, 1.15], [1, 0.85]], a: BARK, v: [[0, 'a'], [1, 'o']], lv: 0.85 });
      at = 0.38 * len;
      dur = 1.76 * len;
      break;
  }
  const peak = p.vary(1.12, 0.04);
  notes.push(bigRoar(v, at, dur, peak));
  vox(p, { ...v, grit: clamp(v.grit * 1.1) }, notes, t);
  scream(p, w, t + at + 0.12 * dur, 0.62 * dur, 0.22 + 0.3 * c.shriek);
  thump(p, w, t + at, v.f * 0.45, 0.35);
  // The breath running out.
  air(p, t + at + 0.75 * dur, 0.35 * dur, 0.05, 1400, [[0, 0], [0.3, 1], [1, 0]]);
  if (c.croc > 0) {
    croc(p, t, (at + dur) * 1.02, v.f, 0.55 * c.croc);
    hiss(p, t + at + 0.7 * dur, 0.45 * dur, 0.13 * c.croc);
  }
}

function screechRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const s = { ...v, rasp: v.rasp * 1.3, grit: clamp(v.grit + 0.1) };
  const long = (at: number): Note => ({ at, dur: 1.2 * len, p: [[0, 1.3], [0.08, p.vary(1.55, 0.03)], [0.3, 1.45], [0.6, 1.2], [1, 0.75]], a: [[0, 0], [0.04, 1], [0.4, 0.85], [0.8, 0.5], [1, 0]], v: [[0, 'i'], [0.2, 'ae'], [0.7, 'a'], [1, 'o']], ro: [[0, 1], [1, 1.5]] });
  switch (p.choose([1.2, 1, 0.7])) {
    case 0:
      // "ki-SKREEEE-ahh".
      vox(p, s, [{ at: 0, dur: 0.14 * len, p: [[0, 0.95], [1, 1.35]], a: BLIP, v: 'e', lv: 0.7 }, long(0.2 * len)], t);
      break;
    case 1:
      // "kak-kak-SKREEEE".
      vox(p, s, [
        { at: 0, dur: 0.08 * len, p: [[0, 1.2], [1, 1.05]], a: BARK, v: [[0, 'ae'], [1, 'a']], lv: 0.75 },
        { at: 0.14 * len, dur: 0.08 * len, p: [[0, 1.25], [1, 1.1]], a: BARK, v: [[0, 'ae'], [1, 'a']], lv: 0.85 },
        long(0.3 * len),
      ], t);
      break;
    default:
      // A hiss, then a long shriek that warbles as it fades.
      hiss(p, t, 0.35 * len, 0.12, 2600);
      vox(p, { ...s, vib: 40, vibHz: 7, vibDelay: 0.9 * len }, [long(0.3 * len)], t);
  }
  if (c.rattle > 0) {
    rattle(p, t + 0.2 * len, 1.1 * len, lerp(58, 40, w.big), 1.2 * c.rattle);
    rattle(p, t + 1.35 * len, 0.5 * len, lerp(50, 34, w.big), 1.8 * c.rattle);
  }
}

function hootRoar(p: Patch, w: Who, t: number) {
  const { v, len } = w;
  let notes: Note[];
  let long: Note;
  const k = p.choose([1.1, 0.9, 0.7]);
  if (k === 0) {
    // "hoo-hoo-HOOOOO-hoo", rising, with a low throat boom under the long one.
    const seq = [[1, 0.22], [1.06, 0.22], [1.2, 0.75], [0.96, 0.3]] as const;
    let at = 0;
    notes = seq.map(([s, d], i) => {
      const n: Note = { at, dur: d * len, p: [[0, s * 0.95], [0.25, s], [1, s * 0.96]], a: HOOT, v: 'u', lv: [0.75, 0.85, 1, 0.8][i] };
      at += (d + 0.12) * len;
      return n;
    });
    long = notes[2];
  } else if (k === 2) {
    // "HOOOO... hoo-HOOOOO": a long hoot, a pickup and a longer, higher one that wavers.
    long = { at: 1.05 * len, dur: 0.75 * len, p: [[0, 1.12], [0.2, 1.2], [0.6, 1.14], [1, 1.04]], a: HOOT, v: [[0, 'u'], [0.4, 'o'], [1, 'u']] };
    notes = [{ at: 0, dur: 0.6 * len, p: [[0, 0.96], [0.3, 1.04], [1, 0.95]], a: HOOT, v: 'u', lv: 0.85 }, { at: 0.75 * len, dur: 0.18 * len, p: [[0, 1], [1, 1.02]], a: HOOT, v: 'u', lv: 0.7 }, long];
  } else {
    // Hoots coming quicker and quicker, up into a long one.
    notes = [];
    let at = 0;
    let gap = 0.3;
    for (let i = 0; i < 5; i++) {
      const s = 0.95 + 0.05 * i;
      notes.push({ at: at * len, dur: Math.min(0.12, 0.75 * gap) * len, p: [[0, s * 0.95], [0.3, s], [1, s * 0.97]], a: HOOT, v: 'u', lv: 0.6 + 0.07 * i });
      at += gap;
      gap *= 0.72;
    }
    long = { at: (at + 0.05) * len, dur: 0.8 * len, p: [[0, 1.2], [0.2, 1.26], [1, 1.12]], a: HOOT, v: [[0, 'u'], [0.5, 'o'], [1, 'u']] };
    notes.push(long);
  }
  vox(p, { ...v, vibDelay: long.at + 0.2 }, notes, t);
  boom(p, t + long.at, long.dur, v.f * 0.5, 0.5 * w.big);
}

function bellowRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const d = 2.2 * len;
  const notes: Note[] = [];
  let at = 0;
  if (c.grunt > 0.5) {
    for (let i = 0; i < 2; i++) notes.push({ at: i * 0.18 * len, dur: 0.11 * len, p: [[0, 0.88], [1, 0.72]], a: GRUNT, v: 'u', nz: 2.5, ro: 1.5, lv: 0.75 });
    at = 0.4 * len;
  }
  const swell: Pts = [[0, 0], [0.3 + 0.1 * c.gentle, 1], [0.75, 0.85], [1, 0]];
  const k = p.choose([1.3, 0.8, 0.7]);
  if (k === 1) {
    // "MOOO-OOOOO": two pulses, the second higher.
    notes.push(
      { at, dur: 0.42 * d, p: [[0, 0.82], [0.3, 1], [1, 0.9]], a: swell, v: [[0, 'm'], [0.3, 'o'], [1, 'u']] },
      { at: at + 0.5 * d, dur: 0.6 * d, p: [[0, 0.92], [0.3, p.vary(1.12, 0.03)], [0.7, 1.04], [1, 0.72]], a: swell, v: [[0, 'u'], [0.25, 'o'], [0.55, 'a'], [0.85, 'o'], [1, 'u']] },
    );
  } else {
    notes.push({ at, dur: k === 2 ? 0.85 * d : d, p: [[0, 0.8], [0.2, 1], [0.45, p.vary(1.12, 0.03)], [0.7, 1.05], [1, 0.72]], a: swell, v: [[0, 'm'], [0.15, 'u'], [0.4, 'o'], [0.6, 'a'], [0.85, 'o'], [1, 'u']] });
  }
  const last = notes[notes.length - 1];
  vox(p, { ...v, grit: clamp(v.grit * 1.3), vibDelay: last.at + 0.5 * last.dur }, notes, t);
  thump(p, w, t + last.at, v.f * 0.5, 0.25);
  // A snort to finish.
  if (k === 2) nose(p, t + last.at + last.dur + 0.05, [[0, 0.22 * len, 0.9]], w.size, 0.6);
}

function honkRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const o: Vowel = c.round > 0.5 ? 'u' : 'o';
  switch (p.choose([1.2, 0.8, 0.8])) {
    case 0: {
      // "hon-HOOOONK": a pickup a fourth below, then a long vibrato honk that falls off at the end.
      const at = 0.3 * len;
      vox(p, { ...v, vibDelay: at + 0.35 }, [
        { at: 0, dur: 0.24 * len, p: [[0, 0.72], [0.15, 0.75], [1, 0.75]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], v: o, lv: 0.7 },
        { at, dur: 1.9 * len, p: [[0, 0.95], [0.04, 1], [0.85, 1], [1, 0.88]], a: [[0, 0], [0.04, 1], [0.2, 0.88], [0.8, 0.8], [1, 0]], v: [[0, o], [0.5, 'a'], [1, o]] },
      ], t);
      break;
    }
    case 1:
      // "HONK... HOOOONK": two long honks, the second a step higher.
      vox(p, { ...v, vibDelay: 0.3 }, [
        { at: 0, dur: 0.8 * len, p: [[0, 0.93], [0.06, 1], [0.85, 1], [1, 0.9]], a: [[0, 0], [0.06, 1], [0.3, 0.85], [0.85, 0.75], [1, 0]], v: o, lv: 0.85 },
        { at: 0.95 * len, dur: 1.2 * len, p: [[0, 1.05], [0.05, 1.12], [0.85, 1.1], [1, 0.95]], a: [[0, 0], [0.05, 1], [0.25, 0.88], [0.85, 0.78], [1, 0]], v: [[0, o], [0.5, 'a'], [1, o]] },
      ], t);
      break;
    default:
      // "honk-honk-HOOOONK", climbing.
      vox(p, { ...v, vibDelay: 1.1 * len }, [
        { at: 0, dur: 0.22 * len, p: [[0, 0.9], [1, 0.9]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], v: o, lv: 0.7 },
        { at: 0.32 * len, dur: 0.22 * len, p: [[0, 1], [1, 1]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], v: o, lv: 0.8 },
        { at: 0.64 * len, dur: 1.5 * len, p: [[0, 1.12], [0.04, 1.2], [0.85, 1.18], [1, 1.02]], a: [[0, 0], [0.04, 1], [0.2, 0.88], [0.8, 0.8], [1, 0]], v: [[0, o], [0.5, 'a'], [1, o]] },
      ], t);
  }
}

function trillRoar(p: Patch, w: Who, t: number) {
  const { v, len } = w;
  switch (p.choose([1.2, 0.8, 0.8])) {
    case 0:
      // "chirr-chirr-CHEE-rrrrr".
      vox(p, v, [
        { at: 0, dur: 0.2 * len, p: [[0, 0.95], [1, 1.05]], tr: 0.9, v: 'e', lv: 0.7 },
        { at: 0.26 * len, dur: 0.2 * len, p: [[0, 1.05], [1, 1.15]], tr: 0.9, v: 'e', lv: 0.8 },
        { at: 0.52 * len, dur: 0.14 * len, p: [[0, 1.1], [1, 1.7]], a: BLIP, tr: 0, v: 'i', lv: 0.9 },
        { at: 0.72 * len, dur: 0.65 * len, p: [[0, 1.55], [0.3, 1.45], [1, 0.95]], tr: [[0, 0.5], [1, 1]], v: [[0, 'i'], [1, 'e']] },
      ], t);
      break;
    case 1:
      // A cascade: four trills tumbling down.
      vox(p, v, [0, 1, 2, 3].map((i): Note => ({ at: i * 0.3 * len, dur: 0.26 * len, p: [[0, 1.5 - 0.12 * i], [1, 1.3 - 0.12 * i]], a: [[0, 0], [0.1, 1], [0.8, 0.8], [1, 0]], tr: 0.95, v: [[0, 'i'], [1, 'e']], lv: 1 - 0.1 * i })), t);
      break;
    default:
      // Trills climbing, then a long whistle.
      vox(p, v, [
        { at: 0, dur: 0.22 * len, p: [[0, 0.9], [1, 1]], tr: 0.9, v: 'e', lv: 0.7 },
        { at: 0.28 * len, dur: 0.22 * len, p: [[0, 1.05], [1, 1.15]], tr: 0.9, v: 'e', lv: 0.8 },
        { at: 0.56 * len, dur: 0.22 * len, p: [[0, 1.2], [1, 1.3]], tr: 0.9, v: 'i', lv: 0.9 },
        { at: 0.84 * len, dur: 0.5 * len, p: [[0, 1.4], [0.3, 1.6], [1, 1.35]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], tr: 0, v: [[0, 'i'], [1, 'e']] },
      ], t);
  }
}

function chitterRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const s = Math.max(0.75, len);
  const notes: Note[] = [];
  const onsets: number[] = [];
  const squeal = (at: number): Note => ({ at, dur: 0.42 * s, p: [[0, 1.25], [0.25, p.vary(1.75, 0.03)], [0.7, 1.65], [1, 1.4]], a: [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]], v: [[0, 'e'], [0.3, 'i'], [1, 'e']], tr: 0 });
  const chatter = (at0: number, n: number, rise: number) => {
    let at = at0;
    let gap = 0.075 * s;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      notes.push(chip(at, 0.024 * s, (i % 2 ? 1.12 : 1.26) * (1 + rise * k), (i % 2 ? 0.98 : 1.04) * (1 + rise * k), 0.65 + 0.35 * k));
      onsets.push(at);
      at += gap;
      gap = Math.max(0.03 * s, gap * 0.9);
    }
    return at;
  };
  switch (p.choose([1.2, 0.8, 0.5 + (1 - c.click)])) {
    case 0:
      // "ki-ki-kikikikiki-KEEEE!": chatter speeding up and climbing into a squeal.
      notes.push(squeal(chatter(0, 11 + Math.floor(p.r(0, 3.99)), 0.25) + 0.03 * s));
      break;
    case 1: {
      // The squeal first, then chatter tumbling down.
      notes.push(squeal(0));
      chatter(0.5 * s, 10, -0.2);
      break;
    }
    default: {
      // Three chirrups climbing, then the squeal.
      for (let i = 0; i < 3; i++) {
        const at = i * 0.24 * s;
        const r = 1 + 0.1 * i;
        notes.push({ at, dur: 0.16 * s, p: [[0, 0.9 * r], [0.3, 1.25 * r], [1, 1.15 * r]], a: BLIP, tr: [[0, 0], [0.3, 0.9], [1, 0.9]], v: [[0, 'e'], [1, 'i']], lv: 0.7 + 0.1 * i });
        onsets.push(at);
      }
      notes.push(squeal(0.76 * s));
    }
  }
  vox(p, { ...v, trill: 0.85, vib: 30, vibHz: 9, vibDelay: 0.6 * s }, notes, t);
  accent(p, w, t, onsets, 0.9);
}

function croakRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const h = c.huge;
  const caw = (at: number, dur: number, top: number, l: number): Note => ({ at, dur, p: [[0, top * 0.95], [0.15, top * 1.08], [1, top * 0.8]], a: CAW, v: [[0, 'ae'], [0.35, 'a'], [1, 'o']], ro: 1.2, lv: l });
  const long = (at: number, dur: number, top: number): Note => ({ at, dur, p: [[0, top * 0.9], [0.1, top * p.vary(1.18, 0.03)], [0.4, top * 1.05], [1, top * 0.7]], a: [[0, 0], [0.04, 1], [0.5, 0.8], [0.85, 0.5], [1, 0]], v: [[0, 'ae'], [0.2, 'a'], [0.7, 'o'], [1, 'u']], fl: [[0, 0.1], [0.5, 0.3], [1, 0.7]], ro: [[0, 1], [1, 1.6]] });
  switch (p.choose([1.2, 0.8 + 1.2 * h, 1.5 - h])) {
    case 0: {
      // "kra-kra-kra-KRAAAAAHH": caws rising in urgency, then a long harsh one.
      const notes = [caw(0, 0.2 * len, 0.95, 0.7), caw(0.3 * len, 0.22 * len, 1, 0.8), caw(0.62 * len, 0.24 * len, 1.05, 0.9), long(0.98 * len, 0.95 * len, 1.1)];
      vox(p, v, notes, t);
      accent(p, w, t, notes.map((n) => n.at));
      break;
    }
    case 1:
      // A long, deep "KROOOAAAK", period-doubled, with a throat boom under it.
      vox(p, { ...v, subh: clamp(v.subh + 0.25) }, [long(0, 1.5 * len, 0.9)], t);
      boom(p, t, 1.2 * len, v.f * 0.45, 0.35 * w.big);
      accent(p, w, t);
      break;
    default: {
      // Caws, a long one, and the bill clattering after it.
      const notes = [caw(0, 0.22 * len, 1, 0.8), caw(0.32 * len, 0.24 * len, 1.04, 0.9), long(0.68 * len, 0.9 * len, 1.08)];
      vox(p, v, notes, t);
      accent(p, w, t, notes.map((n) => n.at));
      rattle(p, t + 1.62 * len, 0.45 * len, p.r(14, 19), 1.5, lerp(1900, 1300, h) * w.size, 4);
    }
  }
}

function rumbleRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const notes: Note[] = [];
  let at = 0;
  let dur = 1.8 * len;
  const k = p.choose([1.2, 0.8, 0.6 + c.nasal]);
  if (k === 1) {
    // Three pulses climbing before the long one.
    for (let i = 0; i < 3; i++) notes.push({ at: i * 0.32 * len, dur: 0.24 * len, p: [[0, 0.88 + 0.04 * i], [1, 0.92 + 0.04 * i]], a: HUM, v: 'm', lv: 0.6 + 0.1 * i });
    at = 1 * len;
    dur = 1.45 * len;
  } else {
    notes.push({ at: 0, dur: 0.55 * len, p: [[0, 0.92], [1, 0.98]], a: HUM, v: [[0, 'm'], [1, 'u']], lv: 0.7 });
    at = 0.62 * len;
    if (k === 2) dur = 1.25 * len;
  }
  // "HRRROOOOOmmm": the mouth opens a little at the top, then closes into a hum; the flutter slows.
  const open: Vowel = k === 2 ? 'a' : 'o';
  notes.push({ at, dur, p: [[0, 0.9], [0.25, p.vary(1.1, 0.03)], [0.6, 1.04], [1, 0.8]], a: [[0, 0], [0.25, 1], [0.7, 0.85], [1, 0]], v: [[0, 'm'], [0.2, 'u'], [0.35, open], [0.65, 'o'], [0.85, 'u'], [1, 'm']], fl: [[0, v.flutter], [1, clamp(v.flutter * 1.8, 0, 0.8)]], nz: [[0, 1], [0.3, 1.8], [1, 1]] });
  // ...and sometimes an answer: a shorter one that rises, "hmm-HMMM?".
  if (k === 2) notes.push({ at: at + dur + 0.1 * len, dur: 0.6 * len, p: [[0, 0.85], [0.6, 1], [1, 1.08]], a: HUM, v: [[0, 'm'], [0.5, 'u'], [1, 'm']], lv: 0.75 });
  const last = notes[notes.length - 1];
  vox(p, { ...v, vibDelay: at + 0.4 * dur }, notes, t);
  air(p, t, last.at + last.dur, 0.45 * lerp(0.4, 1, w.big), 80 + 60 * c.nasal, [[0, 0], [0.4, 0.6], [0.7, 1], [1, 0]]);
  thump(p, w, t + at, v.f * 0.8, 0.3);
  boom(p, t + at, dur, Math.max(40, v.f * (v.f < 90 ? 1 : 0.5)), 0.3 * w.big, HUM, [[0, 0.95], [0.3, 1.05], [1, 0.85]]);
}

function gruntRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const notes: Note[] = [];
  let at: number;
  const k = p.choose([1.2, 0.6 + c.quick, 0.6 + c.deep]);
  if (k === 1) {
    // Grunts coming faster and faster into the roar.
    let gap = 0.22 * len;
    at = 0;
    for (let i = 0; i < 6; i++) {
      notes.push(grunt1(w, at, 0.08 * len, 0.95 + 0.02 * i, 0.6 + 0.05 * i, 'uh'));
      at += gap;
      gap *= 0.84;
    }
    at += 0.04 * len;
  } else if (k === 2) {
    // A snort, a long honking grunt, then the roar.
    nose(p, t, [[0, 0.16 * len, 1]], w.size, 0.5);
    notes.push({ at: 0.22 * len, dur: 0.42 * len, p: [[0, 0.88], [0.3, 0.96], [1, 0.8]], a: [[0, 0], [0.12, 1], [0.6, 0.8], [1, 0]], v: [[0, 'u'], [0.4, 'o'], [1, 'n']], ro: 1.3, lv: 0.8 });
    at = 0.78 * len;
  } else {
    nose(p, t, [[0, 0.16 * len, 1]], w.size, 0.5);
    notes.push(grunt1(w, 0.22 * len, 0.13 * len, 1, 0.75), grunt1(w, 0.45 * len, 0.14 * len, 1.02, 0.85));
    at = 0.7 * len;
  }
  // "HRRAAAWNNH": a long roaring grunt that rattles and falls away.
  const dur = (k === 2 ? 1.3 : 1.15) * len;
  notes.push({ at, dur, p: [[0, 0.85], [0.12, p.vary(1.1, 0.03)], [0.5, 1], [1, 0.7]], a: [[0, 0], [0.08, 1], [0.6, 0.85], [1, 0]], v: [[0, 'uh'], [0.15, 'a'], [0.65, 'o'], [1, 'n']], fl: [[0, v.flutter], [1, clamp(v.flutter + 0.4, 0, 0.85)]], ro: [[0, 1], [1, 1.6]], nz: 1.3 });
  vox(p, { ...v, subh: clamp(v.subh + 0.15 * c.deep) }, notes, t);
  thump(p, w, t + at, v.f * 0.5, 0.25);
  nose(p, t + at + dur + 0.04, [[0, 0.18 * len, 0.8]], w.size, 0.7);
}

function cooRoar(p: Patch, w: Who, t: number) {
  const { v, len, c } = w;
  const notes: Note[] = [];
  const k = p.choose([0.6 + 1.4 * c.boom, 1.6 - c.boom, 0.8]);
  if (k === 0) {
    // Drumming: booms quicker and quicker, then a long rolling coo.
    let at = 0;
    let gap = 0.34 * len;
    for (let i = 0; i < 7; i++) {
      const d = Math.min(0.12 * len, 0.75 * gap);
      notes.push({ at, dur: d, p: [[0, 0.84], [0.3, 0.88], [1, 0.83]], a: HOOT, v: 'u', tr: 0, lv: 0.6 + 0.05 * i });
      if (w.big > 0.3) boom(p, t + at, d * 1.1, v.f * 0.42, 0.35 * w.big);
      at += gap;
      gap = Math.max(0.1 * len, gap * 0.8);
    }
    notes.push({ at: at + 0.05 * len, dur: 0.8 * len, p: [[0, 0.9], [0.3, 1.1], [1, 0.95]], a: [[0, 0], [0.1, 0.8], [0.35, 1], [1, 0]], tr: [[0, 0.9], [0.3, 0.8], [0.4, 0], [1, 0]], v: [[0, 'u'], [0.5, 'o'], [1, 'u']] });
  } else if (k === 1) {
    // A long rolled "crrrOOOOO", then "coo-coo".
    notes.push(
      { at: 0, dur: 1.1 * len, p: [[0, 0.88], [0.25, 1.12], [0.6, 1.08], [1, 0.95]], a: [[0, 0], [0.1, 0.7], [0.35, 1], [0.8, 0.8], [1, 0]], tr: [[0, 0.9], [0.3, 0.85], [0.42, 0], [1, 0]], v: [[0, 'u'], [0.4, 'o'], [1, 'u']] },
      { at: 1.25 * len, dur: 0.14 * len, p: [[0, 1], [1, 0.97]], a: HOOT, v: 'u', tr: 0, lv: 0.75 },
      { at: 1.5 * len, dur: 0.16 * len, p: [[0, 0.95], [1, 0.9]], a: HOOT, v: 'u', tr: 0, lv: 0.65 },
    );
  } else {
    // Three long booming coos, stepping down.
    for (let i = 0; i < 3; i++) {
      const at = i * 0.62 * len;
      notes.push({ at, dur: 0.48 * len, p: [[0, 1.02 - 0.06 * i], [0.3, 1.1 - 0.06 * i], [1, 0.98 - 0.06 * i]], a: HOOT, v: [[0, 'u'], [0.5, 'o'], [1, 'u']], tr: 0, lv: 1 - 0.1 * i });
      if (w.big > 0.3) boom(p, t + at, 0.48 * len, v.f * 0.45, 0.4 * w.big);
    }
  }
  vox(p, { ...v, trill: 0.85, vibDelay: 0.3 }, notes, t);
}

const ROARS: Record<VoiceKind, (p: Patch, w: Who, t: number) => void> = {
  roar: roarRoar,
  screech: screechRoar,
  hoot: hootRoar,
  bellow: bellowRoar,
  honk: honkRoar,
  trill: trillRoar,
  chitter: chitterRoar,
  croak: croakRoar,
  rumble: rumbleRoar,
  grunt: gruntRoar,
  coo: cooRoar,
};

/** The big signature call: game starts, growing up, showing off. */
function roar(p: Patch, w: Who, t = p.t) {
  ROARS[w.kind](p, w, t);
}

// ---------------- small vocal noises ----------------

function chirp(p: Patch, w: Who, t = p.t, lv = 1) {
  const [m0, m1] = w.baby > 0.5 ? (['e', 'i'] as const) : MOUTH[w.kind];
  const tempo = TEMPO[w.kind];
  const d = lerp(0.1, 0.14, w.big) * tempo * p.vary(1, 0.1);
  const up = p.vary(1.3, 0.08);
  const trilly = w.kind === 'trill' || w.kind === 'chitter' || w.kind === 'coo';
  const tr = w.kind === 'trill' ? 0.6 : 0;
  const v = tame(w.v, 0.45);
  const first: Note = { at: 0, dur: d, p: [[0, 1.12], [1, 1.12 * up]], a: BLIP, v: [[0, m0], [1, m1]], tr, lv };
  const notes: Note[] = [];
  switch (p.choose([1, 1, trilly ? 1.2 : 0.5, 0.8])) {
    case 0:
      // "mip!"
      notes.push(first);
      break;
    case 1:
      // "chirp-chirp".
      notes.push(first, { at: d + 0.04 * tempo, dur: d * 0.8, p: [[0, 1.2], [1, 1.3 * up]], a: BLIP, v: m1, tr, lv: 0.8 * lv });
      break;
    case 2:
      // "prrrip": a trilled chirrup.
      set(v, { trill: 0.8 });
      notes.push({ at: 0, dur: d * 1.6, p: [[0, 1], [0.7, 1.15], [1, 1.3 * up]], a: BLIP, tr: [[0, 0.9], [0.65, 0.7], [0.8, 0]], v: [[0, m0], [1, m1]], lv: 1.3 * lv });
      break;
    default:
      // "mrrp?": a dip, then up.
      notes.push({ at: 0, dur: d * 1.5, p: [[0, 1.06], [0.4, 0.93], [1, 1.28 * up]], a: [[0, 0], [0.2, 1], [0.7, 0.85], [1, 0]], v: [[0, m0], [0.4, m0], [1, m1]], tr, lv });
  }
  vox(p, v, notes, t);
  accent(p, w, t, notes.map((n) => n.at), lv);
}

function happy(p: Patch, w: Who) {
  const [m0, m1] = MOUTH[w.kind];
  const tempo = TEMPO[w.kind];
  const slow = tempo > 1.05;
  const tr = w.kind === 'trill' ? 0.7 : 0;
  const d = (slow ? 0.13 : 0.09) * lerp(0.85, 1.1, w.big) * p.vary(1, 0.08) * (w.kind === 'chitter' ? 0.65 : 1);
  const v = tame(w.v, 0.4);
  let notes: Note[];
  const warbly = w.kind === 'trill' || w.kind === 'coo' || w.kind === 'chitter' || w.kind === 'hoot';
  switch (p.choose([1, 0.9, warbly ? 1 : 0.5])) {
    case 0: {
      // Rising steps (a twitter for chitterers).
      const steps = slow ? [1.05, 1.3] : w.kind === 'chitter' ? [1.05, 1.15, 1.25, 1.4, 1.55] : [1.05, 1.25, 1.55];
      notes = steps.map((s, i) => ({ at: i * (d + 0.035), dur: d * (i === steps.length - 1 ? 1.4 : 1), p: [[0, s], [1, s * 1.08]], a: BLIP, v: m1, tr, lv: 0.8 + 0.1 * i }));
      break;
    }
    case 1: {
      // A giggle: bouncy notes, up and down.
      const pat = slow ? [1.2, 1.05, 1.3] : [1.25, 1.1, 1.3, 1.12, 1.4];
      const dd = d * 0.8;
      notes = pat.map((s, i) => ({ at: i * (dd + 0.03), dur: dd, p: [[0, s * 0.96], [0.5, s * 1.04], [1, s]], a: BLIP, v: i % 2 ? m1 : m0, tr, lv: 0.75 + 0.05 * i }));
      break;
    }
    default:
      // A warble: one note trilling as it rises.
      set(v, { trill: 0.7 });
      notes = [{ at: 0, dur: d * 3.2, p: [[0, 1.05], [0.6, 1.3], [1, 1.45]], a: [[0, 0], [0.1, 1], [0.8, 0.9], [1, 0]], tr: [[0, 0.8], [0.8, 0.6], [1, 0]], v: [[0, m0], [1, m1]], lv: 0.9 }];
  }
  vox(p, v, notes);
  accent(p, w, p.t, notes.map((n) => n.at), 0.8);
}

function squeak(p: Patch, w: Who) {
  const d = lerp(0.13, 0.2, w.big) * p.vary(1, 0.1) * (w.kind === 'chitter' ? 0.7 : 1);
  const v = tame(w.v, 0.35);
  switch (p.choose([1.2, 0.8, 0.7])) {
    case 0:
      // "eep!"
      vox(p, v, [{ at: 0, dur: d, p: [[0, 1.4], [0.55, 2], [1, 1.85]], a: [[0, 0], [0.08, 1], [0.6, 0.8], [1, 0]], v: [[0, 'e'], [0.5, 'i']], tr: 0 }]);
      break;
    case 1:
      // "ee-eep!"
      vox(p, v, [
        { at: 0, dur: d * 0.55, p: [[0, 1.5], [1, 1.75]], a: BLIP, v: 'e', tr: 0, lv: 0.75 },
        { at: d * 0.7, dur: d * 0.8, p: [[0, 1.6], [0.6, 2.05], [1, 1.9]], a: BLIP, v: [[0, 'e'], [1, 'i']], tr: 0 },
      ]);
      break;
    default:
      // "wheee!": surprised, wavering.
      vox(p, { ...v, vib: 45, vibHz: 9, vibDelay: 0.03 }, [{ at: 0, dur: d * 1.5, p: [[0, 1.3], [0.35, 2], [1, 1.75]], a: [[0, 0], [0.1, 1], [0.8, 0.8], [1, 0]], v: [[0, 'u'], [0.3, 'i'], [1, 'e']], tr: 0, lv: 0.8 }]);
  }
}

function growl(p: Patch, w: Who) {
  const t = p.t;
  const b = w.v;
  const v: Vox = { ...b, grit: clamp(b.grit * 1.3 + 0.15), noise: b.noise * 1.3 + 0.05, flutter: clamp(b.flutter + 0.3, 0, 0.85), rough: clamp(b.rough + 0.2), trill: 0 };
  let pitch = 0.72;
  let mouth: Vowels = [[0, 'u'], [0.3, 'o'], [0.8, 'o'], [1, 'u']];
  switch (w.kind) {
    case 'trill':
      // A raspy "chrrr".
      set(v, { flutter: 0.8, flutterHz: 42, noise: b.noise + 0.2 });
      pitch = 1;
      mouth = 'e';
      break;
    case 'hoot':
      set(v, { flutter: 0.45, flutterHz: 18, ring: 0.3, level: v.level * 1.5 });
      break;
    case 'screech':
      set(v, { rasp: b.rasp * 1.5 });
      break;
    case 'chitter':
      // An angry "tchtchtch" chatter.
      set(v, { flutter: 0.85, flutterHz: 55, noise: b.noise + 0.3 });
      pitch = 0.9;
      mouth = [[0, 'e'], [1, 'ae']];
      break;
    case 'croak':
      // A rattling "krrrrr".
      set(v, { flutter: 0.7, flutterHz: 28, subh: clamp(b.subh + 0.25) });
      pitch = 0.8;
      mouth = [[0, 'a'], [0.5, 'o'], [1, 'o']];
      break;
    case 'rumble':
      set(v, { flutter: 0.55, flutterHz: 11 });
      pitch = 0.85;
      mouth = [[0, 'm'], [0.5, 'u'], [1, 'm']];
      break;
    case 'grunt':
      pitch = 0.78;
      mouth = [[0, 'uh'], [0.4, 'o'], [1, 'n']];
      break;
    case 'coo':
      set(v, { flutter: 0.5, flutterHz: 20, noise: b.noise + 0.15 });
      pitch = 0.8;
      mouth = 'u';
      break;
  }
  const d = lerp(0.5, 0.85, w.big) * p.vary(1, 0.1);
  switch (p.choose([1.2, 0.8, 0.7])) {
    case 0:
      vox(p, v, [{ at: 0, dur: d, p: [[0, pitch], [0.3, pitch * 1.1], [0.7, pitch * 1.05], [1, pitch * 0.92]], a: [[0, 0], [0.15, 0.85], [0.45, 1], [0.8, 0.75], [1, 0]], v: mouth }]);
      break;
    case 1:
      // Rising, then a snap of the jaws (or beak).
      vox(p, v, [{ at: 0, dur: d * 0.9, p: [[0, pitch * 0.92], [0.7, pitch * 1.18], [1, pitch * 1.1]], a: [[0, 0], [0.3, 0.7], [0.8, 1], [1, 0]], v: mouth }]);
      ticks(p, t, [d * 0.92], lerp(2600, 1300, w.big), 1.2, 3, 0.02);
      break;
    default:
      // "grr... GRRRR": a warning, then the real thing.
      vox(p, v, [
        { at: 0, dur: d * 0.35, p: [[0, pitch], [1, pitch * 1.02]], a: [[0, 0], [0.3, 0.8], [1, 0]], v: mouth, lv: 0.7 },
        { at: d * 0.45, dur: d * 0.7, p: [[0, pitch * 1.02], [0.4, pitch * 1.12], [1, pitch * 0.95]], a: [[0, 0], [0.2, 1], [0.8, 0.8], [1, 0]], v: mouth },
      ]);
  }
  if (w.c.rattle > 0) rattle(p, t + 0.1 * d, 0.9 * d, lerp(55, 40, w.big), 0.8 * w.c.rattle);
  if (w.c.croc > 0) hiss(p, t + 0.4 * d, 0.7 * d, 0.12 * w.c.croc);
  if (w.kind === 'coo') hiss(p, t + 0.1 * d, 0.8 * d, 0.08, 2800);
  if (w.kind === 'grunt') nose(p, t, [[0, 0.12, 0.8]], w.size, 0.5);
  if (w.kind === 'croak' && p.chance(0.5)) rattle(p, t + 0.95 * d, 0.3, p.r(14, 19), 1.2, lerp(1900, 1300, w.c.huge) * w.size, 4);
}

function purr(p: Patch, w: Who) {
  const b = w.v;
  const v: Vox = { ...b, grit: 0, rasp: 0, trill: 0, vib: 0, rough: b.rough * 0.3, subh: 0, noise: b.noise * 0.5 + 0.04, flutter: 0.65, flutterHz: lerp(32, 24, w.big) * p.vary(1, 0.04) };
  let pitch = 0.55;
  let mouth: Vowels = 'u';
  switch (w.kind) {
    case 'trill':
    case 'chitter':
      set(v, { flutter: 0.7, flutterHz: w.kind === 'chitter' ? 40 : 30 });
      pitch = w.kind === 'chitter' ? 0.75 : 0.85;
      mouth = 'e';
      break;
    case 'hoot':
    case 'coo':
      set(v, { flutter: 0.35, flutterHz: w.kind === 'coo' ? 22 : 14 });
      pitch = w.kind === 'coo' ? 0.85 : 0.75;
      break;
    case 'bellow':
    case 'honk':
    case 'rumble':
      set(v, { flutter: 0.4, flutterHz: w.kind === 'rumble' ? 11 : 17, level: v.level * (w.kind === 'rumble' ? 0.6 : 1) });
      pitch = w.kind === 'rumble' ? 0.95 : 0.7;
      mouth = 'm';
      break;
    case 'screech':
      pitch = 0.5;
      break;
    case 'croak':
      set(v, { flutter: 0.55, flutterHz: 24, level: v.level * 1.6 });
      pitch = 0.62;
      mouth = 'o';
      break;
    case 'grunt':
      set(v, { flutter: 0.5, flutterHz: 16 });
      pitch = 0.68;
      mouth = 'm';
      break;
  }
  // Symmetric fades, so purrs repeated every second cross-fade seamlessly.
  // Not below ~80 Hz, so small speakers can still play it.
  pitch = Math.max(pitch, 80 / v.f);
  const d = lerp(1.1, 1.35, w.big);
  vox(p, v, [{ at: 0, dur: d, p: [[0, pitch], [0.5, pitch * 1.06], [1, pitch]], a: [[0, 0], [0.28, 1], [0.72, 1], [1, 0]], v: mouth }]);
}

function yawn(p: Patch, w: Who) {
  const b = w.v;
  const v: Vox = { ...b, grit: b.grit * 0.25, noise: b.noise * 1.5 + 0.15, rough: b.rough * 0.4, subh: 0, flutter: b.flutter * 0.3, rasp: b.rasp * 0.3, trill: 0 };
  const d = lerp(0.8, 1.35, w.big) * p.vary(1, 0.08) * (w.kind === 'rumble' ? 1.1 : w.kind === 'chitter' ? 0.8 : 1);
  const notes: Note[] = [{ at: 0, dur: d, p: [[0, 1.15], [0.25, p.vary(1.28, 0.05)], [0.7, 0.92], [1, 0.72]], a: [[0, 0], [0.22, 0.8], [0.5, 1], [0.82, 0.5], [1, 0]], v: [[0, 'e'], [0.2, 'a'], [0.6, 'a'], [0.85, 'o'], [1, 'm']], nz: [[0, 1.6], [0.5, 1], [1, 1.3]] }];
  // Now and then (hatchlings more often) it ends in a tiny squeak.
  const squeaky = p.chance(0.15 + 0.5 * w.baby);
  if (squeaky) notes.push({ at: d + 0.02, dur: 0.09, p: [[0, 1.5], [1, 1.9]], a: BLIP, v: 'i', lv: 0.45 });
  vox(p, v, notes);
  // A sleepy lip smack.
  const end = p.t + d + (squeaky ? 0.13 : 0);
  const f = lerp(2400, 1300, w.big);
  burst(p, p.out, end + 0.06, 'bandpass', f, 1.5, 0.12, 0.002, 0.02);
  if (p.chance(0.7)) burst(p, p.out, end + 0.11, 'bandpass', f * 1.2, 1.5, 0.08, 0.002, 0.018);
}

function sneeze(p: Patch, w: Who) {
  const v: Vox = { ...w.v, grit: w.v.grit * 0.3, noise: w.v.noise + 0.25, rough: 0, subh: 0, flutter: 0, trill: 0, rasp: 0 };
  const d = lerp(0.6, 1, w.big) * p.vary(1, 0.08);
  const k = p.choose([1.2, 0.6, 0.4 + 0.8 * w.baby]);
  const choo = k === 0 ? 0.52 * d : 0.08 * d;
  const tch = (at: number, lv: number) => {
    // The "tch": an explosive burst of air.
    burst(p, p.out, p.t + at, 'bandpass', lerp(4200, 3000, w.big), 1.1, 0.8 * lv, 0.003, 0.1);
    hiss(p, p.t + at, 0.3 * d, 0.2 * lv, lerp(3500, 2200, w.big));
  };
  const notes: Note[] = [];
  if (k === 0) {
    // "ah-ah-CHOO".
    notes.push({ at: 0, dur: 0.17 * d, p: [[0, 1.1], [1, 1.3]], a: [[0, 0], [0.5, 1], [1, 0]], v: [[0, 'a'], [1, 'e']], lv: 0.35, nz: 2.2 }, { at: 0.27 * d, dur: 0.15 * d, p: [[0, 1.25], [1, 1.5]], a: [[0, 0], [0.5, 1], [1, 0]], v: [[0, 'a'], [1, 'e']], lv: 0.45, nz: 2.2 });
  }
  notes.push({ at: choo + 0.015, dur: 0.24 * d, p: [[0, 1.45], [0.3, 1.3], [1, 0.9]], a: [[0, 0], [0.06, 1], [0.3, 0.6], [1, 0]], v: [[0, 'i'], [0.3, 'u'], [1, 'u']], lv: 0.9, nz: 3 });
  tch(choo, 1);
  if (k === 2) {
    // "tchoo-tchoo!": a second, smaller one.
    const at2 = choo + 0.34 * d;
    notes.push({ at: at2 + 0.015, dur: 0.2 * d, p: [[0, 1.55], [0.3, 1.4], [1, 1]], a: [[0, 0], [0.06, 1], [0.3, 0.6], [1, 0]], v: [[0, 'i'], [0.3, 'u'], [1, 'u']], lv: 0.7, nz: 3 });
    tch(at2, 0.7);
  }
  vox(p, v, notes);
}

function snore(p: Patch, w: Who) {
  const t = p.t;
  const d = lerp(1.1, 1.8, w.big) * p.vary(1, 0.08);
  // In: a fluttering soft palate over a low hum.
  const inhale = 0.55 * d;
  const fl = lerp(38, 26, w.big) * p.vary(1, 0.12);
  const vca = p.gain(0);
  line(vca.gain, t, inhale, [[0, 0], [0.6, 1], [0.9, 0.8], [1, 0]], 0.9);
  const flap = p.gain(0.575);
  p.osc('sine', fl, t, t + inhale).connect(p.gain(0.425)).connect(flap.gain);
  p.noise(t, t + inhale).connect(p.filter('bandpass', lerp(900, 380, w.big) * p.vary(1, 0.1), 1.8)).connect(vca).connect(flap).connect(p.out);
  vox(p, { ...tame(w.v, 0.3), flutter: 0.8, flutterHz: fl, trill: 0, sub: 0 }, [{ at: 0, dur: inhale, p: [[0, 0.5], [1, 0.55]], a: [[0, 0], [0.6, 1], [0.9, 0.8], [1, 0]], v: 'u', lv: w.kind === 'rumble' ? 0.15 : 0.3 }]);
  // Out: a breathy sigh; hatchlings (and now and then adults) add a tiny whistle.
  const out = t + inhale + 0.12 * d;
  const ex = 0.33 * d;
  const g = p.gain(0);
  line(g.gain, out, ex, [[0, 0], [0.2, 1], [1, 0]], 0.35);
  p.noise(out, out + ex).connect(p.filter('bandpass', lerp(2200, 1100, w.big), 0.7)).connect(g).connect(p.out);
  if (w.baby > 0.3 || p.chance(0.25)) {
    const wg = p.gain(0);
    line(wg.gain, out, ex, [[0, 0], [0.3, 1], [1, 0]], 0.05 * Math.max(w.baby, 0.5));
    const wf = p.vary(lerp(2200, 1500, w.big), 0.1);
    const o = p.osc('sine', wf, out, out + ex);
    glide(o.frequency, out, ex, [[0, 1], [1, p.r(0.75, 0.9)]], wf);
    o.connect(wg).connect(p.out);
  }
}

function huff(p: Patch, w: Who) {
  const t = p.t;
  const len = lerp(0.75, 1, w.big) * p.vary(1, 0.1);
  switch (p.choose([1, 0.8, 0.7])) {
    case 0:
      // "hff": a short breath out through the nose.
      nose(p, t, [[0, 0.17 * len, 1]], w.size, 0.1);
      break;
    case 1:
      // "hff-hff": effort.
      nose(p, t, [[0, 0.11 * len, 0.8], [0.19 * len, 0.14 * len, 1]], w.size, 0.15);
      break;
    default:
      // "hhaaah": a sigh, breathy and falling.
      vox(p, { ...tame(w.v, 0.3), noise: w.v.noise + 0.5 }, [{ at: 0, dur: 0.5 * len * TEMPO[w.kind], p: [[0, 0.95], [1, 0.78]], a: [[0, 0], [0.25, 1], [1, 0]], v: [[0, 'a'], [1, 'uh']], nz: [[0, 3], [1, 2]], lv: 0.45 }]);
  }
}

function click(p: Patch, w: Who) {
  // Clicking the tongue (or clacking a beak) while thinking: one to three dry clicks, pitched by size.
  const n = p.choose([1, 1, 0.7]) + 1;
  const beak = w.kind === 'croak';
  const chitter = w.kind === 'chitter';
  const gap = (chitter ? 0.045 : beak ? 0.11 : 0.085) * p.vary(1, 0.12);
  const times = Array.from({ length: n }, (_, i) => i * gap);
  const f = (chitter ? 5200 : beak ? lerp(2200, 1400, w.c.huge) : lerp(3400, 2300, w.big)) * Math.sqrt(w.size) * p.vary(1, 0.08);
  ticks(p, p.t, times, f, 3.5, beak ? 4 : 3, beak ? 0.014 : 0.008);
  // The hollow "tok" of the mouth (or bill) ringing briefly after each click.
  const tok = f * (beak ? 0.6 : 0.42);
  pings(p, p.out, p.t, times.map((at): Grain => [at + 0.001, 0.35, beak ? 0.035 : 0.025, tok, tok * 0.8]));
  // Now and then a tiny "hm?" after thinking (a plain hum, so it stays cheap).
  if (p.chance(0.25)) {
    const t = p.t + n * gap + 0.05;
    const d = 0.12 * TEMPO[w.kind];
    const o = p.osc('glottal', w.v.f, t, t + d);
    glide(o.frequency, t, d, [[0, 1], [1, 1.25]], w.v.f);
    const g = p.gain(0);
    line(g.gain, t, d, BLIP, 0.25 * w.v.level);
    o.connect(p.filter('lowpass', Math.min(w.v.f * 4, 4000), 0)).connect(g).connect(p.out);
  }
}

function murmur(p: Patch, w: Who) {
  // Sleepy or content: a soft closed-mouth "mmm", an "mm-hm", or a drowsy grumble.
  const d = 0.45 * lerp(0.8, 1.15, w.big) * p.vary(1, 0.1) * Math.sqrt(TEMPO[w.kind]);
  // Not below ~80 Hz, so small speakers can still play it.
  const k = Math.max(1, 80 / (0.8 * w.v.f));
  // A hum well below or above the "mm" resonance (roughly 250-500 Hz) sounds fainter: a little more.
  const hum = 0.95 * k * w.v.f;
  const lift = dB(6 * clamp(Math.log2(250 / hum)) + 5 * clamp(Math.log2(hum / 500)));
  const v: Vox = { ...tame(w.v, 0.3), vib: 0, trill: 0, flutter: 0.3, flutterHz: lerp(16, 11, w.big), level: w.v.level * 0.35 * lift };
  let notes: Note[];
  switch (p.choose([1, 1, 0.8])) {
    case 0:
      notes = [{ at: 0, dur: d, p: [[0, 0.95 * k], [0.3, k], [1, 0.82 * k]], a: HUM, v: [[0, 'm'], [1, 'n']], fl: 0 }];
      break;
    case 1:
      notes = [
        { at: 0, dur: 0.4 * d, p: [[0, 0.95 * k], [1, 0.92 * k]], a: HUM, v: 'm', fl: 0, lv: 0.85 },
        { at: 0.5 * d, dur: 0.6 * d, p: [[0, 1.08 * k], [1, 0.95 * k]], a: HUM, v: 'm', fl: 0 },
      ];
      break;
    default:
      notes = [{ at: 0, dur: 1.15 * d, p: [[0, 0.85 * k], [0.5, 0.9 * k], [1, 0.78 * k]], a: HUM, v: [[0, 'n'], [0.5, 'm'], [1, 'm']], fl: 0.6, lv: 1.25 }];
  }
  vox(p, v, notes);
}

function curious(p: Patch, w: Who) {
  // A questioning "hm?": rising at the end, sometimes trilled ("mrr-rrp?") or two notes ("uh-uh?").
  const [m0, m1] = MOUTH[w.kind];
  const d = lerp(0.16, 0.24, w.big) * TEMPO[w.kind] * p.vary(1, 0.1);
  const v = tame(w.v, 0.45);
  let notes: Note[];
  switch (p.choose([1.2, 0.9, 0.8])) {
    case 0:
      notes = [{ at: 0, dur: d * 1.3, p: [[0, 0.95], [0.45, 0.92], [1, p.vary(1.35, 0.04)]], a: [[0, 0], [0.15, 1], [0.75, 0.9], [1, 0]], v: [[0, m0], [1, m1]], tr: 0 }];
      break;
    case 1:
      set(v, { trill: 0.75 });
      notes = [{ at: 0, dur: d * 1.5, p: [[0, 1], [0.6, 1.05], [1, p.vary(1.4, 0.04)]], a: [[0, 0], [0.12, 1], [0.8, 0.9], [1, 0]], tr: [[0, 0.9], [0.6, 0.6], [0.75, 0]], v: [[0, m0], [1, m1]] }];
      break;
    default:
      notes = [
        { at: 0, dur: d * 0.6, p: [[0, 1], [1, 0.98]], a: BLIP, v: m0, tr: 0, lv: 0.8 },
        { at: d * 0.8, dur: d * 0.8, p: [[0, 1.12], [1, p.vary(1.38, 0.04)]], a: BLIP, v: m1, tr: 0 },
      ];
  }
  vox(p, v, notes);
  accent(p, w, p.t, [0], 0.8);
}

function yelp(p: Patch, w: Who) {
  // A startled cry: a sharp jump up that falls away — "yip!", "yip-yip", or a squealing "eeek".
  const v: Vox = { ...w.v, grit: w.v.grit * 0.6, rough: w.v.rough * 0.7, subh: 0, flutter: 0, trill: 0 };
  const d = lerp(0.14, 0.22, w.big) * p.vary(1, 0.1) * Math.sqrt(TEMPO[w.kind]);
  const yip = (at: number, dur: number, top: number, lv: number): Note => ({ at, dur, p: [[0, top * 0.7], [0.12, top], [1, top * 0.66]], a: BARK, v: [[0, 'i'], [0.4, 'ae'], [1, 'uh']], lv });
  switch (p.choose([1.2, 0.8, 0.6])) {
    case 0:
      vox(p, v, [yip(0, d, p.vary(1.9, 0.04), 1)]);
      break;
    case 1:
      vox(p, v, [yip(0, d * 0.75, 1.8, 0.85), yip(d * 0.95, d * 0.8, 1.9, 1)]);
      break;
    default:
      vox(p, { ...v, rasp: v.rasp + 30, vib: 50, vibHz: 11, vibDelay: 0.03 }, [{ at: 0, dur: d * 1.6, p: [[0, 1.6], [0.2, 2.1], [0.8, 1.9], [1, 1.5]], a: [[0, 0], [0.06, 1], [0.7, 0.8], [1, 0]], v: [[0, 'i'], [0.6, 'e'], [1, 'ae']], lv: 0.6 }]);
  }
}

function whine(p: Patch, w: Who) {
  // Pleading: a thin, nasal whimper that falls and rises again, wavering.
  const v: Vox = { ...tame(w.v, 0.25), body: Math.max(w.v.body, 0.5), vib: 30, vibHz: 6.5, vibDelay: 0.05, trill: 0, level: w.v.level * 0.35 };
  const d = lerp(0.4, 0.6, w.big) * p.vary(1, 0.1) * Math.sqrt(TEMPO[w.kind]);
  let notes: Note[];
  switch (p.choose([1.2, 0.9, 0.7])) {
    case 0:
      notes = [{ at: 0, dur: d, p: [[0, 1.5], [0.45, 1.3], [1, p.vary(1.55, 0.03)]], a: [[0, 0], [0.15, 1], [0.8, 0.8], [1, 0]], v: [[0, 'n'], [0.3, 'i'], [1, 'e']] }];
      break;
    case 1:
      notes = [
        { at: 0, dur: 0.4 * d, p: [[0, 1.45], [1, 1.3]], a: [[0, 0], [0.2, 1], [1, 0]], v: [[0, 'n'], [1, 'i']], lv: 1.25 },
        { at: 0.55 * d, dur: 0.6 * d, p: [[0, 1.5], [1, 1.35]], a: [[0, 0], [0.2, 1], [1, 0]], v: [[0, 'n'], [1, 'i']], lv: 1.5 },
      ];
      break;
    default:
      notes = [{ at: 0, dur: 1.4 * d, p: [[0, 1.35], [0.3, 1.55], [0.6, 1.4], [1, 1.5]], a: [[0, 0], [0.12, 1], [0.85, 0.75], [1, 0]], v: [[0, 'n'], [0.2, 'i'], [0.7, 'e'], [1, 'i']] }];
  }
  vox(p, v, notes);
}

// ---------------- growing up ----------------

const GLASS: Partials = [
  [1, 1, 1],
  [2.76, 0.18, 0.4],
];

function hatch(p: Patch, voice: Voice) {
  const t = p.t;
  foley.crackle(p, t, 10, 0.3, 0.3);
  const g = p.gain(0);
  const e = perc(g.gain, t, 0.002, 0.35, 0.05);
  p.osc('sine', p.vary(500, 0.1), t, e).connect(g).connect(p.out);
  foley.shellBits(p, t, 7);
  // The baby's first squeak.
  chirp(p, who(p, voice, 0), t + 0.6, 1.25);
  p.send = 0.12;
}

function grow(p: Patch, w: Who) {
  const t = p.t;
  // A magic chime: a rising arpeggio of bells with sparkles, then a proud call.
  const root = p.pick([523.25, 587.33, 659.25]);
  const steps = p.pick([
    [1, 1.25, 1.5, 2, 2.5],
    [1, 1.125, 1.25, 1.5, 2],
    [1, 1.5, 2, 2.5, 3],
  ]);
  steps.forEach((r, i) => bell(p, p.out, t + i * 0.075, root * r, 0.2, 0.9));
  foley.glitter(p, t + 0.3, 0.8, 6, 0.16);
  call(p, w, t + 0.55, 1.05);
  p.send = 0.3;
}

function magic(p: Patch, w: Who) {
  const t = p.t;
  // A growth treat: a glassy scale sweeping up, glitter drifting around it, a warm glow swelling
  // underneath, and a delighted little chirp.
  const root = p.pick([587.33, 659.25, 698.46, 783.99]);
  const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2];
  let at = 0;
  for (const [i, r] of scale.entries()) {
    bell(p, p.out, t + at, root * r * p.vary(1, 0.003), 0.1 + 0.012 * i, 0.45, GLASS);
    at += p.r(0.04, 0.06);
  }
  bell(p, p.out, t + at + 0.08, root * 3, 0.14, 0.9, GLASS);
  foley.glitter(p, t + 0.1, 1.1, 14, 0.14);
  foley.glow(p, t, root / 2, 1.3, 0.06);
  chirp(p, w, t + 0.75, 0.7);
  p.send = 0.35;
}

// ---------------- the table ----------------

/** Loudness trim per sound in dB, balanced with scripts/sounds.mjs. */
const TRIM: Record<SoundName, number> = {
  call: -0.7,
  roar: -2.0,
  chirp: -1.6,
  growl: -3.0,
  happy: -1.6,
  purr: -11.4,
  crunch: 0.4,
  gulp: 0.8,
  yawn: -8.4,
  snore: -3.2,
  sneeze: -0.8,
  squeak: -0.4,
  boing: 4.7,
  thud: 1.3,
  step: -5.1,
  crack: 8.3,
  hatch: -2.4,
  grow: -1.0,
  whoosh: -2.1,
  pop: 2.4,
  sniff: -1.5,
  flap: -1.8,
  splash: 4.1,
  bonk: 4.6,
  swish: -6.2,
  whip: 2.0,
  dig: -3.7,
  stomp: 3.5,
  toy: 1.2,
  bubble: 1.3,
  chew: 1.3,
  rustle: -7.4,
  magic: 4.0,
  snort: -1.6,
  huff: -8.3,
  click: -3.3,
  murmur: -4.3,
  curious: -3.6,
  yelp: 1.1,
  whine: -1.6,
};

/** Reverb send per sound (bigger for adults' big calls). */
function sendOf(name: SoundName, w: Who) {
  switch (name) {
    case 'roar':
      return 0.14 + 0.16 * w.big + (w.kind === 'honk' ? 0.1 : 0);
    case 'call':
      return 0.08 + 0.1 * w.big + (w.kind === 'honk' ? 0.08 : 0);
    case 'chirp':
    case 'happy':
    case 'squeak':
    case 'growl':
    case 'yawn':
    case 'sneeze':
    case 'curious':
    case 'yelp':
    case 'whine':
    case 'murmur':
    case 'huff':
      return 0.05 + 0.05 * w.big;
    default:
      return 0;
  }
}

/** Frequent, unimportant sounds: dropped first when many are playing. */
export const DROPPABLE: ReadonlySet<SoundName> = new Set<SoundName>(['step', 'crunch', 'sniff', 'boing', 'pop', 'whoosh', 'flap', 'dig', 'chew', 'rustle', 'bubble', 'splash', 'click']);

/** The recipe of each sound. */
const RECIPES: Record<SoundName, (p: Patch, w: Who, voice: Voice) => void> = {
  call: (p, w) => call(p, w),
  roar: (p, w) => roar(p, w),
  chirp: (p, w) => chirp(p, w),
  growl,
  happy,
  purr,
  crunch: foley.crunch,
  gulp: foley.gulp,
  yawn,
  snore,
  sneeze,
  squeak,
  boing: foley.boing,
  thud: foley.thud,
  step: foley.step,
  crack: (p) => foley.crack(p),
  hatch: (p, _w, voice) => hatch(p, voice),
  grow,
  whoosh: foley.whoosh,
  pop: (p) => foley.pop(p),
  sniff: foley.sniff,
  flap: foley.flap,
  splash: foley.splash,
  bonk: foley.bonk,
  swish: foley.swish,
  whip: foley.whip,
  dig: foley.dig,
  stomp: foley.stomp,
  toy: (p) => foley.toy(p),
  bubble: (p) => foley.bubble(p),
  chew: foley.chew,
  rustle: foley.rustle,
  magic,
  snort: foley.snort,
  huff,
  click,
  murmur,
  curious,
  yelp,
  whine,
};

/** Builds pet sound `name` for `voice` at `growth` (0 hatchling .. 1 adult) into the patch, `level` times its trim. */
export function petSound(p: Patch, name: SoundName, voice: Voice, growth: number, level = 1) {
  const w = who(p, voice, growth, name === 'purr' ? 0.02 : 0.06);
  p.send = sendOf(name, w);
  RECIPES[name](p, w, voice);
  p.out.gain.value = dB(TRIM[name]) * level;
}
