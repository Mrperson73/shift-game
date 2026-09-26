// Turns the desktop's window rectangles into the pet's world: the visible parts of window top
// edges become platforms, and window sides become walls it can climb.

import type { Platform, Wall } from '../shared/types';

export interface WinRect {
  hwnd: string;
  /** Screen coordinates in DIPs. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Top-edge parts the pet should not stand on: the window icon and the caption buttons. */
export const ICON_SPACE = 44;
export const CAPTION_SPACE = 150;

type Span = [number, number];

function subtract(spans: Span[], cut: Span): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans) {
    if (cut[1] <= a || cut[0] >= b) out.push([a, b]);
    else {
      if (cut[0] > a) out.push([a, cut[0]]);
      if (cut[1] < b) out.push([cut[1], b]);
    }
  }
  return out;
}

/**
 * `wins` must be in z-order, topmost first, in the same coordinate space as `area`.
 * Returns platforms and walls in area-local coordinates (the overlay's).
 */
export function computeWorld(wins: WinRect[], area: Area, minSegment = 60): { platforms: Platform[]; walls: Wall[] } {
  const platforms: Platform[] = [];
  const walls: Wall[] = [];
  const local = wins.map((w) => ({ ...w, x: w.x - area.x, y: w.y - area.y }));
  local.forEach((w, i) => {
    const above = local.slice(0, i);
    // Top edge, minus icon/caption areas, minus whatever covers it, clipped to the screen.
    if (w.y > 0 && w.y < area.height - 8) {
      let spans: Span[] = [[Math.max(0, w.x + ICON_SPACE), Math.min(area.width, w.x + w.w - CAPTION_SPACE)]];
      for (const u of above) if (w.y >= u.y - 1 && w.y <= u.y + u.h) spans = subtract(spans, [u.x, u.x + u.w]);
      spans
        .filter(([a, b]) => b - a >= minSegment)
        .forEach(([a, b], k) => platforms.push({ id: `${w.hwnd}:${k}`, x1: a, x2: b, y: w.y, win: w.hwnd, wx: w.x, wy: w.y }));
    }
    // Sides: climbable from the top corner down to wherever the side first gets covered.
    for (const side of ['left', 'right'] as const) {
      const x = side === 'left' ? w.x : w.x + w.w;
      if (x < 24 || x > area.width - 24 || w.y <= 0 || w.y >= area.height - 8) continue;
      let y2 = Math.min(w.y + w.h, area.height);
      let blocked = false;
      for (const u of above) {
        if (x < u.x - 1 || x > u.x + u.w + 1) continue;
        if (u.y <= w.y + 1 && u.y + u.h >= w.y) blocked = true; // the top corner is covered
        else if (u.y > w.y && u.y < y2) y2 = u.y;
      }
      if (!blocked && y2 - w.y > 40) walls.push({ id: `${w.hwnd}:${side[0].toUpperCase()}`, win: w.hwnd, side, x, y1: w.y, y2, wx: w.x, wy: w.y });
    }
  });
  return { platforms, walls };
}
