// Dev-only contact sheet: every pose at every growth stage, for visual QA.
// ?species=rex&variant=0&zoom=1&poses=stand,walk&growth=0,1 — or poses=new for all the 1.2 poses
// (node scripts/sheet.mjs rex 0 1 new).
import { drawEgg, drawPet, palette } from '../pet/draw';
import { rng } from '../pet/math';
import { applyPose, type PoseName } from '../pet/poses';
import { Rig } from '../pet/rig';
import { BUILT_IN } from '../pet/species';
import { deadNeck, deadThickness } from '../sim/moves';

const q = new URLSearchParams(location.search);
const base = BUILT_IN.find((s) => s.id === (q.get('species') ?? 'rex'))!;
// ?wings=membrane|feather tries wings on a species that has none (until the flyers exist).
const wings = q.get('wings') as 'membrane' | 'feather' | null;
const species = wings ? { ...base, features: { ...base.features, wings } } : base;
const variantIdx = Number(q.get('variant') ?? 0);
const zoom = Number(q.get('zoom') ?? 1);
const only = q.get('poses')?.split(',') as Shot[] | undefined;
const growths = (q.get('growth') ?? '0,0.25,0.65,1').split(',').map(Number);
/** Poses, plus a few shots that need more than a pose: walking, running, flapping up and down,
 * playing dead (drawn upside down on its back) and clinging to a wall (drawn turned sideways). */
type Shot = PoseName | 'walk' | 'run' | 'egg' | 'flapUp' | 'flapDown' | 'wall';
const CLASSIC: Shot[] = ['egg', 'stand', 'walk', 'run', 'sit', 'lie', 'sleep', 'roar', 'eat', 'jump', 'held', 'happy', 'dance', 'pounce', 'stretch'];
const NEW: Shot[] = ['flapUp', 'flapDown', 'takeoff', 'wings', 'mantle', 'bow', 'playdead', 'cheer', 'charge', 'bonk', 'stomp', 'honk', 'display', 'browse', 'dig', 'screech', 'rake', 'whip', 'curl', 'peer', 'snap', 'lurk', 'gape', 'video', 'laugh', 'gasp', 'scratch', 'preen', 'rear', 'crouchWatch', 'reach', 'stretchNeck', 'headToss', 'forage', 'stalk', 'wall'];
const poses: Shot[] = only?.[0] === ('new' as Shot) ? NEW : only ?? CLASSIC;
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
    } else if (name === 'flapUp' || name === 'flapDown') {
      applyPose(r, 'fly', { flap: name === 'flapUp' ? 1 : -1 });
    } else if (name === 'wall') applyPose(r, 'cling');
    else if (name === 'playdead') applyPose(r, 'playdead', deadNeck(r.p));
    else applyPose(r, name);
    r.look = { x: 90, y: 70 };
    for (let i = 0; i < 90; i++) r.update(1 / 60);
    const air = name === 'jump' || name === 'fall' || name === 'held' || name === 'flapUp' || name === 'flapDown';
    if (air) ctx.translate(0, -26 * zoom);
    if (name === 'playdead') {
      // On its back: turned upside down, resting on the ground.
      ctx.translate(0, -deadThickness(r.p) * sc);
      ctx.rotate(Math.PI);
    }
    if (name === 'wall') {
      // Feet against a wall on the left, climbing up.
      ctx.translate(-cw * 0.4, -ch * 0.35);
      ctx.fillStyle = '#b8c3cf';
      ctx.fillRect(-4, -ch * 0.6, 4, ch * 0.95);
      ctx.rotate(Math.PI / 2);
      ctx.scale(-1, 1);
    }
    drawPet(ctx, r, pal, species.features, { scale: sc, outline: 1.8 * zoom, shadow: !air && name !== 'playdead' && name !== 'wall' });
    ctx.restore();
  });
});
(window as unknown as { done: boolean }).done = true;
