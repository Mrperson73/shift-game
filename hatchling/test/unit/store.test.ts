import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { _test, ensureModsFolder, loadMods } from '../../src/main/mods';
import { sanitizeName, sanitizeSettings, Store } from '../../src/main/store';
import { parseSpeciesMod } from '../../src/pet/species';
import { DEFAULT_SETTINGS, newPet } from '../../src/shared/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-'));

describe('store', () => {
  it('saves atomically, keeps a backup and recovers from a corrupted file', () => {
    const dir = tmp();
    const file = path.join(dir, 'hatchling.json');
    const a = new Store(file);
    expect(a.data.pet).toBeNull();
    a.data.pet = newPet('raptor', 1, 'Blue', Date.now());
    a.save();
    a.data.pet.activeSeconds = 99;
    a.save();
    expect(fs.existsSync(file + '.bak')).toBe(true);
    fs.writeFileSync(file, '{"v":1,"pet":{"name":"Bl'); // torn write
    const b = new Store(file);
    expect(b.recovered).toMatch(/backup/);
    expect(b.data.pet?.name).toBe('Blue');
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('sanitizes what it loads', () => {
    const dir = tmp();
    const file = path.join(dir, 'hatchling.json');
    fs.writeFileSync(file, JSON.stringify({ pet: { name: '<b>x</b>', energy: 9, activeSeconds: -5, stats: { pets: 'lots' } }, settings: { size: 'XXL', volume: 3, speech: 'chatty' } }));
    const s = new Store(file);
    expect(s.data.pet).toMatchObject({ name: 'bx/b', energy: 1, activeSeconds: 0, stats: { pets: 0 } });
    expect(s.data.settings).toMatchObject({ size: 'M', volume: 1, speech: 'chatty' });
    expect(sanitizeName('   ')).toBe('Rexy');
    expect(sanitizeName('A'.repeat(99))).toHaveLength(24);
    expect(sanitizeSettings({ display: 7, startWithWindows: false })).toMatchObject({ display: 7, startWithWindows: false, explore: DEFAULT_SETTINGS.explore });
  });
});

describe('mods folder', () => {
  it('loads good mods and explains bad ones', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'carno.json'), JSON.stringify(_test.EXAMPLE));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    fs.writeFileSync(path.join(dir, 'dupe.json'), JSON.stringify({ ..._test.EXAMPLE }));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    const { species, problems } = loadMods(dir);
    expect(species.map((s) => s.id)).toEqual(['carno']);
    expect(problems.map((p) => p.file).sort()).toEqual(['broken.json', 'dupe.json']);
    expect(problems.find((p) => p.file === 'broken.json')?.error).toMatch(/JSON/);
  });

  it('writes a readme and a valid example', () => {
    const dir = path.join(tmp(), 'species');
    ensureModsFolder(dir);
    expect(fs.readFileSync(path.join(dir, 'README.txt'), 'utf8')).toMatch(/base/);
    const ex = JSON.parse(fs.readFileSync(path.join(dir, 'carnotaurus.json.example'), 'utf8'));
    expect(parseSpeciesMod(ex, 'x').name).toBe('Carno');
    expect(loadMods(dir).species).toEqual([]);
  });
});
