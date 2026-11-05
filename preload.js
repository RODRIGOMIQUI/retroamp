'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setSize: (width, height) => ipcRenderer.send('window:set-size', width, height),
  pathFor: (file) => webUtils.getPathForFile(file),

  tags: {
    write: (filePath, data) => ipcRenderer.invoke('tags:write', filePath, data),
  },

  library: {
    getConfig: () => ipcRenderer.invoke('library:get-config'),
    setJamendoKey: (key) => ipcRenderer.invoke('library:set-jamendo-key', key),
    chooseDir: () => ipcRenderer.invoke('library:choose-dir'),
    openDir: () => ipcRenderer.invoke('library:open-dir'),
    search: (source, song, band) => ipcRenderer.invoke('library:search', source, song, band),
    download: (item) => ipcRenderer.invoke('library:download', item),
    cancel: (jobId) => ipcRenderer.invoke('library:cancel', jobId),
    openExternal: (url) => ipcRenderer.invoke('library:open-external', url),
    onProgress: (cb) => ipcRenderer.on('download:progress', (_e, data) => cb(data)),
  },
});
