// The master bus every sound plays through, one per context: dry and reverb buses, a DC/rumble
// high-pass, a gentle compressor, a soft safety clipper (so nothing ever clips) and the volume.

import { impulse } from './reverb';
import { clamp, clipCurve, dB, type Patch } from './synth';

/** `soft` plays (idle noises, far away) are this much quieter: -8 dB. */
export const SOFT = dB(-8);

/** Settings volume 0..1 to gain: an audio taper, so the slider feels even (0.5 is -12 dB). */
export const volumeGain = (v: number) => clamp(v) ** 2;

/** The reverb's impulse response, made once per context. */
const irs = new WeakMap<BaseAudioContext, AudioBuffer>();

export class Mixer {
  /** Dry bus: patches connect here through their panner. */
  readonly dry: GainNode;
  /** Reverb bus, fed by each patch's send. */
  readonly wet: GainNode;
  private readonly vol: GainNode;
  private readonly nodes: AudioNode[] = [];

  constructor(
    readonly ctx: BaseAudioContext,
    dest: AudioNode,
    volume = 1,
  ) {
    const add = <T extends AudioNode>(n: T) => (this.nodes.push(n), n);
    const gain = (v: number) => {
      const g = add(ctx.createGain());
      g.gain.value = v;
      return g;
    };
    this.dry = gain(1);
    this.wet = gain(1);
    const verb = add(ctx.createConvolver());
    let ir = irs.get(ctx);
    if (!ir) irs.set(ctx, (ir = impulse(ctx)));
    verb.buffer = ir;
    const bus = gain(dB(-1));
    const hp = add(ctx.createBiquadFilter());
    hp.type = 'highpass';
    hp.frequency.value = 38;
    hp.Q.value = 0.6;
    // Gentle glue: only the loudest peaks get squeezed (note: Chromium adds a fixed make-up gain).
    const comp = add(ctx.createDynamicsCompressor());
    comp.threshold.value = -9;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.008;
    comp.release.value = 0.25;
    const pre = gain(0.5);
    const clip = add(ctx.createWaveShaper());
    clip.curve = clipCurve();
    this.vol = gain(volumeGain(volume));
    this.dry.connect(bus);
    this.wet.connect(verb).connect(gain(dB(-4))).connect(bus);
    bus.connect(hp).connect(comp).connect(pre).connect(clip).connect(this.vol).connect(dest);
  }

  setVolume(v: number) {
    const now = this.ctx.currentTime;
    this.vol.gain.cancelScheduledValues(now);
    this.vol.gain.setTargetAtTime(volumeGain(v), now, 0.02);
  }

  /** Fades everything out over about `seconds` (before stopping sounds, so they don't click). */
  fade(seconds: number) {
    const now = this.ctx.currentTime;
    this.vol.gain.cancelScheduledValues(now);
    this.vol.gain.setTargetAtTime(0, now, seconds / 5);
  }

  /** Disconnects the bus (dropping any reverb tail still inside it). */
  dispose() {
    for (const n of this.nodes) n.disconnect();
  }

  /** Sends a built patch to the buses: out → panner → dry, plus its reverb send. */
  route(p: Patch, pan = 0) {
    let out: AudioNode = p.out;
    if (pan) {
      const sp = p.add(this.ctx.createStereoPanner());
      sp.pan.value = clamp(pan, -1, 1);
      out = p.out.connect(sp);
    }
    out.connect(this.dry);
    if (p.send > 0) out.connect(p.gain(p.send)).connect(this.wet);
  }
}
