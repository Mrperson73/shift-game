import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/audio/engine';
import { Mixer, SOFT } from '../../src/audio/mixer';
import { Patch, seeded } from '../../src/audio/synth';
import { SOUND_NAMES, type SoundName, UI_SOUNDS, type UiSound, type Voice, type VoiceKind } from '../../src/audio/types';
import { uiSound } from '../../src/audio/ui';
import { DROPPABLE, petSound } from '../../src/audio/voices';
import { Sounds } from '../../src/overlay/sound';
import { analyse, FakeContext, type FakeNode, renderFake } from './fake-audio';

const KINDS: VoiceKind[] = ['roar', 'screech', 'hoot', 'bellow', 'honk', 'trill', 'chitter', 'croak', 'rumble', 'grunt', 'coo'];
const SPECIES: Record<string, Voice> = {
  rex: { pitch: 110, growl: 0.75, kind: 'roar' },
  allo: { pitch: 125, growl: 0.7, kind: 'roar' },
  carno: { pitch: 140, growl: 0.8, kind: 'roar' },
  spino: { pitch: 95, growl: 0.6, kind: 'roar' },
  raptor: { pitch: 330, growl: 0.35, kind: 'screech' },
  dilo: { pitch: 420, growl: 0.5, kind: 'screech' },
  pachy: { pitch: 180, growl: 0.45, kind: 'hoot' },
  trike: { pitch: 90, growl: 0.5, kind: 'bellow' },
  stego: { pitch: 120, growl: 0.35, kind: 'bellow' },
  ankylo: { pitch: 100, growl: 0.6, kind: 'bellow' },
  brachio: { pitch: 60, growl: 0.3, kind: 'bellow' },
  para: { pitch: 150, growl: 0.2, kind: 'honk' },
  cory: { pitch: 120, growl: 0.2, kind: 'honk' },
  galli: { pitch: 600, growl: 0.15, kind: 'trill' },
  compy: { pitch: 700, growl: 0.3, kind: 'chitter' },
  microraptor: { pitch: 560, growl: 0.25, kind: 'chitter' },
  ptera: { pitch: 260, growl: 0.55, kind: 'croak' },
  quetzal: { pitch: 150, growl: 0.65, kind: 'croak' },
  diplo: { pitch: 55, growl: 0.3, kind: 'rumble' },
  amarga: { pitch: 75, growl: 0.3, kind: 'rumble' },
  styraco: { pitch: 115, growl: 0.5, kind: 'grunt' },
  kentro: { pitch: 150, growl: 0.45, kind: 'grunt' },
  iguanodon: { pitch: 95, growl: 0.4, kind: 'grunt' },
  theriz: { pitch: 140, growl: 0.3, kind: 'coo' },
  ovi: { pitch: 300, growl: 0.2, kind: 'coo' },
};
// Mods may use any pitch in 50..900 Hz and growl in 0..1 with any kind.
const EXTREMES: Record<string, Voice> = Object.fromEntries(
  KINDS.flatMap((kind) => [
    [`low-${kind}`, { pitch: 50, growl: 1, kind }],
    [`high-${kind}`, { pitch: 900, growl: 0, kind }],
  ]),
);
const REX = SPECIES.rex;
/** Each kind's reference voice: its first species. */
const BY_KIND = Object.fromEntries(KINDS.map((k) => [k, Object.values(SPECIES).find((v) => v.kind === k)!])) as Record<VoiceKind, Voice>;

/** Longest each sound may last (until its last source stops), in seconds. */
const MAX: Record<SoundName, number> = {
  call: 1.6,
  roar: 3.5,
  chirp: 0.6,
  growl: 1.5,
  happy: 0.8,
  purr: 1.6,
  crunch: 0.4,
  gulp: 1.2,
  yawn: 2.5,
  snore: 2.5,
  sneeze: 1.5,
  squeak: 0.5,
  boing: 0.8,
  thud: 0.6,
  step: 0.25,
  crack: 0.4,
  hatch: 2,
  grow: 3,
  whoosh: 0.8,
  pop: 0.3,
  sniff: 0.8,
  flap: 0.8,
  splash: 0.7,
  bonk: 0.6,
  swish: 0.8,
  whip: 0.5,
  dig: 0.8,
  stomp: 0.6,
  toy: 0.5,
  bubble: 0.3,
  chew: 0.5,
  rustle: 0.8,
  magic: 3,
  snort: 0.8,
  huff: 1,
  click: 0.6,
  murmur: 1.2,
  curious: 0.8,
  yelp: 0.7,
  whine: 1.2,
};
const UI_MAX: Record<UiSound, number> = { click: 0.1, toggle: 0.25, tab: 0.2, select: 0.6, hatch: 1.2, open: 1, error: 0.4, coin: 0.8 };

