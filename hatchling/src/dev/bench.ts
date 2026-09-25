// Dev-only: how long the simulation, the skeleton and the drawing take per frame.
import { drawPet, paletteFor } from '../pet/draw';
import { rng } from '../pet/math';
import { applyPose } from '../pet/poses';
import { Rig } from '../pet/rig';
import { BUILT_IN } from '../pet/species';
import { DEFAULT_SETTINGS, newPet } from '../shared/types';
import { Pet } from '../sim/pet';
import { ground } from '../sim/world';

const out: string[] = [];
const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 500;
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
for (const id of ['rex', 'trike', 'spino', 'brachio']) {
  const sp = BUILT_IN.find((s) => s.id === id)!;
  const r = new Rig(sp, 1, rng(1));
  applyPose(r, 'stand');
  r.speed = 90;
  r.run = 1;
  const pal = paletteFor(sp, 0);
  const N = 600;
  let t0 = performance.now();
  for (let i = 0; i < N; i++) r.update(1 / 60);
  const rigMs = (performance.now() - t0) / N;
  t0 = performance.now();
  for (let i = 0; i < N; i++) {
    r.update(1 / 60);
    ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
    ctx.clearRect(0, 0, 600, 400);
    ctx.save();
    ctx.translate(300, 250);
    drawPet(ctx, r, pal, sp.features, { scale: 1.65, outline: 2, shadow: true });
    ctx.restore();
  }
  const drawMs = (performance.now() - t0) / N - rigMs;
  let now = 1.7e12;
  const d = newPet(id, 0, 'b', now);
  d.hatchedAt = now;
  d.activeSeconds = 3600 * 60;
  const pet = new Pet(d, sp, DEFAULT_SETTINGS, { width: 1600, height: 860, platforms: [ground(1600, 860)], walls: [] }, { rand: rng(2), hour: () => 12, now: () => now });
  pet.act = { k: 'zoomies', t: 0, laps: 1e9, toX: 100 };
  t0 = performance.now();
  for (let i = 0; i < N; i++) {
    now += 16;
    pet.update(1 / 60);
    pet.drain();
  }
  const simMs = (performance.now() - t0) / N;
  out.push(`${id.padEnd(8)} rig ${rigMs.toFixed(3)} ms  draw ${drawMs.toFixed(3)} ms  sim+rig ${simMs.toFixed(3)} ms`);
}
(window as unknown as { result: string }).result = out.join('\n');
