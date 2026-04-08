const { contextBridge, ipcRenderer } = require('electron')

const terminalDataListeners = new Set()
const terminalExitListeners = new Set()

ipcRenderer.on('zytrader:terminal:data', (_event, payload) => {
  for (const fn of terminalDataListeners) {
    try { fn(payload) } catch {}
  }
})

ipcRenderer.on('zytrader:terminal:exit', (_event, payload) => {
  for (const fn of terminalExitListeners) {
    try { fn(payload) } catch {}
  }
})

contextBridge.exposeInMainWorld('zytrader', {
  fs: {
    list: (dir = '.', opts = {}) => ipcRenderer.invoke('zytrader:fs:list', dir, opts),
    read: (filePath, opts = {}) => ipcRenderer.invoke('zytrader:fs:read', filePath, opts),
    write: (filePath, content, opts = {}) => ipcRenderer.invoke('zytrader:fs:write', filePath, content, opts),
    remove: (targetPath, opts = {}) => ipcRenderer.invoke('zytrader:fs:delete', targetPath, opts),
  },
  terminal: {
    exec: (command, cwd = '.', cwdScope = 'workspace') =>
      ipcRenderer.invoke('zytrader:terminal:exec', command, cwd, cwdScope),
    create: (payload) => ipcRenderer.invoke('zytrader:terminal:create', payload),
    write: (payload) => ipcRenderer.invoke('zytrader:terminal:write', payload),
    resize: (payload) => ipcRenderer.invoke('zytrader:terminal:resize', payload),
    kill: (payload) => ipcRenderer.invoke('zytrader:terminal:kill', payload),
    onData: (callback) => {
      if (typeof callback !== 'function') return () => {}
      terminalDataListeners.add(callback)
      return () => terminalDataListeners.delete(callback)
    },
    onExit: (callback) => {
      if (typeof callback !== 'function') return () => {}
      terminalExitListeners.add(callback)
      return () => terminalExitListeners.delete(callback)
    },
  },
  model: {
    test: (payload) => ipcRenderer.invoke('zytrader:model:test', payload),
  },
  workspace: {
    info: () => ipcRenderer.invoke('zytrader:workspace:info'),
    setRoot: (dir) => ipcRenderer.invoke('zytrader:workspace:setRoot', dir),
    pickRoot: () => ipcRenderer.invoke('zytrader:workspace:pickRoot'),
  },
  vault: {
    bootstrap: () => ipcRenderer.invoke('zytrader:vault:bootstrap'),
    resolve: (key) => ipcRenderer.invoke('zytrader:vault:resolve', key),
    setConfig: (partial) => ipcRenderer.invoke('zytrader:vault:setConfig', partial),
  },
  host: {
    openPath: (targetPath, opts = {}) => ipcRenderer.invoke('zytrader:host:openPath', targetPath, opts),
  },
})

window.addEventListener('DOMContentLoaded', () => {
  console.log('ZyTrader Desktop 已启动')
})
