// Skin: a fine texture (scales or feathers) and form shading, so the flat cartoon shapes read as
// round, scaly or feathery animals. Everything here is a few extra fills per frame.

import type { Ctx } from './shapes';

type Bounds = { x1: number; y1: number; x2: number; y2: number };

const TILE = 32;
const tiles: Partial<Record<'scales' | 'feathers', CanvasImageSource | null>> = {};

/** A small tile of scales or feathers, drawn once and repeated. */
function tile(kind: 'scales' | 'feathers'): CanvasImageSource | null {
  if (kind in tiles) return tiles[kind]!;
  let c: OffscreenCanvas | HTMLCanvasElement | null = null;
  if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(TILE, TILE);
  else if (typeof document !== 'undefined') {
    c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
  }
  const g = c?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!c || !g) return (tiles[kind] = null);
  g.strokeStyle = '#000';
  g.fillStyle = '#000';
  g.lineCap = 'round';
  if (kind === 'scales') {
    // Staggered rows of round scales, each with a darker lower rim.
    g.lineWidth = 1.3;
    for (let row = -1; row < 5; row++) {
      for (let col = -1; col < 3; col++) {
        const x = col * 16 + (row % 2 ? 8 : 0) + 8;
        const y = row * 8 + 4;
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(x, y, 7.5, Math.PI * 0.12, Math.PI * 0.88);
        g.stroke();
        g.globalAlpha = 0.3;
        g.beginPath();
        g.arc(x, y + 1.5, 6, Math.PI * 0.15, Math.PI * 0.85);
        g.lineTo(x, y + 1.5);
        g.fill();
      }
    }
  } else {
    // Overlapping little feather tips.
    g.lineWidth = 1.1;
    for (let row = -1; row < 5; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * 8 + (row % 2 ? 4 : 0);
        const y = row * 8;
        g.beginPath();
        g.moveTo(x - 3.5, y);
        g.quadraticCurveTo(x, y + 7, x + 3.5, y);
        g.stroke();
        g.beginPath();
        g.moveTo(x, y + 1);
        g.lineTo(x, y + 5);
        g.stroke();
      }
    }
  }
  return (tiles[kind] = c);
}

const patterns = new WeakMap<Ctx, Partial<Record<'scales' | 'feathers', CanvasPattern | null>>>();

/**
 * Covers the current clip (the body) with a faint texture. `size` is the width of one scale in
 * rig units; `alpha` how strong it is.
 */
export function texture(ctx: Ctx, kind: 'scales' | 'feathers', b: Bounds, size: number, alpha: number) {
  let byKind = patterns.get(ctx);
  if (!byKind) patterns.set(ctx, (byKind = {}));
  if (!(kind in byKind)) {
    const t = tile(kind);
    byKind[kind] = t ? ctx.createPattern(t, 'repeat') : null;
  }
  const pat = byKind[kind];
  if (!pat) return;
  const k = size / 16;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.scale(k, k);
  ctx.fillStyle = pat;
  ctx.fillRect((b.x1 - 4) / k, (b.y1 - 4) / k, (b.x2 - b.x1 + 8) / k, (b.y2 - b.y1 + 8) / k);
  ctx.restore();
}

/**
 * Form shading for a shape the context is already clipped to: a shadow along its underside and a
 * highlight along its top, as if lit from above. `d` is how deep the bands are, in rig units;
 * `lean` shifts the shadow sideways (for legs, so it falls on their back edge).
 */
export function formShade(ctx: Ctx, path: Path2D, b: Bounds, d: number, shadow: string, light: string, lean = 0) {
  const band = (dx: number, dy: number, color: string) => {
    const p = new Path2D();
    p.rect(b.x1 - 8 - Math.abs(dx), b.y1 - 8 - Math.abs(dy), b.x2 - b.x1 + 16 + 2 * Math.abs(dx), b.y2 - b.y1 + 16 + 2 * Math.abs(dy));
    p.addPath(path);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.fillStyle = color;
    ctx.fill(p, 'evenodd');
    ctx.restore();
  };
  band(lean, d, shadow);
  band(0, -d * 0.7, light);
}

/** Strokes the outline again a little lower, so outlines are heavier underneath (as if in shadow). */
export function heavyUnderline(ctx: Ctx, path: Path2D, o: number) {
  ctx.save();
  ctx.translate(0, -o * 0.75);
  ctx.stroke(path);
  ctx.restore();
}
