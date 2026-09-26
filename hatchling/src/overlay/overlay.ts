// The overlay renderer: one window per monitor that has dinos on it. It runs each dino's
// simulation, draws each one on its own small canvas, and handles the mouse. The window is
// click-through except while the cursor is over a dino (or a ball).
//
// Power: each dino is redrawn only as often as it needs: 60 fps while it runs, jumps or is
// carried, 30 while it walks, 15 while it idles (30 when you're near it), 8 asleep ('saver' power
// halves these, 'smooth' keeps them all at 60). The loop wakes for whichever dino is due next and
// leaves the others alone. While hidden or while the PC is locked it only ticks once a second
// (needs and growth keep counting), and with no dinos here it doesn't run at all.

import { drawEgg, drawPet, type Palette, paletteFor } from '../pet/draw';
import { stageName, stageOf } from '../pet/growth';
import { BUILT_IN, type SpeciesDef } from '../pet/species';
import type { Area, Leave } from '../shared/api';
import { type Activity, ALL_PETS, type Arrival, type HostedPet, type PetCommand, type Settings } from '../shared/types';
import { type EdgeKind, type Env, type Friend, Pet, type SimEvent, type SoundName } from '../sim/pet';
import { GROUND, ground, type World } from '../sim/world';
import { ballSprite, butterflyEl, foodSprite, Fx } from './fx';
import { Sounds } from './sound';
import { ToyLayer } from './toys';

const api = window.hatch;
const stage = document.getElementById('stage')!;
const fxRoot = document.getElementById('fx')!;
// Eggshells lie behind the dinos, and the dinos behind food, balls and butterflies.
const shellLayer = stage.appendChild(document.createElement('div'));
const petLayer = stage.appendChild(document.createElement('div'));
/** Effects that outlast a dino here (the puff when one is put away). */
const fx = new Fx(fxRoot);
const sounds = new Sounds();

