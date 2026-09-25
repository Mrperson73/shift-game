// Reads the Windows desktop through a few read-only Win32 calls (via the koffi FFI):
// top-level window rectangles in z-order, whether the foreground app is full screen, and the names
// of running programs (for game reactions). It never touches other programs' memory or input.
// On other platforms (and if anything fails to load) it reports nothing, and the pet just uses
// the taskbar.

export interface DesktopWindow {
  hwnd: string;
  /** Physical pixels, as Windows reports them. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  title: string;
  pid: number;
}

export interface Foreground {
  hwnd: string;
  /** Covers its whole monitor (full-screen game, video, presentation). */
  fullscreen: boolean;
  /** The monitor rectangle, physical pixels. */
  monitor: { left: number; top: number; right: number; bottom: number };
}

export interface Desktop {
  available: boolean;
  error: string | null;
  windows(exclude: Set<string>): DesktopWindow[];
  foreground(exclude: Set<string>): Foreground | null;
  /** True when Windows itself says a full-screen/presentation app is running. */
  busy(): boolean;
  /** pid -> lower-case exe name. */
  processes(): Map<number, string>;
}

const NONE: Desktop = {
  available: false,
  error: null,
  windows: () => [],
  foreground: () => null,
  busy: () => false,
  processes: () => new Map(),
};

// Windows that are part of the shell or are not real app windows.
const SKIP_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'ForegroundStaging',
  'MultitaskingViewFrame',
  'TaskListThumbnailWnd',
  'tooltips_class32',
  '#32768',
  'IME',
  'MSCTFIME UI',
  'EdgeUiInputTopWndClass',
  'ApplicationManager_ImmersiveShellWindow',
  'Internet Explorer_Hidden',
  'NarratorHelperWindow',
  'Windows.Internal.Shell.TabProxyWindow',
  // Overlays and helper windows that look like windows but aren't anything you can see.
  'CEF-OSC-WIDGET',
  'SysShadow',
  'MSO_BORDEREFFECT_WINDOW_CLASS',
  'VisualStudioGlowWindow',
  'Shell_InputSwitchTopLevelWindow',
  'Chrome_SystemMessageWindow',
  'DummyDWMListenerWindow',
  'EdgeUiInputWndClass',
  'ThumbnailDeviceHelperWnd',
  'PseudoConsoleWindow',
]);

const GW_HWNDNEXT = 2;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_LAYERED = 0x80000;
const LWA_ALPHA = 2;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const MONITOR_DEFAULTTONEAREST = 2;
const TH32CS_SNAPPROCESS = 2;

/** Win32 prototypes, kept together so a unit test can check they parse. */
export const PROTOTYPES = {
  GetTopWindow: 'intptr_t __stdcall GetTopWindow(intptr_t hWnd)',
  GetWindow: 'intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t uCmd)',
  IsWindowVisible: 'int __stdcall IsWindowVisible(intptr_t hWnd)',
  IsIconic: 'int __stdcall IsIconic(intptr_t hWnd)',
  GetWindowLongPtrW: 'intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)',
  GetWindowRect: 'int __stdcall GetWindowRect(intptr_t hWnd, _Out_ HatchRect *lpRect)',
  GetLayeredWindowAttributes: 'int __stdcall GetLayeredWindowAttributes(intptr_t hwnd, _Out_ uint32_t *pcrKey, _Out_ uint8_t *pbAlpha, _Out_ uint32_t *pdwFlags)',
  GetWindowTextW: 'int __stdcall GetWindowTextW(intptr_t hWnd, _Out_ uint8_t *lpString, int nMaxCount)',
  GetClassNameW: 'int __stdcall GetClassNameW(intptr_t hWnd, _Out_ uint8_t *lpClassName, int nMaxCount)',
  GetWindowThreadProcessId: 'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)',
  GetForegroundWindow: 'intptr_t __stdcall GetForegroundWindow()',
  MonitorFromWindow: 'intptr_t __stdcall MonitorFromWindow(intptr_t hwnd, uint32_t dwFlags)',
  GetMonitorInfoW: 'int __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ HatchMonitorInfo *lpmi)',
  DwmGetWindowAttribute: 'int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, _Out_ uint8_t *pvAttribute, uint32_t cbAttribute)',
  SHQueryUserNotificationState: 'int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *pquns)',
  CreateToolhelp32Snapshot: 'intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t dwFlags, uint32_t th32ProcessID)',
  Process32FirstW: 'int __stdcall Process32FirstW(intptr_t hSnapshot, _Inout_ HatchProcessEntry *lppe)',
  Process32NextW: 'int __stdcall Process32NextW(intptr_t hSnapshot, _Inout_ HatchProcessEntry *lppe)',
  CloseHandle: 'int __stdcall CloseHandle(intptr_t hObject)',
};