// One context for the bulk tests: its noise buffers and waves are built once, like in the app.
const shared = new FakeContext();
const audio = shared as unknown as AudioContext;
const mixer = new Mixer(audio, audio.destination, 1);

/** Builds a sound into a fresh patch on the shared context and checks the graph it made. */
function build(fn: (p: Patch) => void, seed = 1) {
  shared.nodes = [];
  shared.issues = [];
  const p = new Patch(audio, 0.05, seeded(seed));
  fn(p);
  mixer.route(p, 0.3);
  // Plain checks, one assertion: this runs a couple of thousand times.
  const errors = [...shared.issues];
  const sources = shared.sources();
  if (!sources.length) errors.push('no sources');
  for (const s of sources) {
    if (s.startAt === null || s.stopAt === null) errors.push(`${s.kind} not scheduled`);
    else if (s.startAt < p.t - 1e-9 || s.stopAt <= s.startAt || s.stopAt > p.end + 1e-9) errors.push(`${s.kind} plays ${s.startAt}..${s.stopAt}`);
    if (!s.outputs.length) errors.push(`${s.kind} feeds nothing`);
  }
  for (const prm of shared.params()) {
    for (const v of prm.values()) {
      if (!Number.isFinite(v)) errors.push(`${prm.label} = ${v}`);
      else if (prm.label === 'Biquad.frequency' && v > shared.sampleRate / 2) errors.push(`${prm.label} = ${v} Hz`);
    }
  }
  expect(errors).toEqual([]);
  return { p, dur: p.end - p.t, nodes: shared.nodes.slice() };
}

/** The pitch automation of a patch's first oscillator (the voice's main source). */
function pitches(nodes: FakeNode[]) {
  const osc = nodes.find((n) => n.kind === 'Oscillator') as unknown as { frequency: { values(): number[] } };
  return osc.frequency.values();
}

/** The highest pitch any of a patch's oscillators reaches (the voice; the other layers are lower). */
const top = (nodes: FakeNode[]) => Math.max(...nodes.filter((n) => n.kind === 'Oscillator').flatMap((n) => (n as unknown as { frequency: { values(): number[] } }).frequency.values()));

// Listening tests render the patch (not the mixer) at a low rate: plenty for levels and brightness, and quick.
const RATE = 16000;
const lab = new FakeContext(RATE);

