// Signature moves (the Special button, and now and then on its own) and the tricks jump, bow and
// play dead. Each move is a little script: `stage` steps through it, `st` is the time in a stage.

import { clamp, lerp } from '../pet/math';
import type { Pose } from '../pet/rig';
import type { BodyParams, SignatureMove } from '../pet/species';
import { between, every, G, type Option } from './common';
import * as Flight from './flight';
import type { Act, Pet } from './pet';
import * as Toys from './toys';

type SpecialAct = Extract<Act, { k: 'special' }>;
type Cat = 'rest' | 'move' | 'play' | 'express' | 'social' | 'explore';

/** Starts a signature move; false when it can't right now (in the air, on a wall). */
export function startMove(p: Pet, move: SignatureMove, asked: boolean): boolean {
  if (move === 'fly') return Flight.startFlight(p, 'show', asked);
  if (p.held || !p.grounded || p.anchored) return false;
  if (move === 'fish' && p.traits.soarer) {
    // Pterosaurs skim a puddle for fish on the wing.
    Toys.ensurePuddle(p, 'far');
    if (Flight.startFlight(p, 'fish', asked)) return true;
  }
  p.vx = 0;
  const a: SpecialAct = { k: 'special', move, t: 0, stage: 0, st: 0, n: 0, tx: p.x, ok: false, asked, v: 0 };
  p.act = a;
  if (move === 'headbutt' || move === 'charge') aim(p, a);
  if (move === 'fish') {
    const pd = Toys.ensurePuddle(p, 'near');
    const reach = mouthReach(p);
    const side = pd.x >= p.x ? 1 : -1;
    // Stand at the edge of the water (crocodilians lie in wait a bit further back).
    a.tx = clamp(pd.x - side * (pd.w * 0.5 + reach * (p.traits.croc ? 0.9 : 0.35)), p.platform.x1 + p.margin * 0.6, p.platform.x2 - p.margin * 0.6);
  }
  return true;
}

/** Slow, calm moves it drops for food when it chose them itself (never when asked for). */
const LEISURELY = new Set<SignatureMove>(['gape', 'browse', 'display', 'honk', 'curl', 'dig']);
export const yieldsToFood = (a: SpecialAct) => !a.asked && LEISURELY.has(a.move);

/** How far the mouth reaches in front of the feet (px). */
export function mouthReach(p: Pet) {
  const b = p.rig.p;
  return (b.bodyLen * 0.5 + b.neckLen * 0.6 + b.headLen * 0.8) * p.px;
}

/** How far the front of the head is in front of the hips (px). */
function frontReach(p: Pet) {
  return Math.max(p.margin, p.rig.s.bounds.x2 * p.px * 0.95);
}

/** Head-butt and charge targets: a window side or a screen edge ahead (or behind), else open ground. */
function aim(p: Pet, a: SpecialAct) {
  const pl = p.platform;
  const lo = pl.x1 + p.margin * 0.6;
  const hi = pl.x2 - p.margin * 0.6;
  if (a.move === 'headbutt') {
    const front = frontReach(p);
    const head = p.y - p.heightPx * 0.6;
    let best: { stop: number; dir: 1 | -1; d: number } | null = null;
    for (const w of p.world.walls) {
      // It must stand in the way at head height, rising from this platform.
      if (w.y1 > head || w.y2 < head || w.x < pl.x1 - 2 || w.x > pl.x2 + 2) continue;
      // Window sides are hit from outside the window; the screen edges from inside the screen.
      const dir: 1 | -1 = w.side === 'left' ? 1 : -1;
      const stop = w.x - dir * front;
      const d = (stop - p.x) * dir;
      if (d < p.margin || d > 900 || stop < lo - 2 || stop > hi + 2) continue;
      const score = d * (dir === p.facing ? 1 : 1.6);
      if (!best || score < best.d) best = { stop, dir, d: score };
    }
    if (best) {
      a.tx = best.stop;
      a.ok = true;
      p.facing = best.dir;
      return;
    }
  }
  // Open ground: charge towards the side with more room.
  const room = p.facing > 0 ? hi - p.x : p.x - lo;
  const other = p.facing > 0 ? p.x - lo : hi - p.x;
  if (other > room * 1.4) p.facing = p.facing > 0 ? -1 : 1;
  const dist = (220 + p.env.rand() * 220) * Math.max(0.7, p.px);
  a.tx = clamp(p.x + p.facing * dist, lo, hi);
  a.ok = false;
}

function go(a: SpecialAct, stage: number) {
  a.stage = stage;
  a.st = 0;
}

function done(p: Pet) {
  p.act = p.idleAct(1 + p.env.rand() * 1.5);
}

