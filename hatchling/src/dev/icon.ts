// Dev-only: renders the app icon (a hatchling bursting out of its egg, wearing the top of the
// shell as a hat) and the tray icon (its head on the same tile, bold enough for 16 px).
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
const S = size;

/** The rounded tile: a sky-to-meadow gradient with a soft glow and a grassy hill. */
function tile(inset: number, radius: number) {
  const x = S * inset;
  const w = S - 2 * x;
  const shape = new Path2D();
  shape.roundRect(x, x, w, w, w * radius);
  const sky = g.createLinearGradient(0, x, 0, x + w);
  sky.addColorStop(0, '#7fd4ff');
  sky.addColorStop(0.55, '#bfeeff');
  sky.addColorStop(1, '#e8fbff');
  g.fillStyle = sky;
  g.fill(shape);
  g.save();
  g.clip(shape);
  const glow = g.createRadialGradient(S * 0.5, S * 0.42, 0, S * 0.5, S * 0.42, S * 0.5);
  glow.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
  glow.addColorStop(0.45, 'rgba(255, 250, 220, 0.35)');
  glow.addColorStop(1, 'rgba(255, 250, 220, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // The hill it hatches on.
  const hill = g.createLinearGradient(0, S * 0.72, 0, S);
  hill.addColorStop(0, '#6fcf4f');
  hill.addColorStop(1, '#2f9a58');
  g.fillStyle = hill;
  g.beginPath();
  g.ellipse(S * 0.5, S * 1.07, S * 0.78, S * 0.33, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.25)';
  g.beginPath();
  g.ellipse(S * 0.36, S * 0.8, S * 0.2, S * 0.025, -0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // A crisp edge so it reads on any wallpaper or taskbar.
  g.strokeStyle = 'rgba(20, 70, 60, 0.55)';
  g.lineWidth = Math.max(1, S * 0.012);
  g.stroke(shape);
  return shape;
}

/** A four-pointed sparkle. */
function sparkle(x: number, y: number, r: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const d = i % 2 ? r * 0.28 : r;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

const r = new Rig(REX, 0.02, rng(3));
applyPose(r, 'happy');
r.target.arms = 1;
if (kind === 'app') {
  // Rising straight up out of the shell, head level.
  r.target.pitch = 0.95;
  r.target.neck = -0.75;
  r.target.head = -0.25;
  r.target.tailLift = -0.4;
} else {
  r.target.neck = 0.25;
  r.target.head = 0.1;
}
r.eyes = 'happy';
r.look = { x: 90, y: 90 };
for (let i = 0; i < 90; i++) r.update(1 / 60);
r.eyes = 'open';
r.solve(0);

const L = r.p.headLen;
const H = r.p.headH;
/** Canvas position of a point in rig coordinates, for a pet drawn with its feet at (fx, fy). */
const toCanvas = (p: { x: number; y: number }, fx: number, fy: number, sc: number) => ({ x: fx + p.x * sc, y: fy - p.y * sc });
if (kind === 'app') {
  const shape = tile(0.04, 0.23);
  g.save();
  g.clip(shape);
  // Frame the head: big, a little right of centre, the body disappearing into the shell.
  const sc = (S * 0.42) / L;
  const hc = at(r.s.headO, r.s.headA, { x: L * 0.45, y: H * 0.4 });
  const feetX = S * 0.6 - hc.x * sc;
  const feetY = S * 0.42 + hc.y * sc;
  const eggH = S * 0.68;
  const chest = toCanvas(r.s.chest, feetX, feetY, sc);
  g.save();
  g.translate(feetX, feetY);
  drawPet(g, r, pal, REX.features, { scale: sc, outline: S * 0.016 });
  g.restore();
  // The bottom of the shell in front of its body...
  g.save();
  g.translate(chest.x - S * 0.07, S * 1.02);
  drawEgg(g, eggH, pal, 0.06, 1, 1, 'bottom');
  g.restore();
  // ...and its top on the hatchling's head, at a jaunty angle.
  const cap = eggH * 0.57;
  const crown = toCanvas(at(r.s.headO, r.s.headA, { x: L * 0.1, y: H * 1.02 }), feetX, feetY, sc);
  g.save();
  g.translate(crown.x, crown.y);
  g.rotate(-0.42);
  g.translate(0, cap * 0.64);
  drawEgg(g, cap, pal, 0, 1, 1, 'top');
  g.restore();
  g.restore();
  sparkle(S * 0.16, S * 0.2, S * 0.065, '#ffffff');
  sparkle(S * 0.27, S * 0.1, S * 0.035, '#fff4b8');
  sparkle(S * 0.87, S * 0.66, S * 0.045, '#ffffff');
} else {
  // Tray: the whole head on the same tile, big and bold.
  const shape = tile(0, 0.26);
  g.save();
  g.clip(shape);
  const hc = at(r.s.headO, r.s.headA, { x: L * 0.5, y: H * 0.35 });
  const sc = (S * 0.84) / (L * 1.1);
  g.translate(S * 0.52 - hc.x * sc, S * 0.5 + hc.y * sc);
  drawPet(g, r, pal, REX.features, { scale: sc, outline: Math.max(1.3, S / 20) });
  g.restore();
}
(window as unknown as { done: boolean }).done = true;
