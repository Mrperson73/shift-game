// The overlay renderer: runs the pet simulation, draws it, and handles the mouse.
// The window is click-through except while the cursor is over the pet (or its ball).

import { drawEgg, drawPet, palette, type Palette } from '../pet/draw';
import { stageName, stageOf } from '../pet/growth';
import { BUILT_IN, type SpeciesDef } from '../pet/species';
import type { PetData, Settings } from '../shared/types';
import { type Env, Pet, type SimEvent } from '../sim/pet';
import { ground } from '../sim/world';
import { ballSprite, foodSprite, Fx } from './fx';
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
const errors: string[] = [];
const dpr = () => window.devicePixelRatio || 1;
const env: Env = { rand: Math.random, hour: () => new Date().getHours(), now: () => Date.now() };

const speciesOf = (id: string) => species.find((s) => s.id === id) ?? BUILT_IN[0];

function paletteFor() {
  const sp = speciesOf(pet.data.species);
  pal = palette(sp.variants[pet.data.variant % sp.variants.length]);
}

function applySettings(s: Settings) {
  settings = s;
  pet?.setSettings(s);
  sounds.enabled = s.sound;
  sounds.volume = s.volume;
  dirty = true;
}

function voice() {
  const sp = speciesOf(pet.data.species);
  sounds.pitch = sp.voice.pitch;
  sounds.growlAmt = sp.voice.growl;
  sounds.baby = pet.rig.baby;
}

function makePet(data: PetData, width: number, height: number) {
  const w = pet?.world ?? { width, height, platforms: [ground(width, height)], walls: [] };
  pet = new Pet(data, speciesOf(data.species), settings, w, env);
  paletteFor();
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
    const outline = Math.min(2.4, Math.max(1.3, 1.6 * pet.px));
    drawPet(ctx, pet.rig, pal, speciesOf(pet.data.species).features, { scale: pet.px, outline, shadow: pet.grounded && pet.rot === 0 });
  }
  ctx.restore();
  canvas.style.transform = `translate(${pet.x - S / 2}px, ${pet.y - S / 2}px)`;
}

// Food, ball and eggshell sprites.
const foodEls = new Map<number, HTMLCanvasElement>();
let ballEl: HTMLCanvasElement | null = null;
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
        sounds.play(e.name, e.soft);
        break;
      case 'dust':
        fx.dust(e.x, e.y, e.big, Math.max(0.6, pet.px));
        break;
      case 'crumbs':
        fx.crumbs(e.x, e.y, pet.species.diet === 'carnivore' ? '#b5532c' : '#5aa83a');
        break;
      case 'hatched':
        pop = 0;
        leaveShell();
        api.notify({ type: 'hatched' });
        saveSoon = 1;
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
  const doing = pet.asleep ? 'sleeping' : pet.act.k === 'eat' ? 'eating' : pet.act.k === 'climb' ? 'climbing' : '';
  return `${d.name} · ${stageName(stageOf(g))} ${Math.floor(g * 100)}%${doing ? ` · ${doing}` : ''}`;
}

// ---------------- the loop ----------------

let last = performance.now();
let loopTimer = 0;

function step(now: number) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  pet.setCursor(cursor, dt);
  pet.update(dt);
  handle(pet.drain());
  if (pop < 1) pop = Math.min(1, pop + dt / 0.35);
  if (!hidden) {
    draw();
    drawSprites();
    const h = pet.headAt();
    fx.follow(h.x, h.y - 6);
    frames++;
    updateHover();
  }
  if (dirty) {
    dirty = false;
    canvasSize = 0;
  }
  const t = Date.now();
  if (saveSoon && (saveSoon -= dt) <= 0) {
    saveSoon = 0;
    save();
  } else if (t - lastSave > 20_000) save();
  if (frames % 120 === 0) {
    const s = status();
    if (s !== lastStatus) {
      lastStatus = s;
      api.notify({ type: 'status', text: s });
    }
  }
}

function save() {
  lastSave = Date.now();
  api.save(pet.snapshot());
}

function loop() {
  const now = performance.now();
  try {
    step(now);
  } catch (e) {
    const msg = (e as Error).stack ?? String(e);
    errors.push(msg);
    api.error(msg);
  }
  schedule();
}

function schedule() {
  clearTimeout(loopTimer);
  if (hidden) {
    // Hidden behind a full-screen app: keep needs and growth ticking, draw nothing.
    loopTimer = window.setTimeout(loop, 1000);
    return;
  }
  // Save power: slow frame rates while nothing much is moving.
  const busy = !!pet.foods.length || !!pet.ball || !!dragging || pop < 1 || captured;
  const k = pet.act.k;
  if (!busy && pet.asleep) loopTimer = window.setTimeout(loop, 1000 / 12);
  else if (!busy && pet.grounded && Math.abs(pet.vx) < 1 && (k === 'idle' || k === 'sit' || k === 'lie' || k === 'egg' || k === 'watch')) loopTimer = window.setTimeout(loop, 1000 / 30);
  else requestAnimationFrame(loop);
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
  setCapture(!!cursor && !hidden && (pet.hitTest(cursor) || overBall(cursor)));
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
  }
  if (dragging === 'pet') pet.drag(p);
  else if (dragging === 'ball') pet.dragBall(p);
  else if (!down && prev && pet.hitTest(p)) pet.stroke(Math.hypot(p.x - prev.x, p.y - prev.y));
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (dragging === 'pet') pet.release();
  else if (dragging === 'ball') pet.releaseBall();
  else if (down && performance.now() - down.t < 450 && pet.hitTest(down)) pet.poke();
  dragging = null;
  down = null;
  document.body.classList.remove('dragging');
  cursor = { x: e.clientX, y: e.clientY };
  updateHover();
});

window.addEventListener('dblclick', (e) => {
  if (pet.hitTest({ x: e.clientX, y: e.clientY })) api.openCard();
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu();
});

// ---------------- wiring ----------------

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
  api.onActivity((a) => pet.setActivity(a));
  api.onHidden((h) => {
    hidden = h;
    pet.setHidden(h);
    if (h) {
      fx.clear();
      setCapture(false);
    }
    schedule();
  });
  api.onSettings((s) => applySettings(s));
  api.onSpecies((list) => {
    species = list;
    pet.setSpecies(speciesOf(pet.data.species));
    paletteFor();
    voice();
    dirty = true;
  });
  api.onPet((p) => {
    makePet(p, pet.world.width, pet.world.height);
    save();
  });
  api.onCommand((c) => {
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
      case 'flush':
        return save();
    }
  });

  if (init.test || init.smoke) {
    (window as unknown as { __test: unknown }).__test = { get pet() { return pet; }, fx, frames: () => frames, errors, canvas, sounds };
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
