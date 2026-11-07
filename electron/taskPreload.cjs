'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskOverlayApi', {
  controlTask: (taskId, action) => ipcRenderer.invoke('task:action', { taskId, action }),
  close: () => ipcRenderer.invoke('taskOverlay:close'),
  minimize: () => ipcRenderer.invoke('taskOverlay:minimize'),
  onTaskTelemetry: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('task:telemetry', listener);
    return () => ipcRenderer.removeListener('task:telemetry', listener);
  },
});

