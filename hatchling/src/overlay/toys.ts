// Draws the toys that are out (sim/toys.ts): bubbles and their wand, a bone, a squeaky duck, a
// laser dot, a puddle (and the fish in the pet's mouth when it catches one), plus the fly buzzing
// about its head. Each is a small element drawn once and moved with a transform: moving toys cost
// next to nothing, resting ones nothing at all (their transform doesn't change, so it isn't set).

import type { Pet } from '../sim/pet';
import { foodSprite } from './fx';

const FISH = {};
const WAND = '<svg viewBox="-9 -9 18 34" width="16" height="30"><circle cx="0" cy="0" r="6.5" fill="rgba(200,235,255,0.25)" stroke="#e05aa0" stroke-width="2.4"/><path d="M0 6.5V24" stroke="#7a4a2a" stroke-width="2.6" stroke-linecap="round"/></svg>';

export class ToyLayer {
  private root: HTMLElement;
  private els = new Map<object, { el: HTMLElement; tf: string }>();
  private seen = new Set<object>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Brings the elements in line with the toys; call once per drawn frame. */
  sync(pet: Pet) {
    this.seen.clear();
    const s = Math.max(0.8, Math.min(1.4, pet.px));
    for (const t of pet.toys) {
      switch (t.kind) {
        case 'bubbles':
          if (t.left > 0) this.place(t, () => html(WAND), t.x - 8, t.y - 8, '');
          for (const b of t.list) this.place(b, () => bubble(b.r), b.x - b.r, b.y - b.r, '');
          break;
        case 'bone':
        case 'duck': {
          const size = t.r * 2 + 6;
          const sq = t.squish;
          const turn = t.kind === 'duck' && t.vx < -5 ? ' scaleX(-1)' : '';
          const extra = `rotate(${t.angle.toFixed(2)}rad)${sq > 0.01 ? ` scale(${(1 + sq * 0.25).toFixed(2)}, ${(1 - sq * 0.35).toFixed(2)})` : ''}${turn}`;
          this.place(t, () => thing(t.kind, t.r), t.x - size / 2, t.y - size + 3, extra);
          break;
        }
        case 'laser':
          this.place(t, () => div('toy-laser'), t.x - 5, t.y - 5, '');
          break;
        case 'puddle': {
          const h = t.w * 0.24;
          const k = Math.min(1, t.left / 4);
          this.place(t, () => puddle(t.w, h), t.x - t.w / 2, t.y - h * 0.55, k < 1 ? `scale(${k.toFixed(2)})` : '', true);
          if (t.fish === 'held') {
            const m = pet.mouthAt();
            const size = 20 * s;
            this.place(FISH, () => fish(size), m.x - size / 2, m.y - size * 0.55, pet.facing < 0 ? 'scaleX(-1)' : '');
          }
          break;
        }
      }
    }
    const g = pet.gnat;
    if (g) this.place(g, () => div('toy-gnat'), g.x - 3, g.y - 3, '');
    for (const [k, e] of this.els) {
      if (!this.seen.has(k)) {
        e.el.remove();
        this.els.delete(k);
      }
    }
  }

  clear() {
    for (const e of this.els.values()) e.el.remove();
    this.els.clear();
  }

  private place(key: object, make: () => HTMLElement, x: number, y: number, extra: string, below = false) {
    this.seen.add(key);
    let e = this.els.get(key);
    if (!e) {
      const el = make();
      el.classList.add('toy');
      if (below) this.root.prepend(el);
      else this.root.appendChild(el);
      e = { el, tf: '' };
      this.els.set(key, e);
    }
    const tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${extra ? ` ${extra}` : ''}`;
    if (tf !== e.tf) {
      e.el.style.transform = tf;
      e.tf = tf;
    }
  }
}

function div(cls: string) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function html(svg: string) {
  const d = document.createElement('div');
  d.innerHTML = svg;
  return d;
}

function bubble(r: number) {
  const d = div('toy-bubble');
  d.style.width = d.style.height = `${r * 2}px`;
  return d;
}

function puddle(w: number, h: number) {
  const d = div('toy-puddle');
  d.style.width = `${w}px`;
  d.style.height = `${h}px`;
  d.appendChild(div('fish-shadow'));
  return d;
}

function fish(size: number) {
  return foodSprite('fish', size);
}

/** A bone or a rubber duck, drawn once. */
function thing(kind: 'bone' | 'duck', r: number): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const size = r * 2 + 6;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  g.lineJoin = 'round';
  g.lineWidth = 1.6;
  g.strokeStyle = '#4a3a2a';
  if (kind === 'bone') {
    // A shaft with two knobs at each end: outlines first, then the fills over them, so the
    // shapes merge into one.
    const L = r * 0.72;
    const k = r * 0.36;
    const shape = new Path2D();
    shape.rect(-L, -k * 0.55, L * 2, k * 1.1);
    const knobs = new Path2D();
    for (const x of [-L, L]) {
      for (const y of [-k * 0.7, k * 0.7]) {
        knobs.moveTo(x + k * 0.72, y);
        knobs.arc(x, y, k * 0.72, 0, Math.PI * 2);
      }
    }
    g.lineWidth = 3.2;
    g.stroke(shape);
    for (const x of [-L, L]) {
      for (const y of [-k * 0.7, k * 0.7]) {
        g.beginPath();
        g.arc(x, y, k * 0.72, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.fillStyle = '#f5ecd8';
    g.fill(shape);
    g.fill(knobs);
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.fillRect(-L * 0.8, -k * 0.35, L * 1.6, k * 0.25);
  } else {
    // A rubber duck, facing right.
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.ellipse(-r * 0.1, r * 0.3, r * 0.85, r * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(r * 0.35, -r * 0.3, r * 0.45, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#ff8a2a';
    g.beginPath();
    g.moveTo(r * 0.72, -r * 0.35);
    g.quadraticCurveTo(r * 1.15, -r * 0.3, r * 0.75, -r * 0.1);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#2a2230';
    g.beginPath();
    g.arc(r * 0.45, -r * 0.42, r * 0.09, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(160,110,0,0.6)';
    g.beginPath();
    g.moveTo(-r * 0.55, r * 0.2);
    g.quadraticCurveTo(-r * 0.2, r * 0.45, r * 0.15, r * 0.2);
    g.stroke();
  }
  return c;
}