window.addEventListener('error', (e) => api.error(`${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => api.error(String((e as PromiseRejectionEvent).reason)));

/** A dino on this monitor: its simulation, its canvas and its effects. */
interface Host {
  pet: Pet;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Its emotes and speech bubbles. */
  fx: Fx;
  fxEl: HTMLDivElement;
  /** Its toys (bubbles, bone, duck, laser, puddle). */
  toys: ToyLayer;
  pal: Palette;
  canvasW: number;
  canvasH: number;
  /** Where the feet are inside the canvas. */
  canvasFeet: number;
  /** 0..1 popping in (hatching, brought out). */
  pop: number;
  /** Squash (+) and stretch (-) of the drawing, as a damped spring. */
  squash: number;
  squashV: number;
  nextTwinkle: number;
  dirty: boolean;
  /** When it was last stepped, and when it's due again (performance.now() ms). */
  last: number;
  due: number;
  lastSave: number;
  saveSoon: number;
  lastStatus: string;
  lastAsleep: boolean;
  statusAt: number;
  /** Seconds until it next thinks about wandering over to another monitor. */
  roam: number;
  foodEls: Map<number, HTMLCanvasElement>;
  ballEl: HTMLCanvasElement | null;
  flyEl: HTMLDivElement | null;
  shell: { el: HTMLCanvasElement; until: number } | null;
  /** It has left this monitor. */
  gone: boolean;
}

let species: SpeciesDef[] = BUILT_IN;
let settings: Settings;
/** The dinos here, bottom to top. */
const hosts: Host[] = [];
let world: World = { width: window.innerWidth, height: window.innerHeight, platforms: [], walls: [] };
let edges: { left: EdgeKind; right: EdgeKind } = { left: 'wall', right: 'wall' };
/** The other monitors, in this window's coordinates. */
let others: Area[] = [];
let activity: Activity | null = null;
let hidden = false;
let locked = false;
let cursor: { x: number; y: number } | null = null;
/** When the window last had a mouse event of its own (those beat the polled cursor for a moment). */
let mouseAt = -1e9;
let captured = false;
/** The dino under the cursor. */
let hover: Host | null = null;
let down: { x: number; y: number; t: number; host: Host | null } | null = null;
let dragging: { host: Host; what: 'pet' | 'ball' | 'toy' } | null = null;
let frames = 0;
const errors: string[] = [];
const dpr = () => window.devicePixelRatio || 1;
const env: Env = { rand: Math.random, hour: () => new Date().getHours(), now: () => Date.now() };
const NO_FRIENDS: Friend[] = [];

const speciesOf = (id: string) => species.find((s) => s.id === id) ?? BUILT_IN[0];
const idOf = (h: Host) => h.pet.data.id;

function report(e: unknown) {
  const msg = (e as Error)?.stack ?? String(e);
  errors.push(msg);
  api.error(msg);
}

function paletteOf(h: Host) {
  const d = h.pet.data;
  h.pal = paletteFor(speciesOf(d.species), d.variant, d.colors);
}

function applySettings(s: Settings) {
  settings = s;
  for (const h of hosts) {
    h.pet.setSettings(s);
    h.dirty = true;
  }
  sounds.enabled = s.sound;
  sounds.volume = s.volume;
}

/** Plays a sound in a dino's voice, from where it is. */
function play(h: Host, name: SoundName, soft?: boolean) {
  const p = h.pet;
  sounds.setVoice(speciesOf(p.data.species).voice, p.growth);
  sounds.play(name, { soft, pan: ((p.x / Math.max(1, p.world.width)) * 2 - 1) * 0.6 });
}

// ---------------- dinos coming and going ----------------

function add(hp: HostedPet) {
  if (hosts.some((h) => idOf(h) === hp.pet.id)) return;
  const pet = new Pet(hp.pet, speciesOf(hp.pet.species), settings, world, env);
  pet.setEdges(edges.left, edges.right);
  if (activity && hp.arrive) {
    // Coming over from somewhere else: it already knows about the game you're playing.
    pet.game = activity.game;
    pet.setActivity(activity);
  }
  if (hidden || locked) pet.setHidden(true);
  const canvas = petLayer.appendChild(document.createElement('canvas'));
  const fxEl = fxRoot.appendChild(document.createElement('div'));
  const h: Host = {
    pet,
    canvas,
    ctx: canvas.getContext('2d')!,
    fx: new Fx(fxEl),
    fxEl,
    toys: new ToyLayer(stage),
    pal: paletteFor(speciesOf(hp.pet.species), hp.pet.variant, hp.pet.colors),
    canvasW: 0,
    canvasH: 0,
    canvasFeet: 0,
    pop: 1,
    squash: 0,
    squashV: 0,
    nextTwinkle: 2,
    dirty: true,
    last: performance.now(),
    due: 0,
    lastSave: 0,
    saveSoon: 0,
    lastStatus: '',
    lastAsleep: false,
    statusAt: 0,
    roam: 60 + Math.random() * 240,
    foodEls: new Map(),
    ballEl: null,
    flyEl: null,
    shell: null,
    gone: false,
  };
  hosts.push(h);
  arrive(h, hp.arrive);
  if (!pet.hatched) {
    // A new egg: point at it.
    setTimeout(() => {
      if (!h.gone && !h.pet.hatched && !hidden) {
        const at = h.pet.headAt();
        h.fx.say('Click me!', at.x, at.y - 6);
      }
    }, 1200);
  }
  wake(h);
}

function arrive(h: Host, a: Arrival | undefined) {
  const p = h.pet;
  if (!a) return;
  if (a.kind === 'edge') p.enter(a.side, a.y, a.ground);
  else if (a.kind === 'drop') p.dropIn(a.x, a.y);
  else if (!hidden && !locked) {
    h.pop = 0;
    fx.dust(p.x, p.y, true, Math.max(0.8, p.px));
    play(h, 'pop');
  }
}

/** The main process takes a dino away (put away, released, or off to another monitor). */
function remove(id: string) {
  const h = hosts.find((x) => idOf(x) === id);
  if (!h) return;
  if (!hidden && !locked) {
    const c = h.pet.toWorld({ x: h.pet.rig.p.bodyLen * 0.3, y: h.pet.rig.height * 0.4 });
    fx.dust(h.pet.x, h.pet.y, true, Math.max(0.8, h.pet.px));
    if (h.pet.hatched) fx.burst(c.x, c.y, Math.max(0.6, h.pet.px));
  }
  leave(h, { how: 'removed', pet: h.pet.snapshot() });
}

/** It leaves this monitor: the main process gets its latest data and sends it on. */
function leave(h: Host, l: Leave) {
  if (h.gone) return;
  h.gone = true;
  api.leave(l);
  const i = hosts.indexOf(h);
  if (i >= 0) hosts.splice(i, 1);
  h.canvas.remove();
  h.fxEl.remove();
  h.toys.clear();
  for (const el of h.foodEls.values()) el.remove();
  h.ballEl?.remove();
  h.flyEl?.remove();
  h.shell?.el.remove();
  if (dragging?.host === h) {
    dragging = null;
    document.body.classList.remove('dragging');
  }
  if (down?.host === h) down = null;
  if (hover === h) hover = null;
  updateHover();
}

/** Puts a dino on top of the others (picked up). */
function raise(h: Host) {
  const i = hosts.indexOf(h);
  if (i < 0 || i === hosts.length - 1) return;
  hosts.splice(i, 1);
  hosts.push(h);
  petLayer.appendChild(h.canvas);
  fxRoot.appendChild(h.fxEl);
}

/** The other dinos on this monitor, as they are now. */
function friendsOf(h: Host): Friend[] {
  const out: Friend[] = [];
  for (const o of hosts) {
    if (o === h) continue;
    out.push(o.pet.asFriend());
  }
  return out;
}

/** Now and then a dino pottering about on the ground wanders over to the next monitor. */
function roam(h: Host, dt: number) {
  if ((h.roam -= dt) > 0) return;
  h.roam = 90 + Math.random() * 270;
  const p = h.pet;
  const sides = (['left', 'right'] as const).filter((s) => edges[s] === 'exit');
  if (!sides.length || p.crossing || p.foods.length || p.ball || (p.act.k !== 'idle' && p.act.k !== 'walk') || Math.random() > 0.35) return;
  // Usually through the nearer edge.
  const near = p.x < world.width / 2 ? 'left' : 'right';
  const side = sides.length === 1 ? sides[0] : Math.random() < 0.75 ? near : near === 'left' ? 'right' : 'left';
  p.leave(side);
}

// ---------------- drawing ----------------

/** Sizes a dino's canvas to it: wide and short while it stands (little below its feet), square
 * while it climbs or is carried. Fewer pixels to clear and composite every frame. */
function resizeCanvas(h: Host) {
  const pet = h.pet;
  // `reach` includes the wingspan of winged species.
  const ext = pet.hatched ? pet.rig.reach * pet.px : pet.eggSize * 1.4;
  const w = Math.ceil(ext * 2 + 24);
  const r = pet.rig.pose;
  const tall = !pet.hatched || pet.rot !== 0 || pet.held || pet.flying || r.fly > 0.02 || (!!pet.species.features.wings && (r.display > 0.02 || r.wings > 0.02));
  const below = tall ? ext + 12 : Math.ceil(ext * 0.15 + 12);
  const hgt = Math.ceil(ext + 12 + below);
  if (Math.abs(w - h.canvasW) < 2 && Math.abs(hgt - h.canvasH) < 2) return;
  h.canvasW = w;
  h.canvasH = hgt;
  h.canvasFeet = hgt - below;
  h.canvas.width = Math.ceil(w * dpr());
  h.canvas.height = Math.ceil(hgt * dpr());
  h.canvas.style.width = `${w}px`;
  h.canvas.style.height = `${hgt}px`;
}

function draw(h: Host) {
  const pet = h.pet;
  const ctx = h.ctx;
  resizeCanvas(h);
  ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
  ctx.clearRect(0, 0, h.canvasW, h.canvasH);
  ctx.save();
  ctx.translate(h.canvasW / 2, h.canvasFeet);
  if (!pet.hatched) {
    drawEgg(ctx, pet.eggSize, h.pal, pet.egg.wobble, pet.egg.crack, pet.egg.open);
  } else {
    if (h.pop < 1) {
      const k = h.pop < 0.6 ? 0.5 + (h.pop / 0.6) * 0.6 : 1.1 - ((h.pop - 0.6) / 0.4) * 0.1;
      ctx.scale(k, k);
    }
    if (pet.rot) ctx.rotate(pet.rot);
    // Squash and stretch around the feet.
    if (Math.abs(h.squash) > 0.002) ctx.scale(1 + h.squash * 0.55, 1 - h.squash);
    const outline = Math.min(2.4, Math.max(1.3, 1.6 * pet.px));
    // On the move, fine skin detail can't be seen anyway.
    drawPet(ctx, pet.rig, h.pal, speciesOf(pet.data.species).features, { scale: pet.px, outline, shadow: pet.grounded && pet.rot === 0, fast: fpsOf(h) >= 30 && !CALM.has(pet.act.k) });
  }
  ctx.restore();
  h.canvas.style.transform = `translate(${pet.x - h.canvasW / 2}px, ${pet.y - h.canvasFeet}px)`;
}

// Food, ball, butterfly and eggshell sprites.
function drawSprites(h: Host) {
  const pet = h.pet;
  const size = 22 * Math.max(0.8, Math.min(1.4, pet.px * 1.1));
  for (const f of pet.foods) {
    let el = h.foodEls.get(f.id);
    if (!el) {
      el = foodSprite(f.golden ? 'treat' : f.kind, size);
      el.className = f.golden ? 'sprite golden' : 'sprite';
      stage.appendChild(el);
      h.foodEls.set(f.id, el);
    }
    el.style.transform = `translate(${f.x - size / 2}px, ${f.y - size * 0.85}px) scale(${Math.max(0.2, f.left)})`;
  }
  for (const [id, el] of h.foodEls) {
    if (!pet.foods.some((f) => f.id === id)) {
      el.remove();
      h.foodEls.delete(id);
    }
  }
  const b = pet.ball;
  if (b && !h.ballEl) {
    h.ballEl = ballSprite(b.r);
    h.ballEl.className = 'sprite';
    stage.appendChild(h.ballEl);
  }
  if (!b && h.ballEl) {
    h.ballEl.remove();
    h.ballEl = null;
  }
  if (b && h.ballEl) {
    const s = b.r + 2;
    h.ballEl.style.transform = `translate(${b.x - s}px, ${b.y - b.r - s}px) rotate(${b.angle}rad)`;
  }
  const fly = pet.butterfly;
  if (fly && !h.flyEl) {
    h.flyEl = butterflyEl(fly.hue);
    stage.appendChild(h.flyEl);
  }
  if (!fly && h.flyEl) {
    h.flyEl.remove();
    h.flyEl = null;
  }
  if (fly && h.flyEl) h.flyEl.style.transform = `translate(${fly.x - 13}px, ${fly.y - 11}px) scaleX(${fly.vx < 0 ? -1 : 1}) rotate(${Math.max(-0.5, Math.min(0.5, fly.vy / 400))}rad)`;
  h.toys.sync(pet);
  if (h.shell && performance.now() > h.shell.until) {
    h.shell.el.remove();
    h.shell = null;
  }
}

function leaveShell(h: Host) {
  const pet = h.pet;
  const size = pet.eggSize;
  const S = Math.ceil(size * 1.6);
  const el = document.createElement('canvas');
  el.width = el.height = Math.ceil(S * dpr());
  el.style.width = el.style.height = `${S}px`;
  el.className = 'sprite';
  el.style.transition = 'opacity 1.5s';
  const g = el.getContext('2d')!;
  g.scale(dpr(), dpr());
  g.translate(S / 2, S - 4);
  drawEgg(g, size, h.pal, 0, 1, 1);
  el.style.transform = `translate(${pet.x - S / 2 - size * 0.5}px, ${pet.y - S + 4}px)`;
  shellLayer.appendChild(el);
  h.shell = { el, until: performance.now() + 40_000 };
  setTimeout(() => (el.style.opacity = '0'), 38_000);
}

/** A point on a dino's body, for sparkles. */
function randomBodyPoint(h: Host) {
  const b = h.pet.rig.s.bounds;
  const l = { x: b.x1 + Math.random() * (b.x2 - b.x1), y: b.y1 + Math.random() * (b.y2 - b.y1) * 0.8 + (b.y2 - b.y1) * 0.2 };
  return h.pet.toWorld(l);
}

// ---------------- events from a dino's simulation ----------------

/** Everything a dino's simulation asks for (effects, sounds, saving, moving on) happens here. */
function handle(h: Host, events: SimEvent[]) {
  const pet = h.pet;
  for (const e of events) {
    switch (e.type) {
      case 'emote': {
        const at = pet.headAt();
        h.fx.emote(e.kind, at.x, at.y - 4, 18 + 10 * pet.px);
        break;
      }
      case 'say': {
        const at = pet.headAt();
        h.fx.say(e.text, at.x, at.y - 6);
        break;
      }
      case 'sound':
        play(h, e.name, e.soft);
        break;
      case 'dust':
        h.fx.dust(e.x, e.y, e.big, Math.max(0.6, pet.px), e.small ? 2 : undefined);
        break;
      case 'crumbs': {
        const food = pet.species.food;
        h.fx.crumbs(e.x, e.y, food === 'meat' ? '#b5532c' : food === 'fish' ? '#8fc0e8' : food === 'berry' ? '#d8325a' : '#5aa83a');
        break;
      }
      case 'squash':
        h.squash = e.amount;
        h.squashV = 0;
        break;
      case 'burst': {
        const c = pet.toWorld({ x: pet.rig.p.bodyLen * 0.4, y: pet.rig.height * 0.5 });
        h.fx.burst(c.x, c.y, Math.max(0.8, pet.px * 1.6));
        break;
      }
      case 'fx':
        h.fx.effect(e.kind, e.x, e.y, e.dir ?? 1, e.scale ?? Math.max(0.6, pet.px));
        break;
      case 'hatched':
        h.pop = 0;
        leaveShell(h);
        api.notify({ type: 'hatched', pet: idOf(h) });
        h.saveSoon = 1;
        if (pet.data.shiny) {
          const c = pet.headAt();
          h.fx.burst(c.x, c.y + 10, 1);
        }
        break;
      case 'grew':
        h.dirty = true;
        api.notify({ type: 'grew', pet: idOf(h), text: stageName(e.stage) });
        break;
      case 'save':
        h.saveSoon = 1;
        break;
      case 'exit':
        // Out of sight past the screen edge: over to the monitor on that side.
        leave(h, { how: 'exit', pet: pet.snapshot(), side: e.side, y: e.y, ground: e.ground });
        return;
    }
  }
}

function status(h: Host) {
  const pet = h.pet;
  const d = pet.data;
  if (!pet.hatched) return `${d.name} · egg`;
  const g = pet.growth;
  const k = pet.act.k;
  const doing = pet.asleep ? 'sleeping' : k === 'eat' ? 'eating' : k === 'climb' || k === 'cling' ? 'climbing' : k === 'dance' ? 'dancing' : k === 'fly' ? 'flying' : k === 'toy' ? 'playing' : k === 'watchVideo' ? 'watching' : '';
  return `${d.name} · ${stageName(stageOf(g))} ${Math.floor(g * 100)}%${doing ? ` · ${doing}` : ''}`;
}

function save(h: Host) {
  h.lastSave = Date.now();
  api.save(h.pet.snapshot());
}

// ---------------- the loop ----------------

let loopTimer = 0;
let rafPending = false;

function stepHost(h: Host, now: number) {
  const pet = h.pet;
  // Real elapsed time: needs and growth count every second, even between slow ticks.
  const dt = Math.max(0, (now - h.last) / 1000);
  h.last = now;
  const anim = Math.min(0.1, dt);
  pet.setCursor(cursor, anim);
  pet.setFriends(hosts.length > 1 ? friendsOf(h) : NO_FRIENDS);
  pet.update(dt);
  handle(h, pet.drain());
  if (h.gone) return;
  if (h.pop < 1) h.pop = Math.min(1, h.pop + anim / 0.35);
  if (h.squash !== 0) {
    h.squashV += (-h.squash * 190 - h.squashV * 13) * anim;
    h.squash += h.squashV * anim;
    if (Math.abs(h.squash) < 0.002 && Math.abs(h.squashV) < 0.02) h.squash = h.squashV = 0;
  }
  if (!hidden && !locked) {
    draw(h);
    drawSprites(h);
    const at = pet.headAt();
    h.fx.follow(at.x, at.y - 6);
    if (pet.data.shiny && pet.hatched && !pet.asleep && (h.nextTwinkle -= dt) <= 0) {
      h.nextTwinkle = 1.2 + Math.random() * 1.8;
      const q = randomBodyPoint(h);
      h.fx.twinkle(q.x, q.y);
    }
    roam(h, dt);
  }
  if (h.dirty) {
    h.dirty = false;
    h.canvasW = 0;
  }
  const t = Date.now();
  if (h.saveSoon && (h.saveSoon -= anim) <= 0) {
    h.saveSoon = 0;
    save(h);
  } else if (t - h.lastSave > 10_000) save(h);
  if (t - h.statusAt > 4000) {
    h.statusAt = t;
    const s = status(h);
    if (s !== h.lastStatus || pet.asleep !== h.lastAsleep) {
      h.lastAsleep = pet.asleep;
      h.lastStatus = s;
      api.notify({ type: 'status', pet: idOf(h), text: s, asleep: pet.asleep });
    }
  }
}

function loop() {
  rafPending = false;
  const now = performance.now();
  let stepped = false;
  for (const h of hosts.slice()) {
    if (h.gone || now < h.due) continue;
    try {
      stepHost(h, now);
    } catch (e) {
      report(e);
    }
    // A little early is fine: timers and frames don't land exactly.
    h.due = now + 1000 / fpsOf(h) - 3;
    stepped = true;
  }
  if (stepped) {
    if (!hidden && !locked) frames++;
    updateHover();
  }
  schedule();
}

/** Fast motion that needs smooth frames. Walking is fine at 30 fps; running and jumping aren't. */
const FAST = new Set(['jump', 'fall', 'move', 'climb', 'land', 'held', 'chase', 'zoomies', 'tail', 'hatch', 'pounce', 'hop', 'fly', 'leap', 'tag']);
const WALK = new Set(['walk', 'travel', 'follow', 'hunt', 'shake', 'dizzy', 'dance', 'paw', 'special', 'toy', 'fidget', 'forage', 'greet', 'roaroff', 'climbfun', 'cling', 'bow', 'playdead']);
const CALM = new Set(['idle', 'sit', 'lie', 'watch', 'wake', 'gaze', 'stretch', 'perch', 'watchVideo']);
/** Drawn rotated or off the ground but holding still (clinging to a wall, playing dead). */
const STILL = new Set(['cling', 'playdead']);

/** How often a dino needs to be redrawn right now. */
function need(h: Host) {
  const pet = h.pet;
  if (!pet.hatched) return pet.egg.wobbleT > 0 || pet.act.k === 'hatch' || hover === h ? 30 : 8;
  // Only things that actually move need smooth frames: a resting ball or food on the ground doesn't.
  const b = pet.ball;
  const ballMoving = !!b && (b.held || Math.abs(b.vx) > 1 || b.vy !== 0);
  // pet.smooth: a fast part of a move, toys in motion.
  const effects = pet.foods.some((f) => !f.landed) || ballMoving || !!pet.butterfly || dragging?.host === h || h.pop < 1 || h.squash !== 0 || pet.smooth;
  if (effects || ((!pet.grounded || pet.rot !== 0) && !STILL.has(pet.act.k)) || FAST.has(pet.act.k)) return 60;
  const speed = Math.abs(pet.vx);
  if (speed > pet.walkSpeed * 1.25 || pet.rig.run > 0.5) return 60;
  if (speed > 1 || WALK.has(pet.act.k)) return 30;
  // Breathing and blinking look the same at 12 (idle) or 5 (asleep) frames a second.
  if (pet.asleep) return pet.settling ? 30 : 5;
  if (CALM.has(pet.act.k)) return hover === h || (cursor && nearPet(h, cursor)) ? 30 : 12;
  return 30;
}

/** A dino's frame rate with the power setting: 'saver' halves it, 'smooth' is always 60. */
function fpsOf(h: Host) {
  if (hidden || locked) return 1;
  const f = need(h);
  return settings.power === 'smooth' ? Math.min(60, f * 2) : settings.power === 'saver' ? Math.max(4, f / 2) : f;
}

/** The busiest dino's frame rate: what the loop runs at. */
function fps() {
  let f = hidden || locked ? 1 : 0;
  for (const h of hosts) f = Math.max(f, fpsOf(h));
  return f;
}

function schedule() {
  clearTimeout(loopTimer);
  if (rafPending || !hosts.length) return;
  let next = Infinity;
  let smooth = false;
  for (const h of hosts) {
    next = Math.min(next, h.due);
    if (fpsOf(h) >= 60) smooth = true;
  }
  // On high refresh rate screens frames come faster than 60 fps; dinos that aren't due skip them.
  if (smooth) {
    rafPending = true;
    requestAnimationFrame(loop);
  } else loopTimer = window.setTimeout(loop, Math.max(0, next - performance.now()));
}

/** Something happened (input, a command): step now instead of waiting. */
function wake(h?: Host) {
  for (const x of h ? [h] : hosts) x.due = 0;
  if (rafPending) return;
  clearTimeout(loopTimer);
  loopTimer = window.setTimeout(loop, 0);
}

// ---------------- mouse ----------------

type Pt = { x: number; y: number };

function overBall(h: Host, p: Pt) {
  const b = h.pet.ball;
  return !!b && Math.hypot(p.x - b.x, p.y - (b.y - b.r)) < b.r + 6;
}

/** Cheap box check before the exact one: most of the time the cursor is nowhere near a dino. */
function nearPet(h: Host, c: Pt, margin = 0) {
  const r = (h.canvasW / 2 || 200) + margin;
  return Math.abs(c.x - h.pet.x) < r && c.y > h.pet.y - r && c.y < h.pet.y + r;
}

/** Whether the main process is watching the mouse closely for this overlay (see setNear). */
let near = false;

/** The topmost dino at a point. */
function petAt(p: Pt): Host | null {
  for (let i = hosts.length - 1; i >= 0; i--) {
    const h = hosts[i];
    if (nearPet(h, p) && h.pet.hitTest(p)) return h;
  }
  return null;
}

/** The dino whose ball is at a point. */
function ballAt(p: Pt): Host | null {
  for (let i = hosts.length - 1; i >= 0; i--) if (overBall(hosts[i], p)) return hosts[i];
  return null;
}

/** The dino whose toy (bone, duck, bubble wand...) is at a point. */
function toyAt(p: Pt): Host | null {
  for (let i = hosts.length - 1; i >= 0; i--) if (hosts[i].pet.overToy(p)) return hosts[i];
  return null;
}

/** A point on another monitor (outside this one): a dino let go there moves over. */
function onOtherMonitor(p: Pt) {
  if (p.x >= 0 && p.y >= 0 && p.x < world.width && p.y < world.height) return false;
  return others.some((a) => p.x >= a.x && p.x < a.x + a.width && p.y >= a.y && p.y < a.y + a.height);
}

function setCapture(on: boolean) {
  if (on === captured) return;
  captured = on;
  api.setCapture(on);
  document.body.classList.toggle('hover', on);
}

function updateHover() {
  if (dragging || down) return;
  const c = !hidden && !locked ? cursor : null;
  hover = c ? petAt(c) : null;
  setCapture(!!c && (hover !== null || ballAt(c) !== null || toyAt(c) !== null));
  // Close to a dino (or its ball or toys), mouse moves come straight to this page, so it takes
  // the mouse the moment the pointer is over it, and a quick click never falls through.
  const n = !!c && (hover !== null || hosts.some((h) => nearPet(h, c, 120) || (!!h.pet.ball && Math.hypot(c.x - h.pet.ball.x, c.y - h.pet.ball.y) < 160) || h.pet.toys.length > 0));
  if (n !== near) {
    near = n;
    api.setNear(n);
  }
}

/** Let go of whatever is held (mouse released, focus lost, or a missed mouseup). */
function endPointer(at?: Pt) {
  const d = dragging;
  if (d?.what === 'pet') d.host.pet.release();
  else if (d?.what === 'ball') d.host.pet.releaseBall();
  else if (d?.what === 'toy') d.host.pet.releaseToy();
  dragging = null;
  down = null;
  document.body.classList.remove('dragging');
  if (at) cursor = at;
  if (d?.what === 'pet' && at && !d.host.gone && onOtherMonitor(at)) leave(d.host, { how: 'drop', pet: d.host.pet.snapshot(), x: at.x, y: at.y });
  updateHover();
  wake();
}

window.addEventListener('mousemove', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  const prev = cursor;
  cursor = p;
  mouseAt = performance.now();
  if (down && !dragging && Math.hypot(p.x - down.x, p.y - down.y) > 5) {
    // Small things win over the dino they're next to (or in the mouth of): a ball, then a toy.
    const b = ballAt(down);
    const t = toyAt(down);
    if (b && b.pet.grabBall(down)) dragging = { host: b, what: 'ball' };
    else if (t && t.pet.grabToy(down)) dragging = { host: t, what: 'toy' };
    else if (down.host) {
      dragging = { host: down.host, what: 'pet' };
      down.host.pet.grab(down);
      raise(down.host);
    }
    if (dragging) {
      document.body.classList.add('dragging');
      wake(dragging.host);
    }
  }
  if (dragging?.what === 'pet') dragging.host.pet.drag(p);
  else if (dragging?.what === 'ball') dragging.host.pet.dragBall(p);
  else if (dragging?.what === 'toy') dragging.host.pet.dragToy(p);
  else if (!down && prev) petAt(p)?.pet.stroke(Math.hypot(p.x - prev.x, p.y - prev.y));
  // Take (or give back) the mouse right away rather than on the next frame.
  if (!dragging && !down) updateHover();
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const p = { x: e.clientX, y: e.clientY };
  mouseAt = performance.now();
  down = { ...p, t: mouseAt, host: petAt(p) };
});

// Keep receiving the pointer while the button is down, even outside the window, so the release is
// never missed; if the system takes the pointer away, let go. (Don't guess a release from a move
// without buttons: Windows and Chromium send those when the window starts taking the mouse.)
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  try {
    document.documentElement.setPointerCapture(e.pointerId);
  } catch {
    /* not capturable */
  }
});
window.addEventListener('pointercancel', () => endPointer());

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  const at = down;
  const quick = !dragging && !!at && performance.now() - at.t < 450;
  // A quick tap on a toy (squeeze the duck, pop a bubble), or else on the dino.
  const toy = quick ? toyAt(at!) : null;
  const tap = quick && !toy && at!.host && at!.host.pet.hitTest(at!) ? at!.host : null;
  endPointer({ x: e.clientX, y: e.clientY });
  tap?.pet.poke();
  toy?.pet.tapToy(at!);
});

window.addEventListener('blur', () => endPointer());
// While the button is down the pointer is captured and its release always arrives, so a leave
// then (which the system sends when the window starts taking the mouse) must not cancel a click.
document.addEventListener('mouseleave', () => {
  if (!dragging && !down) endPointer();
});

window.addEventListener('dblclick', (e) => {
  const h = petAt({ x: e.clientX, y: e.clientY });
  if (h) api.openCard(idOf(h));
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  endPointer();
  const p = { x: e.clientX, y: e.clientY };
  const h = petAt(p) ?? ballAt(p);
  api.menu(h ? idOf(h) : undefined);
});

// ---------------- commands ----------------

function command(h: Host, c: PetCommand) {
  const pet = h.pet;
  switch (c.type) {
    case 'feed':
      return pet.feed();
    case 'play':
      return pet.play();
    case 'call':
      return pet.call();
    case 'sleep':
      return pet.sleepNow();
    case 'wake':
      return pet.wakeNow();
    case 'rename':
      pet.rename(c.name);
      return save(h);
    case 'hatch-now':
      return pet.hatchNow();
    case 'recolor': {
      pet.data.variant = c.variant;
      pet.data.colors = c.colors;
      paletteOf(h);
      if (pet.hatched && !hidden) {
        const q = pet.toWorld({ x: pet.rig.p.bodyLen * 0.4, y: pet.rig.height * 0.5 });
        h.fx.burst(q.x, q.y, Math.max(0.8, pet.px * 1.4));
        if (pet.grounded && !pet.asleep) pet.react('happy');
      }
      return save(h);
    }
    case 'trick':
      return pet.trick(c.name);
    case 'treat':
      return pet.treat();
    case 'toy':
      return pet.toy(c.toy);
    case 'special':
      return pet.special();
    case 'flush':
      return save(h);
  }
}

// ---------------- wiring ----------------

function setHidden(v: boolean) {
  hidden = v;
  for (const h of hosts) {
    h.pet.setHidden(v || locked);
    if (v || locked) h.fx.clear();
  }
  if (v || locked) {
    endPointer();
    setCapture(false);
    sounds.sleep();
  }
  wake();
}

async function main() {
  const init = await api.init();
  species = init.species as SpeciesDef[];
  applySettings(init.settings);
  world = { width: init.width, height: init.height, platforms: [ground(init.width, init.height)], walls: [] };

  api.onWorld((w) => {
    world = { width: w.width, height: w.height, platforms: w.platforms.some((p) => p.id === GROUND) ? w.platforms : [...w.platforms, ground(w.width, w.height)], walls: w.walls };
    edges = w.edges;
    others = w.others;
    for (const h of hosts) {
      h.pet.setWorld(w.width, w.height, w.platforms, w.walls);
      h.pet.setEdges(w.edges.left, w.edges.right);
    }
  });
  api.onCursor((p) => {
    // The window's own mouse events are exact: the polled cursor only fills in between them.
    if (!dragging && !down && performance.now() - mouseAt > 300) {
      cursor = p;
      updateHover();
    }
  });
  api.onActivity((a) => {
    activity = a;
    for (const h of hosts) h.pet.setActivity(a);
    if (a.locked !== locked) {
      locked = a.locked;
      setHidden(hidden);
    }
  });
  api.onHidden((v) => setHidden(v));
  api.onSettings((s) => applySettings(s));
  api.onSpecies((list) => {
    species = list;
    for (const h of hosts) {
      h.pet.setSpecies(speciesOf(h.pet.data.species));
      paletteOf(h);
      h.dirty = true;
    }
  });
  api.onAdd((hp) => add(hp));
  api.onRemove((id) => remove(id));
  api.onCommand((c) => {
    for (const h of hosts.slice()) {
      if (c.pet && c.pet !== ALL_PETS && c.pet !== idOf(h)) continue;
      wake(h);
      command(h, c);
    }
  });

  for (const hp of init.pets) add(hp);
  if (init.test || init.smoke) {
    (window as unknown as { __test: unknown }).__test = {
      /** The first dino on this monitor. */
      get pet() {
        return hosts[0]?.pet;
      },
      pets: () => hosts.map((h) => h.pet),
      display: init.display,
      edges: () => edges,
      fx,
      frames: () => frames,
      fps,
      errors,
      get canvas() {
        return hosts[0]?.canvas;
      },
      sounds,
    };
  }
  api.ready();
  if (init.smoke) void smoke();
  loop();
}

/** `--smoke-test`: exercise the dino for a few seconds and report back. */
async function smoke() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const report: Record<string, unknown> = {};
  try {
    await wait(1500);
    const h = hosts[0];
    const pet = h.pet;
    pet.hatchNow();
    await wait(1500);
    report.hatched = pet.hatched;
    pet.feed();
    await wait(800);
    report.food = pet.foods.length;
    const at = { x: pet.x, y: pet.y - pet.heightPx * 0.4 };
    report.hit = pet.hitTest(at);
    pet.grab(at);
    pet.drag({ x: at.x + 40, y: at.y - 120 });
    pet.release();
    await wait(1500);
    report.landed = pet.grounded;
    pet.trick('dance');
    await wait(600);
    report.danced = pet.act.k === 'dance';
    pet.sleepNow();
    await wait(600);
    report.slept = pet.asleep;
    pet.wakeNow();
    await wait(400);
    // The dino's canvas has pixels on it.
    const data = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4 * 7) if (data[i] > 0) ink++;
    report.ink = ink;
    report.frames = frames;
    report.errors = errors.slice(0, 3);
  } catch (e) {
    report.errors = [...errors, String(e)];
  }
  api.smoke(report);
}

void main();
