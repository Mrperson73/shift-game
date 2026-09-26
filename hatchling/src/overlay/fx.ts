// Little effects around the pet, as DOM elements: emotes, speech bubbles, dust and crumbs.

import type { Food } from '../pet/species';
import type { EmoteKind, FxKind } from '../sim/pet';

const HEART = '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.7C12 6.2 13.5 5 15.6 5 19 5 21.1 8.4 19.6 11.8 17.5 16.4 12 21 12 21z" fill="#ff5c8a" stroke="#7a1f3d" stroke-width="1.6" stroke-linejoin="round"/>';
const STAR = (x: number, y: number, r: number, fill = '#ffd34d') =>
  `<path transform="translate(${x} ${y}) scale(${r / 10})" d="M0-10 2.9-3.1 10-3.1 4.3 1.2 6.4 8.4 0 4.1-6.4 8.4-4.3 1.2-10-3.1-2.9-3.1Z" fill="${fill}" stroke="#7a5a10" stroke-width="1.4" stroke-linejoin="round"/>`;

const TWINKLE_PATH = '<path d="M0-9C1-2 2-1 9 0 2 1 1 2 0 9-1 2-2 1-9 0-2-1-1-2 0-9Z" fill="#fffbe6" stroke="#ffd34d" stroke-width="1"/>';
const TWINKLE = `<svg viewBox="-10 -10 20 20" width="14" height="14">${TWINKLE_PATH}</svg>`;
const LEAF = '<svg viewBox="-8 -8 16 16" width="13" height="13"><path d="M-6 5C-7-3-1-7 6-6 6 2 0 7-6 5Z" fill="#6fbf4a" stroke="#2d5a1c" stroke-width="1.2" stroke-linejoin="round"/><path d="M-5 4 4-4" stroke="#2d5a1c" stroke-width="0.9"/></svg>';
const FEATHER = '<svg viewBox="-10 -10 20 20" width="16" height="16"><path d="M-8 8C-6-2 0-8 8-8 7 0 1 6-8 8Z" fill="#f4efe4" stroke="#6b5a48" stroke-width="1.1" stroke-linejoin="round"/><path d="M-8 8 5-5" stroke="#6b5a48" stroke-width="0.9"/></svg>';

const ICONS: Record<Exclude<EmoteKind, 'zzz' | 'hearts' | 'stars'>, string> = {
  heart: HEART,
  exclaim: '<circle cx="12" cy="12" r="10" fill="#fff6c7" stroke="#6b5a1b" stroke-width="1.6"/><path d="M12 6v7" stroke="#6b3d1b" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.7" fill="#6b3d1b"/>',
  question: '<circle cx="12" cy="12" r="10" fill="#e3f0ff" stroke="#2c4a70" stroke-width="1.6"/><path d="M9 9.3a3 3 0 1 1 4.3 2.7c-.9.4-1.3 1-1.3 2" fill="none" stroke="#2c4a70" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.6" fill="#2c4a70"/>',
  note: '<path d="M9 18.5a3 3 0 1 1-2-2.8V5l10-2v11.5a3 3 0 1 1-2-2.8V6.6L9 7.9z" fill="#7cc6ff" stroke="#1e4d73" stroke-width="1.4" stroke-linejoin="round"/>',
  anger: '<g stroke="#d6283d" stroke-width="2.6" stroke-linecap="round" fill="none"><path d="M4 9c3 0 5-2 5-5"/><path d="M15 4c0 3 2 5 5 5"/><path d="M20 15c-3 0-5 2-5 5"/><path d="M9 20c0-3-2-5-5-5"/></g>',
  sweat: '<path d="M12 3c3 5 6 8 6 11.5a6 6 0 0 1-12 0C6 11 9 8 12 3z" fill="#9fd8ff" stroke="#2a5e87" stroke-width="1.5"/>',
  food: '<circle cx="12" cy="12" r="10.5" fill="#fff" stroke="#6b6b6b" stroke-width="1.4"/><circle cx="4" cy="21" r="1.6" fill="#fff" stroke="#6b6b6b" stroke-width="1"/><path d="M8 15c-2-2-1-6 2-7s6 0 6.5 3-2 5-5 5.3zM15.7 8.3l2.3-2.3M16.5 7.2a1.3 1.3 0 1 1 1.8-1.8" fill="#c96a3b" stroke="#5a2a14" stroke-width="1.3" stroke-linejoin="round"/>',
  sparkle: STAR(8, 9, 7, '#fff3a8') + STAR(17, 15, 5, '#ffe066') + STAR(18, 5, 3, '#fffbe0'),
};

