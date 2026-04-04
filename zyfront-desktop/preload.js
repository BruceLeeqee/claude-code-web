const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zytrader', {
  fs: {
    list: (dir = '.') => ipcRenderer.invoke('zytrader:fs:list', dir),
    read: (filePath) => ipcRenderer.invoke('zytrader:fs:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('zytrader:fs:write', filePath, content),
    remove: (targetPath) => ipcRenderer.invoke('zytrader:fs:delete', targetPath),
  },
  terminal: {
    exec: (command, cwd = '.') => ipcRenderer.invoke('zytrader:terminal:exec', command, cwd),
  },
  model: {
    test: (payload) => ipcRenderer.invoke('zytrader:model:test', payload),
  },
  workspace: {
    info: () => ipcRenderer.invoke('zytrader:workspace:info'),
  },
})

window.addEventListener('DOMContentLoaded', () => {
  console.log('ZyTrader Desktop 已启动')
})