/** Jumps up by h px (towards vx), then carries on with `a` after landing. */
function hop(p: Pet, a: SpecialAct, h: number, vx = 0) {
  p.vy = -Math.sqrt(2 * G * Math.max(4, h));
  p.vx = vx;
  p.grounded = false;
  p.act = { k: 'fall', t: 0, resume: a, voluntary: true };
  p.events.push({ type: 'squash', amount: -0.12 });
}

export function thinkSpecial(p: Pet, a: SpecialAct, dt: number) {
  a.t += dt;
  a.st += dt;
  // Never stuck in a move.
  if (a.t > 30) {
    done(p);
    return;
  }
  switch (a.move) {
    case 'stomp':
      return stomp(p, a);
    case 'headbutt':
      return headbutt(p, a, dt);
    case 'tailSwipe':
      return tailSwipe(p, a);
    case 'charge':
      return charge(p, a, dt);
    case 'fish':
      return fish(p, a, dt);
    case 'honk':
      return honk(p, a, dt);
    case 'display':
      return display(p, a, dt);
    case 'browse':
      return browse(p, a, dt);
    case 'dig':
      return dig(p, a, dt);
    case 'screech':
      return screech(p, a);
    case 'rake':
      return rake(p, a);
    case 'whip':
      return whip(p, a);
    case 'curl':
      return curl(p, a);
    case 'roll':
      return roll(p, a, dt);
    case 'gape':
      return gape(p, a, dt);
    case 'fly':
      done(p);
      return;
  }
}

/** A move's hop landed (called from Pet.land). */
export function moveLanded(p: Pet, a: SpecialAct, impact: number) {
  const x = p.x;
  switch (a.move) {
    case 'stomp':
      p.sound('stomp');
      p.fx('shockwave', x, p.y, 1, Math.max(0.8, p.px * (p.traits.heavy ? 1.5 : 1.1)));
      p.events.push({ type: 'dust', x, y: p.y, big: true }, { type: 'squash', amount: 0.3 });
      a.n++;
      go(a, a.n < 2 ? 1 : 2);
      return;
    case 'headbutt':
      // Bounced back off the wall.
      go(a, 3);
      p.emote('stars');
      return;
    case 'fish':
      // The crocodile's lunge lands in the water.
      if (a.stage === 2) {
        const pd = Toys.puddleOf(p);
        p.sound('splash');
        if (pd) p.fx('splash', pd.x, pd.y, 1, Math.max(1, p.px * 1.3));
        a.ok = p.env.rand() < 0.85;
        if (a.ok && pd) pd.fish = 'held';
        go(a, a.ok ? 3 : 5);
        if (!a.ok) p.emote('question');
      }
      return;
    default:
      if (impact > 900) p.sound('thud', true);
  }
}

// ---------------- the moves ----------------

function stomp(p: Pet, a: SpecialAct) {
  const h = p.heightPx * (p.traits.heavy ? 0.16 : 0.2);
  switch (a.stage) {
    case 0:
      // Wind up...
      p.pose('stomp', { crouch: Math.min(1, 0.3 + a.st * 2) });
      if (a.st > 0.4) hop(p, a, h);
      return;
    case 1:
      // ...STOMP (landing does the effects), and again.
      p.pose('stomp');
      if (a.st > 0.3) hop(p, a, h);
      return;
    case 2:
      // Then a roar.
      if (a.st < 0.05) p.sound('roar');
      p.pose(a.st < 0.25 ? 'crouch' : 'roar');
      if (a.st > 1.6) done(p);
  }
}

function headbutt(p: Pet, a: SpecialAct, dt: number) {
  const r = p.env.rand;
  switch (a.stage) {
    case 0:
      // Paw the ground and snort, head low.
      p.pose('paw', { neck: -0.3, head: -0.3 });
      p.rig.eyes = 'angry';
      if (every(a.st, dt, 0.35)) p.events.push({ type: 'dust', x: p.x - p.facing * p.margin * 0.6, y: p.y, big: false });
      if (every(a.st + 0.9, dt, 1)) p.sound('snort', true);
      if (a.st > 1.1) go(a, 1);
      return;
    case 1: {
      // Charge.
      p.rig.run = 1;
      p.pose('charge', { neck: -0.45, head: -0.45 });
      p.fast = true;
      if (every(a.st, dt, 0.2)) p.events.push({ type: 'dust', x: p.x - p.facing * p.margin * 0.5, y: p.y, big: false, small: true });
      const arrived = p.walkTo(a.tx, true, dt, 1.25);
      if (arrived || a.st > 6) {
        if (a.ok && arrived) {
          // BONK.
          const head = p.toWorld({ x: p.rig.s.bounds.x2, y: p.rig.height * 0.55 });
          p.sound('bonk');
          p.fx('bonk', head.x, head.y, p.facing);
          p.events.push({ type: 'squash', amount: 0.25 });
          hop(p, a, p.heightPx * 0.18, -p.facing * 140 * Math.max(0.6, p.px));
        } else go(a, 2);
      }
      return;
    }
    case 2:
      // Nothing to hit: skid to a stop.
      skid(p, a, dt);
      if (a.st > 0.6) go(a, 4);
      return;
    case 3:
      // Seeing stars, then shaking it off.
      p.brake(dt);
      if (a.st < 1.5) p.pose('dizzy');
      else {
        p.pose('stand');
        p.snap('tilt', Math.sin(a.st * 28) * 0.3);
      }
      if (a.st > 2.1) {
        if (r() < 0.5) p.emote('note');
        done(p);
      }
      return;
    default:
      p.pose('headToss');
      if (a.st < 0.05) p.sound('snort', true);
      if (a.st > 0.7) done(p);
  }
}