export class Fx {
  private root: HTMLElement;
  private bubble: HTMLDivElement | null = null;
  private bubbleUntil = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private el(cls: string, x: number, y: number, html = '') {
    const d = document.createElement('div');
    d.className = `fx ${cls}`;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.innerHTML = html;
    this.root.appendChild(d);
    return d;
  }

  emote(kind: EmoteKind, x: number, y: number, size: number) {
    const s = Math.round(Math.max(16, Math.min(34, size)));
    // Keep it on screen when the pet stands on a window near the top.
    y = Math.max(y, s + 6);
    if (kind === 'zzz') {
      const d = this.el('zzz', x + s * 0.2, y, 'z');
      d.style.fontSize = `${Math.round(s * 0.7)}px`;
      d.addEventListener('animationend', () => d.remove());
      return;
    }
    if (kind === 'hearts') {
      [-1, 0, 1].forEach((k, i) => {
        const d = this.el('emote float', x + k * s * 0.7, y - Math.abs(k) * 4, `<svg viewBox="0 0 24 24" width="${s * 0.8}" height="${s * 0.8}">${HEART}</svg>`);
        d.style.animationDelay = `${i * 90}ms`;
        d.addEventListener('animationend', () => d.remove());
      });
      return;
    }
    if (kind === 'stars') {
      const d = this.el('emote spin', x, y + s * 0.4, `<svg viewBox="0 0 40 20" width="${s * 1.8}" height="${s * 0.9}">${STAR(8, 10, 6)}${STAR(22, 7, 5)}${STAR(34, 11, 6)}</svg>`);
      d.addEventListener('animationend', () => d.remove());
      return;
    }
    const d = this.el('emote float', x, y, `<svg viewBox="0 0 24 24" width="${s}" height="${s}">${ICONS[kind]}</svg>`);
    d.addEventListener('animationend', () => d.remove());
  }

  say(text: string, x: number, y: number) {
    this.bubble?.remove();
    const d = this.el('bubble', x, Math.max(y, 48));
    d.textContent = text;
    this.bubble = d;
    this.bubbleUntil = performance.now() + 2600 + text.length * 60;
  }

  /** Keep the speech bubble above the head; fade it out when its time is up. */
  follow(x: number, y: number) {
    const b = this.bubble;
    if (!b) return;
    b.style.left = `${x}px`;
    b.style.top = `${Math.max(y, 48)}px`;
    if (performance.now() > this.bubbleUntil && !b.classList.contains('out')) {
      b.classList.add('out');
      setTimeout(() => {
        b.remove();
        if (this.bubble === b) this.bubble = null;
      }, 400);
    }
  }

