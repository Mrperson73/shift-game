// Live, animated drawings of the pet (or its egg) for the panel window.

import { drawEgg, drawPet, palette } from '../pet/draw';
import { applyPose, type PoseName } from '../pet/poses';
import { Rig } from '../pet/rig';
import type { SpeciesDef } from '../pet/species';

export interface PortraitOpts {
  species: SpeciesDef;
  variant: number;
  growth: number;
  egg: boolean;
  /** Pixels per rig unit at adult size. */
  zoom: number;
  pose?: PoseName;
  /** Wobble the egg now and then. */
  wobble?: boolean;
  /** Scale the pet to fill the canvas height instead of showing its real size. */
  fit?: boolean;
}

/** Animates into a canvas until the returned function is called. */
export function animate(canvas: HTMLCanvasElement, get: () => PortraitOpts): () => void {
  const ctx = canvas.getContext('2d')!;
  let rig: Rig | null = null;
  let key = '';
  let raf = 0;
  let last = performance.now();
  let mouse: { x: number; y: number } | null = null;
  const onMove = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  window.addEventListener('mousemove', onMove);
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const o = get();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pal = palette(o.species.variants[o.variant % o.species.variants.length]);
    const baseY = h - 14;
    if (o.egg) {
      const wob = o.wobble ? Math.sin(now / 90) * 0.09 * Math.max(0, Math.sin(now / 700) - 0.6) * 3 : 0;
      ctx.save();
      ctx.translate(w / 2, baseY);
      ctx.fillStyle = 'rgba(20,16,30,0.12)';
      ctx.beginPath();
      ctx.ellipse(0, 1, h * 0.26, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      drawEgg(ctx, h * 0.72, pal, wob, 0, 0);
      ctx.restore();
    } else {
      const k = `${o.species.id}:${o.variant}:${o.pose ?? 'stand'}`;
      if (!rig || k !== key) {
        rig = new Rig(o.species, o.growth);
        applyPose(rig, o.pose ?? 'stand');
        key = k;
      }
      if (Math.abs(rig.growth - o.growth) > 1e-4) rig.setGrowth(o.growth);
      const sc = o.fit ? Math.min((h * 0.62) / rig.height, (w * 0.62) / (rig.p.tailLen + rig.p.bodyLen + rig.p.neckLen + rig.p.headLen)) : o.zoom * rig.size;
      const cx = w / 2 - (rig.p.bodyLen * 0.2) * sc;
      rig.look = mouse ? { x: (mouse.x - cx) / sc, y: (baseY - mouse.y) / sc } : null;
      rig.update(dt);
      ctx.save();
      ctx.translate(cx, baseY);
      drawPet(ctx, rig, pal, o.species.features, { scale: sc, outline: Math.max(1.4, Math.min(2.6, sc * 1.6)), shadow: true });
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('mousemove', onMove);
  };
}