function skid(p: Pet, a: SpecialAct, dt: number) {
  if (a.st <= dt * 1.5) {
    p.events.push({ type: 'dust', x: p.x + p.facing * p.margin, y: p.y, big: true });
    p.sound('thud', true);
  }
  p.pose('stand', { pitch: 0.1, crouch: 0.5, neck: 0.1 });
  p.vx *= Math.max(0, 1 - dt * 5);
  if (every(a.st, dt, 0.09) && Math.abs(p.vx) > 20) p.events.push({ type: 'dust', x: p.x + p.facing * p.margin * 0.6, y: p.y, big: false, small: true });
}

function tailSwipe(p: Pet, a: SpecialAct) {
  const club = !!p.species.features.club;
  switch (a.stage) {
    case 0:
      // Look back at the tail, raise it.
      p.pose('whip', { crouch: 0.3, tailLift: 0.5, neck: -0.1 });
      p.lookAt = { x: p.x - p.facing * 300, y: p.y - p.heightPx * 0.3 };
      if (a.st < 0.05) p.sound('snort', true);
      if (a.st > 0.5) go(a, 1);
      return;
    case 1:
    case 2:
      // Swing it round: a quick half turn each way.
      p.fast = true;
      p.pose('stand', { crouch: 0.35, tailLift: 0.25, tailWag: 0.2 });
      if (a.st < 0.05) {
        p.facing = p.facing > 0 ? -1 : 1;
        p.tailKick = p.facing * 26000;
        p.sound('swish');
        const tip = tailTip(p);
        p.fx('swoosh', tip.x, tip.y, -p.facing);
        if (club) p.sound('thud', true);
        p.events.push({ type: 'dust', x: tip.x, y: p.y, big: false });
      }
      if (a.st > 0.38) go(a, a.stage + 1);
      return;
    default:
      p.pose('stand', { tailLift: 0.2 });
      if (a.st < 0.05) p.sound('snort', true);
      if (a.st > 0.6) done(p);
  }
}

function tailTip(p: Pet) {
  const tail = p.rig.s.tail;
  return p.toWorld(tail[tail.length - 1].p);
}

function charge(p: Pet, a: SpecialAct, dt: number) {
  switch (a.stage) {
    case 0:
      p.pose('paw', { neck: -0.25, head: -0.25 });
      p.rig.eyes = 'angry';
      if (every(a.st, dt, 0.35)) p.events.push({ type: 'dust', x: p.x - p.facing * p.margin * 0.6, y: p.y, big: false });
      if (every(a.st + 0.9, dt, 0.6)) p.sound('snort', true);
      if (a.st > 1.2) go(a, 1);
      return;
    case 1: {
      p.rig.run = 1;
      p.pose('charge');
      p.fast = true;
      if (every(a.st, dt, 0.16)) p.events.push({ type: 'dust', x: p.x - p.facing * p.margin * 0.5, y: p.y, big: false, small: true });
      if (p.walkTo(a.tx, true, dt, 1.25) || a.st > 5) {
        go(a, 2);
        // Keep the momentum into the skid.
        p.vx = p.facing * p.runSpeed * 1.1;
      }
      return;
    }
    case 2:
      skid(p, a, dt);
      if (a.st > 0.6) go(a, 3);
      return;
    default:
      p.brake(dt);
      p.pose(a.st < 0.35 ? 'headToss' : 'stand');
      if (a.st < 0.05) p.sound('snort', true);
      if (a.st > 0.9) done(p);
  }
}

