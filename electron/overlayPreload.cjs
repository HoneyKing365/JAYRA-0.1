'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  resolve: (id, approved) => ipcRenderer.invoke('confirmation:resolve', { id, approved }),
  close: () => ipcRenderer.invoke('confirmation:close'),
  onData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('confirmation:data', listener);
    return () => ipcRenderer.removeListener('confirmation:data', listener);
  },
});

