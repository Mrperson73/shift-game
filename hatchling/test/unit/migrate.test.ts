import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { REV, Store } from '../../src/main/store';

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'hatchling.json');

it('a 1.0 save loads', () => {
  const f = file();
  // Exactly what 1.0 wrote.
  fs.writeFileSync(f, JSON.stringify({ v: 1, pet: { v: 1, id: 'abc', name: 'Tiny', species: 'raptor', variant: 3, bornAt: 1, hatchedAt: 2, activeSeconds: 7200, energy: 0.5, happiness: 0.6, hunger: 0.3, stats: { pets: 4, meals: 2, naps: 1, games: 0, throws: 1, pokes: 3 }, lastSeen: 3, x: 0.5 }, settings: { size: 'M', sound: true, volume: 0.5, speech: 'emotes', explore: true, hideFullscreen: true, display: null, startWithWindows: true, activity: 'lively', gameReactions: true }, history: [] }));
  const s = new Store(f);
  expect(s.data.roster).toHaveLength(1);
  expect(s.data.roster[0].pet).toMatchObject({ name: 'Tiny', species: 'raptor', variant: 3, activeSeconds: 7200, colors: null, shiny: false });
  expect(s.data.settings).toMatchObject({ hideFullscreen: false, activity: 'lively', theme: 'auto' });
  expect(s.recovered).toBeNull();
});

it('a 1.1 save (rev 2) becomes a roster with that pet out, on the screen it lived on', () => {
  const f = file();
  // What 1.1 wrote: one pet, and the screen it lived on as a setting.
  const pet = { v: 1, id: 'k3j9x', name: 'Blue', species: 'trike', variant: -1, bornAt: 10, hatchedAt: 20, activeSeconds: 99_000, energy: 0.4, happiness: 0.8, hunger: 0.5, stats: { pets: 40, meals: 12, naps: 5, games: 2, throws: 3, pokes: 9 }, lastSeen: 1_700_000_000_000, x: 0.25, colors: { body: '#123456', belly: '#abcdef', pattern: '#0a0b0c', accent: '#ff00aa', iris: '#00ff00', pattern_kind: 'rosettes' }, shiny: true };
  const history = [{ name: 'Old', species: 'rex', variant: 0, hatchedAt: 1, activeSeconds: 50, retiredAt: 2, shiny: false, colors: null }];
  const settings = { size: 'L', sound: false, volume: 0.3, speech: 'chatty', explore: false, hideFullscreen: true, display: 2779098405, startWithWindows: false, activity: 'calm', gameReactions: false, theme: 'midnight' };
  fs.writeFileSync(f, JSON.stringify({ v: 1, rev: 2, pet, settings, history }));
  const s = new Store(f);
  expect(s.recovered).toBeNull();
  expect(s.data.rev).toBe(REV);
  // Old saves have no togetherSeconds: it starts from the growth time.
  const migrated = { ...pet, togetherSeconds: 99_000 };
  expect(s.data.roster).toEqual([{ pet: migrated, display: 2779098405 }]);
  expect(s.data.out).toEqual(['k3j9x']);
  expect(s.data.selected).toBe('k3j9x');
  expect(s.data.history).toEqual([{ ...history[0], togetherSeconds: 50 }]);
  // Settings carry over (1.1 users chose to hide over full-screen apps: that stays), plus the new ones.
  expect(s.data.settings).toMatchObject({ size: 'L', sound: false, speech: 'chatty', explore: false, hideFullscreen: true, theme: 'midnight', monitors: 'all', growthSpeed: 1, power: 'balanced', videoReactions: true });
  expect('display' in s.data.settings).toBe(false);
  // Saved again, it's a rev 3 file that still has `pet` for going back to 1.1.
  s.save();
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  expect(raw).toMatchObject({ rev: REV, out: ['k3j9x'], selected: 'k3j9x', pet: { id: 'k3j9x', name: 'Blue' } });
  expect(new Store(f).data.roster).toEqual([{ pet: migrated, display: 2779098405 }]);
});

it('a 1.1 save without a pet (never hatched one) starts with an empty roster', () => {
  const f = file();
  fs.writeFileSync(f, JSON.stringify({ v: 1, rev: 2, pet: null, settings: {}, history: [] }));
  const s = new Store(f);
  expect(s.data).toMatchObject({ roster: [], out: [], selected: null });
});