function fish(p: Pet, a: SpecialAct, dt: number) {
  const pd = Toys.puddleOf(p);
  const r = p.env.rand;
  const croc = p.traits.croc;
  if (!pd && a.stage < 3) {
    done(p);
    return;
  }
  switch (a.stage) {
    case 0: {
      // Walk to the water's edge.
      const there = p.walkTo(a.tx, false, dt);
      p.pose(croc ? 'lurk' : 'stand');
      if (there || a.st > 8) {
        p.facing = pd!.x >= p.x ? 1 : -1;
        go(a, 1);
        a.v = croc ? between(r, 2, 3.5) : between(r, 1.2, 2.4);
      }
      return;
    }
    case 1:
      // Peer into the water (a crocodile lies flat and still), ripples now and then.
      p.brake(dt);
      if (croc) p.pose('lurk', { crouch: 1, neck: -0.12 });
      else p.pose('peer');
      p.lookAt = { x: pd!.x, y: pd!.y };
      if (every(a.st, dt, 0.9)) p.fx('ripple', pd!.x + (r() - 0.5) * pd!.w * 0.5, pd!.y);
      if (a.st > a.v) {
        go(a, 2);
        if (croc) {
          // Lunge!
          p.sound('whoosh');
          const dx = pd!.x - p.x;
          const h = p.heightPx * 0.3;
          const t = 2 * Math.sqrt((2 * h) / G);
          hop(p, a, h, dx / t);
          p.snap('jaw', 1.1);
        }
      }
      return;
    case 2:
      // Snap at a fish.
      p.pose('snap');
      p.fast = true;
      if (a.st <= dt * 1.5) {
        p.sound('splash');
        p.fx('splash', pd!.x, pd!.y, 1, Math.max(0.8, p.px));
        a.ok = a.n > 0 || r() < 0.6;
        if (a.ok) pd!.fish = 'held';
      }
      if (a.st > 0.4) {
        if (a.ok) go(a, 3);
        else {
          a.n++;
          p.emote('question');
          go(a, 1);
          a.v = between(r, 1, 2);
        }
      }
      return;
    case 3:
      // Got one: head up with the fish (a crocodile thrashes it about first).
      p.brake(dt);
      if (croc) {
        p.pose('lurk', { shake: 1, jaw: 0.4 });
        p.fast = true;
        if (every(a.st, dt, 0.3) && a.st < 0.9) {
          p.facing = p.facing > 0 ? -1 : 1;
          p.sound('splash', true);
          if (pd) p.fx('splash', p.x + p.facing * p.margin, p.y);
        }
        if (a.st > 1.2) go(a, 4);
      } else {
        p.pose('look_up', { jaw: 0.3 });
        if (a.st > 0.6) go(a, 4);
      }
      return;
    case 4:
      // Toss it and gulp it down.
      p.pose('chirp', { jaw: a.st < 0.2 ? 0.9 : 0.1 });
      if (a.st <= dt * 1.5) {
        if (pd) pd.fish = 'none';
        p.sound('gulp');
        p.emote('heart');
        p.say('fish');
        p.data.hunger = Math.max(0, p.data.hunger - 0.1);
        p.data.happiness = clamp(p.data.happiness + 0.05, 0, 1);
        if (pd) pd.left = Math.min(pd.left, 20);
      }
      if (a.st > 0.7) go(a, 5);
      return;
    default:
      p.pose('happy');
      if (a.st > 0.8) done(p);
  }
}

function honk(p: Pet, a: SpecialAct, dt: number) {
  switch (a.stage) {
    case 0:
      p.pose('inhale');
      if (a.st < 0.05) p.sound('sniff', true);
      if (a.st > 0.5) go(a, 1);
      return;
    case 1: {
      p.pose('honk');
      if (a.st < 0.05) p.sound('call');
      // Sound rings from the crest.
      if (a.st < 0.6 && every(a.st + 0.25, dt, 0.25)) {
        const q = crest(p);
        p.fx('rings', q.x, q.y, p.facing, Math.max(0.8, p.px * 1.2));
      }
      if (a.st > 1.3) go(a, 2);
      return;
    }
    default:
      p.pose('stand', { neck: 0.1 });
      if (a.st > 0.5) {
        if (a.n < 1 && p.env.rand() < 0.5) {
          a.n++;
          go(a, 1);
        } else done(p);
      }
  }
}

/** Top of the head, a bit back (where crests are). */
function crest(p: Pet) {
  const s = p.rig.s;
  return p.toWorld({ x: s.top.x - p.rig.p.headLen * 0.25, y: s.top.y + p.rig.p.headH * 0.2 });
}

