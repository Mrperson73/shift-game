// Confetti for big moments (hatching, a new badge). One overlay canvas that only animates while
// pieces are in the air, then goes idle.

import { reducedMotion } from './state';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  flip: number;
  vf: number;
  size: number;
  color: string;
  shape: 0 | 1 | 2 | 3;
  life: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let pieces: Piece[] = [];
let raf = 0;
let last = 0;

const DEFAULT = ['#ff5c8a', '#ffd23f', '#3fc1ff', '#7ee07a', '#b38cff', '#ff8f4a'];

function ensure() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
}

function size() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas!.width !== Math.round(w * dpr) || canvas!.height !== Math.round(h * dpr)) {
    canvas!.width = Math.round(w * dpr);
    canvas!.height = Math.round(h * dpr);
  }
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** A burst of confetti from a point (page coordinates), fanning upward. */
export function confetti(x: number, y: number, opts: { count?: number; colors?: string[]; power?: number; spread?: number } = {}) {
  if (reducedMotion.value || document.hidden) return;
  ensure();
  const colors = opts.colors?.length ? opts.colors : DEFAULT;
  const n = opts.count ?? 70;
  const power = opts.power ?? 520;
  const spread = opts.spread ?? 1.1;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2 * spread;
    const v = power * (0.45 + Math.random() * 0.65);
    pieces.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 12,
      flip: Math.random() * Math.PI,
      vf: 6 + Math.random() * 8,
      size: 5 + Math.random() * 5,
      color: colors[i % colors.length],
      shape: (i % 4) as Piece['shape'],
      life: 2.2 + Math.random() * 0.8,
    });
  }
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
}

/** Confetti from the middle of an element. */
export function confettiFrom(el: Element | null, opts?: Parameters<typeof confetti>[2]) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 2, opts);
}

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  size();
  const g = ctx!;
  g.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    p.life -= dt;
    if (p.life <= 0 || p.y > window.innerHeight + 30) {
      pieces.splice(i, 1);
      continue;
    }
    p.vy += 900 * dt;
    p.vx *= Math.pow(0.35, dt);
    p.vy *= Math.pow(0.55, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.flip += p.vf * dt;
    g.save();
    g.globalAlpha = Math.min(1, p.life / 0.5);
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.scale(1, Math.cos(p.flip));
    g.fillStyle = p.color;
    const s = p.size;
    if (p.shape === 0) g.fillRect(-s / 2, -s / 3, s, s * 0.66);
    else if (p.shape === 1) {
      g.beginPath();
      g.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      g.fill();
    } else if (p.shape === 2) {
      g.beginPath();
      g.moveTo(0, -s * 0.7);
      g.quadraticCurveTo(0, 0, s * 0.7, 0);
      g.quadraticCurveTo(0, 0, 0, s * 0.7);
      g.quadraticCurveTo(0, 0, -s * 0.7, 0);
      g.quadraticCurveTo(0, 0, 0, -s * 0.7);
      g.fill();
    } else g.fillRect(-s * 0.15, -s * 0.6, s * 0.3, s * 1.2);
    g.restore();
  }
  if (pieces.length) raf = requestAnimationFrame(tick);
  else {
    raf = 0;
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}
