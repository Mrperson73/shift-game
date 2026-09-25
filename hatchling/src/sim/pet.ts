// The pet's life: physics on platforms, what it decides to do, its needs and growth.
// Pure logic (no DOM): the overlay feeds it input and draws the result.

import { growthOf, stageOf, type Stage } from '../pet/growth';
import { clamp, type V } from '../pet/math';
import { applyPose, type PoseName } from '../pet/poses';
import { Rig } from '../pet/rig';
import type { LineEvent, SpeciesDef } from '../pet/species';
import { type Activity, type PetData, type Platform, type Settings, SIZE_SCALE, type Wall } from '../shared/types';
import { type Abilities, GROUND, ground, landingOn, ride, rideWall, route, usable, wallFoot, type World } from './world';

export type EmoteKind = 'heart' | 'hearts' | 'zzz' | 'exclaim' | 'question' | 'note' | 'anger' | 'sweat' | 'stars' | 'food' | 'sparkle';
export type SoundName = 'chirp' | 'roar' | 'growl' | 'crunch' | 'yawn' | 'happy' | 'squeak' | 'thud' | 'crack' | 'hatch' | 'snore' | 'boing';

export type SimEvent =
  | { type: 'emote'; kind: EmoteKind }
  | { type: 'say'; text: string }
  | { type: 'sound'; name: SoundName; soft?: boolean }
  | { type: 'dust'; x: number; y: number; big: boolean }
  | { type: 'crumbs'; x: number; y: number }
  | { type: 'hatched' }
  | { type: 'grew'; stage: Stage }
  | { type: 'save' };

export interface Food {
  id: number;
  x: number;
  y: number;
  vy: number;
  landed: boolean;
  platform: Platform | null;
  left: number;
  kind: 'meat' | 'leaf';
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  quiet: number;
  age: number;
  held: boolean;
}

type SleepReason = 'nap' | 'idle' | 'lock' | 'command';
type ReactKind = 'roar' | 'happy' | 'poke' | 'welcome' | 'grow' | 'game' | 'hungry' | 'chirp' | 'annoyed' | 'hello';
type Purpose = 'explore' | 'food' | 'cursor' | 'ball';

export type Act =
  | { k: 'egg'; next: number }
  | { k: 'hatch'; t: number }
  | { k: 'idle'; t: number; dur: number; nextLook: number; look: V | null; sniff: number }
  | { k: 'walk'; toX: number; run: boolean; dur: number; t: number }
  | { k: 'travel'; to: Platform; toX: number; purpose: Purpose; run: boolean; t: number; drop: boolean }
  | { k: 'jump'; phase: 'crouch' | 'air'; t: number; tx: number; to: Platform; resume: Act | null }
  | { k: 'fall'; t: number; resume: Act | null; voluntary: boolean }
  | { k: 'move'; t: number; dur: number; from: V; to: V; r0: number; r1: number; arc: number; next: Act; platform: Platform | null; wall: Wall | null }
  | { k: 'climb'; wall: Wall; dir: 'up' | 'down'; t: number; top: Platform | null; land: Platform | null; resume: Act | null }
  | { k: 'land'; t: number; hard: boolean; resume: Act | null }
  | { k: 'held'; t: number }
  | { k: 'dizzy'; t: number }
  | { k: 'sit'; t: number; dur: number }
  | { k: 'lie'; t: number; dur: number }
  | { k: 'sleep'; reason: SleepReason; t: number; dur: number; nextZ: number }
  | { k: 'wake'; t: number; welcome: boolean }
  | { k: 'watch'; t: number; dur: number }
  | { k: 'react'; kind: ReactKind; t: number; dur: number }
  | { k: 'eat'; food: number; t: number; next: number }
  | { k: 'chase'; t: number }
  | { k: 'zoomies'; t: number; laps: number; toX: number }
  | { k: 'tail'; t: number; flip: number }
  | { k: 'petted'; t: number; last: number; next: number };

export interface Env {
  rand: () => number;
  /** Local hour of day, 0-23. */
  hour: () => number;
  now: () => number;
}

const G = 2100;
const TAU = Math.PI * 2;
const ACTIVITY_MUL = { calm: 0.55, normal: 1, lively: 1.6 } as const;

export class Pet {
  data: PetData;
  species: SpeciesDef;
  rig: Rig;
  settings: Settings;
  env: Env;
  world: World;
  events: SimEvent[] = [];

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  /** Screen rotation of the pet around its feet (radians): 0 standing, ±π/2 on a window side. */
  rot = 0;
  grounded = true;
  platform: Platform;
  held = false;
  act: Act;

  cursor: V | null = null;
  cursorSpeed = 0;
  hovering = false;
  userIdle = 0;
  locked = false;
  game: string | null = null;
  hidden = false;
  foods: Food[] = [];
  ball: Ball | null = null;

  time = 0;
  private grabOff: V = { x: 0, y: 0 };
  private dragHist: { x: number; y: number; t: number }[] = [];
  private rub = 0;
  private rubDecay = 0;
  private pokes: number[] = [];
  private lastWords = -1e9;
  private lastEmote = -1e9;
  private nextFoodId = 1;
  private growthTimer = 0;
  private hungryNag = 0;
  private stageNow: Stage;
  private wantDrop = false;
  private prevVx = 0;
  private hiddenFor = 0;
  private thrown = false;
  egg = { crack: 0, wobble: 0, open: 0, wobbleT: 0 };

  constructor(data: PetData, species: SpeciesDef, settings: Settings, world: World, env: Env) {
    this.data = data;
    this.species = species;
    this.settings = settings;
    this.env = env;
    this.world = { ...world, walls: world.walls ?? [] };
    const g = growthOf(data.activeSeconds);
    this.stageNow = stageOf(g);
    this.rig = new Rig(species, g, env.rand);
    this.platform = world.platforms.find((p) => p.id === GROUND) ?? ground(world.width, world.height);
    const fx = data.x ?? 0.7 + env.rand() * 0.15;
    this.x = clamp(fx * world.width, this.margin, world.width - this.margin);
    this.y = this.platform.y;
    this.act = this.hatched ? this.idleAct(2) : { k: 'egg', next: 2 };
    applyPose(this.rig, 'stand');
    // Coming back after a long time away: rested, a bit hungry.
    const away = (env.now() - data.lastSeen) / 1000;
    if (away > 3600) {
      data.energy = 1;
      data.hunger = clamp(data.hunger + Math.min(0.4, away / (3600 * 24)), 0, 1);
    }
  }

  // ---------------- derived ----------------

