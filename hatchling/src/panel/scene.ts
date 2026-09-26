// The habitat: a little living diorama at the top of the panel. The pet (drawn with the same
// rig and renderer as on the desktop) wanders, sniffs, sits, naps when it's tired, looks at
// your cursor and reacts to the panel's buttons. Capped at 30 fps; it stops completely while
// the window is hidden or the canvas is off screen, and only one scene runs at a time.

import { drawEgg, drawPet, type Palette } from '../pet/draw';
import { applyPose, type PoseName } from '../pet/poses';
import { type Pose, Rig } from '../pet/rig';
import type { SpeciesDef } from '../pet/species';
import { Land } from './land';
import type { Reaction } from './state';
import type { Biome } from './theme';
import { type FoodKind, foodOf } from './util';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const FRAME = 1000 / 30;
/** While the window is in the background, half the frame rate is plenty. */
const FRAME_IDLE = 1000 / 15;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export interface Subject {
  /** Identity: when it changes the scene starts over with a fresh rig. */
  key: string;
  species: SpeciesDef;
  pal: Palette;
  growth: number;
  egg: boolean;
  /** 0..1: a tired pet sits and naps more. */
  energy: number;
  shiny: boolean;
}

export interface SceneOpts {
  subject: () => Subject;
  biome: () => Biome;
  /** Reduced motion: no wandering, no bursts. */
  calm: () => boolean;
  /** The pet was clicked. */
  onPet?: () => void;
  /** The egg was clicked. */
  onEgg?: () => void;
  /** The egg just hatched in front of you (for confetti and a sound). */
  onHatch?: (x: number, y: number) => void;
  /** Egg chooser preview: never naps. */
  preview?: boolean;
}

type ActK = 'idle' | 'walk' | 'run' | 'sit' | 'nap' | 'sniff' | 'look' | 'happy' | 'eat' | 'chase' | 'stretch' | 'dance' | 'roar' | 'spin' | 'dizzy' | 'shake' | 'call' | 'hatch';
interface Act {
  k: ActK;
  /** Seconds left (walks end on arrival). */
  t: number;
  tx?: number;
  /** Counter (kicks, spins). */
  n?: number;
  /** Timer inside the act. */
  e?: number;
  then?: () => void;
}

type PartKind = 'heart' | 'z' | 'note' | 'spark' | 'crumb' | 'drop' | 'dust' | 'bang' | 'star';
interface Particle {
  kind: PartKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
}

interface Food {
  x: number;
  y: number;
  vy: number;
  kind: FoodKind;
  bites: number;
  landed: boolean;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  fade: number;
}

let running: Scene | null = null;

export class Scene {
  private canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private o: SceneOpts;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private land: Land | null = null;
  private landKey = '';
  private rig: Rig | null = null;
  private key = '';
  private speciesId = '';
  private k = 1;
  private kKey = '';
  private growth = -1;
  private x = 0;
  private facing: 1 | -1 = 1;
  private hop = 0;
  private act: Act = { k: 'idle', t: 1 };
  private parts: Particle[] = [];
  private food: Food | null = null;
  private ball: Ball | null = null;
  private wasEgg: boolean | null = null;
  private eggWob = 0;
  private eggWobT = 0;
  private nextWob = 2;
  private hatchT = -1;
  private sparkT = 0;
  private par = 0;
  private time = 0;
  private mouse: { x: number; y: number; t: number } | null = null;
  private turnDelay = 0;
  private raf = 0;
  private last = 0;
  private wanted = false;
  private onScreen = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver;

  constructor(canvas: HTMLCanvasElement, opts: SceneOpts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.o = opts;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver((e) => {
      this.onScreen = e.some((x) => x.isIntersecting);
      this.schedule();
    });
    this.io.observe(canvas);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
    document.addEventListener('visibilitychange', this.schedule);
    this.resize();
  }

  start() {
    if (running && running !== this) running.stop();
    running = this;
    this.wanted = true;
    this.schedule();
  }

  stop() {
    this.wanted = false;
    if (running === this) running = null;
    this.schedule();
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
    this.io.disconnect();
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('visibilitychange', this.schedule);
  }

  /** Draws a frame right now (e.g. inside a theme transition, before the snapshot). */
  redraw() {
    this.landKey = '';
    if (this.w > 0) this.draw(0);
  }

  // ---------------- loop ----------------

