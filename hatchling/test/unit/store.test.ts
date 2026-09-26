import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { _test, ensureModsFolder, loadMods } from '../../src/main/mods';
import { REV, sanitizeName, sanitizeSettings, Store } from '../../src/main/store';
import { parseSpeciesMod } from '../../src/pet/species';
import { DEFAULT_SETTINGS, newPet, OUT_MAX, ROSTER_MAX } from '../../src/shared/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-'));

describe('store', () => {
  it('saves atomically, keeps a backup and recovers from a corrupted file', () => {
    const dir = tmp();
    const file = path.join(dir, 'hatchling.json');
    const a = new Store(file);
    expect(a.data.roster).toEqual([]);
    const pet = newPet('raptor', 1, 'Blue', Date.now());
    a.data.roster.push({ pet, display: null });
    a.data.out = [pet.id];
    a.save();
    pet.activeSeconds = 99;
    a.save();
    expect(fs.existsSync(file + '.bak')).toBe(true);
    fs.writeFileSync(file, '{"v":1,"rev":3,"roster":[{"pet":{"name":"Bl'); // torn write
    const b = new Store(file);
    expect(b.recovered).toMatch(/backup/);
    expect(b.data.roster[0]?.pet.name).toBe('Blue');
    expect(b.data.out).toEqual([pet.id]);
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('sanitizes what it loads', () => {
    const dir = tmp();
    const file = path.join(dir, 'hatchling.json');
    fs.writeFileSync(file, JSON.stringify({ rev: 3, roster: [{ pet: { name: '<b>x</b>', energy: 9, activeSeconds: -5, stats: { pets: 'lots' } }, display: 'left' }, 'junk', { pet: 7 }], out: ['nope', 5], selected: 42, settings: { size: 'XXL', volume: 3, speech: 'chatty', monitors: 'some' } }));
    const s = new Store(file);
    expect(s.data.roster).toHaveLength(1);
    expect(s.data.roster[0]).toMatchObject({ pet: { name: 'bx/b', energy: 1, activeSeconds: 0, stats: { pets: 0 } }, display: null });
    expect(s.data.out).toEqual([]);
    expect(s.data.selected).toBe(s.data.roster[0].pet.id);
    expect(s.data.settings).toMatchObject({ size: 'M', volume: 1, speech: 'chatty', monitors: 'all' });
    expect(sanitizeName('   ')).toBe('Rexy');
    expect(sanitizeName('A'.repeat(99))).toHaveLength(24);
    expect(sanitizeSettings({ monitors: 'primary', startWithWindows: false, growthSpeed: 5, power: 'saver' })).toMatchObject({ monitors: 'primary', startWithWindows: false, growthSpeed: 5, power: 'saver', explore: DEFAULT_SETTINGS.explore });
    expect(sanitizeSettings({ growthSpeed: 3, power: 'turbo' })).toMatchObject({ growthSpeed: 1, power: 'balanced' });
  });

  it('keeps the roster within its limits', () => {
    const dir = tmp();
    const file = path.join(dir, 'hatchling.json');
    const pets = Array.from({ length: ROSTER_MAX + 6 }, (_, i) => ({ pet: { ...newPet('rex', 0, `Dino ${i}`, 1), id: i < 3 ? 'same' : `id${i}` }, display: i }));
    const out = ['same', 'id3', 'id4', 'id5', 'id6', 'id7', 'gone'];
    fs.writeFileSync(file, JSON.stringify({ v: 1, rev: 3, roster: pets, out, selected: 'gone', settings: {}, history: [] }));
    const s = new Store(file);
    expect(s.data.roster).toHaveLength(ROSTER_MAX);
    // Every dino has its own id (two sharing one would share every save).
    expect(new Set(s.data.roster.map((d) => d.pet.id)).size).toBe(ROSTER_MAX);
    expect(s.data.roster[0].pet.id).toBe('same');
    expect(s.data.out).toHaveLength(OUT_MAX);
    expect(s.data.out.every((id) => s.data.roster.some((d) => d.pet.id === id))).toBe(true);
    expect(s.data.selected).toBe(s.data.out[0]);
    expect(s.data.roster[2].display).toBe(2);
  });

  it('writes the selected dino as `pet` too, so an older Hatchling still finds one', () => {
    const dir = tmp();
    const file = path.join(dir, 'hatchling.json');
    const s = new Store(file);
    const a = newPet('rex', 0, 'Ann', 1);
    const b = newPet('trike', 0, 'Bob', 1);
    s.data.roster.push({ pet: a, display: null }, { pet: b, display: 5 });
    s.data.out = [a.id, b.id];
    s.data.selected = b.id;
    s.save();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(raw).toMatchObject({ rev: REV, out: [a.id, b.id], selected: b.id, pet: { name: 'Bob' } });
    expect(raw.roster.map((d: { pet: { name: string } }) => d.pet.name)).toEqual(['Ann', 'Bob']);
    expect(new Store(file).data.roster[1]).toMatchObject({ pet: { name: 'Bob', species: 'trike' }, display: 5 });
  });
});

describe('mods folder', () => {
  it('loads good mods and explains bad ones', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'cerato.json'), JSON.stringify(_test.EXAMPLE));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    fs.writeFileSync(path.join(dir, 'dupe.json'), JSON.stringify({ ..._test.EXAMPLE }));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    const { species, problems } = loadMods(dir);
    expect(species.map((s) => s.id)).toEqual(['cerato']);
    expect(problems.map((p) => p.file).sort()).toEqual(['broken.json', 'dupe.json']);
    expect(problems.find((p) => p.file === 'broken.json')?.error).toMatch(/JSON/);
  });

  it('writes a readme and a valid example', () => {
    const dir = path.join(tmp(), 'species');
    ensureModsFolder(dir);
    expect(fs.readFileSync(path.join(dir, 'README.txt'), 'utf8')).toMatch(/base/);
    const ex = JSON.parse(fs.readFileSync(path.join(dir, 'ceratosaurus.json.example'), 'utf8'));
    expect(parseSpeciesMod(ex, 'x').name).toBe('Cerato');
    expect(loadMods(dir).species).toEqual([]);
  });
});
