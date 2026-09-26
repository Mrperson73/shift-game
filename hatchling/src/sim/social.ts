// Other pets, your games and your videos.
//
// Friends: it greets a new friend (walks over, sniffs, happy), plays tag, copies a friend's trick,
// big theropods have roar-offs, flyers circle each other (flight.ts), it naps next to a sleeping
// friend, and it doesn't rest on top of another pet (or walk through one that's resting: it hops
// over). Each pet only sees the others' public state (Friend), so games like tag work from what
// both can see: when they touch, "it" and "runner" swap.
//
// Games: a cheer when one starts ("Good luck in Fortnite!"), calmer and quieter while you play,
// "GG!" at the end. Videos: now and then it sits facing the middle of the screen and watches along,
// reacting once in a while. Neither nags: reactions have cool-downs.

import { clamp } from '../pet/math';
import type { Platform } from '../shared/types';
import { between, G, type Option, sgn } from './common';
import * as Moves from './moves';
import type { Act, Friend, Pet } from './pet';
import { landingOn, route } from './world';

type Cat = 'rest' | 'move' | 'play' | 'express' | 'social' | 'explore';

/** Acts where a pet is settled down: others don't rest on top of it, and hop over it. */
const RESTING = new Set(['sit', 'lie', 'sleep', 'watchVideo']);
/** Big theropods (for roar-offs) when the overlay doesn't say. */
const BIG = new Set(['rex', 'carno', 'spino', 'allo', 'giga']);
/** A friend's tricks it may copy. */
const MIMIC = new Set(['dance', 'tail', 'hop', 'leap', 'bow', 'special', 'shake', 'playdead']);

/** On the same platform as the pet. */
export function samePlatform(p: Pet, f: Friend) {
  const pl = p.platform;
  return Math.abs(f.y - pl.y) < 3 && f.x >= pl.x1 - 2 && f.x <= pl.x2 + 2;
}

const friendById = (p: Pet, id: string) => p.friends.find((f) => f.id === id);
const isBig = (f: Friend) => f.big ?? BIG.has(f.species);
/** Settled down, awake or not. */
const resting = (f: Friend) => f.asleep || RESTING.has(f.act);

// ---------------- games and videos ----------------

export function gameChanged(p: Pet, prev: string | null, game: string | null) {
  const m = p.mem;
  if (!p.settings.gameReactions || !p.hatched) return;
  if (game && !prev) {
    p.data.stats.games++;
    // Once, not every time a game restarts.
    if (p.time - m.lastCheer < 120) return;
    m.lastCheer = p.time;
    if (p.act.k === 'sleep') p.wake(false);
    if (p.grounded && !p.anchored) p.react('game', undefined, false, { game });
    else {
      p.emote('exclaim');
      p.say('game', true, { game });
    }
  } else if (!game && prev) {
    if (p.time - m.lastGG < 120) return;
    m.lastGG = p.time;
    if (p.grounded && !p.anchored && p.act.k !== 'sleep') p.react('welcome', 'gameOver', false, { game: prev });
    else p.say('gameOver', true, { game: prev });
  }
}

export function videoChanged(p: Pet, prev: { site: string } | null, video: { site: string; title: string } | null) {
  const m = p.mem;
  if (!video || !p.settings.videoReactions || !p.hatched) return;
  // "Ooh, YouTube!": when a video starts, once in a while (not for every video).
  if (prev && prev.site === video.site) return;
  const key = video.site.toLowerCase();
  if (p.time - (m.videoSeen.get(key) ?? -1e9) < 600) return;
  m.videoSeen.set(key, p.time);
  m.watchReady = p.time + 4;
  const free = p.grounded && !p.anchored && !p.held && ['idle', 'sit', 'lie', 'walk', 'watch', 'gaze', 'fidget', 'forage', 'perch'].includes(p.act.k);
  if (free) p.react('video', undefined, false, { site: video.site });
}

