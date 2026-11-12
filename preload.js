'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  toggleFullScreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  pathFor: (file) => webUtils.getPathForFile(file),
  readAudio: (filePath) => ipcRenderer.invoke('audio:read', filePath),

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
