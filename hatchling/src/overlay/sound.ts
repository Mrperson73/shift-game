// Tiny synthesized sound effects (no audio files): chirps, roars, crunches and so on.
// Pitch drops as the pet grows, so hatchlings squeak and adults rumble.
// (Placeholder engine: being replaced by the richer synth in src/audio.)

import type { SoundName, Voice } from '../audio/types';

export interface PlayOpts {
  /** Quieter (idle noises, far away). */
  soft?: boolean;
  /** Stereo position, -1 (left) .. 1 (right). */
  pan?: number;
}

export class Sounds {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private idleTimer = 0;
  enabled = true;
  volume = 0.5;
  /** Base pitch in Hz and growl amount of the current species; baby is 0..1. */
  pitch = 150;
  growlAmt = 0.5;
  baby = 1;

  /** Voice of the current species and how grown up the pet is (0..1). */
  setVoice(v: Voice, growth: number) {
    this.pitch = v.pitch;
    this.growlAmt = v.growl;
    this.baby = Math.pow(1 - Math.min(1, Math.max(0, growth)), 1.6);
  }

  /** Close the audio device until the next sound (saves power while nothing plays). */
  sleep() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  private get ac() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.ctx;
  }

  play(name: SoundName, opts: PlayOpts = {}) {
    if (!this.enabled || this.volume <= 0) return;
    try {
      const ac = this.ac;
      if (ac.state === 'suspended') void ac.resume();
      const out = ac.createGain();
      out.gain.value = this.volume * 0.32 * (opts.soft ? 0.45 : 1);
      out.connect(ac.destination);
      const t = ac.currentTime + 0.01;
      const f = this.pitch * (1 + 1.3 * this.baby);
      const alias: Partial<Record<SoundName, string>> = { call: 'chirp', purr: 'happy', gulp: 'crunch', sneeze: 'crack', step: 'thud', grow: 'happy', whoosh: 'boing', pop: 'boing', sniff: 'crunch' };
      const fn = (this as unknown as Record<string, (ac: AudioContext, out: AudioNode, t: number, f: number) => void>)[alias[name] ?? name];
      fn.call(this, ac, out, t, f);
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.sleep(), 4000);
    } catch {
      /* audio is optional */
    }
  }

  private tone(ac: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.01) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private burst(ac: AudioContext, out: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, q = 1, attack = 0.005) {
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    const bf = ac.createBiquadFilter();
    bf.type = filter;
    bf.frequency.value = freq;
    bf.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bf).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
    return bf;
  }

  chirp(ac: AudioContext, out: AudioNode, t: number, f: number) {
    const hi = f * 2.2;
    this.tone(ac, out, t, 'sine', hi, hi * 1.6, 0.09, 0.5);
    this.tone(ac, out, t + 0.11, 'sine', hi * 1.1, hi * 1.9, 0.1, 0.4);
  }

  roar(ac: AudioContext, out: AudioNode, t: number, f: number) {
    const dur = 0.9 + 0.5 * (1 - this.baby);
    const o = this.tone(ac, out, t, 'sawtooth', f * 1.4, f * 0.75, dur, 0.28, 0.08);
    const lfo = ac.createOscillator();
    const lg = ac.createGain();
    lfo.frequency.value = 22 + 10 * this.baby;
    lg.gain.value = f * 0.06;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
    const bf = this.burst(ac, out, t, dur, 0.25 + 0.35 * this.growlAmt, 'bandpass', f * 3, 1.2, 0.08);
    bf.frequency.setValueAtTime(f * 4, t);
    bf.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
  }

  growl(ac: AudioContext, out: AudioNode, t: number, f: number) {
    this.tone(ac, out, t, 'sawtooth', f * 0.9, f * 0.8, 0.55, 0.18, 0.05);
    this.burst(ac, out, t, 0.55, 0.2 * (0.5 + this.growlAmt), 'lowpass', f * 3, 1, 0.05);
  }

  crunch(ac: AudioContext, out: AudioNode, t: number) {
    this.burst(ac, out, t, 0.06, 0.5, 'highpass', 2200, 0.7);
    this.burst(ac, out, t + 0.07, 0.05, 0.35, 'highpass', 2800, 0.7);
  }

  yawn(ac: AudioContext, out: AudioNode, t: number, f: number) {
    const o = this.tone(ac, out, t, 'triangle', f * 1.6, f * 0.9, 0.8, 0.22, 0.2);
    const lfo = ac.createOscillator();
    const lg = ac.createGain();
    lfo.frequency.value = 5;
    lg.gain.value = f * 0.03;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.8);
  }

  happy(ac: AudioContext, out: AudioNode, t: number, f: number) {
    [1, 1.26, 1.5].forEach((m, i) => this.tone(ac, out, t + i * 0.08, 'sine', f * 2 * m, f * 2 * m * 1.05, 0.12, 0.35));
  }

  squeak(ac: AudioContext, out: AudioNode, t: number, f: number) {
    this.tone(ac, out, t, 'sine', f * 2.5, f * 3.6, 0.12, 0.4);
  }

  thud(ac: AudioContext, out: AudioNode, t: number) {
    this.tone(ac, out, t, 'sine', 110 - 50 * (1 - this.baby), 45, 0.18, 0.6, 0.004);
    this.burst(ac, out, t, 0.08, 0.2, 'lowpass', 400);
  }

  crack(ac: AudioContext, out: AudioNode, t: number) {
    this.burst(ac, out, t, 0.05, 0.6, 'highpass', 3000, 2);
  }

  hatch(ac: AudioContext, out: AudioNode, t: number, f: number) {
    this.crack(ac, out, t);
    this.burst(ac, out, t + 0.06, 0.12, 0.4, 'bandpass', 1500, 1);
    this.chirp(ac, out, t + 0.35, f);
  }

  snore(ac: AudioContext, out: AudioNode, t: number, f: number) {
    const bf = this.burst(ac, out, t, 1.1, 0.12, 'lowpass', f * 1.5, 3, 0.5);
    bf.frequency.setValueAtTime(f, t);
    bf.frequency.linearRampToValueAtTime(f * 2.5, t + 1.1);
  }

  boing(ac: AudioContext, out: AudioNode, t: number, f: number) {
    this.tone(ac, out, t, 'sine', f * 1.2, f * 3, 0.16, 0.3);
  }
}
