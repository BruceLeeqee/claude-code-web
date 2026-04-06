// @ts-nocheck
const electronModule = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const { existsSync } = require('fs')
const { exec, spawn } = require('child_process')
const pty = require('node-pty')

if (typeof electronModule === 'string') {
  const relaunchEnv = { ...process.env }
  delete relaunchEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronModule, [path.resolve(__dirname, 'main.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: relaunchEnv,
    windowsHide: false,
  })
  child.on('close', (code) => process.exit(code ?? 0))
  child.on('error', (err) => {
    console.error('[bootstrap] Failed to relaunch with Electron:', err)
    process.exit(1)
  })
  // In plain Node runtime, stop executing the rest of this file.
  process.exit(0)
}

if (!electronModule?.app || typeof electronModule.app.whenReady !== 'function') {
  console.error(
    '[zyfront-desktop] require("electron") did not expose app (main process API missing).\n' +
      'Use: npm run electron:dev  or  npx electron .   (do not run: node main.js without Electron)\n' +
      'If ELECTRON_RUN_AS_NODE is set in your environment, clear it for this app or rely on the bootstrap relaunch.'
  )
  process.exit(1)
}

const { app, BrowserWindow, ipcMain, shell } = electronModule

let win

const workspaceRoot = process.env.ZYTRADER_WORKSPACE
  ? path.resolve(process.env.ZYTRADER_WORKSPACE)
  : path.resolve(__dirname, '..')

const ptySessions = new Map()

function resolveSafePath(relativePath = '.') {
  const target = path.resolve(workspaceRoot, relativePath)
  if (!target.startsWith(workspaceRoot)) {
    throw new Error('Path escapes workspace root')
  }
  return target
}

/** 供 shell.openPath：工作区相对路径，或用户主目录/工作区下的绝对路径 */
function resolveHostOpenPath(inputPath) {
  const raw = String(inputPath ?? '').trim()
  if (!raw) throw new Error('path is required')
  if (path.isAbsolute(raw)) {
    const abs = path.normalize(raw)
    const home = path.normalize(os.homedir())
    const wr = path.normalize(workspaceRoot)
    const under =
      process.platform === 'win32'
        ? abs.toLowerCase().startsWith(wr.toLowerCase()) || abs.toLowerCase().startsWith(home.toLowerCase())
        : abs.startsWith(wr) || abs.startsWith(home)
    if (under) return abs
    throw new Error('absolute path must be under workspace or user home directory')
  }
  return resolveSafePath(raw)
}

function emitTerminalData(payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('zytrader:terminal:data', payload)
}

function emitTerminalExit(payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('zytrader:terminal:exit', payload)
}

function resolveWinShell(shell) {
  const normalized = String(shell || 'powershell').toLowerCase()

  if (normalized === 'powershell') {
    return { cmd: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'] }
  }

  if (normalized === 'cmd') {
    return { cmd: 'cmd.exe', args: [] }
  }

  // 如显式选择 git-bash，再按候选路径查找
  const gitBashCandidates = [
    process.env.GIT_BASH_PATH,
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/usr/bin/bash.exe',
  ].filter(Boolean)

  for (const p of gitBashCandidates) {
    if (existsSync(p)) {
      return { cmd: p, args: ['--login', '-i'] }
    }
  }

  // Git Bash 不可用时回退到 PowerShell
  return { cmd: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] }
}

function resolveShellCommand(shell) {
  if (process.platform === 'win32') {
    return resolveWinShell(shell)
  }

  const normalized = String(shell || '').toLowerCase()
  if (normalized === 'zsh') return { cmd: 'zsh', args: ['-i'] }
  if (normalized === 'bash') return { cmd: 'bash', args: ['-i'] }
  return { cmd: process.env.SHELL || 'bash', args: ['-i'] }
}

function createPtySession({ id, cwd = '.', cols = 120, rows = 36, shell = 'powershell' }) {
  const absCwd = resolveSafePath(cwd)
  const { cmd, args } = resolveShellCommand(shell)

  const proc = pty.spawn(cmd, args, {
    name: 'xterm-256color',
    cols: Math.max(40, Number(cols) || 120),
    rows: Math.max(12, Number(rows) || 36),
    cwd: absCwd,
    env: process.env,
  })

  proc.onData((data) => {
    emitTerminalData({ id, data })
  })

  proc.onExit((ev) => {
    ptySessions.delete(id)
    emitTerminalExit({ id, exitCode: ev.exitCode, signal: ev.signal })
  })

  ptySessions.set(id, proc)
  return { ok: true, id }
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
    const execOptions = {
      cwd: absCwd,
      windowsHide: true,
      timeout: 120000,
      ...(process.platform === 'win32' ? { shell: 'powershell.exe' } : {}),
    }
    return await new Promise((resolve) => {
      exec(command, execOptions, (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : 0
        resolve({ ok: !error, command, cwd, code, stdout: stdout ?? '', stderr: stderr ?? '' })
      })
    })
  })

  ipcMain.handle('zytrader:terminal:create', async (_event, payload) => {
    const id = String(payload?.id || '')
    if (!id) return { ok: false, error: 'id required' }
    const existing = ptySessions.get(id)
    if (existing) {
      try { existing.kill() } catch {}
      ptySessions.delete(id)
    }

    try {
      return createPtySession(payload)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:terminal:write', async (_event, payload) => {
    const id = String(payload?.id || '')
    const data = String(payload?.data || '')
    const proc = ptySessions.get(id)
    if (!proc) return { ok: false, error: 'session not found' }
    proc.write(data)
    return { ok: true }
  })

  ipcMain.handle('zytrader:terminal:resize', async (_event, payload) => {
    const id = String(payload?.id || '')
    const cols = Math.max(40, Number(payload?.cols) || 120)
    const rows = Math.max(12, Number(payload?.rows) || 36)
    const proc = ptySessions.get(id)
    if (!proc) return { ok: false, error: 'session not found' }
    proc.resize(cols, rows)
    return { ok: true }
  })

  ipcMain.handle('zytrader:terminal:kill', async (_event, payload) => {
    const id = String(payload?.id || '')
    const proc = ptySessions.get(id)
    if (!proc) return { ok: false, error: 'session not found' }
    try { proc.kill() } catch {}
    ptySessions.delete(id)
    return { ok: true }
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

  ipcMain.handle('zytrader:host:openPath', async (_event, inputPath) => {
    try {
      const abs = resolveHostOpenPath(inputPath)
      const err = await shell.openPath(abs)
      return { ok: !err, path: abs, error: err || undefined }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
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
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32'
      ? {
          color: '#2f2f2f',
          symbolColor: '#d4d4d4',
          height: 32,
        }
      : false,
    backgroundColor: '#1e1e1e',
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

app.on('window-all-closed', () => {
  for (const [, proc] of ptySessions) {
    try { proc.kill() } catch {}
  }
  ptySessions.clear()
  app.quit()
})
