// The live audio engine shared by the overlay (pet sounds) and the panel (UI sounds). The app runs all
// day, so it is frugal: the AudioContext is created on the first sound, suspended ~4 s after the last
// one ends (a running context keeps the audio device busy) and whenever asked to sleep. Busy moments
// drop the least important sounds, and any failure (no audio device...) is silent.

import { Mixer } from './mixer';
import { clamp, Patch, type Rand } from './synth';

export interface EngineOpts {
  /** Suspend the context this long after the last sound ends (ms). */
  idleMs?: number;
  /** Above this many playing sounds, droppable ones are skipped. */
  maxVoices?: number;
  /** Makes the context (tests inject a fake). */
  create?: () => AudioContext;
  /** Random source for the per-play variation (tests make it repeatable). */
  rand?: Rand;
}

export interface Play {
  /** Output level multiplier (e.g. SOFT). */
  level?: number;
  /** Stereo position -1..1. */
  pan?: number;
  /** Skipped when many sounds are playing, or when the same one just started. */
  droppable?: boolean;
  /** Identifies the sound for the repeat guard. */
  key?: string;
}

/** Schedule this far ahead so a sound never starts in the past. */
const LEAD = 0.015;
/** Reverb tail to let ring out before suspending. */
const TAIL = 1.3;
/** Fade-out when put to sleep mid-sound, seconds. */
const FADE = 0.04;
/** Never more than this many sounds at once. */
const HARD_CAP = 24;
/** After a failure to open the audio device, wait before trying again (ms). */
const RETRY_MS = 30_000;

export class Engine {
  private on = true;
  private vol = 0.5;
  private ctx: AudioContext | null = null;
  private mix: Mixer | null = null;
  private readonly active = new Set<Patch>();
  private readonly lastStart = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busyUntil = 0;
  private failedAt = -Infinity;
  private fading = false;

  constructor(private readonly opts: EngineOpts = {}) {}

  get enabled() {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = !!on;
    if (!this.on) this.sleep();
  }

  get volume() {
    return this.vol;
  }

  set volume(v: number) {
    this.vol = Number.isFinite(v) ? clamp(v) : 0;
    try {
      this.mix?.setVolume(this.vol);
    } catch {
      /* audio is optional */
    }
    if (this.vol <= 0) this.sleep();
  }

  /** Number of sounds currently playing. */
  get playing() {
    return this.active.size;
  }

  /** The context, if one was created (for tests and tools). */
  get context() {
    return this.ctx;
  }

  /** Builds a sound with `build` and plays it now. Returns false if it was skipped. */
  play(build: (p: Patch) => void, o: Play = {}): boolean {
    if (!this.on || this.vol <= 0) return false;
    let p: Patch | null = null;
    try {
      // A new sound while fading out for sleep: finish going to sleep first.
      if (this.fading) this.release(true);
      const n = this.active.size;
      if (n >= HARD_CAP || (o.droppable && n >= (this.opts.maxVoices ?? 12))) return false;
      const ctx = this.open();
      if (!ctx || !this.mix) return false;
      const now = ctx.currentTime;
      if (o.droppable && o.key) {
        // The same small sound twice within 40 ms just sounds like a flam.
        const last = this.lastStart.get(o.key);
        if (last !== undefined && now - last < 0.04 && now >= last) return false;
        this.lastStart.set(o.key, now);
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      p = new Patch(ctx, now + LEAD, this.opts.rand);
      build(p);
      if (o.level !== undefined) p.out.gain.value *= o.level;
      this.mix.route(p, o.pan ?? 0);
      const patch = p;
      this.active.add(patch);
      patch.onDone = () => this.active.delete(patch);
      this.keepAwake(patch.end + (patch.send > 0 ? TAIL : 0.2));
      return true;
    } catch {
      p?.cut();
      return false;
    }
  }

  /** Releases the audio device now: fades out what is playing (so it doesn't click) and suspends. */
  sleep() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.fading) return;
    if (this.ctx?.state === 'running' && this.mix && this.active.size) {
      try {
        this.mix.fade(FADE);
        this.fading = true;
        this.timer = setTimeout(() => this.release(true), FADE * 1000 + 20);
        return;
      } catch {
        /* just stop */
      }
    }
    this.release(this.active.size > 0);
  }

  /** Closes the context for good (the window is going away). */
  close() {
    this.release(true);
    const ctx = this.ctx;
    this.ctx = null;
    this.mix = null;
    ctx?.close().catch(() => {});
  }

  /** Stops whatever still plays and suspends the context. After cutting sounds short (`cut`), the bus is
   *  rebuilt for the next sound, so their frozen reverb tail doesn't come back on resume. */
  private release(cut: boolean) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.fading = false;
    for (const p of [...this.active]) p.cut();
    this.active.clear();
    this.busyUntil = 0;
    if (cut && this.mix) {
      this.mix.dispose();
      this.mix = null;
    }
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  }

  private open(): AudioContext | null {
    if (this.ctx && this.ctx.state !== 'closed') {
      this.mix ??= new Mixer(this.ctx, this.ctx.destination, this.vol);
      return this.ctx;
    }
    this.ctx = null;
    this.mix = null;
    if (Date.now() - this.failedAt < RETRY_MS) return null;
    let ctx: AudioContext | null = null;
    try {
      ctx = this.opts.create ? this.opts.create() : new AudioContext({ latencyHint: 'balanced' });
      this.mix = new Mixer(ctx, ctx.destination, this.vol);
      this.ctx = ctx;
      return ctx;
    } catch {
      this.failedAt = Date.now();
      this.mix = null;
      ctx?.close().catch(() => {});
      return null;
    }
  }

  /** (Re)arms the idle timer: suspend `idleMs` after the last sound, once everything has rung out. */
  private keepAwake(until: number, idleMs = this.opts.idleMs ?? 4000) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.busyUntil = Math.max(this.busyUntil, until);
    clearTimeout(this.timer);
    const ms = Math.max(idleMs, (this.busyUntil - ctx.currentTime) * 1000 + 250);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // Anything still ringing (e.g. the clock ran slow while resuming)? Check again later.
      if (ctx.state === 'running' && ctx.currentTime < this.busyUntil) return this.keepAwake(this.busyUntil, 0);
      this.release(false);
    }, ms);
  }
}
