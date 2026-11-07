/* ===========================================================================
 * Win32 helpers for the Electron main process (koffi FFI).
 *
 *  - Raw Input sink: tells REAL hardware input apart from synthetic input.
 *    Input injected with SendInput (MYRAA's own automation) arrives with a
 *    NULL device handle; physical mice/keyboards carry a real one. The backend
 *    uses this to pause automation instead of fighting the user for the mouse.
 *  - Top-level window rectangles, for anchoring the companion to windows.
 *
 * Everything degrades to a no-op off Windows or if koffi fails to load.
 * ========================================================================= */
'use strict';

let api = null;
try {
  if (process.platform === 'win32') {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const RECT = koffi.struct('MYRAA_E_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const RAWINPUTDEVICE = koffi.struct('MYRAA_RAWINPUTDEVICE', {
      usUsagePage: 'uint16',
      usUsage: 'uint16',
      dwFlags: 'uint32',
      hwndTarget: 'intptr_t',
    });
    const enumProto = koffi.proto('bool __stdcall MYRAA_E_EnumProc(intptr_t hwnd, intptr_t lParam)');
    api = {
      koffi,
      RECT,
      enumProto,
      RegisterRawInputDevices: user32.func('bool __stdcall RegisterRawInputDevices(MYRAA_RAWINPUTDEVICE *devices, uint32 count, uint32 size)'),
      GetRawInputData: user32.func('uint32 __stdcall GetRawInputData(intptr_t hRaw, uint32 cmd, _Out_ uint8_t *data, _Inout_ uint32 *size, uint32 headerSize)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(MYRAA_E_EnumProc *cb, intptr_t lParam)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint8_t *buf, int max)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ MYRAA_E_RECT *rect)'),
      DwmGetWindowAttribute: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ MYRAA_E_RECT *value, uint32 size)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint8_t *buf, int max)'),
      DwmGetCloaked: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
      SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
      mouse_event: user32.func('void __stdcall mouse_event(uint32 flags, uint32 dx, uint32 dy, uint32 data, uintptr_t extraInfo)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8_t key, uint8_t scan, uint32 flags, uintptr_t extraInfo)'),
    };
  }
} catch (error) {
  console.warn('[win32] native helpers unavailable:', error && error.message);
  api = null;
}

function hwndOf(win) {
  const handle = win.getNativeWindowHandle();
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
}

/**
 * Register a raw-input sink on `win` and call `onInput({kind, physical, dx, dy})`
 * for every mouse/keyboard event. Returns a disposer.
 */
function startRawInput(win, onInput) {
  if (!api) return () => undefined;
  const hwnd = hwndOf(win);
  const RIDEV_INPUTSINK = 0x00000100;
  const devices = [
    { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }, // mouse
    { usUsagePage: 0x01, usUsage: 0x06, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }, // keyboard
  ];
  if (!api.RegisterRawInputDevices(devices, devices.length, api.koffi.sizeof('MYRAA_RAWINPUTDEVICE'))) {
    console.warn('[win32] RegisterRawInputDevices failed');
    return () => undefined;
  }
  const RID_INPUT = 0x10000003;
  const headerSize = process.arch === 'x64' || process.arch === 'arm64' ? 24 : 16;
  const buffer = Buffer.alloc(96);
  const WM_INPUT = 0x00ff;
  win.hookWindowMessage(WM_INPUT, (_wParam, lParam) => {
    try {
      const hRaw = lParam.length >= 8 ? Number(lParam.readBigUInt64LE(0)) : lParam.readUInt32LE(0);
      const size = [buffer.length];
      const got = api.GetRawInputData(hRaw, RID_INPUT, buffer, size, headerSize);
      if (got === 0xffffffff || got < headerSize) return;
      const type = buffer.readUInt32LE(0); // 0 mouse, 1 keyboard
      const device = headerSize === 24 ? buffer.readBigUInt64LE(8) : BigInt(buffer.readUInt32LE(8));
      const physical = device !== 0n;
      if (type === 0) {
        const dx = buffer.readInt32LE(headerSize + 12);
        const dy = buffer.readInt32LE(headerSize + 16);
        onInput({ kind: 'mouse', physical, dx, dy });
      } else if (type === 1) {
        onInput({ kind: 'keyboard', physical, dx: 0, dy: 0 });
      }
    } catch {
      /* never break the window's message loop */
    }
  });
  return () => {
    try {
      win.unhookWindowMessage(WM_INPUT);
      const RIDEV_REMOVE = 0x00000001;
      api.RegisterRawInputDevices(devices.map((d) => ({ ...d, dwFlags: RIDEV_REMOVE, hwndTarget: 0 })), devices.length, api.koffi.sizeof('MYRAA_RAWINPUTDEVICE'));
    } catch {
      /* ignore */
    }
  };
}

