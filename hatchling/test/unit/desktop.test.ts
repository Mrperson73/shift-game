// The Win32 layer only runs on Windows (CI checks it there with --smoke-test). Here we check the
// parts that are the same on any x64: prototypes parse, and struct layouts match Windows x64.
import koffi from 'koffi';
import { describe, expect, it } from 'vitest';
import { declareTypes, NO_DESKTOP, openDesktop, PROTOTYPES } from '../../src/main/desktop';

const { RECT, MONITORINFO, ENTRY } = declareTypes(koffi);

describe('win32 bindings', () => {
  it('parses every prototype', () => {
    for (const [name, proto] of Object.entries(PROTOTYPES)) expect(() => koffi.proto(proto), name).not.toThrow();
  });

  it('declares the read-only lookups game and video reactions use', () => {
    for (const name of ['GetForegroundWindow', 'GetWindowThreadProcessId', 'GetWindowTextW', 'FindWindowExW', 'OpenProcess', 'QueryFullProcessImageNameW', 'CloseHandle'])
      expect(PROTOTYPES, name).toHaveProperty(name);
    expect(PROTOTYPES.QueryFullProcessImageNameW).toMatch(/_Inout_ uint32_t \*lpdwSize/);
  });

  it('reports nothing, without failing, where the Windows integration is unavailable', () => {
    for (const d of process.platform === 'win32' ? [NO_DESKTOP] : [openDesktop(), NO_DESKTOP]) {
      expect(d.available).toBe(false);
      expect(d.windows(new Set())).toEqual([]);
      expect(d.front(new Set())).toBeNull();
      expect(d.title('1')).toBe('');
      expect(d.processPath(1)).toBe('');
      const parents = new Map<number, number>();
      expect(d.processes(parents).size).toBe(0);
      expect(parents.size).toBe(0);
    }
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
    raw.writeUInt32LE(1234, 32);
    raw.write('Hatchling.exe', 44, 'utf16le');
    const e: Record<string, unknown> = { dwSize: 568 };
    memcpy(e, raw, 568);
    expect(e.th32ProcessID).toBe(4242);
    expect(e.th32ParentProcessID).toBe(1234);
    expect(e.szExeFile).toBe('Hatchling.exe');
  });

  it.runIf(process.platform === 'linux')('passes a buffer size in and reads the length back, as QueryFullProcessImageNameW needs', () => {
    const libc = koffi.load('libc.so.6');
    const readIn = libc.func('void *memcpy(_Out_ uint8_t *dst, _Inout_ uint32_t *src, size_t n)');
    const writeBack = libc.func('void *memcpy(_Inout_ uint32_t *dst, const uint8_t *src, size_t n)');
    const size = [1024];
    const seen = Buffer.alloc(4);
    readIn(seen, size, 4);
    expect(seen.readUInt32LE(0)).toBe(1024);
    const written = Buffer.alloc(4);
    written.writeUInt32LE(57, 0);
    writeBack(size, written, 4);
    expect(size[0]).toBe(57);
  });

  it.runIf(process.platform === 'linux')('passes class names as NUL-terminated UTF-16, as FindWindowExW needs', () => {
    const libc = koffi.load('libc.so.6');
    const memcpy = libc.func('void *memcpy(_Out_ uint8_t *dst, const char16_t *src, size_t n)');
    const out = Buffer.alloc(54);
    memcpy(out, 'Windows.UI.Core.CoreWindow', 54);
    expect(out.equals(Buffer.from('Windows.UI.Core.CoreWindow\0', 'utf16le'))).toBe(true);
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
