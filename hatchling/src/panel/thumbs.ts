// Still pictures (eggs, pets, the logo) rendered once with the real pet renderer and cached as
// data URLs, so grids of eggs and colour cards cost nothing after the first paint.

import { drawEgg, drawPet, type Palette, palette } from '../pet/draw';
import { rng } from '../pet/math';
import { applyPose, type PoseName } from '../pet/poses';
import { Rig } from '../pet/rig';
import { REX, type SpeciesDef } from '../pet/species';

const cache = new Map<string, string>();

function render(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): string {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const k = `${key}|${w}x${h}@${dpr}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  paint(g);
  const url = c.toDataURL('image/png');
  if (cache.size > 400) cache.clear();
  cache.set(k, url);
  return url;
}

const palKey = (p: Palette) => `${p.body}${p.belly}${p.pattern}${p.accent}${p.iris}${p.kind}`;

/** An egg in a species' colours, standing on a soft shadow. */
export function eggThumb(pal: Palette, size: number): string {
  return render(`egg:${palKey(pal)}`, size, size, (g) => {
    g.fillStyle = 'rgba(20,16,30,0.16)';
    g.beginPath();
    g.ellipse(size / 2, size - 5, size * 0.27, 3.5, 0, 0, Math.PI * 2);
    g.fill();
    g.translate(size / 2, size - 5);
    drawEgg(g, size * 0.8, pal, 0, 0, 0);
  });
}

function posed(sp: SpeciesDef, growth: number, pose: PoseName): Rig {
  const r = new Rig(sp, growth, rng(11));
  applyPose(r, pose);
  r.look = { x: 90, y: 55 };
  for (let i = 0; i < 70; i++) r.update(1 / 60);
  return r;
}

/** A pet standing, fitted into w×h (feet at the bottom). */
export function petThumb(sp: SpeciesDef, pal: Palette, growth: number, w: number, h: number, pose: PoseName = 'stand'): string {
  const g0 = Math.round(growth * 20) / 20;
  return render(`pet:${sp.id}:${sp.mod ?? ''}:${palKey(pal)}:${g0}:${pose}`, w, h, (g) => {
    const r = posed(sp, g0, pose);
    const b = r.s.bounds;
    const sc = Math.min((w - 6) / (b.x2 - b.x1), (h - 8) / (b.y2 - b.y1));
    const x = w / 2 - ((b.x1 + b.x2) / 2) * sc;
    const y = h - 4 + b.y1 * sc;
    g.translate(x, y);
    drawPet(g, r, pal, sp.features, { scale: sc, outline: Math.max(1.1, Math.min(2, sc * 1.4)), shadow: true });
  });
}

/** The app icon: a baby rex popping out of its egg. */
export function logo(size: number): string {
  return render('logo', size, size, (g) => {
    const pal = palette(REX.variants[0]);
    const r = new Rig(REX, 0, rng(3));
    applyPose(r, 'happy');
    r.look = { x: 80, y: 70 };
    for (let i = 0; i < 80; i++) r.update(1 / 60);
    r.eyes = 'happy';
    r.solve(0);
    const b = r.s.bounds;
    const sc = (size * 0.8) / (b.x2 - b.x1);
    const feetX = size * 0.5 - ((b.x1 + b.x2) / 2) * sc;
    const feetY = size * 0.6 + ((b.y2 - b.y1) / 2) * sc * 0.55 + b.y1 * sc;
    g.save();
    g.translate(feetX, feetY);
    drawPet(g, r, pal, REX.features, { scale: sc, outline: Math.max(0.9, size * 0.035) });
    g.restore();
    g.translate(size * 0.5, feetY + size * 0.6 * 0.36);
    drawEgg(g, size * 0.62, pal, 0, 1, 1);
  });
}