function startWatch(p: Pet) {
  const r = p.env.rand;
  p.act = { k: 'watchVideo', t: 0, dur: between(r, 20, 50), next: between(r, 4, 9), mood: 0, react: null };
}

export function thinkWatchVideo(p: Pet, a: Extract<Act, { k: 'watchVideo' }>, dt: number) {
  const r = p.env.rand;
  a.t += dt;
  if (!p.video || !p.settings.videoReactions || a.t > a.dur) {
    p.mem.watchReady = p.time + between(r, 30, 90);
    p.act = p.idleAct(1 + r());
    return;
  }
  p.brake(dt);
  // Facing the middle of the screen, where the video probably is.
  const mid = p.world.width / 2;
  if (Math.abs(mid - p.x) > p.margin && sgn(mid - p.x) !== p.facing) p.facing = sgn(mid - p.x);
  p.lookAt = { x: mid, y: p.world.height * 0.4 };
  if (a.react && (a.mood -= dt) > 0) {
    if (a.react === 'laugh') p.pose('laugh');
    else if (a.react === 'gasp') p.pose('gasp');
    else {
      p.pose('video');
      p.rig.eyes = 'happy';
    }
    return;
  }
  a.react = null;
  p.pose('video');
  if ((a.next -= dt) > 0) return;
  // Now and then it reacts: a laugh, a gasp, hearts.
  a.next = between(r, 9, 22);
  const k = r();
  a.react = k < 0.45 ? 'laugh' : k < 0.7 ? 'gasp' : 'hearts';
  a.mood = a.react === 'laugh' ? 1.4 : 1;
  if (a.react === 'laugh') {
    p.emote('note');
    p.say('laugh');
    if (r() < 0.25) p.sound('happy', true);
  } else if (a.react === 'gasp') p.emote('exclaim');
  else p.emote('hearts');
}

// ---------------- friends ----------------

function friendToGreet(p: Pet): Friend | undefined {
  const m = p.mem;
  return p.friends.find((f) => samePlatform(p, f) && !f.asleep && Math.abs(f.x - p.x) < 900 && p.time - (m.greeted.get(f.id) ?? -1e9) > 180);
}

function startGreet(p: Pet, f: Friend) {
  p.mem.greeted.set(f.id, p.time);
  p.act = { k: 'greet', id: f.id, t: 0, stage: 0, st: 0 };
}

export function thinkGreet(p: Pet, a: Extract<Act, { k: 'greet' }>, dt: number) {
  a.t += dt;
  a.st += dt;
  const f = friendById(p, a.id);
  if (!f || a.t > 12 || !samePlatform(p, f)) {
    p.act = p.idleAct(1);
    return;
  }
  p.lookAt = { x: f.x, y: f.y - f.h * 0.7 };
  const dx = f.x - p.x;
  switch (a.stage) {
    case 0: {
      // Walk over.
      const gap = p.margin + f.h * 0.5;
      const pl = p.platform;
      const tx = clamp(f.x - sgn(dx || 1) * gap, pl.x1 + p.margin * 0.6, pl.x2 - p.margin * 0.6);
      const far = Math.abs(tx - p.x) > 260;
      p.rig.run = far ? 1 : 0;
      p.pose('happy', { tailWag: 0.25 });
      if (p.walkTo(tx, far, dt) || a.st > 9) {
        p.facing = sgn(dx || p.facing);
        a.stage = 1;
        a.st = 0;
        p.sound('sniff', true);
      }
      return;
    }
    case 1:
      // Sniff, nuzzle.
      p.brake(dt);
      p.pose('sniff', { tailWag: 0.3, neckAbs: -0.1, headAbs: -0.35 });
      if (a.st > 1.3) {
        a.stage = 2;
        a.st = 0;
        p.emote('heart');
        p.sound('happy', true);
        p.say('friend');
        p.data.happiness = clamp(p.data.happiness + 0.03, 0, 1);
      }
      return;
    default:
      p.brake(dt);
      p.pose('happy', { tailWag: 0.4 });
      if (a.st > 1.1) p.act = p.idleAct(1 + p.env.rand());
  }
}

