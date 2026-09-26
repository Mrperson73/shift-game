import { describe, expect, it } from 'vitest';
import { CAPTION_SPACE, computeWorld, ICON_SPACE } from '../../src/main/geometry';

const area = { x: 0, y: 0, width: 1920, height: 1032 };

describe('computeWorld', () => {
  it('turns a window into a platform (minus icon and buttons) and two walls', () => {
    const { platforms, walls } = computeWorld([{ hwnd: 'a', x: 300, y: 200, w: 800, h: 600 }], area);
    expect(platforms).toEqual([{ id: 'a:0', x1: 300 + ICON_SPACE, x2: 1100 - CAPTION_SPACE, y: 200, win: 'a', wx: 300, wy: 200 }]);
    expect(walls.map((w) => [w.side, w.x, w.y1, w.y2])).toEqual([
      ['left', 300, 200, 800],
      ['right', 1100, 200, 800],
    ]);
  });

  it('hides edges covered by windows in front', () => {
    const front = { hwnd: 'f', x: 500, y: 100, w: 300, h: 400 };
    const back = { hwnd: 'b', x: 200, y: 300, w: 1000, h: 500 };
    const { platforms, walls } = computeWorld([front, back], area);
    const b = platforms.filter((p) => p.win === 'b').map((p) => [p.x1, p.x2]);
    expect(b).toEqual([
      [244, 500],
      [800, 1050],
    ]);
    // Back window's sides are clear; the front window's sides are too.
    expect(walls.filter((w) => w.win === 'b')).toHaveLength(2);
    // A window in front that covers the back window's left top corner blocks that wall.
    const corner = { hwnd: 'c', x: 150, y: 250, w: 200, h: 200 };
    const w2 = computeWorld([corner, back], area).walls.filter((w) => w.win === 'b');
    expect(w2.map((w) => w.side)).toEqual(['right']);
  });

  it('shortens a wall where a window in front crosses it lower down', () => {
    const back = { hwnd: 'b', x: 400, y: 200, w: 600, h: 700 };
    const crossing = { hwnd: 'x', x: 300, y: 600, w: 300, h: 200 };
    const left = computeWorld([crossing, back], area).walls.find((w) => w.win === 'b' && w.side === 'left');
    expect(left).toMatchObject({ y1: 200, y2: 600 });
  });

  it('skips maximized windows and edges at the screen border', () => {
    const { platforms, walls } = computeWorld([{ hwnd: 'm', x: 0, y: 0, w: 1920, h: 1032 }], area);
    expect(platforms).toEqual([]);
    expect(walls).toEqual([]);
  });

  it('works in the overlay coordinates of a second monitor', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 984 };
    const { platforms } = computeWorld([{ hwnd: 'a', x: 2100, y: 300, w: 600, h: 400 }], second);
    expect(platforms[0]).toMatchObject({ x1: 180 + ICON_SPACE, y: 300, wx: 180 });
  });
});
