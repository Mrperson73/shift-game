// Reads the Windows desktop through a few read-only Win32 calls (via the koffi FFI):
// top-level window rectangles in z-order, whether the foreground app is full screen, and the names
// and exe paths of running programs and the title of the window in front (for game and video
// reactions). It never touches other programs' memory or input, and titles are never logged or saved.
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

/** The window you're using, for game and video reactions. */
export interface FrontWindow {
  hwnd: string;
  /** Its process (for a Store app, the app inside the frame window rather than the frame host). */
  pid: number;
  /** How much of its monitor it covers, 0..1. */
  cover: number;
  /** Covers its whole monitor with no title bar and isn't just maximized: a full-screen game or video. */
  fullscreen: boolean;
  /** The desktop, taskbar or another part of the shell, a minimized window or a click-through overlay. */
  shell: boolean;
}

export interface Desktop {
  available: boolean;
  error: string | null;
  windows(exclude: Set<string>): DesktopWindow[];
  foreground(exclude: Set<string>): Foreground | null;
  /** True when Windows itself says a full-screen/presentation app is running. */
  busy(): boolean;
  /** Whether a visible always-on-top window sits above `hwnd` (so it covers the pet). */
  coveredAbove(hwnd: string): boolean;
  /** pid -> lower-case exe name. Fills `parents` (pid -> parent pid) when given. */
  processes(parents?: Map<number, number>): Map<number, string>;
  /** The window in front, cheaply: no window list, no title. */
  front(exclude: Set<string>): FrontWindow | null;
  /** A window's title ('' when it has none). */
  title(hwnd: string): string;
  /** Full path of a program's exe, or '' when Windows won't say (system and protected processes). */
  processPath(pid: number): string;
}