function startTag(p: Pet, f: Friend, role: 'it' | 'run') {
  p.mem.tagReady = p.time + 45;
  p.act = { k: 'tag', id: f.id, role, t: 0, swap: 0, dur: between(p.env.rand, 14, 24), gone: 0 };
  p.emote(role === 'it' ? 'exclaim' : 'note');
}

export function thinkTag(p: Pet, a: Extract<Act, { k: 'tag' }>, dt: number) {
  a.t += dt;
  const f = friendById(p, a.id);
  a.gone = f && samePlatform(p, f) && f.act === 'tag' ? 0 : a.gone + dt;
  // The game ends when time's up, the friend stops playing, or it runs out of puff.
  if (!f || a.t > a.dur || a.gone > (a.t < 6 ? 6 : 1.5) || p.data.energy < 0.12) {
    p.mem.tagReady = p.time + 60;
    p.act = { k: 'react', kind: 'happy', t: 0, dur: 1.2 };
    p.emote('heart');
    return;
  }
  const pl = p.platform;
  const lo = pl.x1 + p.margin * 0.6;
  const hi = pl.x2 - p.margin * 0.6;
  const dx = f.x - p.x;
  const touch = Math.abs(dx) < p.margin + f.h * 0.45;
  if (touch && a.t - a.swap > 1.2) {
    // Tag! "It" and "runner" swap.
    a.swap = a.t;
    if (a.role === 'it') {
      a.role = 'run';
      p.emote('exclaim');
      p.sound('chirp', true);
    } else a.role = 'it';
  }
  p.rig.run = 1;
  p.lookAt = { x: f.x, y: f.y - f.h * 0.6 };
  if (a.role === 'it') {
    p.pose('stand', { tailLift: 0.35, neck: -0.05 });
    p.rig.eyes = 'wide';
    p.walkTo(clamp(f.x - sgn(dx || 1) * p.margin * 0.5, lo, hi), true, dt, 1.06);
  } else {
    // Run away; cornered, it dashes past.
    p.pose('happy', { tailLift: 0.4 });
    let tx = clamp(p.x - sgn(dx || 1) * 320, lo, hi);
    if (Math.abs(tx - p.x) < 50) tx = clamp(f.x + sgn(dx || 1) * 260, lo, hi);
    p.walkTo(tx, true, dt);
  }
}

function startRoarOff(p: Pet, f: Friend, lead: boolean) {
  p.mem.roarReady = p.time + 120;
  p.act = { k: 'roaroff', id: f.id, t: 0, lead, n: 0, next: lead ? 0.9 : 2.2 };
}

export function thinkRoarOff(p: Pet, a: Extract<Act, { k: 'roaroff' }>, dt: number) {
  a.t += dt;
  const f = friendById(p, a.id);
  if (!f || a.t > 15 || !samePlatform(p, f)) {
    p.act = p.idleAct(1);
    return;
  }
  const dx = f.x - p.x;
  const gap = p.heightPx * 1.4 + f.h * 0.8;
  const pl = p.platform;
  // Face the rival from a respectful distance...
  if (Math.abs(dx) > gap * 1.35) p.walkTo(clamp(f.x - sgn(dx) * gap, pl.x1 + p.margin * 0.6, pl.x2 - p.margin * 0.6), false, dt);
  else {
    p.brake(dt);
    p.facing = sgn(dx || p.facing);
  }
  p.lookAt = { x: f.x, y: f.y - f.h * 0.8 };
  // ...and take turns roaring, three each.
  if ((a.next -= dt) <= 0 && a.n < 3) {
    a.n++;
    a.next = 3;
    p.sound('roar');
  }
  const roaring = a.n > 0 && a.next > 1.8 && a.n <= 3;
  p.pose(roaring ? 'roar' : 'growl');
  if (a.n >= 3 && a.next < 1.2) {
    // Friends after all (or one last stomp).
    if (p.env.rand() < 0.5 && Moves.startMove(p, 'stomp', false)) return;
    p.emote('hearts');
    p.act = { k: 'react', kind: 'happy', t: 0, dur: 1.4 };
  }
}