/** Plays a pet sound on the fake and measures what came out. */
function hear(name: SoundName, voice: Voice, growth: number, seed: number) {
  lab.nodes = [];
  lab.issues = [];
  const p = new Patch(lab as unknown as AudioContext, 0.02, seeded(seed));
  petSound(p, name, voice, growth);
  const x = renderFake(lab, p.out as unknown as FakeNode, p.end + 0.15);
  return { ...analyse(x, RATE), dur: p.end - p.t, nodes: p.size, issues: [...lab.issues] };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Timeout for the tests that build or play thousands of sounds. */
const SLOW = 60_000;

/** The average of `f` over a few plays of a sound. */
function heard(name: SoundName, voice: Voice, growth: number, f: (a: ReturnType<typeof hear>) => number, seeds = [11, 12, 13, 14]) {
  return mean(seeds.map((s) => f(hear(name, voice, growth, s))));
}

describe('pet sounds', () => {
  it('schedules every sound for every voice, as a hatchling, a juvenile and an adult', () => {
    for (const [who, voice] of Object.entries({ ...SPECIES, ...EXTREMES })) {
      for (const name of SOUND_NAMES) {
        for (const g of [0, 0.5, 1]) {
          const { dur } = build((p) => petSound(p, name, voice, g), g * 10 + 1);
          expect(dur, `${who} ${name} ${g}`).toBeGreaterThan(0.03);
          expect(dur, `${who} ${name} ${g}`).toBeLessThan(MAX[name]);
        }
      }
    }
  }, SLOW);

  it('keeps footsteps, bites and other frequent little sounds cheap and dry', () => {
    for (const name of ['step', 'crunch'] as const) {
      for (const g of [0, 1]) {
        const { p, nodes } = build((q) => petSound(q, name, REX, g));
        expect(nodes.length).toBeLessThanOrEqual(10);
        expect(p.send).toBe(0);
      }
    }
    expect(DROPPABLE.has('step') && DROPPABLE.has('crunch')).toBe(true);
    expect(DROPPABLE.has('roar') || DROPPABLE.has('call')).toBe(false);
    // Everything droppable (wing beats, digging, chewing, leaves, bubbles...) stays around ten nodes.
    for (const name of DROPPABLE) {
      for (const kind of KINDS) {
        for (const g of [0, 1]) for (const seed of [1, 2, 3]) expect(build((p) => petSound(p, name, BY_KIND[kind], g), seed).nodes.length, `${name} ${kind}`).toBeLessThanOrEqual(14);
      }
    }
  }, SLOW);

  it('keeps every sound a modest graph', () => {
    const small: SoundName[] = ['chirp', 'squeak', 'happy', 'curious', 'yelp', 'whine', 'murmur', 'huff', 'click', 'snort', 'sneeze', 'purr'];
    for (const name of SOUND_NAMES) {
      for (const voice of Object.values(SPECIES)) {
        for (const seed of [1, 2]) {
          const n = build((p) => petSound(p, name, voice, seed - 1), seed).nodes.length;
          expect(n, `${name} ${voice.kind}`).toBeLessThanOrEqual(small.includes(name) ? 56 : 110);
        }
      }
    }
  }, SLOW);

  it('makes hatchlings higher and quicker than adults', () => {
    for (const [who, voice] of Object.entries(SPECIES)) {
      for (const seed of [5, 6]) {
        const baby = build((p) => petSound(p, 'call', voice, 0), seed);
        const adult = build((p) => petSound(p, 'call', voice, 1), seed);
        expect(top(baby.nodes) / top(adult.nodes), who).toBeGreaterThan(1.9);
        expect(baby.dur, who).toBeLessThan(adult.dur);
      }
    }
  });

  it('has a few shapes of each call, not one at different pitches', () => {
    // A play's shape: how many nodes and automation events it took (a note more or less changes both).
    const shape = (name: SoundName, voice: Voice, seed: number) => {
      const { nodes } = build((p) => petSound(p, name, voice, 1), seed);
      return `${nodes.length}:${shared.params().reduce((n, prm) => n + prm.events.length, 0)}`;
    };
    const few: string[] = [];
    for (const kind of KINDS) {
      for (const name of ['call', 'roar', 'chirp', 'happy', 'growl', 'squeak', 'curious', 'yelp', 'whine', 'murmur', 'sneeze', 'huff', 'snort'] as const) {
        const shapes = new Set(Array.from({ length: 12 }, (_, i) => shape(name, BY_KIND[kind], i + 1)));
        if (shapes.size < 3) few.push(`${kind} ${name}: ${shapes.size}`);
      }
    }
    expect(few).toEqual([]);
  }, SLOW);

  it('varies a little on every play', () => {
    const a = Math.max(...pitches(build((p) => petSound(p, 'call', REX, 1), 1).nodes));
    const b = Math.max(...pitches(build((p) => petSound(p, 'call', REX, 1), 2).nodes));
    expect(a).not.toBe(b);
    expect(a / b).toBeGreaterThan(0.85);
    expect(a / b).toBeLessThan(1.18);
  });

  it('purrs long enough to overlap when repeated every second, at a steady pitch', () => {
    const tops: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const { dur, nodes } = build((p) => petSound(p, 'purr', SPECIES.pachy, 0.7), seed);
      expect(dur).toBeGreaterThan(1.05);
      tops.push(Math.max(...pitches(nodes)));
    }
    expect(Math.max(...tops) / Math.min(...tops)).toBeLessThan(1.05);
  });

  it('gives each species of a kind its own colour', () => {
    const size = (voice: Voice, name: SoundName) => build((p) => petSound(p, name, voice, 1)).nodes.length;
    const dur = (voice: Voice, name: SoundName) => build((p) => petSound(p, name, voice, 1)).dur;
    expect(size(SPECIES.spino, 'call')).toBeGreaterThan(size(SPECIES.rex, 'call')); // croc rumble + hiss
    expect(size(SPECIES.dilo, 'roar')).toBeGreaterThan(size(SPECIES.raptor, 'roar')); // rattle
    expect(dur(SPECIES.ankylo, 'call')).toBeGreaterThan(dur(SPECIES.trike, 'call')); // grunts first
    // Brightness (spectral centroid) of adult calls, over a few plays.
    const bright = (voice: Voice, name: SoundName = 'call') => heard(name, voice, 1, (a) => a.centroid);
    expect(bright(SPECIES.allo, 'roar') / bright(SPECIES.rex, 'roar')).toBeGreaterThan(1.08); // raspier, screaming
    expect(bright(SPECIES.cory) / bright(SPECIES.para)).toBeLessThan(0.75); // a rounder, lower honk
    expect(bright(SPECIES.quetzal) / bright(SPECIES.ptera)).toBeLessThan(0.8); // the huge one croaks deeper
    expect(bright(SPECIES.diplo) / bright(SPECIES.amarga)).toBeLessThan(0.85); // plainer and deeper
    expect(bright(SPECIES.theriz) / bright(SPECIES.ovi)).toBeLessThan(0.7); // booms versus coos
    expect(bright(SPECIES.compy) / bright(SPECIES.microraptor)).toBeGreaterThan(1.1); // clickier chatter
    expect(bright(SPECIES.kentro) / bright(SPECIES.iguanodon)).toBeGreaterThan(1.1); // quick huffs versus honking grunts
  }, SLOW);
});

