// A small, strict stand-in for the Web Audio API so the synth can be tested in Node. It records the
// graph and every automation event, throws where browsers throw (exponential ramps to 0, non-finite
// values, starting a source twice, connecting across contexts...) and notes anything suspicious that
// browsers silently accept (automation scheduled out of order, exponential ramps from 0).

type Ev = { type: 'set' | 'lin' | 'exp' | 'target'; value: number; time: number; tc?: number };

export class FakeParam {
  events: Ev[] = [];
  inputs: FakeNode[] = [];
  private v: number;

  constructor(
    readonly ctx: FakeContext,
    readonly label: string,
    value: number,
  ) {
    this.v = value;
  }

  get value() {
    return this.v;
  }

  set value(x: number) {
    if (!Number.isFinite(x)) throw new TypeError(`${this.label}.value = ${x}`);
    this.v = x;
  }

  private add(type: Ev['type'], value: number, time: number, tc?: number) {
    if (!Number.isFinite(value)) throw new TypeError(`${this.label} ${type} value ${value}`);
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`${this.label} ${type} time ${time}`);
    const last = this.events[this.events.length - 1];
    if (last && time < last.time - 1e-9) this.ctx.issues.push(`${this.label}: ${type} at ${time.toFixed(4)} before ${last.time.toFixed(4)}`);
    this.events.push({ type, value, time, tc });
    return this;
  }

  setValueAtTime(v: number, t: number) {
    return this.add('set', v, t);
  }

  linearRampToValueAtTime(v: number, t: number) {
    return this.add('lin', v, t);
  }

  exponentialRampToValueAtTime(v: number, t: number) {
    if (v === 0) throw new RangeError(`${this.label}: exponential ramp to 0`);
    const prev = this.events.length ? this.events[this.events.length - 1].value : this.v;
    if (prev === 0 || Math.sign(prev) !== Math.sign(v)) this.ctx.issues.push(`${this.label}: exponential ramp from ${prev} to ${v} never moves`);
    return this.add('exp', v, t);
  }

  setTargetAtTime(v: number, t: number, tc: number) {
    if (!(tc >= 0)) throw new RangeError(`${this.label}: time constant ${tc}`);
    return this.add('target', v, t, tc);
  }

  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.time < t);
    return this;
  }

  /** Every value this parameter is ever asked to take. */
  values() {
    return [this.v, ...this.events.map((e) => e.value)];
  }
}

export class FakeNode {
  outputs: (FakeNode | FakeParam)[] = [];
  inputs: FakeNode[] = [];
  disconnected = false;

  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }

  protected param(name: string, v: number) {
    return new FakeParam(this.ctx, `${this.kind}.${name}`, v);
  }

  connect<T extends FakeNode | FakeParam>(dest: T): T {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) throw new TypeError(`${this.kind}: connect to ${String(dest)}`);
    if (dest.ctx !== this.ctx) throw new Error(`${this.kind}: InvalidAccessError (another context)`);
    this.outputs.push(dest);
    dest.inputs.push(this);
    return dest;
  }

  disconnect() {
    for (const o of this.outputs) o.inputs = o.inputs.filter((n) => n !== this);
    this.outputs = [];
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = this.param('gain', 1);
}

class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  /** Where a buffer starts playing from, seconds. */
  offset = 0;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0) {
    if (this.startAt !== null) throw new Error(`${this.kind}: InvalidStateError (started twice)`);
    if (!Number.isFinite(when) || when < 0 || !Number.isFinite(offset) || offset < 0) throw new RangeError(`${this.kind}: start(${when}, ${offset})`);
    this.startAt = when;
    this.offset = offset;
  }

  stop(when = 0) {
    if (this.startAt === null) throw new Error(`${this.kind}: InvalidStateError (stop before start)`);
    if (!Number.isFinite(when) || when < 0) throw new RangeError(`${this.kind}: stop(${when})`);
    this.stopAt = when;
  }
}

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];

class FakeOscillator extends FakeSource {
  frequency = this.param('frequency', 440);
  detune = this.param('detune', 0);
  private t = 'sine';
  wave: FakePeriodicWave | null = null;