  get hatched() {
    return this.data.hatchedAt !== null;
  }
  get growth() {
    return this.rig.growth;
  }
  /** Screen pixels per rig unit. */
  get px() {
    return SIZE_SCALE[this.settings.size] * this.rig.size;
  }
  get heightPx() {
    return this.hatched ? this.rig.height * this.px : this.eggSize * 1.1;
  }
  get eggSize() {
    return 40 * SIZE_SCALE[this.settings.size];
  }
  get margin() {
    return (this.rig.p.bodyLen * 0.5 + this.rig.p.hipR) * this.px;
  }
  /** How far the body reaches ahead of the feet (px): used when climbing head first. */
  get reach() {
    const p = this.rig.p;
    return (p.bodyLen * 0.6 + p.neckLen * 0.8 + p.headLen * 0.9) * this.px;
  }
  get climbSpeed() {
    return this.walkSpeed * 1.15;
  }
  get anchored() {
    return this.act.k === 'climb' || this.act.k === 'move';
  }
  get abilities(): Abilities {
    const reach = Math.max(this.maxJumpUp, this.heightPx * (3.2 + 2 * this.species.personality.jump));
    return { maxUp: this.maxJumpUp, maxReach: reach, maxGap: this.maxGap, maxDrop: Math.max(140, this.heightPx * 3.2), margin: this.margin };
  }
  get walkSpeed() {
    const mul = 0.8 + 0.2 * ACTIVITY_MUL[this.settings.activity];
    return (26 + 34 * this.species.personality.speed) * this.px * mul * (0.7 + 0.3 * this.data.happiness + 0.2);
  }
  get runSpeed() {
    return this.walkSpeed * 2.3;
  }
  /** Jump height: a few body heights. Windows further up are reached by climbing their sides. */
  get maxJumpUp() {
    return Math.max(50, this.heightPx * (1.4 + 3 * this.species.personality.jump));
  }
  get maxGap() {
    return 160 * Math.max(0.6, this.px) + this.world.width * 0.08 * this.species.personality.jump;
  }
  get asleep() {
    return this.act.k === 'sleep';
  }
  get platforms() {
    const all = this.settings.explore ? this.world.platforms : this.world.platforms.filter((p) => p.id === GROUND);
    return usable({ ...this.world, platforms: all }, this.heightPx, this.margin * 2.2);
  }

  // ---------------- input from the overlay ----------------

  setWorld(width: number, height: number, platforms: Platform[], walls: Wall[] = []) {
    this.world = { width, height, platforms: platforms.some((p) => p.id === GROUND) ? platforms : [...platforms, ground(width, height)], walls };
    if (this.held) return;
    const a = this.act;
    if (a.k === 'climb') {
      const moved = rideWall(a.wall, walls, this.y);
      if (moved) {
        a.wall = moved.w;
        this.x = moved.w.x;
        this.y = moved.y;
      } else {
        this.rot = 0;
        this.startFall(0);
      }
    } else if (this.grounded) {
      const moved = ride(this.platform, this.platforms, this.x);
      if (moved) {
        this.platform = moved.p;
        this.x = moved.x;
        this.y = moved.p.y;
      } else {
        this.startFall(-60);
      }
    }
    this.x = clamp(this.x, this.margin * 0.5, width - this.margin * 0.5);
    for (const f of this.foods) {
      if (!f.landed || !f.platform) continue;
      const m = ride(f.platform, this.world.platforms, f.x);
      if (m) {
        f.platform = m.p;
        f.x = m.x;
        f.y = m.p.y;
      } else f.landed = false;
    }
  }

  setSettings(s: Settings) {
    this.settings = s;
  }

  setSpecies(species: SpeciesDef) {
    this.species = species;
    this.rig.setSpecies(species);
  }

  setCursor(p: V | null, dt: number) {
    if (p && this.cursor && dt > 0) {
      const d = Math.hypot(p.x - this.cursor.x, p.y - this.cursor.y);
      this.cursorSpeed += (d / dt - this.cursorSpeed) * Math.min(1, dt * 10);
    } else this.cursorSpeed = 0;
    this.cursor = p;
  }

  setActivity(a: Activity) {
    this.userIdle = a.idle;
    const wasLocked = this.locked;
    this.locked = a.locked;
    if (!this.hatched || this.held) return;
    const act = this.act;
    if (a.locked && !wasLocked && act.k !== 'sleep') this.sleep('lock');
    else if (!a.locked && wasLocked && act.k === 'sleep' && act.reason === 'lock') this.wake(true);
    else if (a.idle >= 300 && act.k !== 'sleep' && this.grounded) this.sleep('idle');
    else if (a.idle < 3 && act.k === 'sleep' && act.reason === 'idle') this.wake(true);
    if (a.game !== this.game) {
      const prev = this.game;
      this.game = a.game;
      if (!this.settings.gameReactions) return;
      if (a.game && !prev) {
        this.data.stats.games++;
        if (this.act.k === 'sleep') this.wake(false);
        this.react('game');
      } else if (!a.game && prev) this.react('welcome', 'gameOver');
    }
  }

  setHidden(h: boolean) {
    if (h === this.hidden) return;
    this.hidden = h;
    if (h) {
      this.hiddenFor = 0;
      if (this.held) this.release();
    } else if (this.hiddenFor > 120 && this.hatched && this.act.k !== 'sleep') this.react('welcome');
  }

  /** Whether a point (overlay coordinates) is on the pet. */
  hitTest(pt: V): boolean {
    if (!this.hatched) {
      const s = this.eggSize;
      return Math.abs(pt.x - this.x) < s * 0.4 && pt.y < this.y + 2 && pt.y > this.y - s;
    }
    const l = this.toLocal(pt);
    const pad = 3 / this.px;
    return this.rig.hitCircles().some((c) => Math.hypot(c.p.x - l.x, c.p.y - l.y) <= c.r + pad);
  }

  /** Rig coordinates (x forward, y up) to overlay coordinates. */
  toWorld(l: V, face = this.rig.face): V {
    const dx = l.x * this.px * face;
    const dy = -l.y * this.px;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return { x: this.x + dx * c - dy * s, y: this.y + dx * s + dy * c };
  }

  toLocal(pt: V): V {
    const dx = pt.x - this.x;
    const dy = pt.y - this.y;
    const c = Math.cos(-this.rot);
    const s = Math.sin(-this.rot);
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return { x: (rx / this.px) * this.facing, y: -ry / this.px };
  }

  /** Where the head is (overlay coordinates), for emotes and speech. */
  headAt(): V {
    if (!this.hatched) return { x: this.x, y: this.y - this.eggSize };
    const h = this.toWorld(this.rig.s.top);
    // Emotes float above the head even while climbing.
    return this.rot === 0 ? h : { x: h.x, y: Math.min(h.y, this.y) - this.heightPx * 0.2 };
  }

  mouthAt(): V {
    return this.toWorld(this.rig.s.mouth);
  }

  poke() {
    this.data.stats.pokes++;
    if (!this.hatched) {
      this.egg.crack = Math.min(1, this.egg.crack + 0.34);
      this.egg.wobbleT = 0.6;
      this.sound('crack');
      return;
    }
    this.pokes = [...this.pokes.filter((t) => this.time - t < 4), this.time];
    if (this.act.k === 'sleep') {
      const grumpy = this.act.reason === 'nap';
      this.wake(false);
      if (grumpy) this.emote('anger');
      return;
    }
    if (this.act.k === 'held' || !this.grounded) return;
    this.react(this.pokes.length >= 4 ? 'annoyed' : 'poke');
  }