function mimic(p: Pet, act: string) {
  p.emote('note');
  switch (act) {
    case 'dance':
      return p.trick('dance');
    case 'tail':
      return p.trick('spin');
    case 'hop':
      p.act = { k: 'hop', t: 0, n: 2 + Math.floor(p.env.rand() * 2), next: 0.2 };
      return;
    case 'leap':
      return p.trick('jump');
    case 'bow':
      return p.trick('bow');
    case 'shake':
      return p.trick('shake');
    case 'playdead':
      return p.trick('playdead');
    default: {
      const moves = p.traits.moves.filter((m) => m !== 'fly' && m !== 'gape');
      if (!moves.length || !Moves.startMove(p, moves[Math.floor(p.env.rand() * moves.length)], false)) p.act = p.idleAct(1);
    }
  }
}

/** Something other pets are doing that it joins in with right away (it's idle or so). */
export function socialInterrupt(p: Pet): boolean {
  if (!p.friends.length) return false;
  const m = p.mem;
  let started = false;
  for (const f of p.friends) {
    const before = m.friendActs.get(f.id);
    m.friendActs.set(f.id, f.act);
    if (started || !samePlatform(p, f) || f.asleep) continue;
    const near = Math.abs(f.x - p.x);
    // A friend playing tag comes this way: run!
    if (f.act === 'tag' && near < 800 && p.act.k !== 'tag' && p.time > m.tagReady && p.data.energy > 0.3) {
      startTag(p, f, 'run');
      started = true;
    } else if (f.act === 'greet' && near < 1000 && p.act.k !== 'greet' && p.time - (m.greeted.get(f.id) ?? -1e9) > 30) {
      // A friend coming over to say hello: go and meet it.
      startGreet(p, f);
      started = true;
    } else if (f.act === 'roaroff' && p.traits.bigTheropod && near < 900 && p.act.k !== 'roaroff' && p.time > m.roarReady) {
      // Answer a roar-off.
      startRoarOff(p, f, false);
      started = true;
    } else if (before !== undefined && before !== f.act && MIMIC.has(f.act) && near < 600 && p.time > m.mimicReady && p.env.rand() < 0.4) {
      // Copy the friend's trick.
      m.mimicReady = p.time + 60;
      mimic(p, f.act);
      started = true;
    }
  }
  return started;
}

/** Tired: goes to sleep next to a sleeping friend. False if there's none. */
export function napNearFriend(p: Pet): boolean {
  const f = p.friends.find((q) => q.asleep && Math.abs(q.x - p.x) < 1400);
  if (!f) return false;
  const plat = landingOn(p.platforms, f.x, f.y - 2, f.y + 2);
  if (!plat) return false;
  const m = p.margin * 0.6;
  const gap = p.margin + f.h * 0.55;
  let side = p.x < f.x ? -1 : 1;
  let x = f.x + side * gap;
  if (x < plat.x1 + m || x > plat.x2 - m) {
    side = -side;
    x = f.x + side * gap;
  }
  if (x < plat.x1 + m || x > plat.x2 - m) return false;
  // No way there: it would try again every couple of seconds and never get to sleep.
  if (plat.id !== p.platform.id && !route(p.platforms, p.world.walls, p.platform, p.x, plat, x, p.abilities)) return false;
  p.act = { k: 'travel', to: plat, toX: x, purpose: 'nap', run: false, t: 0, drop: false };
  return true;
}