  get type() {
    return this.t;
  }

  set type(v: string) {
    if (!OSC_TYPES.includes(v)) throw new Error(`oscillator type ${v}: InvalidStateError`);
    this.t = v;
  }

  setPeriodicWave(w: FakePeriodicWave) {
    if (!(w instanceof FakePeriodicWave)) throw new TypeError('not a PeriodicWave');
    this.wave = w;
    this.t = 'custom';
  }
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = this.param('playbackRate', 1);
  detune = this.param('detune', 0);
}

class FakeBiquad extends FakeNode {
  type = 'lowpass';
  frequency = this.param('frequency', 350);
  Q = this.param('Q', 1);
  gain = this.param('gain', 0);
  detune = this.param('detune', 0);
}

class FakeShaper extends FakeNode {
  private c: Float32Array | null = null;
  oversample = 'none';

  get curve() {
    return this.c;
  }

  set curve(c: Float32Array | null) {
    if (c && (!(c instanceof Float32Array) || c.length < 2)) throw new Error('WaveShaper curve: InvalidStateError');
    this.c = c;
  }
}

class FakeConvolver extends FakeNode {
  normalize = true;
  private b: FakeBuffer | null = null;

  get buffer() {
    return this.b;
  }

  set buffer(b: FakeBuffer | null) {
    if (b && ![1, 2, 4].includes(b.numberOfChannels)) throw new Error('Convolver: NotSupportedError (channels)');
    if (b && b.sampleRate !== this.ctx.sampleRate) throw new Error('Convolver: NotSupportedError (sample rate)');
    this.b = b;
  }
}

class FakePanner extends FakeNode {
  pan = this.param('pan', 0);
}

class FakeCompressor extends FakeNode {
  threshold = this.param('threshold', -24);
  knee = this.param('knee', 30);
  ratio = this.param('ratio', 12);
  attack = this.param('attack', 0.003);
  release = this.param('release', 0.25);
}

class FakeDelay extends FakeNode {
  delayTime: FakeParam;

  constructor(
    ctx: FakeContext,
    readonly maxDelayTime: number,
  ) {
    super(ctx, 'Delay');
    if (!(maxDelayTime > 0 && maxDelayTime < 180)) throw new Error(`createDelay(${maxDelayTime}): NotSupportedError`);
    this.delayTime = this.param('delayTime', 0);
  }
}

export class FakeBuffer {
  private data: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (!(numberOfChannels >= 1 && length >= 1 && sampleRate >= 3000)) throw new Error('createBuffer: NotSupportedError');
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  getChannelData(ch: number) {
    return this.data[ch];
  }
}

class FakePeriodicWave {
  constructor(
    readonly real: Float32Array,
    readonly imag: Float32Array,
  ) {
    if (real.length !== imag.length || real.length < 2) throw new Error('createPeriodicWave: IndexSizeError');
  }
}

export class FakeContext {
  static instances: FakeContext[] = [];
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  nodes: FakeNode[] = [];
  /** Things a browser would accept but that point at a bug. */
  issues: string[] = [];
  calls: string[] = [];
  destination: FakeNode;
  /** When set, resume() rejects (e.g. no output device). */
  failResume = false;

  constructor(readonly sampleRate = 48000) {
    FakeContext.instances.push(this);
    this.destination = new FakeNode(this, 'Destination');
  }

