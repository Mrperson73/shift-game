import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Store } from '../../src/main/store';
it('a 1.0 save loads in 1.1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const f = path.join(dir, 'hatchling.json');
  // Exactly what 1.0 wrote.
  fs.writeFileSync(f, JSON.stringify({ v: 1, pet: { v: 1, id: 'abc', name: 'Tiny', species: 'raptor', variant: 3, bornAt: 1, hatchedAt: 2, activeSeconds: 7200, energy: 0.5, happiness: 0.6, hunger: 0.3, stats: { pets: 4, meals: 2, naps: 1, games: 0, throws: 1, pokes: 3 }, lastSeen: 3, x: 0.5 }, settings: { size: 'M', sound: true, volume: 0.5, speech: 'emotes', explore: true, hideFullscreen: true, display: null, startWithWindows: true, activity: 'lively', gameReactions: true }, history: [] }));
  const s = new Store(f);
  expect(s.data.pet).toMatchObject({ name: 'Tiny', species: 'raptor', variant: 3, activeSeconds: 7200, colors: null, shiny: false });
  expect(s.data.settings).toMatchObject({ hideFullscreen: false, activity: 'lively', theme: 'auto' });
  expect(s.recovered).toBeNull();
});