function display(p: Pet, a: SpecialAct, dt: number) {
  const hiss = !!p.species.features.twinCrests;
  switch (a.stage) {
    case 0:
      // Rise up and flare.
      p.pose('display', { display: Math.min(1, a.st / 0.6), jaw: hiss ? 0.5 : 0 });
      if (a.st < 0.05) p.sound(hiss ? 'growl' : 'call', !hiss);
      if (a.st > 0.7) {
        go(a, 1);
        a.tx = clamp(p.x + p.facing * 70 * Math.max(0.7, p.px), p.platform.x1 + p.margin * 0.6, p.platform.x2 - p.margin * 0.6);
      }
      return;
    case 1:
      // Strut a few slow steps, showing off.
      p.pose('display', { jaw: hiss ? 0.4 : 0 });
      if (p.walkTo(a.tx, false, dt, 0.45) || a.st > 2) go(a, 2);
      return;
    case 2:
      // Turn to show the other side, with a shake of the frill.
      p.brake(dt);
      if (a.st < 0.05) {
        p.facing = p.facing > 0 ? -1 : 1;
        p.emote(p.env.rand() < 0.5 ? 'sparkle' : 'heart');
      }
      p.pose('display', { jaw: hiss ? 0.6 : 0.15 });
      p.snap('tilt', Math.sin(a.st * 22) * 0.18 * (1 - a.st));
      if (a.st > 0.9) go(a, 3);
      return;
    default:
      p.pose('stand', { display: Math.max(0, 1 - a.st / 0.5) });
      if (a.st > 0.6) done(p);
  }
}

function browse(p: Pet, a: SpecialAct, dt: number) {
  const r = p.env.rand;
  switch (a.stage) {
    case 0:
      p.pose('browse', { neckAbs: lerp(0.4, 1.25, Math.min(1, a.st / 0.8)) });
      if (a.st > 0.8) {
        go(a, 1);
        a.v = between(r, 4, 6);
      }
      return;
    case 1: {
      // Munching treetop leaves: they flutter down.
      p.pose('browse', { neckAbs: 1.25 + Math.sin(a.st * 3) * 0.05 });
      p.snap('jaw', 0.12 + 0.35 * (0.5 + 0.5 * Math.sin(a.st * 9)));
      const h = p.headAt();
      if (every(a.st, dt, 0.7)) p.fx('leaves', h.x + p.facing * 6, h.y + 6);
      if (every(a.st + 0.4, dt, 1.3)) p.sound('rustle', true);
      if (every(a.st, dt, 2.1)) p.sound('crunch', true);
      if (a.st > a.v) go(a, 2);
      return;
    }
    default:
      p.pose('stand');
      p.snap('jaw', 0.1 + 0.25 * (0.5 + 0.5 * Math.sin(a.st * 10)));
      if (a.st <= dt * 1.5) {
        p.data.hunger = Math.max(0, p.data.hunger - 0.05);
        p.emote('heart');
      }
      if (a.st > 1) done(p);
  }
}

function dig(p: Pet, a: SpecialAct, dt: number) {
  const r = p.env.rand;
  switch (a.stage) {
    case 0:
      p.pose('sniff');
      if (a.st < 0.05) p.sound('sniff', true);
      if (a.st > 0.6) {
        go(a, 1);
        a.v = between(r, 2, 3);
      }
      return;
    case 1: {
      p.pose('dig');
      const foot = p.toWorld({ x: -p.rig.p.meta, y: 0 });
      if (every(a.st, dt, 0.22)) p.fx('dirt', foot.x, p.y - 2, -p.facing);
      if (every(a.st, dt, 0.4)) p.sound('dig', true);
      if (a.st > a.v) {
        go(a, 2);
        // What did it find?
        const k = r();
        const spot = p.toWorld({ x: p.rig.p.bodyLen * 0.8, y: 0 });
        if (k < 0.28 && !p.toys.some((t) => t.kind === 'bone')) {
          Toys.putToy(p, 'bone', { x: spot.x, y: p.y - 4, vx: p.facing * 60, vy: -420 });
          a.ok = true;
          p.sound('pop');
          p.emote('exclaim');
          p.say('found');
        } else if (k < 0.55) {
          p.fx('find', spot.x, p.y - 6);
          p.sound('magic', true);
          p.emote('sparkle');
          p.say('found');
        } else p.emote('question');
      }
      return;
    }
    default:
      p.pose(a.ok ? 'happy' : 'stand');
      if (a.st > 1) {
        if (a.ok) Toys.playWith(p, 'bone');
        else done(p);
      }
  }
}

function screech(p: Pet, a: SpecialAct) {
  switch (a.stage) {
    case 0:
      p.pose('crouch');
      if (a.st > 0.3) go(a, 1);
      return;
    case 1:
      p.pose('screech');
      if (a.st < 0.05) p.sound(a.n ? 'call' : 'roar', a.n > 0);
      if (a.st > (a.n ? 0.7 : 1.2)) go(a, 2);
      return;
    default:
      // Listen: quick, jerky looks around.
      p.pose('alert');
      p.snap('tilt', Math.floor(a.st * 3) % 2 ? 0.25 : -0.15);
      if (a.st > 0.9) {
        if (a.n < 1 && p.env.rand() < 0.4) {
          a.n++;
          go(a, 1);
        } else done(p);
      }
  }
}