describe('what the pet sounds like (rendered)', () => {
  it('plays every sound for every kind: finite, audible, within its time and at a sane level', () => {
    for (const kind of KINDS) {
      for (const name of SOUND_NAMES) {
        for (const g of [0, 1]) {
          const a = hear(name, BY_KIND[kind], g, 21 + g);
          const id = `${kind} ${name} g${g}`;
          expect(a.finite, id).toBe(true);
          expect(a.issues, id).toEqual([]);
          expect(a.dur, id).toBeLessThan(MAX[name]);
          // Heard (the quietest, a hatchling's footstep, peaks near -25 dBFS)...
          expect(a.peak, id).toBeGreaterThan(-32);
          // ...and never more than the master bus's safety clipper can take (+6 dB).
          expect(a.peak, id).toBeLessThan(6);
        }
      }
    }
  }, SLOW);

  it('makes hatchlings sound small and adults big', () => {
    for (const [who, voice] of Object.entries(SPECIES)) {
      for (const name of ['call', 'chirp'] as const) {
        const baby = heard(name, voice, 0, (a) => a.centroid, [3, 4]);
        const adult = heard(name, voice, 1, (a) => a.centroid, [3, 4]);
        expect(baby / adult, `${who} ${name}`).toBeGreaterThan(1.4);
      }
    }
  }, SLOW);

  it('gives every kind a character of its own', () => {
    const f = Object.fromEntries(
      KINDS.map((k) => {
        const plays = [31, 32, 33, 34].map((s) => hear('call', BY_KIND[k], 1, s));
        return [k, { centroid: mean(plays.map((a) => a.centroid)), low: mean(plays.map((a) => a.low)), high: mean(plays.map((a) => a.high)), dur: mean(plays.map((a) => a.dur)) }];
      }),
    ) as Record<VoiceKind, { centroid: number; low: number; high: number; dur: number }>;
    // Sauropods: felt more than heard.
    expect(f.rumble.low).toBeGreaterThan(0.9);
    expect(f.rumble.centroid).toBeLessThan(f.bellow.centroid);
    // Tiny and quick, high and short.
    expect(f.chitter.centroid).toBeGreaterThan(4 * f.roar.centroid);
    expect(f.chitter.dur).toBeLessThan(0.5 * f.roar.dur);
    // Harsh croaks against soft, closed-mouth coos and hollow hoots.
    expect(f.croak.high).toBeGreaterThan(4 * f.coo.high);
    expect(f.coo.high).toBeLessThan(f.hoot.high);
    // Grunts are short; bellows and rumbles long.
    expect(f.grunt.dur).toBeLessThan(0.7 * f.bellow.dur);
    expect(f.rumble.dur).toBeGreaterThan(f.grunt.dur * 2);
    // Every two kinds differ clearly in brightness, bass, rasp or length.
    const ln = (x: number) => Math.log(Math.max(1e-4, x));
    for (const a of KINDS) {
      for (const b of KINDS) {
        if (a >= b) continue;
        const d = Math.max(Math.abs(ln(f[a].centroid / f[b].centroid)) / Math.log(1.25), Math.abs(f[a].low - f[b].low) / 0.2, Math.abs(ln(f[a].high / f[b].high)) / Math.log(3), Math.abs(ln(f[a].dur / f[b].dur)) / Math.log(1.3));
        expect(d, `${a} vs ${b}`).toBeGreaterThan(1);
      }
    }
  }, SLOW);
});