  dust(x: number, y: number, big: boolean, scale: number, count?: number) {
    const n = count ?? (big ? 6 : 4);
    for (let i = 0; i < n; i++) {
      const r = (big ? 9 : 6) * scale * (0.7 + Math.random() * 0.6);
      const d = this.el('dust', x, y - r * 0.5);
      d.style.width = d.style.height = `${r * 2}px`;
      const dx = (i - (n - 1) / 2) * r * 1.3;
      d.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0.55 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% - ${r * 0.8}px)) scale(1)`, opacity: 0 },
        ],
        { duration: 450 + Math.random() * 200, easing: 'cubic-bezier(.2,.7,.3,1)' },
      ).onfinish = () => d.remove();
    }
  }

  crumbs(x: number, y: number, color: string) {
    for (let i = 0; i < 4; i++) {
      const d = this.el('crumb', x, y);
      d.style.background = color;
      const dx = (Math.random() - 0.5) * 30;
      const up = 10 + Math.random() * 14;
      d.animate(
        [
          { transform: 'translate(0, 0)', opacity: 1 },
          { transform: `translate(${dx * 0.5}px, ${-up}px)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${dx}px, ${up * 0.8}px)`, opacity: 0 },
        ],
        { duration: 600 + Math.random() * 300, easing: 'ease-in' },
      ).onfinish = () => d.remove();
    }
  }

  /** A ring and a shower of stars (growing up, recolouring). */
  burst(x: number, y: number, scale: number) {
    const ring = this.el('ring', x, y);
    const size = 60 * scale;
    ring.style.width = ring.style.height = `${size}px`;
    ring.addEventListener('animationend', () => ring.remove());
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = (45 + Math.random() * 35) * scale;
      const r = 5 + Math.random() * 4;
      const star = this.el('spark', x, y, `<svg viewBox="-10 -10 20 20" width="${r * 2}" height="${r * 2}">${STAR(0, 0, 9, i % 2 ? '#fff3a8' : '#ffd34d')}</svg>`);
      star.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 10}px)) scale(1) rotate(90deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.15}px), calc(-50% + ${Math.sin(a) * d + 6}px)) scale(0.6) rotate(140deg)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.3,1)' },
      ).onfinish = () => star.remove();
    }
  }

  /** A single twinkle (shiny pets sparkle now and then). */
  twinkle(x: number, y: number) {
    const d = this.el('twinkle', x, y, TWINKLE);
    d.addEventListener('animationend', () => d.remove());
  }

  /** Effects from moves and toys (see FxKind). `dir` is -1/1 for the ones that point a way. All
   * are short-lived elements animated by the compositor: nothing to redraw each frame. */
  effect(kind: FxKind, x: number, y: number, dir = 1, scale = 1) {
    const s = Math.max(0.5, Math.min(2.2, scale));
    const r = Math.random;
    const fling = (d: HTMLElement, frames: Keyframe[], ms: number, easing = 'cubic-bezier(.2,.7,.4,1)') => {
      d.animate(frames, { duration: ms, easing }).onfinish = () => d.remove();
    };
    switch (kind) {
      case 'pop': {
        const ring = this.el('pop-ring', x, y);
        ring.style.width = ring.style.height = `${14 * s}px`;
        ring.addEventListener('animationend', () => ring.remove());
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + r();
          const d = this.el('drop', x, y);
          fling(d, [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 0.9 }, { transform: `translate(calc(-50% + ${Math.cos(a) * 14 * s}px), calc(-50% + ${Math.sin(a) * 14 * s}px)) scale(0.4)`, opacity: 0 }], 320);
        }
        return;
      }
      case 'splash':
      case 'drops': {
        // Water drops flying up and out (splash), or shaken off all round (drops).
        const n = kind === 'splash' ? 8 : 9;
        for (let i = 0; i < n; i++) {
          const d = this.el('drop', x, y);
          const a = kind === 'splash' ? -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.2 : (i / n) * Math.PI * 2 + r() * 0.5;
          const v = (kind === 'splash' ? 28 + r() * 30 : 18 + r() * 22) * s;
          const dx = Math.cos(a) * v;
          const up = Math.sin(a) * v;
          const size = (3 + r() * 3) * s;
          d.style.width = `${size}px`;
          d.style.height = `${size * 1.25}px`;
          fling(
            d,
            [
              { transform: 'translate(-50%, -50%)', opacity: 0.95 },
              { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${up * 0.8}px))`, opacity: 0.95, offset: 0.45 },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up * 0.4 + 26 * s}px))`, opacity: 0 },
            ],
            550 + r() * 250,
            'ease-out',
          );
        }
        if (kind === 'splash') this.effect('ripple', x, y + 2, 1, scale);
        return;
      }
      case 'ripple': {
        const d = this.el('ripple', x, y);
        d.style.width = `${40 * s}px`;
        d.style.height = `${12 * s}px`;
        d.addEventListener('animationend', () => d.remove());
        return;
      }
      case 'leaves':
      case 'feather': {
        const n = kind === 'leaves' ? 2 + Math.floor(r() * 2) : 1;
        for (let i = 0; i < n; i++) {
          const d = this.el(kind === 'leaves' ? 'leaf' : 'feather', x + (r() - 0.5) * 16 * s, y, kind === 'leaves' ? LEAF : FEATHER);
          const drift = (r() - 0.5) * 70 * s + dir * 10;
          const fall = (70 + r() * 60) * s;
          const spin = (r() - 0.5) * 540;
          fling(
            d,
            [
              { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 0 },
              { transform: `translate(calc(-50% + ${drift * 0.3}px), calc(-50% + ${fall * 0.25}px)) rotate(${spin * 0.3}deg)`, opacity: 1, offset: 0.15 },
              { transform: `translate(calc(-50% + ${-drift * 0.3}px), calc(-50% + ${fall * 0.6}px)) rotate(${spin * 0.7}deg)`, opacity: 1, offset: 0.6 },
              { transform: `translate(calc(-50% + ${drift}px), calc(-50% + ${fall}px)) rotate(${spin}deg)`, opacity: 0 },
            ],
            1700 + r() * 700,
            'linear',
          );
        }
        return;
      }
      case 'dirt': {
        // Clods kicked out behind.
        for (let i = 0; i < 4; i++) {
          const d = this.el('clod', x, y);
          const size = (3 + r() * 3) * s;
          d.style.width = d.style.height = `${size}px`;
          const dx = dir * (16 + r() * 26) * s;
          const up = (10 + r() * 16) * s;
          fling(
            d,
            [
              { transform: 'translate(-50%, -50%)', opacity: 1 },
              { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% - ${up}px))`, opacity: 1, offset: 0.4 },
              { transform: `translate(calc(-50% + ${dx}px), -50%)`, opacity: 0 },
            ],
            450 + r() * 200,
            'ease-out',
          );
        }
        return;
      }
      case 'rings': {
        // A sound ring out of the crest.
        const d = this.el('sound-ring', x, y);
        d.style.width = d.style.height = `${26 * s}px`;
        fling(d, [{ transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.9 }, { transform: `translate(calc(-50% + ${dir * 30 * s}px), calc(-50% - ${14 * s}px)) scale(3.2)`, opacity: 0 }], 1100, 'ease-out');
        return;
      }
      case 'shockwave': {
        // A ring of dust along the ground, and puffs to both sides.
        const d = this.el('shock', x, y);
        d.style.width = `${60 * s}px`;
        d.style.height = `${14 * s}px`;
        d.addEventListener('animationend', () => d.remove());
        this.dust(x - 20 * s, y, true, s, 3);
        this.dust(x + 20 * s, y, true, s, 3);
        return;
      }
      case 'bonk': {
        const flash = this.el('flash', x, y);
        flash.style.width = flash.style.height = `${34 * s}px`;
        flash.addEventListener('animationend', () => flash.remove());
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i / 4 - 0.5) * 2.6 - dir * 0.3;
          const d = this.el('spark', x, y, `<svg viewBox="-10 -10 20 20" width="${12 * s}" height="${12 * s}">${STAR(0, 0, 9)}</svg>`);
          fling(d, [{ transform: 'translate(-50%, -50%) scale(0.3)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * 34 * s}px), calc(-50% + ${Math.sin(a) * 30 * s}px)) scale(1) rotate(120deg)`, opacity: 0 }], 750);
        }
        return;
      }
      case 'crack': {
        const d = this.el('crack', x, y, `<svg viewBox="-20 -20 40 40" width="${40 * s}" height="${40 * s}"><path d="M0-18 4-6 16-12 7-1 19 6 5 4 3 17-3 5-15 12-6 0-18-8-4-5Z" fill="#fff7c2" stroke="#e0a21a" stroke-width="2" stroke-linejoin="round"/></svg>`);
        d.addEventListener('animationend', () => d.remove());
        return;
      }
      case 'slash': {
        const path = (k: number) => `<path d="M${-14 + k * 6} -16 Q ${6 + k * 6} -2 ${-2 + k * 6} 16" fill="none" stroke="#fffdf2" stroke-width="3.2" stroke-linecap="round"/>`;
        const d = this.el('slash', x, y, `<svg viewBox="-24 -20 48 40" width="${46 * s}" height="${38 * s}" style="transform: scaleX(${dir})">${path(-1)}${path(0)}${path(1)}</svg>`);
        d.addEventListener('animationend', () => d.remove());
        return;
      }
      case 'swoosh': {
        const d = this.el('swoosh', x, y, `<svg viewBox="-30 -20 60 40" width="${64 * s}" height="${42 * s}" style="transform: scaleX(${dir})"><path d="M-26 10 Q 0 -26 26 6" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="4" stroke-linecap="round"/><path d="M-18 16 Q 4 -12 24 14" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round"/></svg>`);
        d.addEventListener('animationend', () => d.remove());
        return;
      }
      case 'sparkles': {
        // A golden shower (growth treat).
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + r() * 0.4;
          const dist = (30 + r() * 40) * s;
          const d = this.el('spark', x, y, `<svg viewBox="-10 -10 20 20" width="${(8 + r() * 6) * s}" height="${(8 + r() * 6) * s}">${i % 3 ? STAR(0, 0, 9, '#ffe066') : TWINKLE_PATH}</svg>`);
          fling(d, [{ transform: 'translate(-50%, -50%) scale(0.2)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * dist}px), calc(-50% + ${Math.sin(a) * dist - 16 * s}px)) scale(1) rotate(160deg)`, opacity: 0 }], 1000 + r() * 400);
        }
        return;
      }
      case 'find': {
        // Something shiny pops out of the ground.
        const d = this.el('find', x, y, `<svg viewBox="-10 -12 20 20" width="${18 * s}" height="${18 * s}"><path d="M-6-4-2-9H2L6-4 0 7Z" fill="#7fe0ff" stroke="#1d5a78" stroke-width="1.4" stroke-linejoin="round"/><path d="M-6-4H6M-2-9-1-4 0 7M2-9 1-4" fill="none" stroke="#1d5a78" stroke-width="0.8"/></svg>`);
        fling(d, [{ transform: 'translate(-50%, -30%) scale(0.3)', opacity: 0 }, { transform: `translate(-50%, calc(-50% - ${30 * s}px)) scale(1.1)`, opacity: 1, offset: 0.35 }, { transform: `translate(-50%, calc(-50% - ${36 * s}px)) scale(1)`, opacity: 1, offset: 0.8 }, { transform: `translate(-50%, calc(-50% - ${40 * s}px)) scale(0.8)`, opacity: 0 }], 1500, 'ease-out');
        this.twinkle(x + 6, y - 34 * s);
        return;
      }
    }
  }

  clear() {
    this.root.querySelectorAll('.fx').forEach((e) => e.remove());
    this.bubble = null;
  }
}

