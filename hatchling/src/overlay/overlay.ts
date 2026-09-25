// The overlay renderer: runs the pet simulation, draws it, and handles the mouse.
// The window is click-through except while the cursor is over the pet (or its ball).
//
// Power: it redraws only as often as the pet needs — up to 60 fps while something moves, 20 fps
// while it idles, 10 fps asleep, and not at all while hidden or while the PC is locked.

import { drawEgg, drawPet, type Palette, paletteFor } from '../pet/draw';
import { stageName, stageOf } from '../pet/growth';
import { BUILT_IN, type SpeciesDef } from '../pet/species';
import type { PetData, Settings } from '../shared/types';
import { type Env, Pet, type SimEvent } from '../sim/pet';
import { ground } from '../sim/world';
import { ballSprite, butterflyEl, foodSprite, Fx } from './fx';
import { Sounds } from './sound';

const api = window.hatch;
const stage = document.getElementById('stage')!;
const fx = new Fx(document.getElementById('fx')!);
const sounds = new Sounds();
const canvas = document.createElement('canvas');
stage.appendChild(canvas);
const ctx = canvas.getContext('2d')!;

window.addEventListener('error', (e) => api.error(`${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => api.error(String((e as PromiseRejectionEvent).reason)));

let species: SpeciesDef[] = BUILT_IN;
let settings: Settings;
let pet: Pet;
let pal: Palette;
let hidden = false;
let locked = false;
let cursor: { x: number; y: number } | null = null;
let captured = false;
let down: { x: number; y: number; t: number } | null = null;
let dragging: 'pet' | 'ball' | null = null;
let frames = 0;
let canvasSize = 0;
let pop = 1;
let dirty = true;
let lastSave = 0;
let saveSoon = 0;
let lastStatus = '';
let lastAsleep = false;
let statusAt = 0;
/** Squash (+) and stretch (-) of the drawing, as a damped spring. */
let squash = 0;
let squashV = 0;
let nextTwinkle = 2;
const errors: string[] = [];
const dpr = () => window.devicePixelRatio || 1;
const env: Env = { rand: Math.random, hour: () => new Date().getHours(), now: () => Date.now() };

const speciesOf = (id: string) => species.find((s) => s.id === id) ?? BUILT_IN[0];

function paletteForPet() {
  pal = paletteFor(speciesOf(pet.data.species), pet.data.variant, pet.data.colors);
}

function applySettings(s: Settings) {
  settings = s;
  pet?.setSettings(s);
  sounds.enabled = s.sound;
  sounds.volume = s.volume;
  dirty = true;
}

function voice() {
  sounds.setVoice(speciesOf(pet.data.species).voice, pet.growth);
}

function makePet(data: PetData, width: number, height: number) {
  const w = pet?.world ?? { width, height, platforms: [ground(width, height)], walls: [] };
  pet = new Pet(data, speciesOf(data.species), settings, w, env);
  paletteForPet();
  voice();
  fx.clear();
  dirty = true;
}

// ---------------- drawing ----------------

function resizeCanvas() {
  const p = pet.rig.p;
  const ext = pet.hatched ? (p.tailLen + p.bodyLen + p.neckLen + p.headLen + p.hipHeight * 0.4) * pet.px : pet.eggSize * 1.4;
  const size = Math.ceil(ext * 2 + 24);
  if (Math.abs(size - canvasSize) < 2) return;
  canvasSize = size;
  canvas.width = Math.ceil(size * dpr());
  canvas.height = Math.ceil(size * dpr());
  canvas.style.width = canvas.style.height = `${size}px`;
}

function draw() {
  resizeCanvas();
  const S = canvasSize;
  ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  if (!pet.hatched) {
    drawEgg(ctx, pet.eggSize, pal, pet.egg.wobble, pet.egg.crack, pet.egg.open);
  } else {
    if (pop < 1) {
      const k = pop < 0.6 ? 0.5 + (pop / 0.6) * 0.6 : 1.1 - ((pop - 0.6) / 0.4) * 0.1;
      ctx.scale(k, k);
    }
    if (pet.rot) ctx.rotate(pet.rot);
    // Squash and stretch around the feet.
    if (Math.abs(squash) > 0.002) ctx.scale(1 + squash * 0.55, 1 - squash);
    const outline = Math.min(2.4, Math.max(1.3, 1.6 * pet.px));
    drawPet(ctx, pet.rig, pal, speciesOf(pet.data.species).features, { scale: pet.px, outline, shadow: pet.grounded && pet.rot === 0 });
  }
  ctx.restore();
  canvas.style.transform = `translate(${pet.x - S / 2}px, ${pet.y - S / 2}px)`;
}

// Food, ball, butterfly and eggshell sprites.
const foodEls = new Map<number, HTMLCanvasElement>();
let ballEl: HTMLCanvasElement | null = null;
let flyEl: HTMLDivElement | null = null;
let shell: { el: HTMLCanvasElement; until: number } | null = null;

function drawSprites() {
  const size = 22 * Math.max(0.8, Math.min(1.4, pet.px * 1.1));
  for (const f of pet.foods) {
    let el = foodEls.get(f.id);
    if (!el) {
      el = foodSprite(f.kind, size);
      el.className = 'sprite';
      stage.appendChild(el);
      foodEls.set(f.id, el);
    }
    el.style.transform = `translate(${f.x - size / 2}px, ${f.y - size * 0.85}px) scale(${Math.max(0.2, f.left)})`;
  }
  for (const [id, el] of foodEls) {
    if (!pet.foods.some((f) => f.id === id)) {
      el.remove();
      foodEls.delete(id);
    }
  }
  const b = pet.ball;
  if (b && !ballEl) {
    ballEl = ballSprite(b.r);
    ballEl.className = 'sprite';
    stage.appendChild(ballEl);
  }
  if (!b && ballEl) {
    ballEl.remove();
    ballEl = null;
  }
  if (b && ballEl) {
    const s = b.r + 2;
    ballEl.style.transform = `translate(${b.x - s}px, ${b.y - b.r - s}px) rotate(${b.angle}rad)`;
  }
  const fly = pet.butterfly;
  if (fly && !flyEl) {
    flyEl = butterflyEl(fly.hue);
    stage.appendChild(flyEl);
  }
  if (!fly && flyEl) {
    flyEl.remove();
    flyEl = null;
  }
  if (fly && flyEl) flyEl.style.transform = `translate(${fly.x - 13}px, ${fly.y - 11}px) scaleX(${fly.vx < 0 ? -1 : 1}) rotate(${Math.max(-0.5, Math.min(0.5, fly.vy / 400))}rad)`;
  if (shell && performance.now() > shell.until) {
    shell.el.remove();
    shell = null;
  }
}

function leaveShell() {
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
  drawEgg(g, size, pal, 0, 1, 1);
  el.style.transform = `translate(${pet.x - S / 2 - size * 0.5}px, ${pet.y - S + 4}px)`;
  stage.insertBefore(el, canvas);
  shell = { el, until: performance.now() + 40_000 };
  setTimeout(() => (el.style.opacity = '0'), 38_000);
}

/** A point on the pet's body, for sparkles. */
function randomBodyPoint() {
  const b = pet.rig.s.bounds;
  const l = { x: b.x1 + Math.random() * (b.x2 - b.x1), y: b.y1 + Math.random() * (b.y2 - b.y1) * 0.8 + (b.y2 - b.y1) * 0.2 };
  return pet.toWorld(l);
}

// ---------------- events from the simulation ----------------

function handle(events: SimEvent[]) {
  for (const e of events) {
    switch (e.type) {
      case 'emote': {
        const h = pet.headAt();
        fx.emote(e.kind, h.x, h.y - 4, 18 + 10 * pet.px);
        break;
      }
      case 'say': {
        const h = pet.headAt();
        fx.say(e.text, h.x, h.y - 6);
        break;
      }
      case 'sound':
        sounds.play(e.name, { soft: e.soft, pan: ((pet.x / Math.max(1, pet.world.width)) * 2 - 1) * 0.6 });
        break;
      case 'dust':
        fx.dust(e.x, e.y, e.big, Math.max(0.6, pet.px));
        break;
      case 'crumbs': {
        const food = pet.species.food;
        fx.crumbs(e.x, e.y, food === 'meat' ? '#b5532c' : food === 'fish' ? '#8fc0e8' : food === 'berry' ? '#d8325a' : '#5aa83a');
        break;
      }
      case 'squash':
        squash = e.amount;
        squashV = 0;
        break;
      case 'burst': {
        const c = pet.toWorld({ x: pet.rig.p.bodyLen * 0.4, y: pet.rig.height * 0.5 });
        fx.burst(c.x, c.y, Math.max(0.8, pet.px * 1.6));
        break;
      }
      case 'hatched':
        pop = 0;
        leaveShell();
        api.notify({ type: 'hatched' });
        saveSoon = 1;
        if (pet.data.shiny) {
          const c = pet.headAt();
          fx.burst(c.x, c.y + 10, 1);
        }
        break;
      case 'grew':
        voice();
        dirty = true;
        api.notify({ type: 'grew', text: stageName(e.stage) });
        break;
      case 'save':
        saveSoon = 1;
        break;
    }
  }
}

function status() {
  const d = pet.data;
  if (!pet.hatched) return `${d.name} · egg`;
  const g = pet.growth;
  const doing = pet.asleep ? 'sleeping' : pet.act.k === 'eat' ? 'eating' : pet.act.k === 'climb' ? 'climbing' : pet.act.k === 'dance' ? 'dancing' : '';
  return `${d.name} · ${stageName(stageOf(g))} ${Math.floor(g * 100)}%${doing ? ` · ${doing}` : ''}`;
}

// ---------------- the loop ----------------

let last = performance.now();
let lastDraw = 0;
let loopTimer = 0;
let rafPending = false;

function step(now: number) {
  // Real elapsed time: needs and growth count every second, even between slow ticks.
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  const anim = Math.min(0.1, dt);
  pet.setCursor(cursor, anim);
  pet.update(dt);
  handle(pet.drain());
  if (pop < 1) pop = Math.min(1, pop + anim / 0.35);
  if (squash !== 0) {
    squashV += (-squash * 190 - squashV * 13) * anim;
    squash += squashV * anim;
    if (Math.abs(squash) < 0.002 && Math.abs(squashV) < 0.02) squash = squashV = 0;
  }
  const visible = !hidden && !locked;
  if (visible) {
    draw();
    drawSprites();
    const h = pet.headAt();
    fx.follow(h.x, h.y - 6);
    frames++;
    lastDraw = now;
    updateHover();
    if (pet.data.shiny && pet.hatched && !pet.asleep && (nextTwinkle -= dt) <= 0) {
      nextTwinkle = 1.2 + Math.random() * 1.8;
      const q = randomBodyPoint();
      fx.twinkle(q.x, q.y);
    }
  }
  if (dirty) {
    dirty = false;
    canvasSize = 0;
  }
  const t = Date.now();
  if (saveSoon && (saveSoon -= anim) <= 0) {
    saveSoon = 0;
    save();
  } else if (t - lastSave > 10_000) save();
  if (t - statusAt > 4000) {
    statusAt = t;
    const s = status();
    if (s !== lastStatus || pet.asleep !== lastAsleep) {
      lastAsleep = pet.asleep;
      lastStatus = s;
      api.notify({ type: 'status', text: s, asleep: pet.asleep });
    }
  }
}

function save() {
  lastSave = Date.now();
  api.save(pet.snapshot());
}

function loop() {
  rafPending = false;
  const now = performance.now();
  // On high refresh rate screens, animation frames come faster than 60 fps: skip the extras.
  if (now - lastDraw < 1000 / 60 - 3 && !hidden && !locked && fps() >= 60) {
    rafPending = true;
    requestAnimationFrame(loop);
    return;
  }
  try {
    step(now);
  } catch (e) {
    const msg = (e as Error).stack ?? String(e);
    errors.push(msg);
    api.error(msg);
  }
  schedule();
}

const MOVING = new Set(['walk', 'travel', 'jump', 'fall', 'move', 'climb', 'land', 'held', 'chase', 'zoomies', 'tail', 'hatch', 'pounce', 'hunt', 'shake', 'dizzy']);
const CALM = new Set(['idle', 'sit', 'lie', 'watch', 'wake']);

/** How often the pet needs to be redrawn right now. */
function fps() {
  if (hidden || locked) return 1;
  if (!pet.hatched) return pet.egg.wobbleT > 0 || pet.act.k === 'hatch' || captured ? 30 : 8;
  const busy = pet.foods.length > 0 || !!pet.ball || !!pet.butterfly || !!dragging || pop < 1 || squash !== 0 || !pet.grounded || Math.abs(pet.vx) > 1;
  if (busy || MOVING.has(pet.act.k)) return 60;
  if (pet.asleep) return 10;
  if (CALM.has(pet.act.k)) return captured ? 30 : 20;
  return 30;
}

function schedule() {
  clearTimeout(loopTimer);
  if (rafPending) return;
  const f = fps();
  if (f >= 60) {
    rafPending = true;
    requestAnimationFrame(loop);
  } else loopTimer = window.setTimeout(loop, 1000 / f);
}

/** Something happened (input, a command): run the next frame now instead of waiting. */
function wake() {
  if (rafPending) return;
  clearTimeout(loopTimer);
  loopTimer = window.setTimeout(loop, 0);
}

// ---------------- mouse ----------------

function overBall(p: { x: number; y: number }) {
  const b = pet.ball;
  return !!b && Math.hypot(p.x - b.x, p.y - (b.y - b.r)) < b.r + 6;
}

function setCapture(on: boolean) {
  if (on === captured) return;
  captured = on;
  api.setCapture(on);
  document.body.classList.toggle('hover', on);
}

function updateHover() {
  if (dragging || down) return;
  setCapture(!!cursor && !hidden && !locked && (pet.hitTest(cursor) || overBall(cursor)));
}

/** Let go of whatever is held (mouse released, focus lost, or a missed mouseup). */
function endPointer(at?: { x: number; y: number }) {
  if (dragging === 'pet') pet.release();
  else if (dragging === 'ball') pet.releaseBall();
  dragging = null;
  down = null;
  document.body.classList.remove('dragging');
  if (at) cursor = at;
  updateHover();
  wake();
}

window.addEventListener('mousemove', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  const prev = cursor;
  cursor = p;
  if (down && !dragging && Math.hypot(p.x - down.x, p.y - down.y) > 5) {
    if (overBall(down) && pet.grabBall(down)) dragging = 'ball';
    else {
      dragging = 'pet';
      pet.grab(down);
    }
    document.body.classList.add('dragging');
    wake();
  }
  if (dragging === 'pet') pet.drag(p);
  else if (dragging === 'ball') pet.dragBall(p);
  else if (!down && prev && pet.hitTest(p)) pet.stroke(Math.hypot(p.x - prev.x, p.y - prev.y));
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
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
  const tap = !dragging && down && performance.now() - down.t < 450 && pet.hitTest(down);
  endPointer({ x: e.clientX, y: e.clientY });
  if (tap) pet.poke();
});

window.addEventListener('blur', () => endPointer());
document.addEventListener('mouseleave', () => {
  if (!dragging) endPointer();
});

window.addEventListener('dblclick', (e) => {
  if (pet.hitTest({ x: e.clientX, y: e.clientY })) api.openCard();
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  endPointer();
  api.menu();
});

// ---------------- wiring ----------------

function setHidden(h: boolean) {
  hidden = h;
  pet.setHidden(h || locked);
  if (h || locked) {
    fx.clear();
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
  makePet(init.pet, init.width, init.height);
  pet.setWorld(init.width, init.height, [ground(init.width, init.height)], []);

  api.onWorld((w) => pet.setWorld(w.width, w.height, w.platforms, w.walls));
  api.onCursor((p) => {
    if (!dragging && !down) cursor = p;
  });
  api.onActivity((a) => {
    pet.setActivity(a);
    if (a.locked !== locked) {
      locked = a.locked;
      setHidden(hidden);
    }
  });
  api.onHidden((h) => setHidden(h));
  api.onSettings((s) => applySettings(s));
  api.onSpecies((list) => {
    species = list;
    pet.setSpecies(speciesOf(pet.data.species));
    paletteForPet();
    voice();
    dirty = true;
  });
  api.onPet((p) => {
    makePet(p, pet.world.width, pet.world.height);
    save();
  });
  api.onCommand((c) => {
    wake();
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
        return save();
      case 'hatch-now':
        return pet.hatchNow();
      case 'recolor': {
        pet.data.variant = c.variant;
        pet.data.colors = c.colors;
        paletteForPet();
        if (pet.hatched && !hidden) {
          const q = pet.toWorld({ x: pet.rig.p.bodyLen * 0.4, y: pet.rig.height * 0.5 });
          fx.burst(q.x, q.y, Math.max(0.8, pet.px * 1.4));
          if (pet.grounded && !pet.asleep) pet.react('happy');
        }
        return save();
      }
      case 'trick':
        return pet.trick(c.name);
      case 'flush':
        return save();
    }
  });

  if (init.test || init.smoke) {
    (window as unknown as { __test: unknown }).__test = { get pet() { return pet; }, fx, frames: () => frames, fps, errors, canvas, sounds };
  }
  if (init.smoke) void smoke();
  if (!pet.hatched) {
    // First time: point at the egg.
    setTimeout(() => {
      if (!pet.hatched && !hidden) {
        const h = pet.headAt();
        fx.say('Click me!', h.x, h.y - 6);
      }
    }, 1200);
  }
  loop();
}

/** `--smoke-test`: exercise the pet for a few seconds and report back. */
async function smoke() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const report: Record<string, unknown> = {};
  try {
    await wait(1500);
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
    // The pet canvas has pixels on it.
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
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
