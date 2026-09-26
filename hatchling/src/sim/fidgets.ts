// Idle animations and little habits, flavoured by species: sauropods sway their long necks and
// reach up high, raptors jerk their heads about and crouch to watch, ceratopsians toss their
// heads, hadrosaurs rear up on their hind legs, pterosaurs stretch and mantle their wings and
// shake their crests, small ones dart and hop about, crocodilians lurk low; and everyone looks
// around, turns round, scratches, yawns, flicks its tail, shakes its head, snaps at flies...
// Foraging: walking slowly and stopping to peck, sniff, graze or (pterosaurs) stalk like a stork.

import { clamp } from '../pet/math';
import { between, every, type Option } from './common';
import type { Act, Fidget, ForageStyle, Pet } from './pet';

type Cat = 'rest' | 'move' | 'play' | 'express' | 'social' | 'explore';
type FidgetAct = Extract<Act, { k: 'fidget' }>;
type ForageAct = Extract<Act, { k: 'forage' }>;

/** How long each fidget lasts (s). */
const DUR: Record<Fidget, readonly [number, number]> = {
  look: [2.6, 4],
  turn: [1.4, 1.8],
  scratch: [1.5, 2.3],
  ground: [1.2, 1.8],
  preen: [2.2, 3.6],
  stretchNeck: [1.6, 2.2],
  tailFlick: [1.1, 1.6],
  headShake: [0.8, 1],
  yawn: [1.8, 2.2],
  snap: [2.2, 3],
  stompInPlace: [1.5, 2],
  sway: [4, 6.5],
  reach: [2.6, 3.6],
  jerk: [1.8, 2.8],
  crouchWatch: [2.5, 4.5],
  headToss: [1.1, 1.4],
  rear: [2.2, 3.2],
  wingStretch: [2, 2.8],
  mantle: [2, 3],
  crestShake: [0.9, 1.2],
  dart: [1.2, 2],
  hops: [1, 1],
};

export function startFidget(p: Pet, what: Fidget) {
  const r = p.env.rand;
  if (what === 'hops') {
    // Quick little hops (the hop act).
    p.act = { k: 'hop', t: 0, n: 2 + Math.floor(r() * 3), next: 0.1 };
    return;
  }
  const [lo, hi] = DUR[what];
  const a: FidgetAct = { k: 'fidget', what, t: 0, dur: between(r, lo, hi), n: r() * 100, next: 0 };
  if (what === 'dart') {
    const pl = p.platform;
    const m = p.margin * 0.6;
    const dirn = r() < 0.65 ? p.facing : -p.facing;
    a.n = clamp(p.x + dirn * between(r, 60, 170) * Math.max(0.7, p.px), pl.x1 + m, pl.x2 - m);
  }
  if (what === 'snap') {
    const h = p.headAt();
    p.gnat = { x: h.x + 60, y: h.y - 30, t: 0, away: false };
  }
  p.vx = what === 'dart' ? p.vx : 0;
  p.act = a;
}

/** A value that jumps to a new random-ish number at each step (for twitchy movements). */
const jitter = (seed: number, k: number) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5 + Math.sin(seed * 4.1 + k * 17.3) * 0.5;