  /** The cursor moved `d` pixels while over the pet. Enough back-and-forth counts as petting. */
  stroke(d: number) {
    if (!this.hatched || this.held) return;
    this.rub += d;
    this.rubDecay = 0.6;
    if (this.rub < 90 * Math.max(0.6, SIZE_SCALE[this.settings.size])) return;
    this.rub = 0;
    if (this.act.k === 'sleep') {
      this.emote('note');
      this.data.happiness = clamp(this.data.happiness + 0.01, 0, 1);
      return;
    }
    if (this.act.k === 'petted') {
      this.act.last = this.time;
      return;
    }
    if (!this.grounded || this.act.k === 'eat' || this.act.k === 'jump') return;
    this.data.stats.pets++;
    this.data.happiness = clamp(this.data.happiness + 0.05, 0, 1);
    this.act = { k: 'petted', t: 0, last: this.time, next: 0 };
    this.say('pet');
    this.sound('happy');
    this.events.push({ type: 'save' });
  }

  grab(pt: V) {
    this.held = true;
    this.grounded = false;
    this.rot = 0;
    this.grabOff = { x: pt.x - this.x, y: pt.y - this.y };
    this.dragHist = [{ x: pt.x, y: pt.y, t: this.time }];
    this.vx = 0;
    this.vy = 0;
    if (this.hatched) {
      this.act = { k: 'held', t: 0 };
      this.sound('squeak');
    }
  }

  drag(pt: V) {
    if (!this.held) return;
    const w = this.world;
    const nx = clamp(pt.x - this.grabOff.x, this.margin * 0.5, w.width - this.margin * 0.5);
    const ny = clamp(pt.y - this.grabOff.y, this.heightPx * 0.8, w.height);
    this.rig.accel = clamp(((nx - this.x) / Math.max(1e-3, this.px)) * 30, -4000, 4000);
    this.x = nx;
    this.y = ny;
    this.dragHist.push({ x: pt.x, y: pt.y, t: this.time });
    if (this.dragHist.length > 12) this.dragHist.shift();
  }

  release() {
    if (!this.held) return;
    this.held = false;
    const h = this.dragHist.filter((e) => this.time - e.t < 0.1);
    let vx = 0;
    let vy = 0;
    if (h.length >= 2) {
      const dt = Math.max(0.016, h[h.length - 1].t - h[0].t);
      vx = (h[h.length - 1].x - h[0].x) / dt;
      vy = (h[h.length - 1].y - h[0].y) / dt;
    }
    this.vx = clamp(vx, -2600, 2600);
    this.vy = clamp(vy, -2600, 2600);
    const fast = Math.hypot(this.vx, this.vy) > 700;
    this.thrown = fast;
    if (fast && this.hatched) {
      this.data.stats.throws++;
      this.say('thrown');
      this.sound('boing');
      const likes = this.species.personality.playfulness > 0.7;
      this.data.happiness = clamp(this.data.happiness + (likes ? 0.02 : -0.02), 0, 1);
    }
    this.startFall(this.vy);
  }

  feed() {
    if (!this.hatched) return;
    const w = this.world;
    const s = this.px;
    const off = (60 + this.env.rand() * 120) * Math.max(0.7, s) * this.facing;
    const x = clamp(this.x + off, 30, w.width - 30);
    this.foods.push({ id: this.nextFoodId++, x, y: 0, vy: 0, landed: false, platform: null, left: 1, kind: this.species.diet === 'carnivore' ? 'meat' : 'leaf' });
    if (this.foods.length > 4) this.foods.shift();
    if (this.act.k === 'sleep') this.wake(false);
  }

  play() {
    if (!this.hatched) return;
    const w = this.world;
    const r = Math.max(7, 9 * SIZE_SCALE[this.settings.size]);
    const from = this.cursor && this.cursor.y < w.height - 10 ? this.cursor : { x: clamp(this.x + this.facing * 150, 20, w.width - 20), y: 20 };
    this.ball = { x: from.x, y: Math.min(from.y, w.height - 40), vx: (this.env.rand() - 0.5) * 300, vy: -200, r, angle: 0, quiet: 0, age: 0, held: false };
    if (this.act.k === 'sleep') this.wake(false);
  }

  call() {
    if (!this.hatched) return;
    if (this.act.k === 'sleep') this.wake(false);
    if (this.cursor) this.goTo(this.cursor.x, this.cursor.y, 'cursor', true);
  }

  sleepNow() {
    if (this.hatched && this.act.k !== 'sleep') this.sleep('command');
  }

  wakeNow() {
    if (this.act.k === 'sleep') this.wake(true);
  }

  hatchNow() {
    if (!this.hatched) this.egg.crack = 1;
  }

  rename(name: string) {
    this.data.name = name;
    this.events.push({ type: 'save' });
  }

  // ---------------- the loop ----------------

  update(dt: number) {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    this.updateNeeds(dt);
    if (this.hidden) {
      this.hiddenFor += dt;
      return;
    }
    if (this.rubDecay > 0 && (this.rubDecay -= dt) <= 0) this.rub = 0;
    this.updateFood(dt);
    this.updateBall(dt);
    if (!this.hatched) {
      this.updateEgg(dt);
      this.physics(dt);
      return;
    }
    this.think(dt);
    this.physics(dt);
    // Feed the rig.
    const r = this.rig;
    r.facing = this.facing;
    r.speed = this.act.k === 'climb' ? this.climbSpeed / this.px : this.grounded ? Math.abs(this.vx) / this.px : 0;
    const accel = (this.vx - this.prevVx) / Math.max(dt, 1e-3);
    this.prevVx = this.vx;
    if (!this.held) r.accel = (accel / this.px) * this.facing;
    r.look = this.lookTarget();
    r.update(dt);
  }

  private updateNeeds(dt: number) {
    const d = this.data;
    const active = !this.locked && this.userIdle < 60;
    if (!this.hatched) return;
    if (active) d.activeSeconds += dt;
    const night = this.isNight();
    if (this.act.k === 'sleep') d.energy += dt / (14 * 60);
    else d.energy -= (dt / ((55 + 70 * this.species.personality.stamina) * 60)) * (night ? 1.5 : 1) * (this.hidden ? 0.5 : 1);
    d.hunger += dt / ((this.act.k === 'sleep' ? 10 : 6) * 3600);
    d.happiness += (0.55 - d.happiness) * (dt / (5 * 3600));
    d.energy = clamp(d.energy, 0, 1);
    d.hunger = clamp(d.hunger, 0, 1);
    d.happiness = clamp(d.happiness, 0, 1);
    if ((this.growthTimer += dt) >= 2) {
      this.growthTimer = 0;
      const g = growthOf(d.activeSeconds);
      if (Math.abs(g - this.rig.growth) > 1e-6) this.rig.setGrowth(g);
      const st = stageOf(g);
      if (st !== this.stageNow) {
        this.stageNow = st;
        this.events.push({ type: 'grew', stage: st }, { type: 'save' });
        if (!this.hidden && this.act.k !== 'sleep' && this.grounded) this.react('grow');
      }
    }
  }

