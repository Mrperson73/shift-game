// Dev-only: renders the app icon (a hatchling in its egg) and the tray icon.
import { drawEgg, drawPet, palette } from '../pet/draw';
import { at, rng } from '../pet/math';
import { applyPose } from '../pet/poses';
import { Rig } from '../pet/rig';
import { REX } from '../pet/species';

const q = new URLSearchParams(location.search);
const size = Number(q.get('size') ?? 1024);
const kind = q.get('kind') ?? 'app';
const c = document.createElement('canvas');
c.width = c.height = size;
document.body.style.margin = '0';
document.body.style.background = 'transparent';
document.body.appendChild(c);
const g = c.getContext('2d')!;
const pal = palette(REX.variants[0]);
const r = new Rig(REX, 0, rng(3));
applyPose(r, kind === 'app' ? 'happy' : 'stand');
r.eyes = kind === 'app' ? 'happy' : 'open';
r.look = { x: 80, y: 70 };
for (let i = 0; i < 80; i++) r.update(1 / 60);
r.eyes = kind === 'app' ? 'happy' : 'open';
r.solve(0);
const b = r.s.bounds;
if (kind === 'app') {
  // Fit the hatchling, then put the bottom half of its shell in front of its legs.
  const sc = (size * 0.74) / (b.x2 - b.x1);
  const feetX = size * 0.5 - ((b.x1 + b.x2) / 2) * sc;
  const feetY = size * 0.58 + ((b.y2 - b.y1) / 2) * sc * 0.55 + b.y1 * sc;
  g.save();
  g.translate(feetX, feetY);
  drawPet(g, r, pal, REX.features, { scale: sc, outline: size * 0.018 });
  g.restore();
  const eggH = size * 0.6;
  g.save();
  g.translate(size * 0.5, feetY + eggH * 0.36);
  drawEgg(g, eggH, pal, 0, 1, 1);
  g.restore();
} else {
  // Tray: the head, big and bold, filling the square.
  const L = r.p.headLen;
  const H = r.p.headH;
  const center = at(r.s.headO, r.s.headA, { x: L * 0.46, y: H * 0.42 });
  const sc = (size * 0.98) / (Math.max(L, H) * 1.18);
  g.save();
  g.translate(size / 2 - center.x * sc, size / 2 + center.y * sc);
  drawPet(g, r, pal, REX.features, { scale: sc, outline: Math.max(1.3, size / 18) });
  g.restore();
}
(window as unknown as { done: boolean }).done = true;
