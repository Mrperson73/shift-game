// Dev-only contact sheet: every pose at every growth stage, for visual QA.
import { drawEgg, drawPet, palette } from '../pet/draw';
import { rng } from '../pet/math';
import { applyPose, type PoseName } from '../pet/poses';
import { Rig } from '../pet/rig';
import { BUILT_IN } from '../pet/species';

const q = new URLSearchParams(location.search);
const species = BUILT_IN.find((s) => s.id === (q.get('species') ?? 'rex'))!;
const variantIdx = Number(q.get('variant') ?? 0);
const zoom = Number(q.get('zoom') ?? 1);
const only = q.get('poses')?.split(',') as PoseName[] | undefined;
const growths = (q.get('growth') ?? '0,0.25,0.65,1').split(',').map(Number);
const poses: (PoseName | 'walk' | 'run' | 'egg')[] = only ?? ['egg', 'stand', 'walk', 'run', 'sit', 'lie', 'sleep', 'roar', 'eat', 'jump', 'held', 'happy', 'dance', 'pounce', 'stretch'];
const cw = 190 * zoom;
const ch = 150 * zoom;
const canvas = document.createElement('canvas');
canvas.width = cw * poses.length;
canvas.height = ch * growths.length;
document.body.style.margin = '0';
document.body.style.background = '#e9eef3';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
const pal = palette(species.variants[variantIdx % species.variants.length]);
ctx.font = `${11 * zoom}px sans-serif`;
growths.forEach((g, row) => {
  poses.forEach((name, col) => {
    const x0 = col * cw;
    const y0 = row * ch;
    ctx.fillStyle = (row + col) % 2 ? '#e3e9ef' : '#edf1f5';
    ctx.fillRect(x0, y0, cw, ch);
    ctx.fillStyle = '#7a8594';
    ctx.fillText(`${name} ${Math.round(g * 100)}%`, x0 + 4, y0 + 12 * zoom);
    ctx.fillStyle = '#c9d2dc';
    ctx.fillRect(x0, y0 + ch - 22 * zoom, cw, 2);
    ctx.save();
    ctx.translate(x0 + cw * 0.52, y0 + ch - 22 * zoom);
    const r = new Rig(species, g, rng(7));
    const sc = 0.85 * zoom * r.size;
    if (name === 'egg') {
      drawEgg(ctx, 34 * zoom, pal, 0.08, g, 0);
      ctx.restore();
      return;
    }
    if (name === 'walk' || name === 'run') {
      applyPose(r, 'stand');
      r.speed = name === 'run' ? 95 : 42;
      r.run = name === 'run' ? 1 : 0;
    } else applyPose(r, name);
    r.look = { x: 90, y: 70 };
    for (let i = 0; i < 90; i++) r.update(1 / 60);
    if (name === 'jump' || name === 'fall' || name === 'held') ctx.translate(0, -26 * zoom);
    drawPet(ctx, r, pal, species.features, { scale: sc, outline: 1.8 * zoom, shadow: name !== 'held' && name !== 'jump' && name !== 'fall' });
    ctx.restore();
  });
});
(window as unknown as { done: boolean }).done = true;