  private isNight() {
    const h = this.env.hour();
    return h >= 23 || h < 6;
  }

  private lookTarget(): V | null {
    const a = this.act;
    const px = this.px;
    const toLocal = (p: V): V => ({ x: ((p.x - this.x) / px) * this.facing, y: (this.y - p.y) / px });
    if (a.k === 'eat' || a.k === 'sleep' || a.k === 'climb' || a.k === 'move') return null;
    if (a.k === 'idle' && a.look) return a.look;
    if (this.ball && (a.k === 'chase' || a.k === 'travel')) return toLocal(this.ball);
    if (this.cursor) {
      const d = Math.hypot(this.cursor.x - this.x, this.cursor.y - this.y);
      const near = d < 420 + 260 * this.species.personality.curiosity;
      const inFront = (this.cursor.x - this.x) * this.facing > -20;
      if ((near && inFront) || a.k === 'watch' || a.k === 'petted' || a.k === 'held' || (a.k === 'react' && a.kind !== 'roar')) return toLocal(this.cursor);
    }
    return null;
  }

  // ---------------- physics ----------------

  private startFall(vy: number, voluntary = false) {
    this.grounded = false;
    this.vy = vy;
    this.wantDrop = false;
    this.rot = 0;
    const a = this.act;
    const resume = a.k === 'travel' ? a : a.k === 'climb' ? a.resume : null;
    if (resume && resume.k === 'travel') resume.drop = false;
    if (a.k !== 'jump' && a.k !== 'egg' && a.k !== 'hatch') this.act = { k: 'fall', t: 0, resume, voluntary };
  }

  private physics(dt: number) {
    if (this.held || this.anchored) return;
    const w = this.world;
    const lo = this.margin * 0.5;
    const hi = w.width - this.margin * 0.5;
    if (!this.grounded) {
      // Exact for constant gravity, so jump arcs reach the heights they were planned for.
      let nx = this.x + this.vx * dt;
      let ny = this.y + this.vy * dt + 0.5 * G * dt * dt;
      this.vy += G * dt;
      if (nx < lo) {
        nx = lo;
        this.vx = Math.abs(this.vx) * 0.45;
        if (Math.abs(this.vx) > 300) this.bump();
      } else if (nx > hi) {
        nx = hi;
        this.vx = -Math.abs(this.vx) * 0.45;
        if (Math.abs(this.vx) > 300) this.bump();
      }
      const top = this.heightPx * 0.9;
      if (ny < top) {
        ny = top;
        if (this.vy < 0) this.vy = Math.abs(this.vy) * 0.25;
      }
      if (this.vy > 0) {
        const land = landingOn(this.platforms, nx, this.y, ny);
        if (land) {
          this.land(land, nx);
          return;
        }
      }
      this.x = nx;
      this.y = ny;
      if (this.y > w.height + 50) this.land(this.platforms.find((p) => p.id === GROUND) ?? ground(w.width, w.height), clamp(nx, lo, hi));
      return;
    }
    // On the ground: move along the platform.
    const p = this.platform;
    this.x += this.vx * dt;
    this.y = p.y;
    const m = this.margin * 0.55;
    if (this.x < p.x1 + m || this.x > p.x2 - m) {
      if (this.wantDrop && (this.x < p.x1 || this.x > p.x2) && p.id !== GROUND) {
        this.startFall(-80, true);
        return;
      }
      if (!this.wantDrop) {
        this.x = clamp(this.x, p.x1 + m, p.x2 - m);
        this.vx = 0;
      }
    }
    this.x = clamp(this.x, lo, hi);
  }

  private bump() {
    this.emote('stars');
    this.sound('thud');
  }

  private land(p: Platform, x: number) {
    const impact = this.vy;
    this.grounded = true;
    this.platform = p;
    this.x = x;
    this.y = p.y;
    this.vy = 0;
    this.vx *= 0.2;
    this.wantDrop = false;
    const hard = this.thrown && impact > 1300;
    this.thrown = false;
    this.events.push({ type: 'dust', x, y: p.y, big: hard });
    if (!this.hatched) return;
    if (impact > 700) this.sound('thud', impact < 1100);
    const a = this.act;
    const resume = a.k === 'jump' ? a.resume : a.k === 'fall' ? a.resume : null;
    this.act = { k: 'land', t: 0, hard, resume };
  }

  // ---------------- food and ball ----------------

  private updateFood(dt: number) {
    for (const f of this.foods) {
      if (f.landed) continue;
      const ny = f.y + f.vy * dt + 0.35 * G * dt * dt;
      f.vy += G * 0.7 * dt;
      const land = landingOn(this.world.platforms.filter((p) => p.y > 30), f.x, f.y, ny);
      if (land) {
        f.landed = true;
        f.platform = land;
        f.y = land.y;
        f.vy = 0;
        this.events.push({ type: 'dust', x: f.x, y: land.y, big: false });
      } else f.y = ny;
    }
  }

  private updateBall(dt: number) {
    const b = this.ball;
    if (!b || b.held) return;
    b.age += dt;
    b.vy += G * 0.8 * dt;
    let nx = b.x + b.vx * dt;
    let ny = b.y + b.vy * dt;
    const w = this.world;
    if (nx < b.r || nx > w.width - b.r) {
      nx = clamp(nx, b.r, w.width - b.r);
      b.vx = -b.vx * 0.7;
    }
    if (ny < b.r) {
      ny = b.r;
      b.vy = Math.abs(b.vy) * 0.6;
    }
    if (b.vy > 0) {
      const land = landingOn(this.world.platforms, nx, b.y, ny);
      if (land) {
        ny = land.y - 0.01;
        if (b.vy > 160) {
          b.vy = -b.vy * 0.62;
          if (b.vy < -120) this.sound('boing');
        } else b.vy = 0;
        b.vx *= 0.985;
        if (Math.abs(b.vx) < 8) b.vx = 0;
      }
    }
    b.angle += (b.vx * dt) / b.r;
    b.x = nx;
    b.y = ny;
    b.quiet = Math.abs(b.vx) < 5 && b.vy === 0 ? b.quiet + dt : 0;
    if (b.age > 60 || b.quiet > 25) this.ball = null;
  }

  grabBall(pt: V) {
    if (this.ball && Math.hypot(pt.x - this.ball.x, pt.y - (this.ball.y - this.ball.r)) < this.ball.r + 6) {
      this.ball.held = true;
      this.dragHist = [{ x: pt.x, y: pt.y, t: this.time }];
      return true;
    }
    return false;
  }