function rake(p: Pet, a: SpecialAct) {
  switch (a.stage) {
    case 0:
      p.pose('rake');
      if (a.st < 0.05) p.sound('growl', true);
      if (a.st > 0.6) go(a, 1);
      return;
    case 1: {
      // Slash down, three times.
      p.pose('rake');
      p.fast = true;
      if (a.st < 0.05) {
        p.sound('swish');
        const q = p.toWorld({ x: p.rig.p.bodyLen + p.rig.p.chestR * 1.2, y: p.rig.p.hipHeight * 0.9 });
        p.fx('slash', q.x, q.y, p.facing);
      }
      p.snap('arms', a.st < 0.14 ? lerp(1.2, -0.35, a.st / 0.14) : lerp(-0.35, 1.15, Math.min(1, (a.st - 0.14) / 0.3)));
      if (a.st > 0.45) {
        a.n++;
        if (a.n >= 3) go(a, 2);
        else go(a, 1);
      }
      return;
    }
    default:
      p.pose('stand', { arms: 0.2 });
      if (a.st > 0.7) done(p);
  }
}

function whip(p: Pet, a: SpecialAct) {
  switch (a.stage) {
    case 0:
      // Look back and raise the tail.
      p.pose('whip');
      p.lookAt = { x: p.x - p.facing * 400, y: p.y - p.heightPx * 0.5 };
      if (a.st > (a.n ? 0.5 : 0.8)) go(a, 1);
      return;
    case 1:
      // CRACK.
      p.fast = true;
      p.pose('stand', { tailLift: -0.15, tailCurl: 0.02 });
      p.lookAt = { x: p.x - p.facing * 400, y: p.y - p.heightPx * 0.3 };
      if (a.st < 0.05) p.tailKick = -p.facing * 38000;
      if (!a.ok && a.st > 0.14) {
        a.ok = true;
        const tip = tailTip(p);
        p.sound('whip');
        p.fx('crack', tip.x, tip.y, -p.facing);
        p.events.push({ type: 'dust', x: tip.x, y: p.y, big: false });
      }
      if (a.st > 0.5) go(a, 2);
      return;
    default:
      p.pose('stand', { tailLift: 0.1 });
      if (a.st > 0.7) {
        a.n++;
        a.ok = false;
        if (a.n < 2 && p.env.rand() < 0.5) go(a, 0);
        else done(p);
      }
  }
}

function curl(p: Pet, a: SpecialAct) {
  switch (a.stage) {
    case 0:
      p.pose('curl');
      if (a.st < 0.05) p.sound('snort', true);
      if (a.st > 0.4) {
        go(a, 1);
        a.v = between(p.env.rand, 2.5, 4);
      }
      return;
    case 1:
      p.pose('curl', { tremble: a.st < 0.6 ? 0.15 : 0 });
      if (a.st > a.v) go(a, 2);
      return;
    case 2:
      // Peek out.
      p.pose('curl', { neckAbs: -0.12, headAbs: -0.3 });
      p.rig.eyes = 'open';
      if (a.st > 0.9) go(a, 3);
      return;
    default:
      p.pose('shake');
      if (a.st < 0.05) p.events.push({ type: 'dust', x: p.x, y: p.y, big: false });
      if (a.st > 0.9) done(p);
  }
}

/** Crocodilian death roll: a thrashing spin with the jaws clamped, water flying. */
function roll(p: Pet, a: SpecialAct, dt: number) {
  switch (a.stage) {
    case 0:
      p.pose('lurk', { jaw: 0.7 });
      if (a.st > 0.35) go(a, 1);
      return;
    case 1:
      p.fast = true;
      p.pose('lurk', { shake: 1, tremble: 0.4, jaw: 0.35 });
      if (every(a.st + 0.34, dt, 0.35) && a.n < 4) {
        a.n++;
        p.facing = p.facing > 0 ? -1 : 1;
        p.tailKick = p.facing * 22000;
        p.sound('splash', a.n > 1);
        p.fx('splash', p.x + (p.env.rand() - 0.5) * p.margin, p.y, p.facing);
        p.events.push({ type: 'dust', x: p.x - p.facing * p.margin * 0.5, y: p.y, big: false }, { type: 'squash', amount: 0.18 });
      }
      if (a.st > 1.45) go(a, 2);
      return;
    default:
      p.pose('lurk');
      if (a.st > 0.8) done(p);
  }
}