  private schedule = () => {
    const go = this.wanted && this.onScreen && !document.hidden && this.w > 0;
    if (go && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!go && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  };

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const el = now - this.last;
    if (el < (document.hasFocus() ? FRAME : FRAME_IDLE) - 3) return;
    this.last = now;
    const dt = Math.min(0.1, el / 1000);
    this.update(dt);
    this.draw(dt);
  };

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.landKey = '';
    this.kKey = '';
    if (!this.rig) this.x = w * 0.5;
    this.x = clamp(this.x, 0, w);
    if (w > 0) this.draw(0);
    this.schedule();
  }

  private ensureLand(): Land {
    const b = this.o.biome();
    const key = `${b.id}:${this.w}x${this.h}@${this.dpr}`;
    const hour = hourNow();
    if (!this.land || key !== this.landKey) {
      const groundTop = Math.round(this.h * 0.76);
      const groundY = Math.round(this.h * 0.885);
      this.land = new Land(this.w, this.h, this.dpr, b, groundTop, groundY, hour);
      this.landKey = key;
    } else this.land.refresh(hour);
    return this.land;
  }

  // ---------------- input ----------------

  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, t: this.time };
    this.canvas.style.cursor = this.hit(this.mouse.x, this.mouse.y) ? 'pointer' : '';
  };

  private onLeave = () => {
    this.mouse = null;
    this.canvas.style.cursor = '';
  };

  private onClick = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    if (!this.hit(mx, my)) return;
    const s = this.o.subject();
    if (s.egg) {
      this.eggWobT = 0.8;
      this.burst('spark', this.x, this.land!.groundY - 40, 5, '#fff3a8');
      this.o.onEgg?.();
      return;
    }
    if (this.act.k === 'hatch') return;
    this.o.onPet?.();
    if (this.act.k === 'nap') this.set('stretch', 1.3, () => this.cheer(1.6));
    else this.cheer(1.8);
  };

  private hit(mx: number, my: number): boolean {
    const land = this.land;
    if (!land) return false;
    const s = this.o.subject();
    if (s.egg) {
      const eh = this.eggSize();
      return Math.abs(mx - this.x) < eh * 0.45 && my > land.groundY - eh - 6 && my < land.groundY + 8;
    }
    const rig = this.rig;
    if (!rig) return false;
    const px = this.k * rig.size;
    const face = rig.face >= 0 ? 1 : -1;
    const baseY = land.groundY - this.hop;
    for (const c of rig.hitCircles()) {
      const cx = this.x + c.p.x * px * face;
      const cy = baseY - c.p.y * px;
      if (Math.hypot(mx - cx, my - cy) < c.r * px + 4) return true;
    }
    return false;
  }

  // ---------------- reactions from the panel ----------------

  react(r: Reaction) {
    const s = this.o.subject();
    if (s.egg || !this.rig || this.act.k === 'hatch') {
      if (s.egg) this.eggWobT = 0.8;
      return;
    }
    const calm = this.o.calm();
    const land = this.land!;
    const [lo, hi] = this.range();
    switch (r) {
      case 'feed': {
        let fx = rand(lo, hi);
        if (Math.abs(fx - this.x) < 60) fx = clamp(this.x + (this.x < this.w / 2 ? 90 : -90), lo, hi);
        this.food = { x: fx, y: calm ? land.groundY - 4 : -12, vy: 0, kind: foodOf(s.species), bites: 0, landed: calm };
        this.goEat();
        break;
      }
      case 'play': {
        const bx = clamp(this.x + this.facing * rand(70, 120), 30, this.w - 30);
        this.ball = { x: bx, y: calm ? land.groundY - 9 : -14, vx: 0, vy: 0, r: 8.5, rot: 0, fade: 1 };
        this.act = { k: 'chase', t: 10, n: 0 };
        break;
      }
      case 'call':
        this.walkTo(this.w / 2, true, () => this.set('call', 1.4, () => this.cheer(1.2)));
        break;
      case 'sleep':
        this.set('nap', 40);
        break;
      case 'wake':
        this.set('stretch', 1.4, () => this.cheer(1.2));
        break;
      case 'dance':
        this.act = { k: 'dance', t: 3.4, e: 0 };
        break;
      case 'roar':
        this.set('roar', 1.7, () => this.set('idle', 1));
        this.burst('bang', this.headX(), this.headY(), 7, '#ffffff');
        break;
      case 'spin':
        this.act = { k: 'spin', t: 1.3, e: 0, n: 0 };
        break;
      case 'sit':
        this.set('sit', 4.5);
        break;
      case 'shake':
        this.set('shake', 1.5, () => this.set('idle', 1));
        break;
      case 'sparkle':
      case 'treat':
        this.burst('spark', this.x, land.groundY - this.petHeight() * 0.55, 12, '#fff3a8');
        this.cheer(1.2);
        break;
      case 'jump':
        this.set('happy', 1.6);
        this.burst('dust', this.x, land.groundY - 4, 5, '#ffffff');
        break;
      case 'bow':
        this.set('sniff', 1.2, () => this.cheer(1));
        break;
      case 'playdead':
        this.set('nap', 2.6, () => this.set('stretch', 1.2, () => this.cheer(1)));
        break;
      case 'special':
        this.set('roar', 1.5, () => this.cheer(1));
        this.burst('bang', this.headX(), this.headY(), 7, '#ffffff');
        break;
      case 'ball':
        this.react('play');
        break;
      case 'bubbles':
      case 'bone':
      case 'duck':
      case 'laser':
      case 'puddle':
        this.burst('note', this.headX(), this.headY(), 3, '#7cc6ff');
        this.cheer(1.4);
        break;
    }
  }

  // ---------------- behaviour ----------------

  private set(k: ActK, t: number, then?: () => void) {
    this.act = { k, t, then };
  }

  private cheer(t: number) {
    this.set('happy', t);
    if (this.o.calm()) return;
    const y = this.land ? this.land.groundY - this.petHeight() * 0.9 : 0;
    this.burst('heart', this.headX(), y, 3, '#ff5c8a');
  }

  private walkTo(tx: number, run: boolean, then?: () => void) {
    const [lo, hi] = this.range();
    this.act = { k: run ? 'run' : 'walk', t: 12, tx: clamp(tx, lo, hi), then };
  }

  private goEat() {
    const f = this.food;
    if (!f || !this.rig) return;
    const dir = f.x >= this.x ? 1 : -1;
    const reach = this.mouthReach();
    this.walkTo(f.x - dir * reach, false, () => {
      this.facing = dir;
      this.set('eat', 2.6, () => {
        this.food = null;
        this.cheer(1.6);
      });
    });
  }

  private think() {
    const s = this.o.subject();
    const calm = this.o.calm();
    const night = this.land ? this.land.light.night : 0;
    const tired = !this.o.preview && s.energy < 0.22;
    const sleepy = !this.o.preview && s.energy < 0.45;
    // Unfinished business first: food on the ground, a ball to chase.
    if (this.food?.landed) return this.goEat();
    if (this.ball && this.ball.fade >= 1) {
      this.act = { k: 'chase', t: 8, n: 0 };
      return;
    }
    const r = Math.random();
    if (tired && r < 0.75) return this.set('nap', rand(14, 26));
    if (calm) return this.set(r < 0.2 ? 'sit' : 'idle', rand(3, 6));
    const [lo, hi] = this.range();
    if (r < 0.42) {
      let tx = rand(lo, hi);
      if (Math.abs(tx - this.x) < 50) tx = this.x + (this.x < (lo + hi) / 2 ? 80 : -80);
      return this.walkTo(tx, !this.o.preview && Math.random() < 0.08 * (1 + s.species.personality.playfulness));
    }
    if (r < 0.54) return this.set('sniff', rand(1.8, 3));
    if (r < 0.64 + (sleepy ? 0.12 : 0)) return this.set('sit', rand(4, 8));
    if (r < 0.7 && night > 0.5) return this.set('look', rand(2.5, 4));
    if (r < 0.75) return this.set('happy', rand(1.2, 2));
    return this.set('idle', rand(2, 4));
  }

  /** x range the pet can stand in without poking out of the scene. */
  private range(): [number, number] {
    const rig = this.rig;
    if (!rig) return [this.w * 0.2, this.w * 0.8];
    const px = this.k * rig.size;
    const b = rig.s.bounds;
    const m = Math.max(-b.x1, b.x2) * px + 8;
    const lo = Math.min(this.w / 2, m);
    return [lo, Math.max(lo, this.w - m)];
  }

  private petHeight() {
    return this.rig ? this.rig.height * this.rig.size * this.k : 40;
  }

  private mouthReach() {
    const rig = this.rig!;
    return Math.max(4, rig.s.mouth.x * 0.92) * this.k * rig.size;
  }

  private headX() {
    const rig = this.rig;
    if (!rig) return this.x;
    return this.x + rig.s.headO.x * this.k * rig.size * (rig.face >= 0 ? 1 : -1);
  }

  private headY() {
    const rig = this.rig;
    if (!rig || !this.land) return 0;
    return this.land.groundY - (rig.s.top.y + 6) * this.k * rig.size;
  }

  private eggSize() {
    return Math.min(70, this.h * 0.38);
  }

  private scaleFor(sp: SpeciesDef): number {
    const key = `${sp.id}:${this.w}x${this.h}`;
    if (key === this.kKey) return this.k;
    const adult = new Rig(sp, 1, () => 0.5);
    const len = adult.p.tailLen + adult.p.bodyLen + adult.p.neckLen + adult.p.headLen;
    const groundY = this.h * 0.885;
    this.k = Math.min(1.5, (groundY - 14) / (adult.height * 1.1), (this.w * 0.58) / len);
    this.kKey = key;
    return this.k;
  }

  private update(dt: number) {
    this.time += dt;
    const s = this.o.subject();
    const calm = this.o.calm();
    const land = this.ensureLand();
    if (s.key !== this.key || s.species.id !== this.speciesId) {
      this.key = s.key;
      this.speciesId = s.species.id;
      this.rig = new Rig(s.species, s.growth);
      this.growth = s.growth;
      applyPose(this.rig, 'stand');
      this.poseKey = 'stand';
      this.x = this.w * 0.5;
      this.facing = Math.random() < 0.5 ? 1 : -1;
      this.rig.facing = this.facing;
      this.rig.face = this.facing;
      this.act = { k: 'idle', t: 0.8 };
      this.food = null;
      this.ball = null;
      this.parts = [];
      this.hatchT = -1;
      this.wasEgg = s.egg;
    }
    this.scaleFor(s.species);
    const rig = this.rig!;
    if (Math.abs(s.growth - this.growth) > 1e-4) {
      const jump = Math.abs(s.growth - this.growth) > 0.05;
      this.growth = s.growth;
      rig.setGrowth(s.growth);
      if (jump && !calm) {
        this.burst('dust', this.x, land.groundY - 6, 8, '#ffffff');
        this.cheer(1.2);
      }
      const [lo, hi] = this.range();
      this.x = clamp(this.x, lo, hi);
    }
    // Hatching in front of you.
    if (this.wasEgg && !s.egg) {
      this.wasEgg = false;
      this.hatchT = 0;
      this.act = { k: 'hatch', t: 2.2 };
    }
    this.wasEgg = s.egg;
    this.updateParticles(dt);
    if (s.egg) {
      this.updateEgg(dt, calm);
      return;
    }
    if (this.hatchT >= 0) {
      this.hatchT += dt;
      if (this.hatchT > 0.95 && this.hatchT - dt <= 0.95) {
        this.burst('spark', this.x, land.groundY - this.eggSize() * 0.6, 14, '#fff3a8');
        this.o.onHatch?.(this.x, land.groundY - this.eggSize() * 0.5);
      }
      if (this.hatchT > 2.2) {
        this.hatchT = -1;
        this.cheer(1.8);
      }
    }
    this.updateFood(dt, land);
    this.updateBall(dt, land);
    this.behave(dt, s, land, calm);
    // Shiny sparkles.
    if (s.shiny && !calm && (this.sparkT -= dt) <= 0) {
      this.sparkT = rand(0.35, 0.7);
      const c = rig.hitCircles();
      const q = c[Math.floor(Math.random() * Math.min(c.length, 6))];
      const px = this.k * rig.size;
      this.parts.push({ kind: 'star', x: this.x + q.p.x * px * (rig.face >= 0 ? 1 : -1) + rand(-6, 6), y: land.groundY - q.p.y * px + rand(-6, 6), vx: 0, vy: -6, g: 0, life: 0.9, max: 0.9, size: rand(3, 5.5), rot: 0, vr: 0, color: '#fff6c2' });
    }
    // The far hills drift a little as the pet moves: a hint of depth.
    const target = calm ? 0 : -clamp((this.x - this.w / 2) / (this.w / 2), -1, 1);
    this.par += (target - this.par) * Math.min(1, dt * 1.5);
  }

  private updateEgg(dt: number, calm: boolean) {
    this.x = this.w * 0.5;
    if (calm) {
      this.eggWob = 0;
      return;
    }
    if (this.eggWobT > 0) {
      this.eggWobT -= dt;
      this.eggWob = Math.sin(this.time * 26) * 0.14 * Math.min(1, this.eggWobT / 0.3);
    } else {
      this.eggWob *= 0.8;
      if ((this.nextWob -= dt) <= 0) {
        this.nextWob = rand(2.2, 4.2);
        this.eggWobT = rand(0.45, 0.8);
      }
    }
  }

  private behave(dt: number, s: Subject, land: Land, calm: boolean) {
    const rig = this.rig!;
    const a = this.act;
    const px = this.k * rig.size;
    const pers = s.species.personality;
    const walkV = (26 + 34 * pers.speed) * 0.85;
    let speed = 0;
    let run = 0;
    let pose: PoseName = 'stand';
    let extra: Partial<Pose> | undefined;
    let lookMouse = true;
    this.hop = 0;
    a.t -= dt;
    switch (a.k) {
      case 'walk':
      case 'run': {
        const dx = (a.tx ?? this.x) - this.x;
        const dir = dx >= 0 ? 1 : -1;
        if (Math.abs(dx) < 3) {
          this.done();
          break;
        }
        if (dir !== this.facing) this.facing = dir;
        // Don't moonwalk: wait for the turn to finish.
        if (Math.abs(rig.face - this.facing) < 0.6) {
          speed = (a.k === 'run' ? walkV * 2.2 : walkV) * Math.min(1, Math.abs(dx) / 18 + 0.35);
          run = a.k === 'run' ? 1 : 0;
          this.x += dir * Math.min(Math.abs(dx), speed * px * dt);
        }
        if (a.t <= 0) this.done();
        break;
      }
      case 'chase': {
        const b = this.ball;
        if (!b || a.t <= 0 || (a.n ?? 0) >= 3) {
          if (b) b.fade = Math.min(b.fade, 0.99);
          this.cheer(1.4);
          break;
        }
        const reach = (rig.p.bodyLen * 0.4 + rig.p.neckLen * 0.4 + rig.p.headLen * 0.6) * px;
        const dir = b.x >= this.x ? 1 : -1;
        const tx = b.x - dir * reach;
        const dx = tx - this.x;
        if (dir !== this.facing && Math.abs(b.x - this.x) > 6) this.facing = dir;
        if (Math.abs(dx) > 4 && Math.abs(rig.face - this.facing) < 0.6) {
          speed = walkV * 2.1;
          run = 1;
          this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * px * dt);
        }
        const [lo, hi] = this.range();
        this.x = clamp(this.x, lo - 20, hi + 20);
        a.e = (a.e ?? 9) + dt;
        if (a.e > 0.7 && Math.abs(dx) < 10 && b.y > land.groundY - b.r - 14) {
          // Nudge it with the snout, back toward the middle.
          const toMid = b.x < this.w / 2 ? 1 : -1;
          b.vx = toMid * rand(150, 240);
          b.vy = -rand(170, 260);
          a.n = (a.n ?? 0) + 1;
          a.e = 0;
          this.burst('dust', b.x, land.groundY - 2, 4, '#ffffff');
        }
        break;
      }
      case 'sit':
        pose = 'sit';
        if (a.t <= 0) this.done();
        break;
      case 'nap':
        pose = 'sleep';
        lookMouse = false;
        if (!calm && Math.random() < dt * 0.9) this.parts.push({ kind: 'z', x: this.headX() + this.facing * 6, y: this.headY() + 8, vx: this.facing * 5, vy: -14, g: 0, life: 2.2, max: 2.2, size: rand(10, 14), rot: rand(-0.3, 0.3), vr: 0, color: '#ffffff' });
        if (a.t <= 0) this.set('stretch', 1.3, () => this.set('idle', 1.5));
        break;
      case 'sniff':
        pose = 'sniff';
        lookMouse = false;
        if (a.t <= 0) this.done();
        break;
      case 'look':
        pose = 'look_up';
        lookMouse = false;
        if (a.t <= 0) this.done();
        break;
      case 'happy':
        pose = 'happy';
        if (a.t <= 0) this.done();
        break;
      case 'eat':
        pose = 'eat';
        lookMouse = false;
        if (this.food && !calm && Math.random() < dt * 5) {
          const mx = this.x + this.facing * this.mouthReach();
          this.parts.push({ kind: 'crumb', x: mx, y: land.groundY - 6, vx: rand(-40, 40), vy: -rand(40, 90), g: 300, life: 0.7, max: 0.7, size: rand(1.5, 2.8), rot: 0, vr: 0, color: CRUMB[this.food.kind] });
        }
        if (this.food) this.food.bites = 1 - Math.max(0, a.t) / 2.6;
        if (a.t <= 0) this.done();
        break;
      case 'stretch':
        pose = 'stretch';
        lookMouse = false;
        if (a.t <= 0) this.done();
        break;
      case 'call':
        pose = 'chirp';
        if (!calm && Math.random() < dt * 3) this.burst('note', this.headX(), this.headY(), 1, '#ffffff');
        if (a.t <= 0) this.done();
        break;
      case 'dance': {
        pose = 'happy';
        a.e = (a.e ?? 0) + dt;
        const beat = Math.floor(a.e / 0.42);
        this.facing = beat % 2 ? -1 : 1;
        this.hop = calm ? 0 : Math.abs(Math.sin((a.e / 0.42) * Math.PI)) * 7;
        if (!calm && Math.random() < dt * 2.5) this.burst('note', this.headX(), this.headY(), 1, '#ffffff');
        if (a.t <= 0) this.done();
        break;
      }
      case 'roar':
        pose = 'roar';
        lookMouse = false;
        if (a.t <= 0) this.done();
        break;
      case 'spin': {
        a.e = (a.e ?? 0) + dt;
        const n = Math.floor(a.e / 0.16);
        if (n !== a.n) {
          a.n = n;
          this.facing = this.facing === 1 ? -1 : 1;
        }
        pose = 'happy';
        if (a.t <= 0) {
          this.set('dizzy', 1.4, () => this.set('idle', 1));
          this.burst('star', this.headX(), this.headY() - 4, 4, '#ffe066');
        }
        break;
      }
      case 'dizzy':
        pose = 'dizzy';
        lookMouse = false;
        if (a.t <= 0) this.done();
        break;
      case 'shake':
        pose = 'stand';
        extra = { tremble: 1, tailWag: 0.3 };
        lookMouse = false;
        if (!calm && Math.random() < dt * 14) {
          const px2 = this.x + rand(-1, 1) * rig.p.bodyLen * px * 0.6;
          this.parts.push({ kind: 'drop', x: px2, y: land.groundY - rig.p.hipHeight * px * rand(0.9, 1.5), vx: rand(-90, 90), vy: -rand(40, 120), g: 420, life: 0.7, max: 0.7, size: rand(2, 3.2), rot: 0, vr: 0, color: '#9fdcff' });
        }
        if (a.t <= 0) this.done();
        break;
      case 'hatch':
        pose = this.hatchT > 1 ? 'happy' : 'sit';
        lookMouse = false;
        if (a.t <= 0) this.done();
        break;
      case 'idle':
      default: {
        // Curious: turn to face the cursor when it's behind.
        const m = this.mouse;
        if (m && this.time - m.t < 3 && !calm) {
          const behind = (m.x - this.x) * this.facing < -20;
          if (behind) {
            this.turnDelay += dt;
            if (this.turnDelay > 0.5) {
              this.facing = this.facing === 1 ? -1 : 1;
              this.turnDelay = 0;
            }
          } else this.turnDelay = 0;
        }
        if (a.t <= 0) this.done();
      }
    }
    const cur = poseKey(pose, extra);
    if (cur !== this.poseKey) {
      applyPose(rig, pose, extra);
      this.poseKey = cur;
    }
    rig.speed = speed;
    rig.run = run;
    rig.facing = this.facing;
    const m = this.mouse;
    if (lookMouse && m && this.time - m.t < 4) {
      const baseY = land.groundY - this.hop;
      rig.look = { x: ((m.x - this.x) * (rig.face >= 0 ? 1 : -1)) / px, y: (baseY - m.y) / px };
    } else if (lookMouse && this.food) {
      rig.look = { x: ((this.food.x - this.x) * this.facing) / px, y: (land.groundY - this.food.y) / px };
    } else if (lookMouse && this.ball) {
      rig.look = { x: ((this.ball.x - this.x) * this.facing) / px, y: (land.groundY - this.ball.y) / px };
    } else rig.look = null;
    rig.update(dt);
  }

  private poseKey = '';

  private done() {
    const then = this.act.then;
    this.act = { k: 'idle', t: 0 };
    if (then) then();
    else this.think();
  }

  private updateFood(dt: number, land: Land) {
    const f = this.food;
    if (!f) return;
    if (!f.landed) {
      f.vy += 900 * dt;
      f.y += f.vy * dt;
      const floor = land.groundY - 4;
      if (f.y >= floor) {
        f.y = floor;
        if (Math.abs(f.vy) > 120) {
          f.vy *= -0.35;
          this.burst('dust', f.x, land.groundY - 1, 3, '#ffffff');
        } else {
          f.vy = 0;
          f.landed = true;
        }
      }
    }
  }

  private updateBall(dt: number, land: Land) {
    const b = this.ball;
    if (!b) return;
    if (b.fade < 1) {
      b.fade -= dt * 1.5;
      if (b.fade <= 0) {
        this.ball = null;
        return;
      }
    }
    b.vy += 900 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.rot += (b.vx * dt) / b.r;
    const floor = land.groundY - b.r;
    if (b.y > floor) {
      b.y = floor;
      b.vy = Math.abs(b.vy) > 80 ? -b.vy * 0.55 : 0;
      b.vx *= 0.82;
    }
    if (b.y >= floor - 0.5) b.vx *= Math.pow(0.35, dt);
    if (b.x < b.r + 4) {
      b.x = b.r + 4;
      b.vx = Math.abs(b.vx) * 0.7;
    }
    if (b.x > this.w - b.r - 4) {
      b.x = this.w - b.r - 4;
      b.vx = -Math.abs(b.vx) * 0.7;
    }
  }

  // ---------------- particles ----------------

  private burst(kind: PartKind, x: number, y: number, n: number, color: string) {
    if (this.o.calm() && kind !== 'heart') return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1, 1) * (kind === 'heart' ? 0.7 : kind === 'bang' ? Math.PI : Math.PI * 0.9);
      const sp = kind === 'heart' ? rand(26, 40) : kind === 'dust' ? rand(14, 34) : kind === 'bang' ? 70 : rand(40, 110);
      const life = kind === 'heart' ? rand(1.2, 1.6) : kind === 'dust' ? 0.6 : kind === 'bang' ? 0.45 : rand(0.6, 1);
      this.parts.push({
        kind,
        x: x + (kind === 'heart' ? (i - (n - 1) / 2) * 12 : 0),
        y,
        vx: kind === 'bang' ? Math.cos((i / n) * Math.PI - Math.PI) * sp * this.facing : Math.cos(a) * sp,
        vy: kind === 'bang' ? Math.sin((i / n) * Math.PI - Math.PI) * sp : Math.sin(a) * sp,
        g: kind === 'spark' || kind === 'star' ? 60 : kind === 'dust' ? -20 : 0,
        life,
        max: life,
        size: kind === 'heart' ? rand(7, 9.5) : kind === 'dust' ? rand(3, 6) : kind === 'note' ? rand(7, 9) : rand(2.5, 4.5),
        rot: rand(-0.4, 0.4),
        vr: rand(-2, 2),
        color,
      });
    }
  }

  private updateParticles(dt: number) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'heart' || p.kind === 'note' || p.kind === 'z') p.x += Math.sin((p.max - p.life) * 5 + p.size) * 12 * dt;
    }
  }

  // ---------------- drawing ----------------

  private draw(dt: number) {
    const g = this.ctx;
    const land = this.ensureLand();
    const s = this.o.subject();
    const calm = this.o.calm();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    land.drawBack(g, this.time, dt, this.par, calm);
    if (s.egg || (this.hatchT >= 0 && this.hatchT < 1.6)) this.drawNest(g, land, true);
    if (this.food) drawFood(g, this.food);
    if (s.egg) this.drawEgg(g, land, s.pal, 0, 0);
    else if (this.rig) {
      const rig = this.rig;
      if (this.hatchT >= 0 && this.hatchT < 0.95) {
        this.drawEgg(g, land, s.pal, Math.min(1, this.hatchT / 0.8), 0);
      } else {
        const px = this.k * rig.size;
        const pop = this.hatchT >= 0 ? popScale(this.hatchT - 0.95) : 1;
        g.save();
        g.translate(this.x, land.groundY - this.hop);
        if (pop !== 1) g.scale(pop, pop);
        drawPet(g, rig, s.pal, s.species.features, { scale: px, outline: clamp(1.6 * px, 1.3, 2.4), shadow: true, airborne: this.hop });
        g.restore();
        if (this.hatchT >= 0.95 && this.hatchT < 1.6) this.drawEgg(g, land, s.pal, 1, Math.min(1, (this.hatchT - 0.95) / 0.5));
      }
    }
    if (s.egg || (this.hatchT >= 0 && this.hatchT < 1.6)) this.drawNest(g, land, false);
    if (this.ball) drawBall(g, this.ball);
    land.drawFront(g, this.time, calm);
    this.drawParticles(g);
  }

  private drawEgg(g: Ctx, land: Land, pal: Palette, crack: number, open: number) {
    const size = this.eggSize();
    g.save();
    g.translate(this.x, land.groundY + 2);
    const wob = this.hatchT >= 0 && this.hatchT < 0.95 ? Math.sin(this.time * 34) * 0.16 : this.eggWob;
    drawEgg(g, size, pal, wob, crack, open);
    g.restore();
  }

  private drawNest(g: Ctx, land: Land, back: boolean) {
    const size = this.eggSize();
    const w = size * 0.95;
    const y = land.groundY + 2;
    g.save();
    g.translate(this.x, y);
    g.lineCap = 'round';
    // After hatching, the nest fades away.
    if (this.hatchT >= 1.1) g.globalAlpha = Math.max(0, 1 - (this.hatchT - 1.1) / 0.5);
    if (back) {
      g.fillStyle = 'rgba(40,24,14,0.35)';
      g.beginPath();
      g.ellipse(0, -2, w * 0.62, size * 0.1, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#6b4a2e';
      g.beginPath();
      g.ellipse(0, -size * 0.08, w * 0.55, size * 0.12, 0, Math.PI, TAU);
      g.fill();
    } else {
      const cols = ['#8a6238', '#a57a4a', '#6f4d2c', '#b98d5a'];
      for (let i = 0; i < 16; i++) {
        const u = i / 15;
        const x0 = (u - 0.5) * w * 1.15;
        g.strokeStyle = cols[i % cols.length];
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x0 - 9, -size * 0.1 + Math.sin(i * 1.7) * 2);
        g.quadraticCurveTo(x0, size * 0.02 - Math.cos(i) * 2, x0 + 11, -size * 0.14 + Math.sin(i * 2.3) * 2);
        g.stroke();
      }
      g.fillStyle = '#7d5733';
      g.beginPath();
      g.ellipse(0, -size * 0.02, w * 0.6, size * 0.09, 0, 0, Math.PI);
      g.fill();
    }
    g.restore();
  }

  private drawParticles(g: Ctx) {
    for (const p of this.parts) {
      const a = Math.min(1, p.life / Math.min(0.35, p.max * 0.5));
      g.save();
      g.globalAlpha = a;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      drawParticle(g, p);
      g.restore();
    }
  }
}

