import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/audio/engine';
import { Mixer, SOFT } from '../../src/audio/mixer';
import { Patch, seeded } from '../../src/audio/synth';
import { SOUND_NAMES, type SoundName, UI_SOUNDS, type UiSound, type Voice, type VoiceKind } from '../../src/audio/types';
import { uiSound } from '../../src/audio/ui';
import { DROPPABLE, petSound } from '../../src/audio/voices';
import { Sounds } from '../../src/overlay/sound';
import { FakeContext, type FakeNode } from './fake-audio';

const KINDS: VoiceKind[] = ['roar', 'screech', 'hoot', 'bellow', 'honk', 'trill'];
const SPECIES: Record<string, Voice> = {
  rex: { pitch: 110, growl: 0.75, kind: 'roar' },
  carno: { pitch: 140, growl: 0.8, kind: 'roar' },
  spino: { pitch: 95, growl: 0.6, kind: 'roar' },
  raptor: { pitch: 330, growl: 0.35, kind: 'screech' },
  dilo: { pitch: 420, growl: 0.5, kind: 'screech' },
  pachy: { pitch: 180, growl: 0.45, kind: 'hoot' },
  trike: { pitch: 90, growl: 0.5, kind: 'bellow' },
  stego: { pitch: 120, growl: 0.35, kind: 'bellow' },
  ankylo: { pitch: 100, growl: 0.6, kind: 'bellow' },
  para: { pitch: 150, growl: 0.2, kind: 'honk' },
  galli: { pitch: 600, growl: 0.15, kind: 'trill' },
};
// Mods may use any pitch in 50..900 Hz and growl in 0..1 with any kind.
const EXTREMES: Record<string, Voice> = Object.fromEntries(
  KINDS.flatMap((kind) => [
    [`low-${kind}`, { pitch: 50, growl: 1, kind }],
    [`high-${kind}`, { pitch: 900, growl: 0, kind }],
  ]),
);
const REX = SPECIES.rex;

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
  splash: 0.3,
  bonk: 0.6,
  swish: 0.8,
  whip: 0.4,
  dig: 0.8,
  stomp: 0.6,
  toy: 0.5,
  bubble: 0.3,
  chew: 0.4,
  rustle: 0.8,
  magic: 3,
  snort: 0.8,
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
  });

  it('keeps footsteps and bites cheap and dry', () => {
    for (const name of ['step', 'crunch'] as const) {
      for (const g of [0, 1]) {
        const { p, nodes } = build((q) => petSound(q, name, REX, g));
        expect(nodes.length).toBeLessThanOrEqual(10);
        expect(p.send).toBe(0);
      }
    }
    expect(DROPPABLE.has('step') && DROPPABLE.has('crunch')).toBe(true);
    expect(DROPPABLE.has('roar') || DROPPABLE.has('call')).toBe(false);
  });

  it('makes hatchlings higher and quicker than adults', () => {
    for (const voice of Object.values(SPECIES)) {
      const baby = build((p) => petSound(p, 'call', voice, 0), 5);
      const adult = build((p) => petSound(p, 'call', voice, 1), 5);
      expect(Math.max(...pitches(baby.nodes)) / Math.max(...pitches(adult.nodes))).toBeGreaterThan(1.9);
      expect(baby.dur).toBeLessThan(adult.dur);
    }
  });

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
  });
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