const BUTTERFLY_COLOURS = [
  ['#ff9a3c', '#6b2d0c', '#ffd9a8'],
  ['#58a8ff', '#1b3f78', '#cfe6ff'],
  ['#ffd84a', '#7a5a0a', '#fff4bf'],
  ['#ff7ac8', '#7a1f55', '#ffd3ec'],
];

/** A little butterfly; its wings flap with a CSS animation, so moving it costs nothing to draw. */
export function butterflyEl(hue: number): HTMLDivElement {
  const [wing, edge, spot] = BUTTERFLY_COLOURS[hue % BUTTERFLY_COLOURS.length];
  const half = (side: 1 | -1) =>
    `<g class="wing ${side > 0 ? 'r' : 'l'}"><path d="M0 0C${side * 3} -9 ${side * 13} -11 ${side * 12} -3C${side * 11} 1 ${side * 4} 1 0 0Z" fill="${wing}" stroke="${edge}" stroke-width="1.2"/><path d="M0 0C${side * 2} 4 ${side * 8} 9 ${side * 9} 4C${side * 9} 1 ${side * 4} 0.5 0 0Z" fill="${wing}" stroke="${edge}" stroke-width="1.2"/><circle cx="${side * 7}" cy="-4" r="1.6" fill="${spot}"/></g>`;
  const d = document.createElement('div');
  d.className = 'butterfly';
  d.innerHTML = `<svg viewBox="-14 -12 28 24" width="26" height="22">${half(-1)}${half(1)}<ellipse cx="0" cy="0" rx="1.3" ry="5" fill="#2a2030"/><path d="M-0.5-4.5-3-9M0.5-4.5 3-9" stroke="#2a2030" stroke-width="0.9" fill="none" stroke-linecap="round"/></svg>`;
  return d;
}

