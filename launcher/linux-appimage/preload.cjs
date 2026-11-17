'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ocarinaAtlas', {
  getInitialState: () => ipcRenderer.invoke('launcher:get-state'),
  startServer: () => ipcRenderer.invoke('launcher:start-server'),
  stopServer: () => ipcRenderer.invoke('launcher:stop-server'),
  openMap: () => ipcRenderer.invoke('launcher:open-map'),
  openExternal: (url) => ipcRenderer.invoke('launcher:open-external', url),
  copyText: (text) => ipcRenderer.invoke('launcher:copy-text', text),
  setupSync: () => ipcRenderer.invoke('launcher:setup-sync'),
  refreshLan: () => ipcRenderer.invoke('launcher:refresh-lan'),
  toggleLanMode: (enabled) => ipcRenderer.invoke('launcher:toggle-lan', enabled),
  updateSettings: (patch) => ipcRenderer.invoke('launcher:update-settings', patch),
  resetRpcDefaults: () => ipcRenderer.invoke('launcher:reset-rpc-defaults'),
  checkUpdates: () => ipcRenderer.invoke('launcher:check-updates'),
  clearLogs: () => ipcRenderer.invoke('launcher:clear-logs'),
  setDrawerOpen: (open) => ipcRenderer.invoke('launcher:set-drawer-open', open),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('launcher:state', listener)
    return () => ipcRenderer.removeListener('launcher:state', listener)
  },
  onLog: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, entry) => callback(entry)
    ipcRenderer.on('launcher:log', listener)
    return () => ipcRenderer.removeListener('launcher:log', listener)
  },
})