  createGain() {
    return new FakeGain(this, 'Gain');
  }
  createOscillator() {
    return new FakeOscillator(this, 'Oscillator');
  }
  createBufferSource() {
    return new FakeBufferSource(this, 'BufferSource');
  }
  createBiquadFilter() {
    return new FakeBiquad(this, 'Biquad');
  }
  createWaveShaper() {
    return new FakeShaper(this, 'WaveShaper');
  }
  createConvolver() {
    return new FakeConvolver(this, 'Convolver');
  }
  createStereoPanner() {
    return new FakePanner(this, 'StereoPanner');
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this, 'Compressor');
  }
  createDelay(max = 1) {
    return new FakeDelay(this, max);
  }
  createBuffer(ch: number, length: number, sr: number) {
    return new FakeBuffer(ch, length, sr);
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    return new FakePeriodicWave(real, imag);
  }

  resume() {
    this.calls.push('resume');
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    if (this.failResume) return Promise.reject(new Error('no device'));
    this.state = 'running';
    return Promise.resolve();
  }

  suspend() {
    this.calls.push('suspend');
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    this.state = 'suspended';
    return Promise.resolve();
  }

  close() {
    this.calls.push('close');
    this.state = 'closed';
    return Promise.resolve();
  }

  sources() {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }

  /** Moves the clock to `t` and fires `ended` on sources that have stopped by then. */
  advance(t: number) {
    this.currentTime = t;
    for (const s of this.sources()) {
      if (!s.ended && s.stopAt !== null && s.stopAt <= t) {
        s.ended = true;
        s.onended?.();
      }
    }
  }

  /** Every AudioParam of every node. */
  params() {
    const out: FakeParam[] = [];
    for (const n of this.nodes) for (const v of Object.values(n)) if (v instanceof FakeParam) out.push(v);
    return out;
  }
}

/** The fake, typed as the real thing for code under test. */
export const fakeContext = () => new FakeContext() as unknown as AudioContext & FakeContext;

// ---------------- offline rendering ----------------
// Plays a graph built on the fake, so tests can check what the sounds actually output (level, silence,
// NaNs, brightness). Like Chromium it works in blocks of 128 frames: a-rate automation, band-limited
// oscillators, looping buffers with linear interpolation, the spec's biquads, waveshapers and delays (a
// delay inside a feedback loop adds one block, as in Chromium). Mono: panners pass their input through.

const BLOCK = 128;

const paramsOf = (n: FakeNode) => Object.values(n).filter((v): v is FakeParam => v instanceof FakeParam);

/** An AudioParam's automation, read at increasing times. */
class Timeline {
  private readonly ev: Ev[];
  /** Value each event starts from (a setTarget starts from the value before it). */
  private readonly from: number[] = [];
  private i = 0;

  constructor(
    private readonly def: number,
    events: Ev[],
  ) {
    this.ev = events
      .map((e, k) => [e, k] as const)
      .sort((a, b) => a[0].time - b[0].time || a[1] - b[1])
      .map(([e]) => e);
    for (let k = 0; k < this.ev.length; k++) this.from.push(this.ev[k].type === 'target' ? this.at(this.ev[k].time, k) : this.ev[k].value);
  }

  /** The value at `t` using only the first `upto` events. */
  private at(t: number, upto: number) {
    let i = 0;
    while (i < upto && this.ev[i].time <= t) i++;
    return this.value(t, i, upto);
  }

  private value(t: number, i: number, n: number) {
    const prev = i > 0 ? this.ev[i - 1] : null;
    const next = i < n ? this.ev[i] : null;
    if (next && (next.type === 'lin' || next.type === 'exp')) {
      const t0 = prev ? prev.time : 0;
      const v0 = prev ? this.from[i - 1] : this.def;
      const k = next.time > t0 ? (t - t0) / (next.time - t0) : 1;
      if (next.type === 'lin') return v0 + (next.value - v0) * k;
      return v0 * next.value > 0 ? v0 * (next.value / v0) ** k : v0;
    }
    if (!prev) return this.def;
    if (prev.type === 'target') return prev.value + (this.from[i - 1] - prev.value) * Math.exp(-(t - prev.time) / Math.max(1e-9, prev.tc ?? 0));
    return prev.value;
  }

  /** Whether the value may change between `t0` and `t1` (reads must not go back in time). */
  moving(t0: number, t1: number) {
    if (!this.ev.length) return false;
    while (this.i < this.ev.length && this.ev[this.i].time <= t0) this.i++;
    const prev = this.i > 0 ? this.ev[this.i - 1] : null;
    if (prev?.type === 'target') return true;
    const next = this.i < this.ev.length ? this.ev[this.i] : null;
    return !!next && (next.type !== 'set' || next.time <= t1);
  }

  get(t: number) {
    while (this.i < this.ev.length && this.ev[this.i].time <= t) this.i++;
    return this.value(t, this.i, this.ev.length);
  }
}