  dragBall(pt: V) {
    const b = this.ball;
    if (!b?.held) return;
    b.x = clamp(pt.x, b.r, this.world.width - b.r);
    b.y = clamp(pt.y + b.r, b.r * 2, this.world.height);
    this.dragHist.push({ x: pt.x, y: pt.y, t: this.time });
    if (this.dragHist.length > 12) this.dragHist.shift();
  }

  releaseBall() {
    const b = this.ball;
    if (!b?.held) return;
    b.held = false;
    const h = this.dragHist.filter((e) => this.time - e.t < 0.1);
    if (h.length >= 2) {
      const dt = Math.max(0.016, h[h.length - 1].t - h[0].t);
      b.vx = clamp((h[h.length - 1].x - h[0].x) / dt, -2200, 2200);
      b.vy = clamp((h[h.length - 1].y - h[0].y) / dt, -2200, 2200);
    }
    b.age = 0;
    b.quiet = 0;
  }

  // ---------------- egg ----------------

  private updateEgg(dt: number) {
    const e = this.egg;
    const a = this.act;
    if (a.k === 'hatch') {
      a.t += dt;
      e.open = Math.min(1, a.t / 0.7);
      if (a.t >= 0.7) {
        this.data.hatchedAt = this.env.now();
        this.events.push({ type: 'hatched' }, { type: 'save' });
        this.facing = this.x > this.world.width / 2 ? -1 : 1;
        this.react('hello', 'hello');
        this.emote('hearts');
      }
      return;
    }
    e.crack = Math.min(1, e.crack + dt / 45);
    if (e.wobbleT > 0) e.wobbleT -= dt;
    if (a.k === 'egg' && (a.next -= dt) <= 0) {
      a.next = 1.5 + this.env.rand() * 3 * (1 - e.crack * 0.7);
      e.wobbleT = 0.5 + e.crack * 0.4;
    }
    e.wobble = e.wobbleT > 0 ? Math.sin(this.time * 26) * 0.12 * (0.6 + e.crack) : 0;
    if (e.crack >= 1 && a.k === 'egg') {
      this.act = { k: 'hatch', t: 0 };
      this.sound('hatch');
    }
  }

  // ---------------- decisions ----------------

  private idleAct(dur: number): Act {
    return { k: 'idle', t: 0, dur, nextLook: 1, look: null, sniff: 0 };
  }

  private sleep(reason: SleepReason) {
    this.data.stats.naps++;
    const dur = reason === 'nap' ? 90 + this.env.rand() * 240 : reason === 'command' ? 30 * 60 : 1e9;
    this.act = { k: 'sleep', reason, t: 0, dur, nextZ: 2.5 };
    this.vx = 0;
  }

  private wake(welcome: boolean) {
    this.act = { k: 'wake', t: 0, welcome };
    this.sound('yawn');
  }

  react(kind: ReactKind, line?: LineEvent, soft = false) {
    if (!this.hatched) return;
    const dur = { roar: 1.6, happy: 1.6, poke: 0.9, welcome: 2.2, grow: 2.4, game: 2.2, hungry: 1.8, chirp: 0.9, annoyed: 1.3, hello: 2.2 }[kind];
    this.act = { k: 'react', kind, t: 0, dur };
    this.vx = 0;
    switch (kind) {
      case 'roar':
        this.sound('roar', soft);
        break;
      case 'game':
        this.sound('roar');
        this.emote('exclaim');
        this.say('game', true);
        break;
      case 'happy':
        this.emote('heart');
        this.sound('happy');
        break;
      case 'poke':
        this.emote(this.env.rand() < 0.5 ? 'question' : 'exclaim');
        this.sound('chirp');
        this.say('poke');
        break;
      case 'annoyed':
        this.emote('anger');
        this.sound('growl');
        this.pokes = [];
        break;
      case 'welcome':
        this.emote('heart');
        this.sound('happy');
        this.say(line ?? 'welcome', true);
        break;
      case 'hello':
        this.sound('chirp');
        this.say('hello', true);
        break;
      case 'grow':
        this.emote('sparkle');
        this.sound('roar');
        this.say('grow', true);
        break;
      case 'hungry':
        this.emote('food');
        this.sound('chirp');
        break;
      case 'chirp':
        this.sound('chirp', soft);
        this.emote('note');
        break;
    }
  }

  private goTo(x: number, y: number, purpose: Purpose, run: boolean) {
    const plats = this.platforms;
    let target = landingOn(plats, clamp(x, 1, this.world.width - 1), y - 2, Infinity) ?? plats.find((p) => p.id === GROUND)!;
    const m = this.margin * 0.6;
    let tx = clamp(x, target.x1 + m, target.x2 - m);
    if (target.x2 - target.x1 < m * 2) {
      target = plats.find((p) => p.id === GROUND)!;
      tx = clamp(x, m, this.world.width - m);
    }
    this.act = { k: 'travel', to: target, toX: tx, purpose, run, t: 0, drop: false };
  }

  private choose() {
    const r = this.env.rand;
    const d = this.data;
    const pers = this.species.personality;
    const mul = ACTIVITY_MUL[this.settings.activity];
    const food = this.foods.find((f) => f.landed);
    if (food) {
      this.goTo(food.x, food.y, 'food', true);
      return;
    }
    if (this.ball && d.energy > 0.15) {
      this.act = { k: 'chase', t: 0 };
      return;
    }
    if (d.energy < 0.2 || (this.isNight() && d.energy < 0.45 && r() < 0.25)) {
      this.sleep('nap');
      return;
    }
    if (d.hunger > 0.75 && this.time > this.hungryNag) {
      this.hungryNag = this.time + 15 * 60;
      this.react('hungry');
      return;
    }
    const baby = this.rig.baby;
    const cursorNear = this.cursor && Math.hypot(this.cursor.x - this.x, this.cursor.y - this.y) < 500;
    const others = this.platforms.filter((p) => p.id !== this.platform.id);
    const tired = 1 - d.energy;
    const options: [number, () => void][] = [
      [3, () => (this.act = this.idleAct(3 + r() * 6))],
      [3.2 * mul * (0.5 + d.energy), () => this.wander(false)],
      [0.6 * mul * pers.speed * d.energy, () => this.wander(true)],
      [1.2 + tired * 2 - mul * 0.3, () => (this.act = { k: 'sit', t: 0, dur: 8 + r() * 20 })],
      [0.5 + tired * 2.5, () => (this.act = { k: 'lie', t: 0, dur: 10 + r() * 25 })],
      [cursorNear ? 2 * pers.curiosity : 0, () => (this.act = { k: 'watch', t: 0, dur: 4 + r() * 6 })],
      [others.length && this.settings.explore ? 1.3 * pers.jump * mul * d.energy : 0, () => this.explore(others)],
      [0.35 * pers.playfulness * mul * (0.3 + baby) * d.energy, () => (this.act = { k: 'tail', t: 0, flip: 0 })],
      [d.happiness > 0.6 && d.energy > 0.55 ? 0.3 * pers.playfulness * mul : 0, () => (this.act = { k: 'zoomies', t: 0, laps: 2 + Math.floor(r() * 3), toX: this.x })],
      [0.25 * pers.vocal, () => this.react(this.growth > 0.5 && this.species.id !== 'raptor' ? 'roar' : 'chirp', undefined, true)],
    ];
    const total = options.reduce((s, [w]) => s + Math.max(0, w), 0);
    let pick = r() * total;
    for (const [w, fn] of options) {
      pick -= Math.max(0, w);
      if (pick <= 0) {
        fn();
        return;
      }
    }
    this.act = this.idleAct(4);
  }