export function thinkFidget(p: Pet, a: FidgetAct, dt: number) {
  a.t += dt;
  const r = p.env.rand;
  const t = a.t;
  const u = t / a.dur;
  const fwd = p.facing;
  if (a.what !== 'dart') p.brake(dt);
  switch (a.what) {
    case 'look': {
      // Ahead and up, behind, down, up high.
      const seg = Math.floor(t / 0.95) % 4;
      const hp = p.heightPx;
      p.lookAt = seg === 0 ? { x: p.x + fwd * 300, y: p.y - hp * 2 } : seg === 1 ? { x: p.x - fwd * 320, y: p.y - hp } : seg === 2 ? { x: p.x + fwd * 160, y: p.y + 20 } : { x: p.x + fwd * 60, y: p.y - hp * 3.2 };
      p.pose('alert');
      break;
    }
    case 'turn':
      // A look back over the shoulder, then turn round.
      if (t < 0.7) {
        p.pose('alert');
        p.lookAt = { x: p.x - fwd * 300, y: p.y - p.heightPx * 0.8 };
      } else {
        if (a.next === 0) {
          a.next = 1;
          p.facing = p.facing > 0 ? -1 : 1;
        }
        p.pose('stand');
      }
      break;
    case 'scratch':
      // Scratching an itch with a hind foot, head tilted into it.
      p.pose('scratch', { tailWag: 0.2 });
      p.lookAt = null;
      break;
    case 'ground':
      // Scratching at the ground.
      p.pose('paw', { neck: -0.35, head: -0.3 });
      if (every(t, dt, 0.35)) p.fx('dirt', p.x - fwd * p.margin * 0.4, p.y - 2, -fwd, Math.max(0.5, p.px * 0.7));
      if (every(t + 0.3, dt, 1)) p.sound('dig', true);
      break;
    case 'preen':
      // Grooming: nibbling along the back or a wing.
      p.pose('preen', { wings: p.winged ? 0.5 : 0, tilt: Math.sin(t * 5) * 0.15 });
      p.snap('jaw', 0.05 + 0.3 * Math.max(0, Math.sin(t * 14)));
      p.lookAt = null;
      if (p.traits.feathered && every(t + 0.5, dt, 1.6) && r() < 0.6) {
        const c = p.toWorld({ x: 0, y: p.rig.height * 0.6 });
        p.fx('feather', c.x, c.y, -fwd);
      }
      break;
    case 'stretchNeck':
      p.pose(u < 0.65 ? 'stretchNeck' : 'stand');
      p.lookAt = null;
      break;
    case 'tailFlick':
      p.pose('alert', { tailLift: 0.3 + 0.25 * Math.sin(t * 9) });
      if (every(t + 0.35, dt, 0.4)) p.tailKick = (Math.floor(t / 0.4) % 2 ? -1 : 1) * 12000;
      break;
    case 'headShake':
      p.pose('stand', { neck: 0.1 });
      p.snap('tilt', Math.sin(t * 32) * 0.35 * (1 - u));
      p.snap('head', 0.1 + Math.sin(t * 27) * 0.12 * (1 - u));
      if (t <= dt * 1.5 && !p.traits.bigTheropod) p.sound('snort', true);
      p.lookAt = null;
      break;
    case 'yawn':
      p.pose(t < 0.8 ? 'stretch' : u < 0.85 ? 'yawn' : 'stand');
      if (every(t + 0.2, dt, 1)) p.sound('yawn', true);
      p.lookAt = null;
      break;
    case 'snap': {
      // A fly buzzes about its head; it watches it... and snaps.
      const g = p.gnat;
      p.pose('alert', { neck: 0.15 });
      if (g && !g.away) p.lookAt = { x: g.x, y: g.y };
      if (t > a.dur - 0.35 && a.next === 0) {
        a.next = 1;
        if (g && !g.away) {
          if (r() < 0.65) {
            p.gnat = null;
            p.sound('chew', true);
            if (r() < 0.5) p.emote('note');
          } else {
            g.away = true;
            p.emote('question');
          }
        }
      }
      if (a.next) p.pose('chirp', { jaw: t > a.dur - 0.2 ? 0.1 : 1 });
      break;
    }
    case 'stompInPlace': {
      // Heavy little stomps on the spot.
      const k = (t * 2.2) % 1;
      p.pose('stomp', { crouch: 0.15 + 0.45 * Math.max(0, Math.sin(k * Math.PI)), jaw: 0.1 });
      if (every(t + 0.2, dt, 1 / 2.2)) {
        p.events.push({ type: 'dust', x: p.x + (Math.floor(t * 2.2) % 2 ? 1 : -1) * p.margin * 0.3, y: p.y, big: false, small: true }, { type: 'squash', amount: 0.08 });
        p.sound('stomp', true);
      }
      break;
    }
    case 'sway':
      // Slow, dreamy neck sways.
      p.pose('stand', { neck: 0.28 * Math.sin(t * 1.1), head: 0.18 * Math.sin(t * 1.1 + 0.9), tailWag: 0.06 });
      p.lookAt = null;
      break;
    case 'reach':
      // Up high, sniffing the air.
      p.pose(u < 0.85 ? 'reach' : 'stand', { jaw: 0.05 + 0.12 * Math.max(0, Math.sin(t * 7)) });
      if (every(t + 0.1, dt, 1.1)) p.sound('sniff', true);
      p.lookAt = null;
      break;
    case 'jerk': {
      // Twitchy: the head snaps from one spot to the next.
      const step = Math.floor(t / 0.32);
      const neck = 0.35 * jitter(a.n, step);
      const head = 0.3 * jitter(a.n + 3, step);
      const tilt = 0.3 * jitter(a.n + 7, step);
      p.pose('alert', { neck, head, tilt });
      p.snap('neck', neck);
      p.snap('head', head);
      p.snap('tilt', tilt);
      p.rig.eyes = 'wide';
      p.lookAt = null;
      break;
    }
    case 'crouchWatch':
      // Low and still, watching; only the tail twitches.
      p.pose('crouchWatch');
      if (p.cursor) p.lookAt = p.cursor;
      if (every(t + 0.3, dt, 0.8)) p.tailKick = (r() < 0.5 ? -1 : 1) * 10000;
      break;
    case 'headToss':
      p.pose(t < 0.3 || (t > 0.6 && t < 0.9) ? 'headToss' : 'stand', { neck: t >= 0.3 && t <= 0.6 ? -0.2 : 0 });
      if (t <= dt * 1.5) p.sound('snort', true);
      p.lookAt = null;
      break;
    case 'rear':
      // Up on the hind legs for a look around.
      p.pose(u < 0.8 ? 'rear' : 'stand');
      p.lookAt = { x: p.x + fwd * 400, y: p.y - p.heightPx * 2.5 };
      if (every(t + 0.6, dt, 3) && p.traits.hadrosaur && r() < 0.5) p.sound('call', true);
      if (u >= 0.8 && a.next === 0) {
        a.next = 1;
        p.events.push({ type: 'dust', x: p.x, y: p.y, big: false }, { type: 'squash', amount: 0.1 });
      }
      break;
    case 'wingStretch':
      // Wings out wide, a few slow beats.
      p.pose(u < 0.9 ? 'wings' : 'stand');
      p.snap('flap', 0.25 + 0.5 * Math.sin(t * 2.6));
      if (every(t + 0.4, dt, 2)) p.sound('flap', true);
      break;
    case 'mantle':
      p.pose(u < 0.85 ? 'mantle' : 'stand');
      break;
    case 'crestShake':
      p.pose('stand', { wings: 0.35, neck: 0.15 });
      p.snap('tilt', Math.sin(t * 34) * 0.3 * (1 - u));
      p.snap('flap', 0.3 + Math.sin(t * 40) * 0.4);
      if (t <= dt * 1.5) p.sound('flap', true);
      p.lookAt = null;
      break;
    case 'dart':
      // A quick dash, then freeze with a curious tilt.
      if (a.next === 0) {
        p.rig.run = 1;
        p.pose('alert', { tailLift: 0.3 });
        if (p.walkTo(a.n, true, dt, 1.25)) a.next = 1;
      } else {
        p.brake(dt);
        p.pose('curious', { tilt: 0.3 });
      }
      break;
    case 'hops':
      break;
  }
  if (t > a.dur || t > 8) {
    if (a.what === 'snap' && p.gnat) p.gnat.away = true;
    p.act = p.idleAct(0.6 + r() * 1.4);
  }
}