/** Band-limited single-cycle tables of each waveform, by how many harmonics fit under Nyquist. */
const TABLE = 2048;
const LIMITS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];
const tables = new Map<unknown, Map<number, Float32Array>>();

function coefficients(o: FakeOscillator): [Float32Array, Float32Array] {
  if (o.wave) return [o.wave.real, o.wave.imag];
  const re = new Float32Array(513);
  const im = new Float32Array(513);
  for (let k = 1; k <= 512; k++) {
    if (o.type === 'sine') im[k] = k === 1 ? 1 : 0;
    else if (o.type === 'square') im[k] = k % 2 ? 4 / (Math.PI * k) : 0;
    else if (o.type === 'sawtooth') im[k] = ((k % 2 ? 1 : -1) * 2) / (Math.PI * k);
    else im[k] = k % 2 ? (((k - 1) / 2) % 2 ? -1 : 1) * (8 / (Math.PI * Math.PI * k * k)) : 0;
  }
  return [re, im];
}

function table(o: FakeOscillator, harmonics: number): Float32Array {
  const key = o.wave ?? o.type;
  let byLimit = tables.get(key);
  if (!byLimit) tables.set(key, (byLimit = new Map()));
  const limit = LIMITS.reduce((best, l) => (l <= harmonics ? l : best), 1);
  const cached = byLimit.get(limit);
  if (cached) return cached;
  const [re, im] = coefficients(o);
  const build = (n: number) => {
    const x = new Float32Array(TABLE + 1);
    for (let k = 1; k < Math.min(n + 1, re.length); k++) {
      if (!re[k] && !im[k]) continue;
      for (let j = 0; j < TABLE; j++) {
        const a = (2 * Math.PI * ((k * j) % TABLE)) / TABLE;
        x[j] += re[k] * Math.cos(a) + im[k] * Math.sin(a);
      }
    }
    x[TABLE] = x[0];
    return x;
  };
  // Normalized like the Web Audio API: the full-band wave peaks at 1.
  let norm = byLimit.get(-1)?.[0];
  if (norm === undefined) {
    const full = build(re.length);
    norm = 1 / Math.max(1e-9, full.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
    byLimit.set(-1, Float32Array.of(norm));
  }
  const t = build(limit).map((v) => v * norm);
  byLimit.set(limit, t);
  return t;
}

type Run = (t0: number, frame: number) => void;

/** Renders the output of `from` (mono) for `seconds` from time 0. */
export function renderFake(ctx: FakeContext, from: FakeNode, seconds: number): Float32Array {
  const sr = ctx.sampleRate;
  const nyq = sr / 2;
  const blocks = Math.ceil((seconds * sr) / BLOCK);
  const deps = (n: FakeNode) => [...n.inputs, ...paramsOf(n).flatMap((p) => p.inputs)];
  // The subgraph feeding `from`, through audio inputs and the inputs of params.
  const nodes: FakeNode[] = [];
  const seen = new Set<FakeNode>();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    nodes.push(n);
    stack.push(...deps(n));
  }

  // Delays inside a feedback loop read last block's input, so they break the loop (Tarjan's SCC).
  const cut = new Set<FakeNode>();
  let count = 0;
  const idx = new Map<FakeNode, number>();
  const low = new Map<FakeNode, number>();
  const onStack = new Set<FakeNode>();
  const st: FakeNode[] = [];
  const strong = (v: FakeNode) => {
    idx.set(v, count);
    low.set(v, count++);
    st.push(v);
    onStack.add(v);
    for (const w of deps(v)) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) !== idx.get(v)) return;
    const comp: FakeNode[] = [];
    let w: FakeNode;
    do {
      w = st.pop()!;
      onStack.delete(w);
      comp.push(w);
    } while (w !== v);
    if (comp.length > 1 || deps(v).includes(v)) {
      const delays = comp.filter((n) => n instanceof FakeDelay);
      if (!delays.length) throw new Error('renderFake: a feedback loop without a delay');
      for (const d of delays) cut.add(d);
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);

  // Processing order: dependencies first; cut delays only depend on the past.
  const order: FakeNode[] = [];
  const state = new Map<FakeNode, number>();
  const visit = (n: FakeNode) => {
    const s = state.get(n);
    if (s === 2) return;
    if (s === 1) throw new Error('renderFake: unexpected cycle');
    state.set(n, 1);
    if (!cut.has(n)) for (const d of deps(n)) visit(d);
    state.set(n, 2);
    order.push(n);
  };
  for (const n of cut) visit(n);
  visit(from);
  for (const n of cut) for (const d of deps(n)) visit(d);

  const outs = new Map<FakeNode, Float32Array>();
  const runs: Run[] = [];
  const input = (n: FakeNode, buf: Float32Array) => {
    buf.fill(0);
    for (const i of n.inputs) {
      const o = outs.get(i)!;
      for (let k = 0; k < BLOCK; k++) buf[k] += o[k];
    }
    return buf;
  };
  /** A-rate values of a param over the block (automation plus connected signals), or one number if constant. */
  const param = (prm: FakeParam) => {
    const tl = new Timeline(prm.value, prm.events);
    const buf = new Float32Array(BLOCK);
    return (t0: number): Float32Array | number => {
      if (!prm.inputs.length && !tl.moving(t0, t0 + BLOCK / sr)) return tl.get(t0);
      for (let k = 0; k < BLOCK; k++) buf[k] = tl.get(t0 + k / sr);
      for (const i of prm.inputs) {
        const o = outs.get(i)!;
        for (let k = 0; k < BLOCK; k++) buf[k] += o[k];
      }
      return buf;
    };
  };
  const val = (v: Float32Array | number, k: number) => (typeof v === 'number' ? v : v[k]);
  const feedback: { n: FakeNode; buf: Float32Array; w: number }[] = [];

  for (const n of order) {
    const out = new Float32Array(BLOCK);
    const inBuf = new Float32Array(BLOCK);
    outs.set(n, out);
    if (n instanceof FakeGain) {
      const g = param(n.gain);
      runs.push((t0) => {
        input(n, inBuf);
        const gv = g(t0);
        for (let k = 0; k < BLOCK; k++) out[k] = inBuf[k] * val(gv, k);
      });
    } else if (n instanceof FakeOscillator) {
      const f = param(n.frequency);
      const d = param(n.detune);
      const hz = new Float32Array(BLOCK);
      let phase = 0;
      runs.push((t0, frame) => {
        const fv = f(t0);
        const dv = d(t0);
        let top = 0;
        for (let k = 0; k < BLOCK; k++) {
          hz[k] = Math.max(-nyq, Math.min(nyq, val(fv, k) * (typeof dv === 'number' && dv === 0 ? 1 : 2 ** (val(dv, k) / 1200))));
          top = Math.max(top, Math.abs(hz[k]));
        }
        const tab = table(n, Math.floor(nyq / Math.max(1e-6, top)));
        for (let k = 0; k < BLOCK; k++) {
          const t = (frame + k) / sr;
          if (n.startAt === null || n.stopAt === null || t < n.startAt || t >= n.stopAt) {
            out[k] = 0;
            continue;
          }
          const x = phase * TABLE;
          const j = Math.floor(x);
          out[k] = tab[j] + (tab[j + 1] - tab[j]) * (x - j);
          phase += hz[k] / sr;
          phase -= Math.floor(phase);
        }
      });
    } else if (n instanceof FakeBufferSource) {
      const rate = param(n.playbackRate);
      let pos = -1;
      runs.push((t0, frame) => {
        const b = n.buffer;
        const r = val(rate(t0), 0);
        for (let k = 0; k < BLOCK; k++) {
          const t = (frame + k) / sr;
          if (!b || n.startAt === null || n.stopAt === null || t < n.startAt || t >= n.stopAt) {
            out[k] = 0;
            continue;
          }
          const data = b.getChannelData(0);
          // Chromium rounds the offset to a frame and starts between frames.
          if (pos < 0) pos = Math.round(n.offset * b.sampleRate) + (frame + k - n.startAt * sr) * ((r * b.sampleRate) / sr);
          if (pos >= b.length) {
            if (!n.loop) {
              out[k] = 0;
              continue;
            }
            pos %= b.length;
          }
          const j = Math.floor(pos);
          const next = j + 1 < b.length ? data[j + 1] : n.loop ? data[0] : 0;
          out[k] = data[j] + (next - data[j]) * (pos - j);
          pos += (r * b.sampleRate) / sr;
        }
      });
    } else if (n instanceof FakeBiquad) {
      const f = param(n.frequency);
      const q = param(n.Q);
      const gn = param(n.gain);
      const dt = param(n.detune);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      const c = [0, 0, 0, 0, 0];
      // The Web Audio spec's biquads (Q in dB for low- and high-pass).
      const coef = (freq: number, Q: number, G: number) => {
        const w0 = (2 * Math.PI * Math.max(1, Math.min(nyq * 0.999, freq))) / sr;
        const cw = Math.cos(w0);
        const sw = Math.sin(w0);
        const A = 10 ** (G / 40);
        const aq = sw / (2 * Math.max(1e-4, Q));
        const adb = sw / (2 * 10 ** (Q / 20));
        const as = (sw / 2) * Math.SQRT2;
        const ra = 2 * as * Math.sqrt(A);
        let k: number[];
        switch (n.type) {
          case 'lowpass':
            k = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + adb, -2 * cw, 1 - adb];
            break;
          case 'highpass':
            k = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + adb, -2 * cw, 1 - adb];
            break;
          case 'bandpass':
            k = [aq, 0, -aq, 1 + aq, -2 * cw, 1 - aq];
            break;
          case 'notch':
            k = [1, -2 * cw, 1, 1 + aq, -2 * cw, 1 - aq];
            break;
          case 'allpass':
            k = [1 - aq, -2 * cw, 1 + aq, 1 + aq, -2 * cw, 1 - aq];
            break;
          case 'peaking':
            k = [1 + aq * A, -2 * cw, 1 - aq * A, 1 + aq / A, -2 * cw, 1 - aq / A];
            break;
          case 'lowshelf':
            k = [A * (A + 1 - (A - 1) * cw + ra), 2 * A * (A - 1 - (A + 1) * cw), A * (A + 1 - (A - 1) * cw - ra), A + 1 + (A - 1) * cw + ra, -2 * (A - 1 + (A + 1) * cw), A + 1 + (A - 1) * cw - ra];
            break;
          case 'highshelf':
            k = [A * (A + 1 + (A - 1) * cw + ra), -2 * A * (A - 1 + (A + 1) * cw), A * (A + 1 + (A - 1) * cw - ra), A + 1 - (A - 1) * cw + ra, 2 * (A - 1 - (A + 1) * cw), A + 1 - (A - 1) * cw - ra];
            break;
          default:
            throw new Error(`renderFake: biquad type ${n.type}`);
        }
        c[0] = k[0] / k[3];
        c[1] = k[1] / k[3];
        c[2] = k[2] / k[3];
        c[3] = k[4] / k[3];
        c[4] = k[5] / k[3];
      };
      runs.push((t0) => {
        input(n, inBuf);
        const fv = f(t0);
        const qv = q(t0);
        const gv = gn(t0);
        const dv = dt(t0);
        const still = typeof fv === 'number' && typeof qv === 'number' && typeof gv === 'number' && typeof dv === 'number';
        for (let k = 0; k < BLOCK; k++) {
          if (k === 0 || (!still && k % 4 === 0)) coef(val(fv, k) * 2 ** (val(dv, k) / 1200), val(qv, k), val(gv, k));
          const x = inBuf[k];
          const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
          x2 = x1;
          x1 = x;
          y2 = y1;
          y1 = Math.abs(y) < 1e-30 ? 0 : y;
          out[k] = y;
        }
      });
    } else if (n instanceof FakeShaper) {
      // Chromium's oversampling filters delay the output: 128 frames at 2x, 192 at 4x.
      const H = 256;
      const lag = new Float32Array(H + BLOCK);
      runs.push(() => {
        input(n, inBuf);
        const cv = n.curve;
        const late = n.oversample === '2x' ? 128 : n.oversample === '4x' ? 192 : 0;
        for (let k = 0; k < BLOCK; k++) {
          let y = inBuf[k];
          if (cv) {
            const v = ((cv.length - 1) / 2) * (inBuf[k] + 1);
            if (!(v > 0)) y = cv[0];
            else if (v >= cv.length - 1) y = cv[cv.length - 1];
            else {
              const j = Math.floor(v);
              y = cv[j] + (cv[j + 1] - cv[j]) * (v - j);
            }
          }
          lag[H + k] = y;
        }
        for (let k = 0; k < BLOCK; k++) out[k] = lag[H + k - late];
        lag.copyWithin(0, BLOCK);
      });
    } else if (n instanceof FakeDelay) {
      const dly = param(n.delayTime);
      const size = Math.ceil(n.maxDelayTime * sr) + 4 * BLOCK;
      const h = { n, buf: new Float32Array(size), w: 0 };
      const loop = cut.has(n);
      if (loop) feedback.push(h);
      const wrap = (j: number) => ((j % size) + size) % size;
      runs.push((t0) => {
        const dv = dly(t0);
        if (!loop) {
          input(n, inBuf);
          for (let k = 0; k < BLOCK; k++) h.buf[(h.w + k) % size] = inBuf[k];
        }
        for (let k = 0; k < BLOCK; k++) {
          const x = h.w + k - (Math.max(0, Math.min(n.maxDelayTime, val(dv, k))) * sr + (loop ? BLOCK : 0));
          const j = Math.floor(x);
          const a = h.buf[wrap(j)];
          out[k] = a + (h.buf[wrap(j + 1)] - a) * (x - j);
        }
        if (!loop) h.w += BLOCK;
      });
    } else if (n instanceof FakeConvolver || n instanceof FakeCompressor) {
      throw new Error(`renderFake: can't render a ${n.kind} (render the patch, not the mixer)`);
    } else {
      // Panners, the destination: mono pass-through.
      runs.push(() => {
        input(n, inBuf);
        out.set(inBuf);
      });
    }
  }

  const result = new Float32Array(blocks * BLOCK);
  const tmp = new Float32Array(BLOCK);
  const last = outs.get(from)!;
  for (let b = 0; b < blocks; b++) {
    const frame = b * BLOCK;
    for (const run of runs) run(frame / sr, frame);
    // Feedback delays take in this block's input, for later blocks.
    for (const h of feedback) {
      input(h.n, tmp);
      for (let k = 0; k < BLOCK; k++) h.buf[(h.w + k) % h.buf.length] = tmp[k];
      h.w += BLOCK;
    }
    result.set(last, frame);
  }
  return result;
}