describe('ui sounds', () => {
  it('schedules every UI sound briefly', () => {
    for (const name of UI_SOUNDS) {
      const { dur } = build((p) => uiSound(p, name));
      expect(dur, name).toBeGreaterThan(0.02);
      expect(dur, name).toBeLessThan(UI_MAX[name]);
    }
  });
});

describe('mixer', () => {
  it('ends in a compressor, a safety clipper and the volume, with a stereo reverb', () => {
    const ctx = new FakeContext();
    const a = ctx as unknown as AudioContext;
    new Mixer(a, a.destination, 0.5);
    const chain: string[] = [];
    for (let n: FakeNode | undefined = ctx.destination; n; n = n.inputs[0]) chain.push(n.kind);
    expect(chain.slice(0, 6)).toEqual(['Destination', 'Gain', 'WaveShaper', 'Gain', 'Compressor', 'Biquad']);
    const vol = ctx.destination.inputs[0] as unknown as { gain: { value: number } };
    expect(vol.gain.value).toBeCloseTo(0.25); // volume 0.5 is -12 dB
    const verb = ctx.nodes.find((n) => n.kind === 'Convolver') as unknown as { buffer: { numberOfChannels: number; duration: number } };
    expect(verb.buffer.numberOfChannels).toBe(2);
    expect(verb.buffer.duration).toBeLessThan(2);
    expect(ctx.issues).toEqual([]);
  });
});