/** Food and ball sprites, drawn once ('treat' is the golden growth treat). */
export function foodSprite(kind: Food | 'treat', size: number): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale((size * dpr) / 24, (size * dpr) / 24);
  g.lineJoin = 'round';
  g.lineWidth = 1.6;
  if (kind === 'treat') {
    // A golden star cookie.
    g.fillStyle = '#ffd34d';
    g.strokeStyle = '#8a5a10';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? 5 : 10.5;
      g.lineTo(12 + Math.cos(a) * rr, 13 + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.beginPath();
    g.ellipse(10, 10, 3, 1.6, -0.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8a21a';
    for (const [x, y] of [[12, 15], [15, 12], [9.5, 12.5]]) {
      g.beginPath();
      g.arc(x, y, 1, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'meat') {
    g.fillStyle = '#f7f1e3';
    g.strokeStyle = '#5a2a14';
    g.beginPath();
    g.arc(18.5, 6.5, 2.4, 0, Math.PI * 2);
    g.arc(20, 9.5, 2.2, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillRect(15, 7, 4, 3);
    g.fillStyle = '#c4643b';
    g.beginPath();
    g.ellipse(10, 14, 8.5, 6.5, -0.6, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(8, 11.5, 3.5, 1.8, -0.6, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'fish') {
    g.strokeStyle = '#1f3d5c';
    g.fillStyle = '#7fb6e6';
    g.beginPath();
    g.moveTo(17, 14);
    g.lineTo(23, 9);
    g.lineTo(22, 19);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(10.5, 14, 8.5, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#d9ecff';
    g.beginPath();
    g.ellipse(9.5, 16, 5.5, 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1f3d5c';
    g.beginPath();
    g.arc(5.5, 12.8, 1.2, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'berry') {
    g.fillStyle = '#5aa83a';
    g.strokeStyle = '#2d5a1c';
    g.beginPath();
    g.moveTo(12, 8);
    g.quadraticCurveTo(15, 1, 22, 3);
    g.quadraticCurveTo(18, 9, 12, 8);
    g.fill();
    g.stroke();
    g.strokeStyle = '#4a1030';
    for (const [x, y, c] of [
      [8, 15, '#d8325a'],
      [15, 16, '#b0204a'],
      [11.5, 10.5, '#e84a6a'],
    ] as const) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, y, 4.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.arc(x - 1.5, y - 1.5, 1.2, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillStyle = '#6fbf4a';
    g.strokeStyle = '#2d5a1c';
    g.beginPath();
    g.moveTo(3, 20);
    g.quadraticCurveTo(2, 6, 20, 3);
    g.quadraticCurveTo(22, 18, 3, 20);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(4, 19);
    g.quadraticCurveTo(10, 11, 18, 5);
    g.stroke();
  }
  return c;
}

export function ballSprite(r: number): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const size = r * 2 + 4;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  g.lineWidth = 1.8;
  g.strokeStyle = '#3a1d2a';
  g.fillStyle = '#ff6b6b';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = '#fff4e0';
  g.fillRect(-r, -r * 0.18, r * 2, r * 0.36);
  g.fillStyle = '#ffd34d';
  g.beginPath();
  g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  return c;
}
