// Dev-only: every species side by side as a baby and as an adult, in several colours.
import { drawPet, paletteFor } from '../pet/draw';
import { rng } from '../pet/math';
import { applyPose, type PoseName } from '../pet/poses';
import { Rig } from '../pet/rig';
import { BUILT_IN } from '../pet/species';

const q = new URLSearchParams(location.search);
const pose = (q.get('pose') ?? 'stand') as PoseName;
const zoom = Number(q.get('zoom') ?? 1.2);
const cw = 250 * zoom;
const ch = 140 * zoom;
const rows = [0.15, 1];
const canvas = document.createElement('canvas');
canvas.width = cw * 4;
canvas.height = Math.ceil(BUILT_IN.length / 4) * ch * rows.length;
document.body.style.margin = '0';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#eef2f6';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.font = `${12 * zoom}px sans-serif`;
BUILT_IN.forEach((sp, i) => {
  rows.forEach((g, k) => {
    const x0 = (i % 4) * cw;
    const y0 = (Math.floor(i / 4) * rows.length + k) * ch;
    ctx.fillStyle = (i + k) % 2 ? '#e6ecf2' : '#f2f5f8';
    ctx.fillRect(x0, y0, cw, ch);
    ctx.fillStyle = '#6a7686';
    ctx.fillText(`${sp.name} ${g < 1 ? 'baby' : 'adult'}`, x0 + 6, y0 + 16 * zoom);
    const r = new Rig(sp, g, rng(3));
    applyPose(r, pose);
    r.look = { x: 90, y: 60 };
    for (let n = 0; n < 60; n++) r.update(1 / 60);
    ctx.save();
    ctx.translate(x0 + cw * 0.52, y0 + ch - 16 * zoom);
    const pal = paletteFor(sp, (i + k * 3) % sp.variants.length);
    drawPet(ctx, r, pal, sp.features, { scale: 1.1 * zoom * r.size, outline: 1.8 * zoom, shadow: true });
    ctx.restore();
  });
});
(window as unknown as { done: boolean }).done = true;