describe('engine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setup = () => {
    const ctx = new FakeContext();
    const create = vi.fn(() => ctx as unknown as AudioContext);
    return { ctx, create };
  };

  it('does nothing, and opens no audio device, while off or muted', () => {
    const { create } = setup();
    const s = new Sounds({ create });
    s.enabled = false;
    s.play('roar');
    s.enabled = true;
    s.volume = 0;
    s.play('roar');
    s.sleep();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the context on the first sound and suspends it after ~4 s of quiet', () => {
    vi.useFakeTimers();
    const { ctx, create } = setup();
    const s = new Sounds({ create, rand: seeded(3) });
    s.volume = 0.6;
    s.setVoice(REX, 0.4);
    expect(create).not.toHaveBeenCalled();
    s.play('chirp');
    s.play('step');
    expect(create).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(ctx.calls).not.toContain('suspend');
    ctx.advance(5);
    vi.advanceTimersByTime(1500);
    expect(ctx.state).toBe('suspended');
    s.play('chirp');
    expect(ctx.calls[ctx.calls.length - 1]).toBe('resume');
    expect(ctx.state).toBe('running');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('waits for long sounds to finish before suspending', () => {
    vi.useFakeTimers();
    const { ctx, create } = setup();
    const s = new Sounds({ create, rand: seeded(3) });
    s.setVoice(REX, 1);
    s.play('roar');
    // The audio clock lags (e.g. the device took a while to start): the roar still rings at 4 s.
    ctx.advance(1);
    vi.advanceTimersByTime(4100);
    expect(ctx.state).toBe('running');
    // So the engine checks again once the roar and its reverb should be over.
    ctx.advance(6);
    vi.advanceTimersByTime(3000);
    expect(ctx.state).toBe('suspended');
  });

  it('sleep() fades out what is playing and releases the device right away', () => {
    vi.useFakeTimers();
    const { ctx, create } = setup();
    const s = new Sounds({ create, rand: seeded(3) });
    s.play('roar');
    ctx.currentTime = 0.5;
    s.sleep();
    // A quick fade on the master volume first, so the cut doesn't click.
    const vol = ctx.destination.inputs[0] as unknown as { gain: { events: { type: string; value: number }[] } };
    expect(vol.gain.events[vol.gain.events.length - 1]).toMatchObject({ type: 'target', value: 0 });
    vi.advanceTimersByTime(100);
    expect(ctx.state).toBe('suspended');
    for (const src of ctx.sources()) expect(src.stopAt).toBeLessThanOrEqual(0.5);
    // Everything is let go, including the reverb holding the cut roar's tail.
    expect(ctx.nodes.filter((n) => n.kind === 'Oscillator' || n.kind === 'Convolver').every((n) => n.disconnected)).toBe(true);
    // The next sound wakes it up on a fresh bus.
    s.play('chirp');
    expect(ctx.state).toBe('running');
    expect(ctx.nodes.filter((n) => n.kind === 'Convolver' && !n.disconnected).length).toBe(1);
    // Waking up in the middle of a fade: the fade finishes at once, the new sound plays.
    s.sleep();
    s.play('squeak');
    expect(ctx.calls.slice(-2)).toEqual(['suspend', 'resume']);
    expect(ctx.state).toBe('running');
    expect(ctx.issues).toEqual([]);
  });

  it('lets finished sounds be garbage collected', () => {
    const { ctx, create } = setup();
    const engine = new Engine({ create, rand: seeded(1) });
    engine.play((p) => petSound(p, 'chirp', REX, 1));
    ctx.advance(3);
    const before = ctx.nodes.length;
    expect(engine.play((p) => petSound(p, 'call', SPECIES.para, 1))).toBe(true);
    const made = ctx.nodes.slice(before);
    expect(engine.playing).toBe(1);
    ctx.advance(10);
    expect(engine.playing).toBe(0);
    expect(made.every((n) => n.disconnected)).toBe(true);
  });

  it('caps simultaneous sounds, dropping footsteps and bites first', () => {
    const { ctx, create } = setup();
    const engine = new Engine({ create, rand: seeded(1), maxVoices: 12 });
    let played = 0;
    for (let i = 0; i < 40; i++) {
      ctx.currentTime = i * 0.05; // nothing ends: a busy moment
      if (engine.play((p) => petSound(p, 'step', REX, 1), { droppable: true, key: 'step' })) played++;
    }
    expect(played).toBe(12);
    for (let i = 0; i < 20; i++) engine.play((p) => petSound(p, 'call', REX, 1));
    expect(engine.playing).toBe(24);
    // The same small sound twice within 40 ms is dropped too.
    ctx.advance(60);
    expect(engine.play((p) => petSound(p, 'crunch', REX, 1), { droppable: true, key: 'crunch' })).toBe(true);
    expect(engine.play((p) => petSound(p, 'crunch', REX, 1), { droppable: true, key: 'crunch' })).toBe(false);
  });

  it('plays soft sounds 8 dB quieter and pans them', () => {
    const levels: number[] = [];
    for (const soft of [false, true]) {
      const { ctx, create } = setup();
      const s = new Sounds({ create, rand: seeded(9) });
      s.play('chirp', { soft, pan: -0.5 });
      const panner = ctx.nodes.find((n) => n.kind === 'StereoPanner') as unknown as FakeNode & { pan: { value: number } };
      expect(panner.pan.value).toBe(-0.5);
      levels.push((panner.inputs[0] as unknown as { gain: { value: number } }).gain.value);
    }
    expect(levels[1] / levels[0]).toBeCloseTo(SOFT);
    expect(20 * Math.log10(SOFT)).toBeCloseTo(-8);
  });

  it('fails silently when there is no audio', async () => {
    const broken = vi.fn(() => {
      throw new Error('no audio device');
    });
    const s = new Sounds({ create: broken });
    expect(() => s.play('roar')).not.toThrow();
    s.play('chirp');
    expect(broken).toHaveBeenCalledTimes(1); // no retry storm
    // No AudioContext at all (like here in Node).
    const bare = new Sounds();
    expect(() => {
      bare.play('roar');
      bare.volume = 0.3;
      bare.sleep();
    }).not.toThrow();
    // A device that won't start.
    const { ctx, create } = setup();
    ctx.state = 'suspended';
    ctx.failResume = true;
    const s2 = new Sounds({ create });
    expect(() => s2.play('call')).not.toThrow();
    await Promise.resolve();
  });
});

describe('panel sfx', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares the synth with its own lazily created context', async () => {
    vi.useFakeTimers();
    const made: FakeContext[] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          const c = new FakeContext();
          made.push(c);
          return c;
        }
      },
    );
    const { sfx } = await import('../../src/panel/sfx');
    sfx.configure(false, 0.5);
    sfx.play('click');
    expect(made.length).toBe(0);
    sfx.configure(true, 0.5);
    for (const name of UI_SOUNDS) sfx.play(name);
    sfx.call(SPECIES.galli, 0.2);
    expect(made.length).toBe(1);
    expect(made[0].issues).toEqual([]);
    sfx.configure(false, 0.5);
    vi.advanceTimersByTime(100);
    expect(made[0].state).toBe('suspended');
  });
});
