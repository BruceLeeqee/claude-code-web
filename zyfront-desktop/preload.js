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
    list: (dir = '.') => ipcRenderer.invoke('zytrader:fs:list', dir),
    read: (filePath) => ipcRenderer.invoke('zytrader:fs:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('zytrader:fs:write', filePath, content),
    remove: (targetPath) => ipcRenderer.invoke('zytrader:fs:delete', targetPath),
  },
  terminal: {
    exec: (command, cwd = '.') => ipcRenderer.invoke('zytrader:terminal:exec', command, cwd),
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
  },
  host: {
    openPath: (targetPath) => ipcRenderer.invoke('zytrader:host:openPath', targetPath),
  },
})

window.addEventListener('DOMContentLoaded', () => {
  console.log('ZyTrader Desktop 已启动')
})
