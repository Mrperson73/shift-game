// The pet's sounds (all synthesized, no audio files): calls and roars in the species' voice, plus
// crunches, footsteps, thuds and the rest. Hatchlings squeak, adults rumble. The synth lives in
// src/audio; the audio device is only held while something is playing.

import { Engine, type EngineOpts } from '../audio/engine';
import { SOFT } from '../audio/mixer';
import type { SoundName, Voice } from '../audio/types';
import { DROPPABLE, petSound } from '../audio/voices';

export interface PlayOpts {
  /** Quieter (idle noises, far away): about -8 dB. */
  soft?: boolean;
  /** Stereo position, -1 (left) .. 1 (right). */
  pan?: number;
}

export class Sounds {
  private readonly engine: Engine;
  private voice: Voice = { pitch: 150, growl: 0.5, kind: 'roar' };
  private growth = 0;

  /** Options are for tests (a fake AudioContext, repeatable randomness). */
  constructor(opts: EngineOpts = {}) {
    this.engine = new Engine({ idleMs: 4000, maxVoices: 12, ...opts });
  }

  /** Settings: sound on/off. Turning it off releases the audio device. */
  get enabled() {
    return this.engine.enabled;
  }

  set enabled(on: boolean) {
    this.engine.enabled = on;
  }

  /** Settings volume, 0..1. */
  get volume() {
    return this.engine.volume;
  }

  set volume(v: number) {
    this.engine.volume = v;
  }

  /** Voice of the current species and how grown up the pet is (0 hatchling .. 1 adult). */
  setVoice(v: Voice, growth: number) {
    this.voice = v;
    this.growth = Number.isFinite(growth) ? Math.min(1, Math.max(0, growth)) : 0;
  }

  play(name: SoundName, opts: PlayOpts = {}) {
    const { voice, growth } = this;
    this.engine.play((p) => petSound(p, name, voice, growth), {
      level: opts.soft ? SOFT : 1,
      pan: opts.pan,
      droppable: DROPPABLE.has(name),
      key: name,
    });
  }

  /** Release the audio device now (pet hidden, screen locked). The next sound wakes it. */
  sleep() {
    this.engine.sleep();
  }
}
