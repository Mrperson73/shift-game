import { describe, expect, it } from 'vitest';
import { dist, rng } from '../../src/pet/math';
import { applyPose, POSES, type PoseName } from '../../src/pet/poses';
import { Rig } from '../../src/pet/rig';
import { ANKY, BUILT_IN, STEGO, TRIKE } from '../../src/pet/species';

const finite = (o: unknown): boolean => {
  if (typeof o === 'number') return Number.isFinite(o);
  if (Array.isArray(o)) return o.every(finite);
  if (o && typeof o === 'object') return Object.values(o).every(finite);
  return true;
};

describe('rig', () => {
  it('never produces NaN in any pose, speed or growth', () => {
    for (const sp of BUILT_IN) {
      for (const g of [0, 0.3, 1]) {
        const r = new Rig(sp, g, rng(1));
        for (const name of Object.keys(POSES) as PoseName[]) {
          applyPose(r, name);
          r.speed = name === 'stand' ? 80 : 0;
          r.look = { x: 50, y: 200 };
          r.accel = 3000;
          for (let i = 0; i < 40; i++) r.update(1 / 60);
          expect(finite(r.s), `${sp.id} ${g} ${name}`).toBe(true);
        }
      }
    }
  });

  it('keeps bone lengths in the legs', () => {
    const r = new Rig(BUILT_IN[0], 1, rng(2));
    r.speed = 60;
    for (let i = 0; i < 100; i++) {
      r.update(1 / 60);
      for (const l of r.s.legs) {
        expect(dist(l.hip, l.knee)).toBeCloseTo(r.p.thigh, 3);
        expect(dist(l.knee, l.heel)).toBeLessThanOrEqual(r.p.shin + 1e-6);
      }
    }
  });

  it('plants feet: a foot on the ground does not slide while walking', () => {
    for (const sp of BUILT_IN) {
      const r = new Rig(sp, 1, rng(3));
      applyPose(r, 'stand');
      const v = 50;
      r.speed = v;
      let X = 0;
      for (let i = 0; i < 120; i++) {
        X += v / 60;
        r.update(1 / 60);
      }
      // Track the world position of each foot while it's on the ground.
      const planted: number[][] = [[], []];
      let worst = 0;
      for (let i = 0; i < 180; i++) {
        X += v / 60;
        r.update(1 / 60);
        r.s.legs.forEach((l, k) => {
          if (l.lift < 1e-6) {
            planted[k].push(X + l.ball.x);
          } else if (planted[k].length) {
            worst = Math.max(worst, Math.max(...planted[k]) - Math.min(...planted[k]));
            planted[k] = [];
          }
        });
      }
      expect(worst, sp.id).toBeLessThan(1.5);
    }
  });

  it('walks four-legged species on four planted feet', () => {
    for (const sp of [TRIKE, STEGO, ANKY]) {
      for (const g of [0, 1]) {
        const r = new Rig(sp, g, rng(6));
        applyPose(r, 'stand');
        expect(r.s.fronts.length).toBe(2);
        expect(r.s.arms.length).toBe(0);
        const v = 30;
        r.speed = v;
        let X = 0;
        for (let i = 0; i < 120; i++) {
          X += v / 60;
          r.update(1 / 60);
        }
        const planted: number[][] = [[], []];
        let worst = 0;
        for (let i = 0; i < 180; i++) {
          X += v / 60;
          r.update(1 / 60);
          r.s.fronts.forEach((l, k) => {
            // Bone lengths hold and the feet reach the ground.
            expect(dist(l.hip, l.knee)).toBeCloseTo(r.p.fThigh, 3);
            if (l.lift < 1e-6) {
              planted[k].push(X + l.ball.x);
              expect(dist(l.knee, l.heel), `${sp.id} ${g} reach`).toBeGreaterThan(r.p.fShin - 0.05);
            } else if (planted[k].length) {
              worst = Math.max(worst, Math.max(...planted[k]) - Math.min(...planted[k]));
              planted[k] = [];
            }
          });
        }
        expect(worst, `${sp.id} ${g}`).toBeLessThan(1.5);
        expect(r.steps, sp.id).toBeGreaterThan(4);
      }
    }
  });

  it('turns smoothly through zero', () => {
    const r = new Rig(BUILT_IN[1], 0.5, rng(4));
    r.facing = -1;
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) {
      r.update(1 / 60);
      seen.push(r.face);
    }
    expect(seen.some((f) => Math.abs(f) < 0.3)).toBe(true);
    expect(seen[seen.length - 1]).toBe(-1);
  });

  it('keeps the head above ground when eating and sleeping', () => {
    for (const sp of BUILT_IN) {
      for (const g of [0, 1]) {
        for (const pose of ['eat', 'sleep', 'sniff'] as PoseName[]) {
          const r = new Rig(sp, g, rng(5));
          applyPose(r, pose);
          for (let i = 0; i < 90; i++) r.update(1 / 60);
          expect(r.s.headO.y, `${sp.id} ${g} ${pose}`).toBeGreaterThan(-1);
        }
      }
    }
  });
});