  private wander(run: boolean) {
    const p = this.platform;
    const m = this.margin * 0.6;
    const span = p.x2 - p.x1 - 2 * m;
    if (span < 10) {
      this.act = this.idleAct(3);
      return;
    }
    const reach = Math.min(span, (run ? 500 : 260) * Math.max(0.6, this.px));
    const toX = clamp(this.x + (this.env.rand() * 2 - 1) * reach, p.x1 + m, p.x2 - m);
    this.act = { k: 'walk', toX, run, dur: 20, t: 0 };
  }

  private explore(others: Platform[]) {
    const r = this.env.rand;
    const reachable = others.filter((q) => route(this.platforms, this.world.walls, this.platform, this.x, q, (q.x1 + q.x2) / 2, this.abilities));
    if (!reachable.length) {
      this.wander(false);
      return;
    }
    const p = reachable[Math.floor(r() * reachable.length)];
    const m = this.margin * 0.6;
    this.act = { k: 'travel', to: p, toX: p.x1 + m + r() * Math.max(0, p.x2 - p.x1 - 2 * m), purpose: 'explore', run: false, t: 0, drop: false };
  }

  /** Walk toward x on the current platform; returns true when arrived. */
  private walkTo(x: number, run: boolean, dt: number): boolean {
    const dx = x - this.x;
    const speed = run ? this.runSpeed : this.walkSpeed;
    if (Math.abs(dx) < Math.max(3, speed * dt * 1.5)) {
      this.vx = 0;
      return true;
    }
    const dirn = dx > 0 ? 1 : -1;
    if (dirn !== this.facing && Math.abs(this.vx) < speed * 0.3) this.facing = dirn;
    const target = dirn * speed * (Math.abs(dx) < speed * 0.3 ? 0.5 : 1);
    this.vx += clamp(target - this.vx, -speed * 6 * dt, speed * 6 * dt);
    return false;
  }

  private pose(name: PoseName, extra?: Parameters<typeof applyPose>[2]) {
    applyPose(this.rig, name, extra);
  }