/**
 * Shell surfaces that are not app windows: the desktop itself (Progman /
 * WorkerW cover the whole screen and would hide every icon and ledge), the
 * taskbars and the Start/notification hosts.
 */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'XamlExplorerHostIslandWindow']);

/** Visible, non-minimised, uncloaked top-level app windows with titles (physical pixels), in z-order. */
function listWindows() {
  if (!api) return [];
  const out = [];
  const textBuf = Buffer.alloc(512);
  const classBuf = Buffer.alloc(512);
  const cloaked = [0];
  const cb = api.koffi.register((hwnd) => {
    try {
      if (!api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return true;
      const len = api.GetWindowTextW(hwnd, textBuf, 255);
      if (len <= 0) return true;
      const classLen = api.GetClassNameW(hwnd, classBuf, 255);
      if (classLen > 0 && SHELL_CLASSES.has(classBuf.subarray(0, classLen * 2).toString('utf16le'))) return true;
      // Suspended Store apps keep "visible" but cloaked windows nobody can see.
      cloaked[0] = 0;
      if (api.DwmGetCloaked(hwnd, 14, cloaked, 4) === 0 && cloaked[0] !== 0) return true;
      // Skip tool windows (tooltips, overlays).
      const exStyle = Number(api.GetWindowLongPtrW(hwnd, -20));
      if (exStyle & 0x00000080) return true;
      const rect = {};
      if (api.DwmGetWindowAttribute(hwnd, 9, rect, 16) !== 0) api.GetWindowRect(hwnd, rect);
      const pid = [0];
      api.GetWindowThreadProcessId(hwnd, pid);
      if (rect.right - rect.left < 120 || rect.bottom - rect.top < 60) return true;
      out.push({ hwnd: Number(hwnd), pid: pid[0], title: textBuf.subarray(0, len * 2).toString('utf16le'), rect });
    } catch {
      /* keep enumerating */
    }
    return true;
  }, api.koffi.pointer(api.enumProto));
  try {
    api.EnumWindows(cb, 0);
  } finally {
    api.koffi.unregister(cb);
  }
  return out;
}

/**
 * One window's visible frame (physical pixels), or null when it is gone,
 * hidden or minimised. Cheap enough to poll every frame (riding along).
 */
function windowRect(hwnd) {
  if (!api || !hwnd) return null;
  try {
    if (!api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return null;
    const rect = {};
    if (api.DwmGetWindowAttribute(hwnd, 9, rect, 16) !== 0 && !api.GetWindowRect(hwnd, rect)) return null;
    return rect;
  } catch {
    return null;
  }
}

function virtualDesktopBounds() {
  if (!api) return null;
  const left = api.GetSystemMetrics(76);
  const top = api.GetSystemMetrics(77);
  const width = api.GetSystemMetrics(78);
  const height = api.GetSystemMetrics(79);
  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

function moveCursorNormalized(x, y) {
  if (!api || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const bounds = virtualDesktopBounds();
  if (!bounds) return false;
  const px = bounds.left + Math.round(Math.max(0, Math.min(1, x)) * (bounds.width - 1));
  const py = bounds.top + Math.round(Math.max(0, Math.min(1, y)) * (bounds.height - 1));
  return !!api.SetCursorPos(px, py);
}

function setLeftButton(down) {
  if (!api) return false;
  api.mouse_event(down ? 0x0002 : 0x0004, 0, 0, 0, 0);
  return true;
}

function zoomAtCursor(scaleDelta) {
  if (!api || !Number.isFinite(scaleDelta)) return false;
  const delta = Math.max(-240, Math.min(240, Math.round(scaleDelta * 4800)));
  if (!delta) return false;
  const KEYEVENTF_KEYUP = 0x0002;
  const VK_CONTROL = 0x11;
  api.keybd_event(VK_CONTROL, 0, 0, 0);
  try {
    api.mouse_event(0x0800, 0, 0, delta >>> 0, 0);
  } finally {
    api.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
  }
  return true;
}

module.exports = {
  available: () => !!api,
  startRawInput,
  listWindows,
  windowRect,
  hwndOf,
  virtualDesktopBounds,
  moveCursorNormalized,
  setLeftButton,
  zoomAtCursor,
};