// ---------------- analysis ----------------

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * c - im[b] * s;
        const xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

export interface Analysis {
  /** Peak and RMS (over the whole render), dBFS. */
  peak: number;
  rms: number;
  /** Power-weighted mean frequency, Hz. */
  centroid: number;
  /** Share of the power below 250 Hz (bass you feel) and above 1500 Hz (rasp, hiss, whistles). */
  low: number;
  high: number;
  /** No NaN or infinity anywhere. */
  finite: boolean;
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200);

/** Level and spectrum of a rendered signal. */
export function analyse(x: Float32Array, sampleRate: number): Analysis {
  let peak = 0;
  let ss = 0;
  let finite = true;
  for (const v of x) {
    if (!Number.isFinite(v)) finite = false;
    else {
      peak = Math.max(peak, Math.abs(v));
      ss += v * v;
    }
  }
  const N = 2048;
  let sum = 0;
  let wsum = 0;
  let low = 0;
  let high = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let c = 0; c + N <= x.length; c += N / 2) {
    for (let i = 0; i < N; i++) {
      const v = x[c + i];
      re[i] = (Number.isFinite(v) ? v : 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const pw = re[k] * re[k] + im[k] * im[k];
      const f = (k * sampleRate) / N;
      sum += pw;
      wsum += pw * f;
      if (f < 250) low += pw;
      else if (f > 1500) high += pw;
    }
  }
  const share = (x: number) => (sum ? x / sum : 0);
  return { peak: toDb(peak), rms: toDb(Math.sqrt(ss / Math.max(1, x.length))), centroid: share(wsum), low: share(low), high: share(high), finite };
}