/** The fly buzzing about its head (and flying off). */
export function updateGnat(p: Pet, dt: number) {
  const g = p.gnat;
  if (!g) return;
  g.t += dt;
  if (g.away || p.act.k !== 'fidget') {
    g.away = true;
    g.x += 120 * dt;
    g.y -= 160 * dt;
    if (g.t > 6 || g.y < -20) p.gnat = null;
    return;
  }
  const h = p.headAt();
  const k = g.t * 5.3;
  g.x = h.x + p.facing * 20 + Math.sin(k) * 28 + Math.sin(k * 2.7) * 10;
  g.y = h.y - 10 + Math.cos(k * 1.3) * 18;
}

// ---------------- foraging ----------------

export function startForage(p: Pet, style: ForageStyle) {
  const r = p.env.rand;
  p.act = { k: 'forage', style, t: 0, stage: 0, st: 0, n: 2 + Math.floor(r() * 3), toX: forageStep(p) };
}

function forageStep(p: Pet) {
  const pl = p.platform;
  const m = p.margin * 0.6;
  const r = p.env.rand;
  let dirn = r() < 0.75 ? p.facing : -p.facing;
  let x = p.x + dirn * between(r, 30, 80) * Math.max(0.7, p.px);
  if (x < pl.x1 + m || x > pl.x2 - m) {
    dirn = -dirn;
    x = p.x + dirn * between(r, 30, 80) * Math.max(0.7, p.px);
  }
  return clamp(x, pl.x1 + m, pl.x2 - m);
}

const FORAGE_SPEED: Record<ForageStyle, number> = { stalk: 0.5, sniff: 0.6, graze: 0.45, peck: 0.8 };