/** Crocodilian basking: flat, jaws wide open, very still; now and then they snap shut. */
function gape(p: Pet, a: SpecialAct, dt: number) {
  const r = p.env.rand;
  switch (a.stage) {
    case 0:
      p.pose(a.st < 0.4 ? 'lurk' : 'gape', { jaw: a.st < 0.4 ? 0 : 0.6 });
      if (a.st > 0.8) {
        go(a, 1);
        a.v = a.asked ? between(r, 6, 9) : between(r, 8, 14);
        a.tx = a.t + between(r, 2.5, 5);
      }
      return;
    case 1: {
      p.brake(dt);
      // Snaps shut now and then (at least once), then slowly opens again.
      const last = a.st > a.v && a.n === 0 && !a.ok;
      if (a.ok) {
        p.pose('gape', { jaw: 0 });
        if (a.t > a.tx) {
          a.ok = false;
          a.tx = a.t + between(r, 2, 4);
        }
      } else {
        p.pose('gape');
        if (a.t > a.tx || last) {
          if (r() < 0.6 || last) {
            a.ok = true;
            a.n++;
            p.snap('jaw', 0);
            p.sound('chew', true);
            a.tx = a.t + 0.5;
          } else a.tx = a.t + between(r, 2, 4);
        }
      }
      if (a.st > a.v && !a.ok) go(a, 2);
      return;
    }
    default:
      p.pose(a.st < 0.3 ? 'lurk' : 'stand');
      if (a.st > 0.6) done(p);
  }
}

// ---------------- tricks ----------------

type LeapAct = Extract<Act, { k: 'leap' }>;

export function thinkLeap(p: Pet, a: LeapAct, dt: number) {
  a.t += dt;
  if (a.phase === 'crouch') {
    p.pose('crouch');
    p.vx = 0;
    if (!p.grounded) a.phase = 'air';
    else if (a.t > 0.28) {
      const h = Math.max(p.heightPx * 1.3, p.maxJumpUp * 0.75);
      p.vy = -Math.sqrt(2 * G * h);
      p.grounded = false;
      a.phase = 'air';
      a.t = 0;
      p.events.push({ type: 'dust', x: p.x, y: p.y, big: false }, { type: 'squash', amount: -0.18 });
      p.sound('whoosh', true);
    }
    return;
  }
  p.fast = true;
  p.pose('jump', { arms: 1, tailLift: 0.5, head: 0.3, neck: 0.2, jaw: 0.4 });
  p.rig.eyes = 'happy';
  // A spin at the top.
  if (a.flip && p.vy >= 0 && p.vy - G * dt < 0) p.facing = p.facing > 0 ? -1 : 1;
  if (a.t > 4) p.startFall(p.vy, true);
}

/** What it does after landing a trick jump. */
export function leapLanded(p: Pet): Act {
  p.emote('heart');
  p.sound('happy', true);
  return { k: 'react', kind: 'happy', t: 0, dur: 1.2 };
}

export function thinkBow(p: Pet, a: Extract<Act, { k: 'bow' }>, dt: number) {
  a.t += dt;
  p.brake(dt);
  p.pose(a.t < 1.5 ? 'bow' : 'happy');
  if (every(a.t, dt, 1.1) && a.t < 1.2) {
    p.emote('heart');
    p.sound('happy', true);
  }
  if (a.t > 2.2) p.act = p.idleAct(1);
}

/** How thick the body is lying down (rig units): on its back, it rests that far up. */
export function deadThickness(b: BodyParams) {
  return b.bellyR + b.bellyDrop * 0.7 - 1 + Math.max(b.hipR, b.chestR);
}

/** Lying on its back, the neck angle (local, upside down) that lays the head on the ground: long
 * necks lie almost flat, short ones bend down to it. */
export function deadNeck(b: BodyParams): Partial<Pose> {
  const chest = b.bellyR * 0.85 + b.bellyDrop * 0.4;
  const neckAbs = clamp(Math.asin(clamp((deadThickness(b) - b.headH * 0.6 - chest) / Math.max(1, b.neckLen), -0.9, 0.9)), -0.3, 0.8);
  return { neckAbs, headAbs: neckAbs * 0.3 };
}

/** Flop over onto its back, legs in the air... */
export function startPlayDead(p: Pet) {
  if (!p.grounded || p.anchored) return;
  // It rests on its back that far above the ground.
  const thick = deadThickness(p.rig.p) * p.px;
  p.vx = 0;
  p.act = { k: 'playdead', t: 0, stage: 0, st: 0, cx: p.x, cy: p.platform.y - thick / 2, hc: thick / 2, dir: p.facing > 0 ? -1 : 1 };
}