/** Arrived next to a sleeping friend: curls up facing it. */
export function afterNap(p: Pet) {
  const f = p.friends.filter((q) => q.asleep).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  if (f) p.facing = sgn(f.x - p.x || p.facing);
  p.sleep('nap');
}

/** A resting friend right where it is (so it doesn't rest on top of it). */
export function crowded(p: Pet): Friend | undefined {
  return p.friends.find((f) => samePlatform(p, f) && resting(f) && Math.abs(f.x - p.x) < (p.margin + f.h * 0.5) * 0.9);
}

/** Moves over a bit from a resting friend. */
export function shuffleAway(p: Pet, f: Friend) {
  const pl: Platform = p.platform;
  const gap = (p.margin + f.h * 0.6) * 1.2;
  const lo = pl.x1 + p.margin * 0.6;
  const hi = pl.x2 - p.margin * 0.6;
  let x = f.x + sgn(p.x - f.x || 1) * gap;
  if (x < lo || x > hi) x = f.x - sgn(p.x - f.x || 1) * gap;
  p.act = { k: 'walk', toX: clamp(x, lo, hi), run: false, dur: 6, t: 0 };
}

/** Walking into a friend that's resting: hops over it. Returns true if it jumped. */
export function hopOver(p: Pet): boolean {
  if (p.time < p.mem.hopReady || !p.grounded || Math.abs(p.vx) < 10) return false;
  const dirn = sgn(p.vx);
  for (const f of p.friends) {
    if (!samePlatform(p, f) || !resting(f)) continue;
    const dx = (f.x - p.x) * dirn;
    if (dx > p.margin * 0.2 && dx < p.margin + f.h * 0.35) {
      const h = f.h * 0.75 + p.heightPx * 0.15;
      const t = 2 * Math.sqrt((2 * h) / G);
      const clear = dx + f.h * 0.9 + p.margin * 0.6;
      const resume = p.act;
      p.vy = -Math.sqrt(2 * G * h);
      p.vx = dirn * Math.max(Math.abs(p.vx), clear / t);
      p.grounded = false;
      p.act = { k: 'fall', t: 0, resume, voluntary: true };
      p.mem.hopReady = p.time + 3;
      p.sound('whoosh', true);
      return true;
    }
  }
  return false;
}

/** Friends and videos as things to do (for choosing). */
export function options(p: Pet): Partial<Record<Cat, Option[]>> {
  const out: { social: Option[]; play: Option[] } = { social: [], play: [] };
  const m = p.mem;
  if (!p.grounded || p.anchored) return out;
  if (p.video && p.settings.videoReactions && p.time > m.watchReady) out.social.push([3, 'watchVideo', () => startWatch(p)]);
  if (!p.friends.length) return out;
  const g = friendToGreet(p);
  if (g) out.social.push([m.greeted.has(g.id) ? 1.2 : 5, 'greet', () => startGreet(p, g)]);
  const mate = p.friends.find((q) => samePlatform(p, q) && !q.asleep && Math.abs(q.x - p.x) < 700);
  if (mate && p.data.energy > 0.4 && p.time > m.tagReady) out.play.push([1.4 * (0.4 + p.species.personality.playfulness), 'tag', () => startTag(p, mate, 'it')]);
  const rival = p.traits.bigTheropod ? p.friends.find((q) => samePlatform(p, q) && !q.asleep && isBig(q) && Math.abs(q.x - p.x) < 900) : undefined;
  if (rival && p.time > m.roarReady) out.social.push([1.5, 'roaroff', () => startRoarOff(p, rival, true)]);
  return out;
}

/** How much there is to be social about (added to the social category's weight). */
export function weight(p: Pet): number {
  let w = 0;
  if (p.video && p.settings.videoReactions && p.time > p.mem.watchReady) w += 1.6;
  if (p.friends.some((f) => samePlatform(p, f) && !f.asleep)) w += 1;
  if (friendToGreet(p)) w += 2;
  return w;
}
