/* ===========================================================================
 * MYRAA — Electron preload
 * ---------------------------------------------------------------------------
 * Runs in an isolated context and exposes a minimal, explicit API surface to
 * the renderer via contextBridge. Only serializable metadata may cross this
 * boundary. Live MediaStream objects stay in the renderer and are supplied by
 * Electron's main-process display-media request handler.
 * ========================================================================= */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Get the list of capturable desktop sources (entire screen + individual
 * windows) from the main process. Returns an array of
 * `{ id, name, thumbnail, display_id, appIcon }` where `thumbnail` is a
 * data-URL string suitable for a preview UI.
 */
async function getDesktopCaptureSources() {
  try {
    const sources = await ipcRenderer.invoke('screen:get-sources');
    return Array.isArray(sources) ? sources : [];
  } catch (err) {
    console.error('[MYRAA preload] getDesktopCaptureSources failed:', err);
    return [];
  }
}

contextBridge.exposeInMainWorld('myraa', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  // Serializable source metadata only; MediaStreams cannot cross this bridge.
  getDesktopCaptureSources,
  /** Native file picker for character import; returns an absolute path or null. */
  pickCharacterSource: () => ipcRenderer.invoke('dialog:pick-character'),
  /** Native file picker for a supported custom companion asset. */
  pickCustomAsset: (category) => ipcRenderer.invoke('dialog:pick-custom-asset', category),
  /** Main window: open the Character Studio when asked from the tray/companion. */
  onOpenStudio: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-studio', listener);
    return () => ipcRenderer.removeListener('app:open-studio', listener);
  },
  onToggleChat: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:toggle-chat', listener);
    return () => ipcRenderer.removeListener('app:toggle-chat', listener);
  },
  onOpenDailySummary: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-daily-summary', listener);
    return () => ipcRenderer.removeListener('app:open-daily-summary', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-settings', listener);
    return () => ipcRenderer.removeListener('app:open-settings', listener);
  },
  onSetViewMode: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('app:set-view-mode', listener);
    return () => ipcRenderer.removeListener('app:set-view-mode', listener);
  },
  setViewMode: (mode) => ipcRenderer.send('app:set-view-mode', mode),
  /** Move/click/zoom the native desktop cursor while Air Mouse is enabled. */
  gestureInput: (action, x, y, scaleDelta) => ipcRenderer.send('gesture:input', {
    action,
    x: Number(x),
    y: Number(y),
    scaleDelta: Number(scaleDelta),
  }),
  hideMainWindow: () => ipcRenderer.send('app:hide-main'),
  moveCompanion: (direction, distance) => ipcRenderer.invoke('companion:move', direction, distance),
  /** Desktop companion window bridge (only meaningful in that window). */
  companion: {
    setInteractive: (value) => ipcRenderer.send('companion:interactive', Boolean(value)),
    dragStart: () => ipcRenderer.send('companion:drag-start'),
    dragEnd: () => ipcRenderer.send('companion:drag-end'),
    poke: (kind) => ipcRenderer.send('companion:poke', kind === 'head_pat' ? 'head_pat' : 'poke'),
    seat: (offsetPx) => ipcRenderer.send('companion:seat', Number(offsetPx) || 0),
    /** Canvas row she rests on (floor or seat line) and how long to ease there. */
    contact: (y, durationMs) => ipcRenderer.send('companion:contact', Number(y) || 0, Number(durationMs) || 0),
    metrics: (metrics) => ipcRenderer.send('companion:metrics', {
      walkSpeed: Number(metrics?.walkSpeed) || 0,
      heightPx: Number(metrics?.heightPx) || 0,
      halfWidthPx: Number(metrics?.halfWidthPx) || 0,
      floorY: Number(metrics?.floorY) || 0,
      handX: Number.isFinite(Number(metrics?.handX)) ? Number(metrics.handX) : null,
      handY: Number.isFinite(Number(metrics?.handY)) ? Number(metrics.handY) : null,
      headX: Number.isFinite(Number(metrics?.headX)) ? Number(metrics.headX) : null,
    }),
    done: (act) => ipcRenderer.send('companion:done', String(act || '')),
    /** She was spoken to: come out if hiding. */
    summon: () => ipcRenderer.send('companion:summon'),
    contextMenu: () => ipcRenderer.send('companion:context-menu'),
    on: (channel, callback) => {
      const allowed = ['companion:moved', 'companion:cursor', 'companion:command', 'companion:state'];
      if (!allowed.includes(channel)) return () => undefined;
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
});