export function thinkPlayDead(p: Pet, a: Extract<Act, { k: 'playdead' }>, dt: number) {
  a.t += dt;
  a.st += dt;
  let turn = 0;
  const ease = (u: number) => u * u * (3 - 2 * u);
  switch (a.stage) {
    case 0:
      // A dramatic stagger...
      p.pose('dizzy', { tremble: 0.5 });
      p.rig.eyes = 'wide';
      if (a.st < 0.05) p.sound('squeak', true);
      if (a.st > 0.4) {
        a.stage = 1;
        a.st = 0;
      }
      break;
    case 1: {
      // ...flops over...
      const u = Math.min(1, a.st / 0.45);
      turn = ease(u) * Math.PI;
      p.pose('playdead', deadNeck(p.rig.p));
      p.fast = true;
      if (u >= 1) {
        a.stage = 2;
        a.st = 0;
        p.sound('thud', true);
        p.events.push({ type: 'dust', x: a.cx, y: p.platform.y, big: false }, { type: 'squash', amount: 0.15 });
      }
      break;
    }
    case 2:
      // ...and lies there, legs up. One twitch.
      turn = Math.PI;
      p.pose('playdead', { ...deadNeck(p.rig.p), tremble: a.st > 1.3 && a.st < 1.5 ? 0.6 : 0 });
      if (a.st > 2.4) {
        a.stage = 3;
        a.st = 0;
      }
      break;
    default: {
      // Pops back up with the rest of the turn: ta-da!
      const u = Math.min(1, a.st / 0.4);
      turn = Math.PI + ease(u) * Math.PI;
      if (u < 0.5) p.pose('playdead', deadNeck(p.rig.p));
      else p.pose('happy');
      p.fast = true;
      if (u >= 1 || a.t > 8) {
        finishPlayDead(p, a);
        return;
      }
    }
  }
  if (a.t > 8) {
    finishPlayDead(p, a);
    return;
  }
  // Turn around the middle of the body (the drawing turns around the feet).
  const ang = turn * a.dir;
  p.rot = ang;
  p.x = a.cx - a.hc * Math.sin(ang);
  p.y = a.cy + a.hc * Math.cos(ang);
  p.vx = 0;
  p.vy = 0;
}

function finishPlayDead(p: Pet, a: Extract<Act, { k: 'playdead' }>) {
  p.rot = 0;
  p.x = a.cx;
  p.y = p.platform.y;
  p.grounded = true;
  p.events.push({ type: 'squash', amount: -0.15 });
  p.say('tada', true);
  p.emote('sparkle');
  p.sound('happy');
  p.act = { k: 'react', kind: 'happy', t: 0, dur: 1.4 };
}

// ---------------- choosing ----------------

/** Its own moves as things to do now and then, weighted so each species shows its character. */
export function options(p: Pet): Partial<Record<Cat, Option[]>> {
  const out: Partial<Record<Cat, Option[]>> = {};
  const add = (cat: Cat, w: number, move: SignatureMove) => {
    if (w <= 0) return;
    (out[cat] ??= []).push([w, `special:${move}`, () => void (startMove(p, move, false) || (p.act = p.idleAct(1)))]);
  };
  const d = p.data;
  const pers = p.species.personality;
  const lively = p.settings.activity === 'lively' ? 1 : p.settings.activity === 'normal' ? 0.5 : 0;
  for (const m of p.traits.moves) {
    switch (m) {
      case 'stomp':
        add('express', 1.8 + 1.2 * lively, m);
        break;
      case 'headbutt':
        add('play', (1.2 + lively) * (0.3 + d.energy), m);
        break;
      case 'tailSwipe':
        add('express', 1.4 + 0.6 * lively, m);
        break;
      case 'charge':
        add('play', (1.2 + lively) * (0.3 + d.energy), m);
        break;
      case 'fish':
        add('play', 1.3 + 0.5 * pers.playfulness, m);
        break;
      case 'honk':
        add('express', 1.2 + 1.5 * pers.vocal, m);
        break;
      case 'display':
        add('express', 1.6, m);
        break;
      case 'browse':
        add('rest', 2.6, m);
        break;
      case 'dig':
        add('explore', 1.1, m);
        add('play', 0.4, m);
        break;
      case 'screech':
        add('express', 1.2 + pers.vocal, m);
        break;
      case 'rake':
        add('express', 1.6, m);
        break;
      case 'whip':
        add('play', 1.3 + 0.6 * lively, m);
        break;
      case 'curl':
        add('rest', 1, m);
        break;
      case 'roll':
        add('play', 0.8 + 0.5 * lively, m);
        break;
      case 'gape':
        add('rest', 2.4, m);
        break;
      case 'fly':
        break;
    }
  }
  return out;
}