/** A desktop that sees nothing (other platforms, or the native module didn't load). */
export const NO_DESKTOP: Desktop = {
  available: false,
  error: null,
  windows: () => [],
  foreground: () => null,
  busy: () => false,
  coveredAbove: () => false,
  processes: () => new Map(),
  front: () => null,
  title: () => '',
  processPath: () => '',
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
const WS_MAXIMIZE = 0x01000000;
const WS_CAPTION = 0x00c00000;
const WS_EX_TOPMOST = 0x8;
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
/** Enough to ask a process for its exe path, and nothing else (no memory access). */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** Store apps: the frame window belongs to ApplicationFrameHost.exe, this child to the app itself. */
const STORE_APP_CLASS = 'Windows.UI.Core.CoreWindow';

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
  OpenProcess: 'intptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)',
  QueryFullProcessImageNameW: 'int __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32_t dwFlags, _Out_ uint8_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
  FindWindowExW: 'intptr_t __stdcall FindWindowExW(intptr_t hWndParent, intptr_t hWndChildAfter, const char16_t *lpszClass, const char16_t *lpszWindow)',
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
  if (process.platform !== 'win32') return NO_DESKTOP;
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
    const OpenProcess = kernel32.func(P.OpenProcess);
    const QueryFullProcessImageNameW = kernel32.func(P.QueryFullProcessImageNameW);
    const FindWindowExW = user32.func(P.FindWindowExW);
    const entrySize = koffi.sizeof(ENTRY);
    const monitorInfoSize = koffi.sizeof(MONITORINFO);

    const buf = Buffer.alloc(1024);
    const pathBuf = Buffer.alloc(2048);
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
        const style = Number(GetWindowLongPtrW(h, GWL_STYLE));
        const r: Partial<Rect> = {};
        const mon = monitorOf(h);
        if (!mon || !GetWindowRect(h, r)) return { hwnd: id, fullscreen: false, monitor: mon ?? { left: 0, top: 0, right: 0, bottom: 0 } };
        // A maximized window fills its monitor too when the taskbar auto-hides (see front()).
        const full = !shell && !(style & WS_MAXIMIZE) && r.left! <= mon.left && r.top! <= mon.top && r.right! >= mon.right && r.bottom! >= mon.bottom;
        return { hwnd: id, fullscreen: full, monitor: mon };
      },
      coveredAbove(hwnd) {
        // Our overlay is always on top, so only other always-on-top windows can be above it.
        let h = GetTopWindow(0);
        for (let guard = 0; h && guard < 500; guard++, h = GetWindow(h, GW_HWNDNEXT)) {
          if (String(h) === hwnd) return false;
          if (!IsWindowVisible(h) || IsIconic(h)) continue;
          const ex = Number(GetWindowLongPtrW(h, GWL_EXSTYLE));
          if (!(ex & WS_EX_TOPMOST) || ex & WS_EX_TRANSPARENT || (ex & WS_EX_TOOLWINDOW && !(ex & WS_EX_APPWINDOW))) continue;
          if (ex & WS_EX_LAYERED && invisible(h)) continue;
          dwmBuf.fill(0);
          if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, dwmBuf, 4) === 0 && dwmBuf.readUInt32LE(0)) continue;
          if (SKIP_CLASSES.has(className(h))) continue;
          const r = rectOf(h);
          if (r && r.right - r.left > 60 && r.bottom - r.top > 40) return true;
        }
        return false;
      },
      busy() {
        const s = [0];
        if (SHQueryUserNotificationState(s) !== 0) return false;
        // 2 = full-screen app, 3 = Direct3D full-screen, 4 = presentation mode.
        return s[0] === 2 || s[0] === 3 || s[0] === 4;
      },
      processes(parents) {
        const out = new Map<number, string>();
        parents?.clear();
        const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (!snap || snap === -1) return out;
        try {
          const e = { dwSize: entrySize } as Record<string, unknown>;
          let ok = Process32FirstW(snap, e);
          for (let guard = 0; ok && guard < 10000; guard++) {
            out.set(e.th32ProcessID as number, String(e.szExeFile).toLowerCase());
            parents?.set(e.th32ProcessID as number, e.th32ParentProcessID as number);
            e.dwSize = entrySize;
            ok = Process32NextW(snap, e);
          }
        } finally {
          CloseHandle(snap);
        }
        return out;
      },
      front(exclude) {
        const h = GetForegroundWindow();
        if (!h || exclude.has(String(h))) return null;
        const cls = className(h);
        const style = Number(GetWindowLongPtrW(h, GWL_STYLE));
        const ex = Number(GetWindowLongPtrW(h, GWL_EXSTYLE));
        // A full-screen Store app's own window can be in front; the Start menu's has the same class,
        // so that one is told apart by its process instead.
        const shell = (SKIP_CLASSES.has(cls) && cls !== STORE_APP_CLASS) || (ex & WS_EX_TRANSPARENT) !== 0 || !!IsIconic(h);
        const inner = cls === 'ApplicationFrameWindow' ? FindWindowExW(h, 0, STORE_APP_CLASS, null) : 0;
        const pid = [0];
        GetWindowThreadProcessId(inner || h, pid);
        const r = rectOf(h);
        const m = monitorOf(h);
        let cover = 0;
        if (r && m && m.right > m.left && m.bottom > m.top) {
          const w = Math.min(r.right, m.right) - Math.max(r.left, m.left);
          const hgt = Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top);
          if (w > 0 && hgt > 0) cover = (w * hgt) / ((m.right - m.left) * (m.bottom - m.top));
        }
        // A maximized window also fills its monitor when the taskbar auto-hides; it keeps its title bar.
        const fullscreen = !shell && cover >= 0.999 && !(style & WS_MAXIMIZE) && (style & WS_CAPTION) !== WS_CAPTION;
        return { hwnd: String(h), pid: pid[0], cover, fullscreen, shell };
      },
      title(hwnd) {
        return text(GetWindowTextW, Number(hwnd));
      },
      processPath(pid) {
        const h = pid ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) : 0;
        if (!h) return '';
        try {
          const size = [pathBuf.length / 2];
          return QueryFullProcessImageNameW(h, 0, pathBuf, size) ? pathBuf.toString('utf16le', 0, size[0] * 2) : '';
        } finally {
          CloseHandle(h);
        }
      },
    };
  } catch (err) {
    return { ...NO_DESKTOP, error: (err as Error).message };
  }
}