function hourNow() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function poseKey(p: PoseName, extra?: object) {
  return extra ? `${p}:${JSON.stringify(extra)}` : p;
}

/** Overshooting pop-in over 0.6 s (ease-out-back from half size). */
function popScale(t: number) {
  if (t <= 0) return 0.5;
  if (t >= 0.6) return 1;
  const u = t / 0.6 - 1;
  return 0.5 + 0.5 * (1 + 2.7 * u * u * u + 1.7 * u * u);
}

const HEART = new Path2D('M0 7S-7.5 2.4-9.6-2.2C-11.1-5.6-9-9-5.6-9c2.1 0 3.6 1.2 4.6 2.7C0-7.8 1.5-9 3.6-9 7-9 9.1-5.6 7.6-2.2 5.5 2.4 0 7 0 7z');

function drawParticle(g: Ctx, p: Particle) {
  const s = p.size;
  switch (p.kind) {
    case 'heart':
      g.scale(s / 9, s / 9);
      g.fillStyle = '#ff5c8a';
      g.strokeStyle = '#7a1f3d';
      g.lineWidth = 1.8;
      g.fill(HEART);
      g.stroke(HEART);
      break;
    case 'z':
      g.font = `600 ${Math.round(s)}px Fredoka, 'Segoe UI', sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(30,30,60,0.75)';
      g.strokeText('z', 0, 0);
      g.fillStyle = '#ffffff';
      g.fillText('z', 0, 0);
      break;
    case 'note':
      g.fillStyle = '#ffffff';
      g.strokeStyle = 'rgba(30,30,60,0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(-s * 0.3, s * 0.45, s * 0.42, s * 0.3, -0.4, 0, TAU);
      g.moveTo(s * 0.08, s * 0.4);
      g.lineTo(s * 0.08, -s * 0.8);
      g.quadraticCurveTo(s * 0.5, -s * 0.5, s * 0.6, -s * 0.1);
      g.stroke();
      g.beginPath();
      g.ellipse(-s * 0.3, s * 0.45, s * 0.42, s * 0.3, -0.4, 0, TAU);
      g.fill();
      break;
    case 'spark':
    case 'star': {
      const k = p.kind === 'star' ? Math.sin((p.life / p.max) * Math.PI) : 1;
      const r = s * (p.kind === 'star' ? k : 1);
      g.fillStyle = p.color;
      g.beginPath();
      g.moveTo(0, -r * 1.6);
      g.quadraticCurveTo(0, 0, r * 1.6, 0);
      g.quadraticCurveTo(0, 0, 0, r * 1.6);
      g.quadraticCurveTo(0, 0, -r * 1.6, 0);
      g.quadraticCurveTo(0, 0, 0, -r * 1.6);
      g.fill();
      break;
    }
    case 'crumb':
    case 'drop':
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(0, 0, s, 0, TAU);
      g.fill();
      break;
    case 'dust':
      g.globalAlpha *= 0.55;
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(0, 0, s * (1.6 - (p.life / p.max) * 0.6), 0, TAU);
      g.fill();
      break;
    case 'bang':
      g.strokeStyle = p.color;
      g.lineWidth = 2.4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(p.vx * 0.06, p.vy * 0.06);
      g.stroke();
      break;
  }
}

const CRUMB: Record<FoodKind, string> = { meat: '#b5552f', fish: '#9fb8c8', leaf: '#6fbf4a', berry: '#c43a5a' };

function drawFood(g: Ctx, f: Food) {
  const k = 1 - f.bites * 0.7;
  g.save();
  g.translate(f.x, f.y);
  g.scale(k, k);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 1.6;
  if (f.kind === 'meat') {
    g.strokeStyle = '#4a2414';
    g.fillStyle = '#f4ead8';
    g.beginPath();
    g.moveTo(3, -4);
    g.lineTo(11, -8);
    g.arc(12.5, -9.5, 2.2, Math.PI * 0.75, Math.PI * 2.25);
    g.lineTo(12.4, -7);
    g.lineTo(4, -2);
    g.stroke();
    g.fill();
    g.fillStyle = '#c0603a';
    g.beginPath();
    g.ellipse(-2, -5, 8.5, 6, -0.35, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = '#e08a5a';
    g.beginPath();
    g.ellipse(-4, -7.5, 3.5, 1.8, -0.35, 0, TAU);
    g.fill();
  } else if (f.kind === 'fish') {
    g.strokeStyle = '#27404f';
    g.fillStyle = '#8fb3c9';
    g.beginPath();
    g.moveTo(-9, -5);
    g.quadraticCurveTo(-1, -13, 8, -5);
    g.quadraticCurveTo(-1, 3, -9, -5);
    g.moveTo(-9, -5);
    g.lineTo(-14, -10);
    g.lineTo(-14, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#27404f';
    g.beginPath();
    g.arc(3.5, -6.5, 1.2, 0, TAU);
    g.fill();
  } else if (f.kind === 'berry') {
    g.strokeStyle = '#4a1426';
    for (const [x, y, c] of [
      [-4, -4, '#d9405f'],
      [4, -4, '#b8325a'],
      [0, -10, '#e24d6b'],
    ] as [number, number, string][]) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, y, 4.2, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.arc(x - 1.4, y - 1.4, 1.1, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#5fae45';
    g.beginPath();
    g.ellipse(3, -15, 4, 1.8, -0.5, 0, TAU);
    g.fill();
  } else {
    for (const [a, c] of [
      [-0.7, '#5fae45'],
      [0.1, '#79c35a'],
      [0.8, '#4c9a3a'],
    ] as [number, string][]) {
      g.save();
      g.rotate(a);
      g.fillStyle = c;
      g.strokeStyle = '#27501f';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(6, -6, 0, -15);
      g.quadraticCurveTo(-6, -6, 0, 0);
      g.fill();
      g.stroke();
      g.restore();
    }
  }
  g.restore();
}

function drawBall(g: Ctx, b: Ball) {
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, b.fade));
  g.translate(b.x, b.y);
  g.fillStyle = 'rgba(20,16,30,0.15)';
  g.beginPath();
  g.ellipse(0, b.r + 1 + Math.max(0, 0), b.r * 0.9, 2.2, 0, 0, TAU);
  g.fill();
  g.rotate(b.rot);
  const cols = ['#ff5a5f', '#ffffff', '#3fa7ff', '#ffffff', '#ffd23f', '#ffffff'];
  for (let i = 0; i < 6; i++) {
    g.fillStyle = cols[i];
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, b.r, (i / 6) * TAU, ((i + 1) / 6) * TAU);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#3a2a40';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 0, b.r, 0, TAU);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(0, 0, b.r * 0.22, 0, TAU);
  g.fill();
  g.restore();
}
