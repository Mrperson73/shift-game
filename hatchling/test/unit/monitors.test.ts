import { describe, expect, it } from 'vitest';
import { edgesOf, type Mon, monitorAt, neighbour, othersOf, splitMonitor } from '../../src/main/monitors';

const mon = (id: number, x: number, y: number, w: number, h: number, taskbar = 40, primary = false): Mon => ({
  id,
  bounds: { x, y, width: w, height: h },
  workArea: { x, y, width: w, height: h - taskbar },
  label: `M${id}`,
  primary,
});

describe('monitors', () => {
  // A laptop on the left, a big monitor in the middle (the main one), a portrait one on the right
  // standing a bit lower, and one above the main monitor.
  const laptop = mon(1, -1536, 200, 1536, 864);
  const main = mon(2, 0, 0, 2560, 1440, 48, true);
  const portrait = mon(3, 2560, 300, 1080, 1920, 0);
  const above = mon(4, 0, -1080, 1920, 1080);
  const all = [laptop, main, portrait, above];

  it('finds the monitor a dino walks onto at each side', () => {
    expect(neighbour(all, main, 'left')?.id).toBe(1);
    expect(neighbour(all, main, 'right')?.id).toBe(3);
    expect(neighbour(all, laptop, 'right')?.id).toBe(2);
    expect(neighbour(all, laptop, 'left')).toBeNull();
    expect(neighbour(all, portrait, 'left')?.id).toBe(2);
    // Stacked monitors aren't side by side.
    expect(neighbour(all, above, 'left')).toBeNull();
    expect(neighbour(all, above, 'right')).toBeNull();
    expect(edgesOf(all, main)).toEqual({ left: 'exit', right: 'exit' });
    expect(edgesOf(all, laptop)).toEqual({ left: 'wall', right: 'exit' });
    expect(edgesOf([main], main)).toEqual({ left: 'wall', right: 'wall' });
  });

  it('needs the screens to touch and overlap enough', () => {
    const corner = mon(5, 2560, 1400, 1920, 1080);
    expect(neighbour([main, corner], main, 'right')).toBeNull();
    const gap = mon(6, 2700, 0, 1920, 1080);
    expect(neighbour([main, gap], main, 'right')).toBeNull();
    // Mixed scale factors can leave a pixel or two between screens.
    const near = mon(7, 2562, 0, 1920, 1080);
    expect(neighbour([main, near], main, 'right')?.id).toBe(7);
  });

  it('picks the monitor at the height where the dino walks off', () => {
    const upper = mon(8, 2560, 0, 1920, 700);
    const lower = mon(9, 2560, 700, 1920, 1080);
    expect(neighbour([main, upper, lower], main, 'right', 300)?.id).toBe(8);
    expect(neighbour([main, upper, lower], main, 'right', 1390)?.id).toBe(9);
    // Without a height: the one that overlaps most.
    expect(neighbour([main, upper, lower], main, 'right')?.id).toBe(9);
  });

  it('knows where points are and where the others are', () => {
    expect(monitorAt(all, 100, 100).id).toBe(2);
    expect(monitorAt(all, -10, 500).id).toBe(1);
    expect(monitorAt(all, 3000, 2000).id).toBe(3);
    expect(monitorAt(all, 100, -500).id).toBe(4);
    // Off every screen: the nearest one.
    expect(monitorAt(all, 5000, 1000).id).toBe(3);
    expect(othersOf([laptop, main], main)).toEqual([{ x: -1536, y: 200, width: 1536, height: 824 }]);
    expect(othersOf([laptop, main], laptop)).toEqual([{ x: 1536, y: -200, width: 2560, height: 1392 }]);
  });

  it('splits one screen into side-by-side test monitors', () => {
    const [a, b] = splitMonitor(mon(99, 0, 0, 1600, 1000, 40, true), 2);
    expect(a).toMatchObject({ id: 1, primary: true, bounds: { x: 0, width: 800 }, workArea: { x: 0, y: 0, width: 800, height: 960 } });
    expect(b).toMatchObject({ id: 2, primary: false, bounds: { x: 800, width: 800 }, workArea: { x: 800, y: 0, width: 800, height: 960 } });
    expect(edgesOf([a, b], a)).toEqual({ left: 'wall', right: 'exit' });
    expect(edgesOf([a, b], b)).toEqual({ left: 'exit', right: 'wall' });
  });
});
