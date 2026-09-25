// Little effects around the pet, as DOM elements: emotes, speech bubbles, dust and crumbs.

import type { EmoteKind } from '../sim/pet';

const HEART = '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.7C12 6.2 13.5 5 15.6 5 19 5 21.1 8.4 19.6 11.8 17.5 16.4 12 21 12 21z" fill="#ff5c8a" stroke="#7a1f3d" stroke-width="1.6" stroke-linejoin="round"/>';
const STAR = (x: number, y: number, r: number, fill = '#ffd34d') =>
  `<path transform="translate(${x} ${y}) scale(${r / 10})" d="M0-10 2.9-3.1 10-3.1 4.3 1.2 6.4 8.4 0 4.1-6.4 8.4-4.3 1.2-10-3.1-2.9-3.1Z" fill="${fill}" stroke="#7a5a10" stroke-width="1.4" stroke-linejoin="round"/>`;

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
    const d = this.el('bubble', x, y);
    d.textContent = text;
    this.bubble = d;
    this.bubbleUntil = performance.now() + 2600 + text.length * 60;
  }

  /** Keep the speech bubble above the head; fade it out when its time is up. */
  follow(x: number, y: number) {
    const b = this.bubble;
    if (!b) return;
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    if (performance.now() > this.bubbleUntil && !b.classList.contains('out')) {
      b.classList.add('out');
      setTimeout(() => {
        b.remove();
        if (this.bubble === b) this.bubble = null;
      }, 400);
    }
  }

  dust(x: number, y: number, big: boolean, scale: number) {
    const n = big ? 6 : 4;
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

  clear() {
    this.root.querySelectorAll('.fx').forEach((e) => e.remove());
    this.bubble = null;
  }
}

/** Food and ball sprites, drawn once. */
export function foodSprite(kind: 'meat' | 'leaf', size: number): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale((size * dpr) / 24, (size * dpr) / 24);
  g.lineJoin = 'round';
  g.lineWidth = 1.6;
  if (kind === 'meat') {
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
