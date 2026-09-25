// A small, strict stand-in for the Web Audio API so the synth can be tested in Node. It records the
// graph and every automation event, throws where browsers throw (exponential ramps to 0, non-finite
// values, starting a source twice, connecting across contexts...) and notes anything suspicious that
// browsers silently accept (automation scheduled out of order, exponential ramps from 0).

type Ev = { type: 'set' | 'lin' | 'exp' | 'target'; value: number; time: number };

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

  private add(type: Ev['type'], value: number, time: number) {
    if (!Number.isFinite(value)) throw new TypeError(`${this.label} ${type} value ${value}`);
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`${this.label} ${type} time ${time}`);
    const last = this.events[this.events.length - 1];
    if (last && time < last.time - 1e-9) this.ctx.issues.push(`${this.label}: ${type} at ${time.toFixed(4)} before ${last.time.toFixed(4)}`);
    this.events.push({ type, value, time });
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
    return this.add('target', v, t);
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
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0) {
    if (this.startAt !== null) throw new Error(`${this.kind}: InvalidStateError (started twice)`);
    if (!Number.isFinite(when) || when < 0 || !Number.isFinite(offset) || offset < 0) throw new RangeError(`${this.kind}: start(${when}, ${offset})`);
    this.startAt = when;
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
  sampleRate = 48000;
  state: 'running' | 'suspended' | 'closed' = 'running';
  nodes: FakeNode[] = [];
  /** Things a browser would accept but that point at a bug. */
  issues: string[] = [];
  calls: string[] = [];
  destination: FakeNode;
  /** When set, resume() rejects (e.g. no output device). */
  failResume = false;

  constructor() {
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