type Koffi = typeof import('koffi');

/** Declares the structs the prototypes use. */
export function declareTypes(koffi: Pick<Koffi, 'struct' | 'array'>) {
  const RECT = koffi.struct('HatchRect', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const MONITORINFO = koffi.struct('HatchMonitorInfo', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' });
  const ENTRY = koffi.struct('HatchProcessEntry', {
    dwSize: 'uint32_t',
    cntUsage: 'uint32_t',
    th32ProcessID: 'uint32_t',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32_t',
    cntThreads: 'uint32_t',
    th32ParentProcessID: 'uint32_t',
    pcPriClassBase: 'int32_t',
    dwFlags: 'uint32_t',
    szExeFile: koffi.array('char16_t', 260, 'String'),
  });
  return { RECT, MONITORINFO, ENTRY };
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function openDesktop(): Desktop {
  if (process.platform !== 'win32') return NONE;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as Koffi;
    const { MONITORINFO, ENTRY } = declareTypes(koffi);
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const shell32 = koffi.load('shell32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const P = PROTOTYPES;
    const GetTopWindow = user32.func(P.GetTopWindow);
    const GetWindow = user32.func(P.GetWindow);
    const IsWindowVisible = user32.func(P.IsWindowVisible);
    const IsIconic = user32.func(P.IsIconic);
    const GetWindowLongPtrW = user32.func(P.GetWindowLongPtrW);
    const GetWindowRect = user32.func(P.GetWindowRect);
    const GetLayeredWindowAttributes = user32.func(P.GetLayeredWindowAttributes);
    const GetWindowTextW = user32.func(P.GetWindowTextW);
    const GetClassNameW = user32.func(P.GetClassNameW);
    const GetWindowThreadProcessId = user32.func(P.GetWindowThreadProcessId);
    const GetForegroundWindow = user32.func(P.GetForegroundWindow);
    const MonitorFromWindow = user32.func(P.MonitorFromWindow);
    const GetMonitorInfoW = user32.func(P.GetMonitorInfoW);
    const DwmGetWindowAttribute = dwmapi.func(P.DwmGetWindowAttribute);
    const dwmBuf = Buffer.alloc(16);
    const SHQueryUserNotificationState = shell32.func(P.SHQueryUserNotificationState);
    const CreateToolhelp32Snapshot = kernel32.func(P.CreateToolhelp32Snapshot);
    const Process32FirstW = kernel32.func(P.Process32FirstW);
    const Process32NextW = kernel32.func(P.Process32NextW);
    const CloseHandle = kernel32.func(P.CloseHandle);
    const entrySize = koffi.sizeof(ENTRY);
    const monitorInfoSize = koffi.sizeof(MONITORINFO);

    const buf = Buffer.alloc(1024);
    const text = (fn: (h: number, b: Buffer, n: number) => number, h: number) => {
      const n = fn(h, buf, 511);
      return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
    };
    const className = (h: number) => text(GetClassNameW, h);
    const rectOf = (h: number): Rect | null => {
      // The visible frame (without the invisible resize borders Windows 10/11 add).
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, dwmBuf, 16) === 0) {
        const r = { left: dwmBuf.readInt32LE(0), top: dwmBuf.readInt32LE(4), right: dwmBuf.readInt32LE(8), bottom: dwmBuf.readInt32LE(12) };
        if (r.right > r.left) return r;
      }
      const g: Partial<Rect> = {};
      return GetWindowRect(h, g) ? (g as Rect) : null;
    };
    /** A layered window that is (almost) fully see-through. */
    const invisible = (h: number) => {
      const key = [0];
      const alpha = [0];
      const flags = [0];
      return !!GetLayeredWindowAttributes(h, key, alpha, flags) && (flags[0] & LWA_ALPHA) !== 0 && alpha[0] < 40;
    };
    const monitorOf = (h: number): Rect | null => {
      const mon = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
      if (!mon) return null;
      const mi = { cbSize: monitorInfoSize, rcMonitor: {}, rcWork: {}, dwFlags: 0 } as { cbSize: number; rcMonitor: Rect; rcWork: Rect; dwFlags: number };
      return GetMonitorInfoW(mon, mi) ? mi.rcMonitor : null;
    };

    return {
      available: true,
      error: null,
      windows(exclude) {
        const out: DesktopWindow[] = [];
        let h = GetTopWindow(0);
        for (let guard = 0; h && guard < 4000; guard++, h = GetWindow(h, GW_HWNDNEXT)) {
          if (!IsWindowVisible(h) || IsIconic(h)) continue;
          const id = String(h);
          if (exclude.has(id)) continue;
          const style = Number(GetWindowLongPtrW(h, GWL_STYLE));
          const ex = Number(GetWindowLongPtrW(h, GWL_EXSTYLE));
          if (style & WS_CHILD) continue;
          if (ex & WS_EX_TOOLWINDOW && !(ex & WS_EX_APPWINDOW)) continue;
          if (ex & WS_EX_NOACTIVATE) continue;
          if (ex & WS_EX_TRANSPARENT && ex & WS_EX_LAYERED) continue;
          if (ex & WS_EX_LAYERED && invisible(h)) continue;
          dwmBuf.fill(0);
          if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, dwmBuf, 4) === 0 && dwmBuf.readUInt32LE(0)) continue;
          if (SKIP_CLASSES.has(className(h))) continue;
          const title = text(GetWindowTextW, h);
          if (!title) continue;
          const r = rectOf(h);
          if (!r || r.right - r.left < 120 || r.bottom - r.top < 60) continue;
          // A layered window covering a whole screen is an overlay (dimmers, recorders), not a window.
          if (ex & WS_EX_LAYERED) {
            const m = monitorOf(h);
            if (m && r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom) continue;
          }
          const pid = [0];
          GetWindowThreadProcessId(h, pid);
          out.push({ hwnd: id, ...r, title, pid: pid[0] });
        }
        return out;
      },
      foreground(exclude) {
        const h = GetForegroundWindow();
        if (!h) return null;
        const id = String(h);
        const cls = className(h);
        const ex = Number(GetWindowLongPtrW(h, GWL_EXSTYLE));
        // Click-through overlays (game bars, FPS counters) are never "the full-screen app".
        const shell = SKIP_CLASSES.has(cls) || exclude.has(id) || (ex & WS_EX_TRANSPARENT) !== 0 || (ex & WS_EX_LAYERED && invisible(h));
        const r: Partial<Rect> = {};
        const mon = monitorOf(h);
        if (!mon || !GetWindowRect(h, r)) return { hwnd: id, fullscreen: false, monitor: mon ?? { left: 0, top: 0, right: 0, bottom: 0 } };
        const full = !shell && r.left! <= mon.left && r.top! <= mon.top && r.right! >= mon.right && r.bottom! >= mon.bottom;
        return { hwnd: id, fullscreen: full, monitor: mon };
      },
      busy() {
        const s = [0];
        if (SHQueryUserNotificationState(s) !== 0) return false;
        // 2 = full-screen app, 3 = Direct3D full-screen, 4 = presentation mode.
        return s[0] === 2 || s[0] === 3 || s[0] === 4;
      },
      processes() {
        const out = new Map<number, string>();
        const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (!snap || snap === -1) return out;
        try {
          const e = { dwSize: entrySize } as Record<string, unknown>;
          let ok = Process32FirstW(snap, e);
          for (let guard = 0; ok && guard < 10000; guard++) {
            out.set(e.th32ProcessID as number, String(e.szExeFile).toLowerCase());
            e.dwSize = entrySize;
            ok = Process32NextW(snap, e);
          }
        } finally {
          CloseHandle(snap);
        }
        return out;
      },
    };
  } catch (err) {
    return { ...NONE, error: (err as Error).message };
  }
}