export function thinkForage(p: Pet, a: ForageAct, dt: number) {
  const r = p.env.rand;
  a.t += dt;
  a.st += dt;
  if (a.t > 30 || a.n <= 0) {
    p.act = p.idleAct(1 + r());
    return;
  }
  if (a.stage === 0) {
    // A few slow steps.
    p.pose(a.style === 'stalk' ? 'stalk' : a.style === 'peck' ? 'alert' : 'forage', a.style === 'peck' ? { neck: -0.1 + 0.15 * Math.sin(a.t * 9) } : undefined);
    if (p.walkTo(a.toX, false, dt, FORAGE_SPEED[a.style]) || a.st > 5) {
      a.stage = 1;
      a.st = 0;
    }
    return;
  }
  // Stop and look closely: stalk and snap, sniff, graze or peck.
  p.brake(dt);
  const len = a.style === 'graze' ? 1.8 : a.style === 'stalk' ? 1.6 : 1.1;
  switch (a.style) {
    case 'stalk':
      if (a.st < len - 0.3) p.pose('peer');
      else {
        p.pose('snap');
        if (every(a.st - (len - 0.3), dt, 10)) {
          p.sound(r() < 0.4 ? 'gulp' : 'chew', true);
          if (r() < 0.3) p.emote('note');
        }
      }
      break;
    case 'sniff':
      p.pose('sniff');
      if (a.st <= dt * 1.5) p.sound('sniff', true);
      break;
    case 'graze':
      p.pose('eat');
      p.snap('jaw', 0.1 + 0.3 * (0.5 + 0.5 * Math.sin(a.st * 10)));
      if (every(a.st, dt, 0.9)) p.sound('crunch', true);
      break;
    case 'peck': {
      // Quick pecks at the ground.
      const k = (a.st * 3.2) % 1;
      p.pose(k < 0.45 ? 'sniff' : 'alert');
      break;
    }
  }
  if (a.st > len) {
    a.n--;
    a.stage = 0;
    a.st = 0;
    a.toX = forageStep(p);
  }
}

// ---------------- choosing ----------------

/** Its fidgets and ways of foraging as things to do, weighted for its kind (for choosing). */
export function options(p: Pet): Partial<Record<Cat, Option[]>> {
  const tr = p.traits;
  const out: Partial<Record<Cat, Option[]>> = {};
  const add = (cat: Cat, w: number, name: string, fn: () => void) => {
    if (w > 0) (out[cat] ??= []).push([w, name, fn]);
  };
  const f = (cat: Cat, w: number, what: Fidget) => add(cat, w, `fidget:${what}`, () => startFidget(p, what));
  const d = p.data;
  // Everyone.
  f('rest', 1, 'look');
  f('rest', 0.6, 'turn');
  f('express', tr.biped && !tr.wings ? 0.7 : 0, 'scratch');
  f('express', 0.45, 'ground');
  f('express', 0.5, 'tailFlick');
  f('express', 0.5, 'headShake');
  f('rest', d.energy < 0.6 ? 0.8 : 0.3, 'yawn');
  f('express', 0.55, 'snap');
  f('express', 0.4, 'stretchNeck');
  // Its kind.
  if (tr.feathered || tr.wings) f('rest', 1.2, 'preen');
  if (tr.heavy && !tr.sauropod) f('express', 0.9, 'stompInPlace');
  if (tr.sauropod) {
    f('rest', 2.4, 'sway');
    f('express', 1.6, 'reach');
  }
  if (tr.raptor) {
    f('express', 1.7, 'jerk');
    f('rest', 1.2, 'crouchWatch');
  }
  if (tr.ceratopsian) f('express', 1.6, 'headToss');
  if (tr.hadrosaur && tr.biped) f('express', 1.5, 'rear');
  if (tr.wings) {
    f('express', 1.6, 'wingStretch');
    f('express', tr.soarer ? 1 : 0.3, 'crestShake');
  }
  if (tr.soarer) f('express', 0.7, 'mantle');
  if (tr.small) {
    f('play', 1.6, 'dart');
    f('play', 1.2, 'hops');
    f('move', 1.2, 'dart');
  }
  // Foraging, and a crocodile's low lurking walk.
  if (tr.stalker) add('move', 2.4, 'forage:stalk', () => startForage(p, 'stalk'));
  else if (tr.croc) add('move', 1.8, 'lurk', () => lurk(p));
  else if (p.species.diet === 'herbivore' && !tr.sauropod) add('move', 0.8, 'forage:graze', () => startForage(p, 'graze'));
  else if (p.species.diet === 'carnivore') add('move', 0.6, 'forage:sniff', () => startForage(p, 'sniff'));
  if (tr.small || (tr.feathered && !tr.wings)) add('move', 0.8, 'forage:peck', () => startForage(p, 'peck'));
  return out;
}

/** A slow, low walk, belly near the ground. */
export function lurk(p: Pet) {
  const pl = p.platform;
  const m = p.margin * 0.6;
  const reach = Math.min(pl.x2 - pl.x1 - 2 * m, 260 * Math.max(0.6, p.px));
  if (reach < 20) {
    p.act = p.idleAct(2);
    return;
  }
  const toX = clamp(p.x + (p.env.rand() * 2 - 1) * reach, pl.x1 + m, pl.x2 - m);
  p.act = { k: 'walk', toX, run: false, dur: 20, t: 0, style: 'lurk' };
}

