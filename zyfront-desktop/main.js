// @ts-nocheck
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const { existsSync } = require('fs')
const { exec } = require('child_process')

let win

const workspaceRoot = process.env.ZYTRADER_WORKSPACE
  ? path.resolve(process.env.ZYTRADER_WORKSPACE)
  : path.resolve(__dirname, '..')

function resolveSafePath(relativePath = '.') {
  const target = path.resolve(workspaceRoot, relativePath)
  if (!target.startsWith(workspaceRoot)) {
    throw new Error('Path escapes workspace root')
  }
  return target
}

function registerIpcHandlers() {
  ipcMain.handle('zytrader:fs:list', async (_event, dir = '.') => {
    const abs = resolveSafePath(dir)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    return {
      ok: true,
      dir,
      entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
    }
  })

  ipcMain.handle('zytrader:fs:read', async (_event, filePath) => {
    const abs = resolveSafePath(filePath)
    const content = await fs.readFile(abs, 'utf8')
    return { ok: true, path: filePath, content }
  })

  ipcMain.handle('zytrader:fs:write', async (_event, filePath, content) => {
    const abs = resolveSafePath(filePath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content ?? '', 'utf8')
    return { ok: true, path: filePath }
  })

  ipcMain.handle('zytrader:fs:delete', async (_event, targetPath) => {
    const abs = resolveSafePath(targetPath)
    await fs.rm(abs, { recursive: true, force: true })
    return { ok: true, path: targetPath }
  })

  ipcMain.handle('zytrader:terminal:exec', async (_event, command, cwd = '.') => {
    const absCwd = resolveSafePath(cwd)
    return await new Promise((resolve) => {
      exec(command, { cwd: absCwd, windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : 0
        resolve({ ok: !error, command, cwd, code, stdout: stdout ?? '', stderr: stderr ?? '' })
      })
    })
  })

  ipcMain.handle('zytrader:model:test', async (_event, payload) => {
    const { baseUrl, apiKey, model, provider } = payload || {}
    if (!baseUrl || !apiKey || !model) {
      return { ok: false, status: 400, body: 'baseUrl/apiKey/model required' }
    }

    const url = String(baseUrl).replace(/\/$/, '') + '/v1/messages'
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          messages: [{ role: 'user', content: `ping from ${provider ?? 'custom'}` }],
        }),
      })
      const body = await resp.text()
      return { ok: resp.ok, status: resp.status, body: body.slice(0, 1000) }
    } catch (e) {
      return { ok: false, status: 500, body: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('zytrader:workspace:info', async () => ({
    ok: true,
    root: workspaceRoot,
    exists: existsSync(workspaceRoot),
  }))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'ZyTrader Desktop',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:4200')
  } else {
    win.loadFile(path.join(__dirname, 'dist/zyfront-desktop-web/browser/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