  private think(dt: number) {
    const a = this.act;
    const r = this.env.rand;
    const rig = this.rig;
    rig.run = 0;
    if (a.k !== 'walk' && a.k !== 'travel' && a.k !== 'chase' && a.k !== 'zoomies' && this.grounded) this.vx *= Math.max(0, 1 - dt * 12);
    this.wantDrop = a.k === 'travel' && a.drop;
    switch (a.k) {
      case 'egg':
      case 'hatch':
        return;
      case 'idle': {
        a.t += dt;
        this.pose(a.sniff > 0 ? 'sniff' : 'stand');
        if (a.sniff > 0) a.sniff -= dt;
        if ((a.nextLook -= dt) <= 0) {
          a.nextLook = 1.2 + r() * 2.8;
          const k = r();
          a.look = k < 0.35 ? null : k < 0.55 ? { x: 60 + r() * 60, y: 60 + r() * 60 } : k < 0.75 ? { x: 80, y: r() * 20 } : { x: -40, y: 70 };
          if (k > 0.92) a.sniff = 1.4;
          if (k > 0.97 && r() < 0.5) this.facing = this.facing === 1 ? -1 : 1;
        }
        if (a.t > a.dur) this.choose();
        return;
      }
      case 'walk':
        a.t += dt;
        rig.run = a.run ? 1 : 0;
        this.pose('stand');
        if (this.walkTo(a.toX, a.run, dt) || a.t > a.dur) this.act = this.idleAct(1 + r() * 3);
        return;
      case 'travel': {
        a.t += dt;
        if (!this.grounded) return;
        rig.run = a.run ? 1 : 0;
        this.pose('stand');
        if (a.drop) {
          // Committed to walking off the edge; physics starts the fall.
          this.wantDrop = true;
          this.vx = this.facing * this.walkSpeed * 0.8;
          if (a.t > 25) a.drop = false;
          return;
        }
        if (a.t > 25) {
          this.emote('question');
          this.act = this.idleAct(2);
          return;
        }
        if (a.purpose === 'food' && !this.foods.some((f) => f.landed)) {
          this.act = this.idleAct(1);
          return;
        }
        const plats = this.platforms;
        const to = plats.find((p) => p.id === a.to.id) ?? (a.to.win ? plats.find((p) => p.win === a.to.win) : undefined);
        if (!to) {
          this.act = this.idleAct(1);
          return;
        }
        a.to = to;
        const m = this.margin * 0.6;
        a.toX = clamp(a.toX, to.x1 + m, to.x2 - m);
        const hop = route(plats, this.world.walls, this.platform, this.x, to, a.toX, this.abilities);
        if (!hop) {
          this.emote('question');
          this.act = this.idleAct(2);
          return;
        }
        if (hop.kind === 'walk') {
          a.drop = false;
          if (this.walkTo(a.toX, a.run, dt)) this.arrive(a.purpose);
          return;
        }
        if (hop.kind === 'drop') {
          a.drop = false;
          if (this.walkTo(hop.fromX, a.run, dt)) {
            a.drop = true;
            this.wantDrop = true;
            this.facing = hop.toX < this.x ? -1 : 1;
            this.vx = this.facing * this.walkSpeed * 0.8;
          }
          return;
        }
        a.drop = false;
        if (hop.kind === 'climbUp' || hop.kind === 'climbDown') {
          if (this.walkTo(hop.fromX, a.run, dt)) this.startClimb(hop.wall, hop.kind === 'climbUp' ? 'up' : 'down', hop.to, a);
          return;
        }
        if (this.walkTo(hop.fromX, a.run, dt)) {
          this.facing = hop.toX > this.x + 1 ? 1 : hop.toX < this.x - 1 ? -1 : this.facing;
          this.act = { k: 'jump', phase: 'crouch', t: 0, tx: hop.toX, to: hop.to, resume: a };
        }
        return;
      }
      case 'move': {
        a.t += dt;
        const k = Math.min(1, a.t / a.dur);
        const e = k * k * (3 - 2 * k);
        this.x = a.from.x + (a.to.x - a.from.x) * e;
        this.y = a.from.y + (a.to.y - a.from.y) * e - Math.sin(Math.PI * k) * a.arc;
        this.rot = a.r0 + (a.r1 - a.r0) * e;
        this.vx = 0;
        this.vy = 0;
        rig.speed = 0;
        this.pose(a.arc > 4 ? 'jump' : 'stand');
        if (k >= 1) {
          this.rot = a.r1;
          if (a.platform) {
            this.grounded = true;
            this.platform = a.platform;
            this.y = a.platform.y;
          }
          this.act = a.next;
        }
        return;
      }
      case 'climb': {
        a.t += dt;
        const w = a.wall;
        const speed = this.climbSpeed;
        this.x = w.x;
        this.y += (a.dir === 'up' ? -1 : 1) * speed * dt;
        this.vx = 0;
        this.pose('stand', { tailLift: 0.15 });
        const left = w.side === 'left';
        if (a.dir === 'up' && this.y <= w.y1 + this.margin * 0.5) {
          const top = a.top;
          if (!top) {
            this.startFall(0);
            return;
          }
          const m = this.margin * 0.8;
          const tx = Math.min(Math.max(left ? w.x + m : w.x - m, top.x1 + m * 0.5), top.x2 - m * 0.5);
          this.facing = left ? 1 : -1;
          this.act = { k: 'move', t: 0, dur: 0.35, from: { x: this.x, y: this.y }, to: { x: tx, y: top.y }, r0: this.rot, r1: 0, arc: this.heightPx * 0.25, next: a.resume ?? this.idleAct(1), platform: top, wall: null };
          return;
        }
        if (a.dir === 'down') {
          const floor = a.land ? Math.min(a.land.y, w.y2) : w.y2;
          if (this.y >= floor - this.reach * 0.85) {
            const foot = wallFoot(w, this.margin);
            this.facing = left ? -1 : 1;
            if (a.land && a.land.y <= w.y2 + this.reach) {
              this.act = { k: 'move', t: 0, dur: 0.3, from: { x: this.x, y: this.y }, to: { x: foot, y: a.land.y }, r0: this.rot, r1: 0, arc: 0, next: a.resume ?? this.idleAct(1), platform: a.land, wall: null };
            } else {
              this.x = foot;
              this.vx = this.facing * 30;
              this.startFall(0, true);
            }
          }
        }
        return;
      }
      case 'jump': {
        a.t += dt;
        if (a.phase === 'crouch') {
          this.pose('crouch');
          this.vx = 0;
          if (a.t > 0.2) {
            const dx = a.tx - this.x;
            const apex = Math.min(this.y, a.to.y) - (30 + Math.abs(dx) * 0.2) * Math.max(0.8, this.px);
            const h1 = Math.max(4, this.y - apex);
            const h2 = Math.max(4, a.to.y - apex);
            const t1 = Math.sqrt((2 * h1) / G);
            const t2 = Math.sqrt((2 * h2) / G);
            this.vy = -Math.sqrt(2 * G * h1);
            this.vx = dx / (t1 + t2);
            this.grounded = false;
            a.phase = 'air';
            a.t = 0;
            this.events.push({ type: 'dust', x: this.x, y: this.y, big: false });
          }
        } else this.pose('jump');
        return;
      }
      case 'fall':
        a.t += dt;
        this.pose(!a.voluntary && (a.t > 0.25 || this.vy > 900) ? 'fall' : 'jump');
        return;
      case 'land':
        a.t += dt;
        this.pose('land');
        if (a.t > (a.hard ? 0.35 : 0.18)) {
          if (a.hard) {
            this.act = { k: 'dizzy', t: 0 };
            this.emote('stars');
          } else if (a.resume) this.act = a.resume;
          else this.act = this.idleAct(0.5 + r());
        }
        return;
      case 'held':
        a.t += dt;
        this.pose('held', { pitch: 0.35 + clamp(-rig.accel * 0.0002, -0.4, 0.4) });
        if (this.species.personality.playfulness > 0.7 && a.t > 1) rig.eyes = 'happy';
        return;
      case 'dizzy':
        a.t += dt;
        this.pose('dizzy');
        if (a.t > 2) this.act = this.idleAct(1);
        return;
      case 'sit':
      case 'lie':
        a.t += dt;
        this.pose(a.k);
        if (a.t > a.dur) {
          if (a.k === 'lie' && this.data.energy < 0.5 && r() < 0.5) this.sleep('nap');
          else this.choose();
        }
        return;
      case 'sleep': {
        a.t += dt;
        this.pose(a.t < 2.5 ? 'drowsy' : 'sleep');
        if (a.t > 2.5 && (a.nextZ -= dt) <= 0) {
          a.nextZ = 2.8 + r() * 1.5;
          this.emote('zzz');
          if (r() < 0.15) this.sound('snore');
        }
        const rested = a.reason === 'nap' && this.data.energy > 0.96;
        if (a.t > a.dur || rested) this.wake(false);
        return;
      }
      case 'wake':
        a.t += dt;
        this.pose(a.t < 1.3 ? 'stretch' : a.t < 2.2 ? 'yawn' : 'stand');
        if (a.t > 2.5) {
          if (a.welcome) this.react('welcome');
          else this.act = this.idleAct(1);
        }
        return;
      case 'watch':
        a.t += dt;
        this.pose('alert');
        if (this.cursor) {
          const dirn = this.cursor.x > this.x ? 1 : -1;
          if (dirn !== this.facing && Math.abs(this.cursor.x - this.x) > this.margin) this.facing = dirn;
          if (this.cursorSpeed > 1500 && this.species.personality.curiosity > 0.7 && this.grounded) {
            this.vy = -380 * Math.max(0.6, this.px);
            this.grounded = false;
            this.act = { k: 'fall', t: 0, resume: null, voluntary: true };
            return;
          }
        }
        if (a.t > a.dur || !this.cursor) this.choose();
        return;
      case 'react': {
        a.t += dt;
        const k = a.kind;
        if (k === 'roar' || k === 'game') this.pose(a.t < 0.3 ? 'crouch' : a.t < 1.5 ? 'roar' : 'stand');
        else if (k === 'happy' || k === 'welcome' || k === 'hello' || k === 'grow') {
          this.pose('happy');
          // Little hops.
          if (this.grounded && a.t > 0.2 && a.t < a.dur - 0.4 && Math.floor(a.t * 2.5) !== Math.floor((a.t - dt) * 2.5)) {
            this.vy = -260 * Math.max(0.6, this.px);
            this.grounded = false;
            this.act = { k: 'fall', t: 0, resume: a, voluntary: true };
          }
        } else if (k === 'poke') this.pose('alert');
        else if (k === 'annoyed') this.pose(a.t < 1 ? 'roar' : 'stand', { jaw: 0.4, tremble: 0.3 });
        else if (k === 'hungry') this.pose('look_up');
        else if (k === 'chirp') this.pose(a.t < 0.5 ? 'chirp' : 'stand');
        if (a.t > a.dur) this.act = this.idleAct(1 + r() * 2);
        return;
      }
      case 'eat': {
        const food = this.foods.find((f) => f.id === a.food);
        if (!food) {
          this.act = this.idleAct(1);
          return;
        }
        a.t += dt;
        const chomp = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(a.t * 14));
        this.pose('eat', { jaw: chomp });
        food.left -= dt / 3;
        if ((a.next -= dt) <= 0) {
          a.next = 0.45;
          const m = this.mouthAt();
          this.events.push({ type: 'crumbs', x: m.x, y: m.y });
          this.sound('crunch');
        }
        if (food.left <= 0) {
          this.foods = this.foods.filter((f) => f.id !== food.id);
          this.data.hunger = Math.max(0, this.data.hunger - 0.6);
          this.data.happiness = clamp(this.data.happiness + 0.15, 0, 1);
          this.data.stats.meals++;
          this.events.push({ type: 'save' });
          this.say('feed');
          this.react('happy');
        }
        return;
      }
      case 'chase': {
        a.t += dt;
        const b = this.ball;
        if (!b || a.t > 30) {
          this.act = this.idleAct(1);
          return;
        }
        rig.run = 1;
        this.pose('stand', { tailLift: 0.3 });
        if (b.held) {
          this.vx *= 0.9;
          if (Math.abs(b.x - this.x) > 20) this.facing = b.x > this.x ? 1 : -1;
          return;
        }
        const onMine = Math.abs(b.y - this.platform.y) < 6 && b.x > this.platform.x1 && b.x < this.platform.x2;
        if (!onMine) {
          if (b.vy === 0 && Math.abs(b.vx) < 30) this.goTo(b.x, b.y - 2, 'ball', true);
          else this.walkTo(clamp(b.x, this.platform.x1 + this.margin, this.platform.x2 - this.margin), true, dt);
          return;
        }
        const reach = (this.rig.p.headLen * 0.9 + this.rig.p.bodyLen * 0.5) * this.px;
        if (Math.abs(b.x - this.x) < reach && b.vy === 0) {
          b.vx = this.facing * (320 + r() * 380);
          b.vy = -260 - r() * 260;
          this.sound('boing');
          this.data.happiness = clamp(this.data.happiness + 0.02, 0, 1);
          if (r() < 0.3) this.emote('note');
          this.vx *= 0.3;
        } else this.walkTo(b.x - this.facing * reach * 0.6, true, dt);
        return;
      }
      case 'zoomies': {
        a.t += dt;
        rig.run = 1;
        this.pose('happy');
        const p = this.platform;
        const m = this.margin * 0.7;
        if (this.walkTo(a.toX, true, dt)) {
          a.laps--;
          a.toX = a.toX > (p.x1 + p.x2) / 2 ? p.x1 + m + this.env.rand() * 60 : p.x2 - m - this.env.rand() * 60;
          if (a.laps < 0 || a.t > 12) this.act = this.idleAct(2);
        }
        return;
      }
      case 'tail':
        a.t += dt;
        this.pose('happy', { tailLift: 0.4 });
        if ((a.flip -= dt) <= 0) {
          a.flip = 0.22;
          this.facing = this.facing === 1 ? -1 : 1;
        }
        if (a.t > 2.2) {
          this.act = { k: 'dizzy', t: 1.2 };
          this.emote('stars');
        }
        return;
      case 'petted':
        a.t += dt;
        this.pose('happy', { tailWag: 0.45 });
        if ((a.next -= dt) <= 0) {
          a.next = 0.9;
          this.emote('heart');
        }
        if (this.time - a.last > 1.4) this.act = this.idleAct(1.5);
        return;
    }
  }

  /** Get onto a window side: jump to it from below, or swing over the edge from the top. */
  private startClimb(wall: Wall, dir: 'up' | 'down', to: Platform, resume: Act) {
    const left = wall.side === 'left';
    const r1 = left ? -Math.PI / 2 : Math.PI / 2;
    this.facing = (left ? 1 : -1) * (dir === 'up' ? 1 : -1) as 1 | -1;
    this.grounded = false;
    const plats = this.platforms;
    if (dir === 'up') {
      const startY = Math.min(this.y, wall.y2) - this.heightPx * 0.15;
      const top = plats.find((p) => p.id === to.id) ?? null;
      const climb: Act = { k: 'climb', wall, dir, t: 0, top, land: null, resume };
      const dy = Math.abs(this.y - startY);
      this.act = { k: 'move', t: 0, dur: 0.28 + Math.sqrt(dy) * 0.02, from: { x: this.x, y: this.y }, to: { x: wall.x, y: startY }, r0: 0, r1, arc: dy > 20 ? 0 : this.heightPx * 0.2, next: climb, platform: null, wall };
      if (dy > 20) this.sound('boing', true);
    } else {
      const land = plats.find((p) => p.id === to.id) ?? null;
      const climb: Act = { k: 'climb', wall, dir, t: 0, top: null, land, resume };
      this.act = { k: 'move', t: 0, dur: 0.4, from: { x: this.x, y: this.y }, to: { x: wall.x, y: wall.y1 + this.margin * 0.4 }, r0: 0, r1, arc: this.heightPx * 0.15, next: climb, platform: null, wall };
    }
  }

  private arrive(p: Purpose) {
    if (p === 'food') {
      const f = this.foods.filter((q) => q.landed).sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0];
      if (f && Math.abs(f.x - this.x) < this.margin * 2 + 30 && Math.abs(f.y - this.y) < 4) {
        this.facing = f.x >= this.x ? 1 : -1;
        this.act = { k: 'eat', food: f.id, t: 0, next: 0.2 };
        return;
      }
      if (f) {
        this.goTo(f.x, f.y, 'food', true);
        return;
      }
    }
    if (p === 'cursor') {
      this.act = { k: 'watch', t: 0, dur: 3 + this.env.rand() * 3 };
      this.emote('heart');
      return;
    }
    if (p === 'ball') {
      this.act = { k: 'chase', t: 0 };
      return;
    }
    this.act = this.idleAct(1 + this.env.rand() * 3);
  }

  // ---------------- output ----------------

  emote(kind: EmoteKind) {
    if (this.settings.speech === 'off') return;
    if (kind !== 'zzz' && this.time - this.lastEmote < 0.25) return;
    this.lastEmote = this.time;
    this.events.push({ type: 'emote', kind });
  }

  sound(name: SoundName, soft = false) {
    this.events.push({ type: 'sound', name, soft });
  }

  say(ev: LineEvent, important = false) {
    if (this.settings.speech !== 'chatty') return;
    if (!important && this.time - this.lastWords < 40) return;
    const lines = this.species.lines[ev];
    if (!lines?.length) return;
    this.lastWords = this.time;
    this.events.push({ type: 'say', text: lines[Math.floor(this.env.rand() * lines.length)] });
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): PetData {
    this.data.lastSeen = this.env.now();
    this.data.x = this.world.width ? clamp(this.x / this.world.width, 0, 1) : null;
    return { ...this.data, stats: { ...this.data.stats } };
  }
}

export const _test = { G, TAU };
