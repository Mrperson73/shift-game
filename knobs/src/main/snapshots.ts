import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import type { VersionInfo } from '../shared/types';
import { writeAtomic } from './store';

interface IndexEntry extends VersionInfo { hash: string }

export function hashFiles(files: Record<string, string>): string {
  const h = crypto.createHash('sha1');
  for (const k of Object.keys(files).sort()) h.update(k).update('\0').update(files[k]).update('\0');
  return h.digest('hex');
}

/** Per-game version history: gzipped JSON of every distinct set of source files. */
export class Snapshots {
  constructor(private dir: string, private max = 100) {}

  private index(id: string): IndexEntry[] {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, id, 'index.json'), 'utf8'));
    } catch {
      return [];
    }
  }

  list(id: string): VersionInfo[] {
    return this.index(id).map(({ hash: _hash, ...v }) => v);
  }

  latestHash(id: string): string | null {
    return this.index(id)[0]?.hash ?? null;
  }

  /** Save a version unless it's identical to the newest one. Returns the new entry, or null. */
  add(id: string, files: Record<string, string>, reason: string): VersionInfo | null {
    const hash = hashFiles(files);
    const idx = this.index(id);
    if (idx[0]?.hash === hash) return null;
    const ts = Date.now();
    const vid = `${ts.toString(36)}${crypto.randomBytes(2).toString('hex')}`;
    const texts = Object.values(files);
    const entry: IndexEntry = {
      id: vid, ts, reason, hash, files: Object.keys(files),
      lines: texts.reduce((n, t) => n + t.split('\n').length, 0),
      bytes: texts.reduce((n, t) => n + t.length, 0),
    };
    const gdir = path.join(this.dir, id);
    fs.mkdirSync(gdir, { recursive: true });
    fs.writeFileSync(path.join(gdir, `${vid}.json.gz`), zlib.gzipSync(JSON.stringify(files)));
    idx.unshift(entry);
    for (const old of idx.splice(this.max)) fs.rmSync(path.join(gdir, `${old.id}.json.gz`), { force: true });
    writeAtomic(path.join(gdir, 'index.json'), JSON.stringify(idx));
    return entry;
  }

  get(id: string, vid: string): Record<string, string> | null {
    if (!/^[a-z0-9]+$/.test(vid)) return null;
    try {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(this.dir, id, `${vid}.json.gz`))).toString('utf8'));
    } catch {
      return null;
    }
  }
}
