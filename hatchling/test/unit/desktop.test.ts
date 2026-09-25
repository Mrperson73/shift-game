// The Win32 layer only runs on Windows (CI checks it there with --smoke-test). Here we check the
// parts that are the same on any x64: prototypes parse, and struct layouts match Windows x64.
import koffi from 'koffi';
import { describe, expect, it } from 'vitest';
import { declareTypes, PROTOTYPES } from '../../src/main/desktop';

const { RECT, MONITORINFO, ENTRY } = declareTypes(koffi);

describe('win32 bindings', () => {
  it('parses every prototype', () => {
    for (const [name, proto] of Object.entries(PROTOTYPES)) expect(() => koffi.proto(proto), name).not.toThrow();
  });

  it('matches Windows x64 struct sizes', () => {
    expect(koffi.sizeof(RECT)).toBe(16);
    expect(koffi.sizeof(MONITORINFO)).toBe(40);
    expect(koffi.sizeof(ENTRY)).toBe(568);
    expect(koffi.offsetof(ENTRY, 'szExeFile')).toBe(44);
    expect(koffi.offsetof(ENTRY, 'th32DefaultHeapID')).toBe(16);
  });

  it.runIf(process.platform === 'linux')('decodes a process entry the way Process32NextW fills it', () => {
    const libc = koffi.load('libc.so.6');
    const memcpy = libc.func('void *memcpy(_Inout_ HatchProcessEntry *dst, const uint8_t *src, size_t n)');
    const raw = Buffer.alloc(568);
    raw.writeUInt32LE(568, 0);
    raw.writeUInt32LE(4242, 8);
    raw.write('Hatchling.exe', 44, 'utf16le');
    const e: Record<string, unknown> = { dwSize: 568 };
    memcpy(e, raw, 568);
    expect(e.th32ProcessID).toBe(4242);
    expect(e.szExeFile).toBe('Hatchling.exe');
  });

  it.runIf(process.platform === 'linux')('decodes MONITORINFO the way GetMonitorInfoW fills it', () => {
    const libc = koffi.load('libc.so.6');
    const memcpy = libc.func('void *memcpy(_Inout_ HatchMonitorInfo *dst, const uint8_t *src, size_t n)');
    const raw = Buffer.alloc(40);
    [40, 0, 0, 1920, 1080, 0, 0, 1920, 1032, 1].forEach((v, i) => raw.writeInt32LE(v, i * 4));
    // Same shape desktop.ts passes in: cbSize plus empty nested rects.
    const mi: Record<string, unknown> = { cbSize: 40, rcMonitor: {}, rcWork: {}, dwFlags: 0 };
    memcpy(mi, raw, 40);
    expect(mi.rcMonitor).toEqual({ left: 0, top: 0, right: 1920, bottom: 1080 });
    expect(mi.rcWork).toEqual({ left: 0, top: 0, right: 1920, bottom: 1032 });
  });

  it.runIf(process.platform === 'linux')('fills byte buffers passed to _Out_ uint8_t* parameters', () => {
    const libc = koffi.load('libc.so.6');
    const gethostname = libc.func('int gethostname(_Out_ uint8_t *name, size_t len)');
    const buf = Buffer.alloc(256);
    expect(gethostname(buf, 255)).toBe(0);
    expect(buf.toString('latin1').replace(/\0.*$/s, '').length).toBeGreaterThan(0);
  });
});
