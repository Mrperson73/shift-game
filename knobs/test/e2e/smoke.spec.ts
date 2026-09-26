import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

// `Knobs --smoke-test` is what CI runs against the installed Windows build: it must open the
// demo in a hidden window, check it, clean up, and report through its exit code.
test('--smoke-test opens the demo and exits 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knobs-smoke-e2e-'));
  const out = path.join(tmp, 'result.txt');
  const exe = process.env.KNOBS_EXE || (require('electron') as unknown as string);
  const args = [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(process.env.KNOBS_EXE ? [] : [ROOT]), '--smoke-test'];
  const env: Record<string, string | undefined> = { ...process.env, KNOBS_SMOKE_OUT: out };
  delete env.KNOBS_USER_DATA;
  delete env.KNOBS_GAMES_DIR;
  // Twice: the second run must cope with the folder the first one left behind.
  for (let run = 0; run < 2; run++) {
    fs.rmSync(out, { force: true });
    const r = spawnSync(exe, args, { env, timeout: 40_000, encoding: 'utf8' });
    expect(fs.readFileSync(out, 'utf8')).toMatch(/^KNOBS_SMOKE OK knobs=\d+/);
    expect(r.status).toBe(0);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
