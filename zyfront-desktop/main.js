// @ts-nocheck
const electronModule = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const { existsSync, readFileSync, mkdirSync } = require('fs')
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

const { app, BrowserWindow, ipcMain, shell, dialog } = electronModule

let win
let computerWin

// Fix "Unable to move/create cache: Access denied (0x5)" on some Windows environments by
// forcing Chromium cache directories into Electron's writable userData.
try {
  const cacheRoot = path.join(app.getPath('userData'), 'chromium-cache')
  mkdirSync(cacheRoot, { recursive: true })
  mkdirSync(path.join(cacheRoot, 'disk'), { recursive: true })
  mkdirSync(path.join(cacheRoot, 'gpu'), { recursive: true })
  app.commandLine.appendSwitch('disk-cache-dir', path.join(cacheRoot, 'disk'))
  app.commandLine.appendSwitch('gpu-cache-dir', path.join(cacheRoot, 'gpu'))
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
} catch (e) {
  // If this fails we still allow app startup; computer.use may degrade.
}

/** @type {{ workspaceRoot: string, vaultRoot: string, vaultMode: string, projectKey: string, workspaceFromEnv: boolean, vaultConfigured: boolean }} */
const RUNTIME = {
  workspaceRoot: '',
  vaultRoot: '',
  vaultMode: 'nested',
  projectKey: '',
  workspaceFromEnv: false,
  vaultConfigured: false,
}

const APP_CONFIG_FILENAME = 'zytrader-workspace.json'

const DEFAULT_DIRECTORY_CONFIG = {
  version: 1,
  keys: {
    inbox: '00-INBOX',
    'inbox-human': '00-INBOX/human',
    'inbox-agent': '00-INBOX/agent',
    'human-notes': '01-HUMAN-NOTES',
    'agent-memory': '02-AGENT-MEMORY',
    'agent-short-term': '02-AGENT-MEMORY/01-Short-Term',
    'agent-long-term': '02-AGENT-MEMORY/02-Long-Term',
    'agent-context': '02-AGENT-MEMORY/03-Context',
    'agent-meta': '02-AGENT-MEMORY/04-Meta',
    projects: '03-PROJECTS',
    resources: '04-RESOURCES',
    system: '05-SYSTEM',
  },
}

const VAULT_SUBDIRS = [
  path.join('00-INBOX', 'human'),
  path.join('00-INBOX', 'agent'),
  path.join('01-HUMAN-NOTES', '01-Daily'),
  path.join('01-HUMAN-NOTES', '02-Knowledge'),
  path.join('01-HUMAN-NOTES', '03-Notes'),
  path.join('01-HUMAN-NOTES', '04-Tags'),
  path.join('02-AGENT-MEMORY', '01-Short-Term'),
  path.join('02-AGENT-MEMORY', '02-Long-Term'),
  path.join('02-AGENT-MEMORY', '03-Context'),
  path.join('02-AGENT-MEMORY', '04-Meta'),
  '03-PROJECTS',
  path.join('04-RESOURCES', 'images'),
  path.join('04-RESOURCES', 'files'),
  path.join('04-RESOURCES', 'media'),
  path.join('04-RESOURCES', 'templates'),
  '05-SYSTEM',
]

const VAULT_README_CONTENT = `Obsidian-Agent-Vault/  # 根目录（可自定义路径）
├── 00-INBOX/          # 临时收纳（人类随手记、Agent临时记忆、未分类文件）
│   ├── human/         # 人类临时笔记
│   └── agent/         # Agent临时记忆（短期上下文、未归档记忆）
├── 01-HUMAN-NOTES/    # 人类正式笔记（对应Obsidian原生笔记）
│   ├── 01-Daily/      # 日记（按日期归档）
│   ├── 02-Knowledge/  # 知识笔记（按领域分类，支持双链）
│   ├── 03-Notes/      # 普通笔记（随手整理的内容）
│   └── 04-Tags/       # 标签归档（按标签聚合，可选）
├── 02-AGENT-MEMORY/   # Claude Code Agent记忆（核心目录，标准化存储）
│   ├── 01-Short-Term/ # 短期记忆（会话上下文、临时决策，定期清理）
│   ├── 02-Long-Term/  # 长期记忆（核心知识、固定规则、用户偏好，持久化）
│   ├── 03-Context/    # 上下文记忆（与用户交互的历史上下文，关联笔记）
│   └── 04-Meta/       # 记忆元数据（记忆更新日志、关联映射表）
├── 03-PROJECTS/       # 项目管理（人类+Agent协同项目）
│   ├── 项目1/         # 单个项目目录
│   │   ├── notes/     # 项目相关人类笔记
│   │   ├── memory/    # 项目相关Agent记忆（项目专属规则、进度记忆）
│   │   └── resources/ # 项目相关资源
│   └── 项目2/
├── 04-RESOURCES/      # 通用资源（所有模块共享）
│   ├── images/        # 图片（笔记插图、Agent生成图片）
│   ├── files/         # 附件（PDF、文档、压缩包）
│   ├── media/         # 媒体（音频、视频）
│   └── templates/     # 模板（人类笔记模板、Agent记忆模板）
└── 05-SYSTEM/         # 系统配置（目录规则、Agent记忆规则、解析配置）
    ├── directory.config.json # 目录配置（可自定义目录映射）
    ├── rule.config.json      # 文件处理规则配置
    └── agent.config.json     # Agent记忆配置`

function normalizeRelPath(p = '') {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function shouldProtectVaultPath(relativePath) {
  const rel = normalizeRelPath(relativePath)
  if (!rel) return false
  if (rel === 'README.md') return true
  const parts = rel.split('/').filter(Boolean)
  if (parts.length <= 2) return true
  return false
}

function getAppConfigPath() {
  return path.join(app.getPath('userData'), APP_CONFIG_FILENAME)
}

function getDefaultAppConfig() {
  return {
    version: 1,
    workspaceRoot: '',
    vault: {
      mode: 'nested',
      // 默认不在项目目录下再套一层 AGENT-ROOT，按工作区位置自动推断
      nestedRelative: '',
      globalRoot: '',
      projectKey: '',
    },
  }
}

function sanitizeProjectKey(name) {
  const s = String(name || 'project')
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return s || 'project'
}

async function readAppConfigFile() {
  const fp = getAppConfigPath()
  try {
    const raw = await fs.readFile(fp, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...getDefaultAppConfig(), ...parsed, vault: { ...getDefaultAppConfig().vault, ...(parsed.vault || {}) } }
  } catch {
    return getDefaultAppConfig()
  }
}

async function writeAppConfigFile(cfg) {
  const fp = getAppConfigPath()
  await fs.mkdir(path.dirname(fp), { recursive: true })
  await fs.writeFile(fp, JSON.stringify(cfg, null, 2), 'utf8')
}

function computeWorkspaceRoot(cfg) {
  const persisted = cfg.workspaceRoot && String(cfg.workspaceRoot).trim()
  if (persisted) {
    const abs = path.resolve(persisted)
    if (existsSync(abs)) {
      return { root: abs, fromEnv: false }
    }
  }
  if (process.env.ZYTRADER_WORKSPACE) {
    return { root: path.resolve(process.env.ZYTRADER_WORKSPACE), fromEnv: true }
  }
  return { root: path.resolve(__dirname, '..'), fromEnv: false }
}

function readWorkspaceLocalVaultRoot(workspaceRoot) {
  const localCfgPath = path.join(workspaceRoot, '.zytrader', 'local.config.json')
  if (!existsSync(localCfgPath)) return ''
  try {
    const raw = readFileSync(localCfgPath, 'utf8')
    const parsed = JSON.parse(raw)
    const v1 = parsed?.vaultRoot
    const v2 = parsed?.vault?.root
    const picked = typeof v1 === 'string' && v1.trim() ? v1 : typeof v2 === 'string' && v2.trim() ? v2 : ''
    return picked ? path.resolve(String(picked).trim()) : ''
  } catch {
    return ''
  }
}

function computeVaultRoot(workspaceRoot, vaultCfg) {
  const mode = vaultCfg?.mode === 'global' ? 'global' : 'nested'
  const nestedRelRaw = vaultCfg?.nestedRelative !== undefined ? String(vaultCfg.nestedRelative).trim() : ''
  const nestedRel = nestedRelRaw.replace(/\\/g, '/')

  let pk =
    vaultCfg?.projectKey !== undefined && String(vaultCfg.projectKey).trim() !== ''
      ? sanitizeProjectKey(vaultCfg.projectKey)
      : sanitizeProjectKey(path.basename(workspaceRoot))

  if (mode === 'global') {
    const gr = vaultCfg?.globalRoot && String(vaultCfg.globalRoot).trim()
    if (gr) {
      return { vaultRoot: path.resolve(gr), mode: 'global', projectKey: pk }
    }
  }

  // 工作区本地覆盖：支持随机器变化的绝对根目录配置（不影响一级/二级固定目录结构）
  const localOverride = readWorkspaceLocalVaultRoot(workspaceRoot)
  if (localOverride) {
    return { vaultRoot: path.normalize(localOverride), mode: 'nested', projectKey: pk }
  }

  // nested 模式默认策略：
  // 1) 若显式配置 nestedRelative，则按配置拼接
  // 2) 若工作区位于 .../AGENT-ROOT/03-PROJECTS/<project>，则 vault 根自动回退到外层 AGENT-ROOT
  // 3) 其他情况回退到 workspaceRoot
  if (nestedRel) {
    const vr = nestedRel === '.' ? workspaceRoot : path.join(workspaceRoot, nestedRel)
    return { vaultRoot: path.normalize(vr), mode: 'nested', projectKey: pk }
  }

  const wsNorm = path.normalize(workspaceRoot)
  const parts = wsNorm.split(path.sep)
  const projectsIdx = parts.findIndex((p, i) => p === '03-PROJECTS' && i > 0)
  if (projectsIdx > 0 && parts[projectsIdx - 1] === 'AGENT-ROOT') {
    const root = parts.slice(0, projectsIdx).join(path.sep) || path.sep
    return { vaultRoot: path.normalize(root), mode: 'nested', projectKey: pk }
  }

  return { vaultRoot: wsNorm, mode: 'nested', projectKey: pk }
}

async function refreshRuntime() {
  const cfg = await readAppConfigFile()

  // 兼容旧版本：若历史配置仍是 AGENT-ROOT 子目录模式，自动迁移到外层根目录策略
  if (cfg?.vault?.nestedRelative === 'AGENT-ROOT') {
    cfg.vault.nestedRelative = ''
    await writeAppConfigFile(cfg)
  }

  const { root: ws, fromEnv } = computeWorkspaceRoot(cfg)
  const { vaultRoot, mode, projectKey } = computeVaultRoot(ws, cfg.vault || {})
  const sysDir = path.join(vaultRoot, '05-SYSTEM')
  RUNTIME.workspaceRoot = ws
  RUNTIME.vaultRoot = vaultRoot
  RUNTIME.vaultMode = mode
  RUNTIME.projectKey = projectKey
  RUNTIME.workspaceFromEnv = fromEnv
  RUNTIME.vaultConfigured = existsSync(sysDir)
}

const ptySessions = new Map()

function isPathUnder(child, parent) {
  const c = path.normalize(child)
  const p = path.normalize(parent)
  if (process.platform === 'win32') {
    const cl = c.toLowerCase()
    const pl = p.toLowerCase()
    return cl === pl || cl.startsWith(pl + path.sep)
  }
  return c === p || c.startsWith(p + path.sep)
}

function resolveSafePath(relativePath = '.') {
  const base = RUNTIME.workspaceRoot
  const target = path.resolve(base, relativePath)
  if (!isPathUnder(target, base)) {
    throw new Error('Path escapes workspace root')
  }
  return target
}

function resolveVaultPath(relativePath = '.') {
  const base = RUNTIME.vaultRoot
  const target = path.resolve(base, relativePath)
  if (!isPathUnder(target, base)) {
    throw new Error('Path escapes vault root')
  }
  return target
}

function resolveScopedPath(relativePath, scope) {
  const sc = scope === 'vault' ? 'vault' : 'workspace'
  try {
    return sc === 'vault' ? resolveVaultPath(relativePath) : resolveSafePath(relativePath)
  } catch (error) {
    // Tolerate wrong scope from renderer when absolute path is already under
    // the other allowed root; keep path traversal checks enforced.
    const raw = String(relativePath ?? '').trim()
    if (!path.isAbsolute(raw)) throw error
    const abs = path.normalize(raw)
    if (isPathUnder(abs, RUNTIME.workspaceRoot)) return abs
    if (isPathUnder(abs, RUNTIME.vaultRoot)) return abs
    throw error
  }
}

/** 供 shell.openPath：工作区或 Vault 相对路径，或用户主目录/工作区/Vault 下的绝对路径 */
function resolveHostOpenPath(inputPath, scope = 'workspace') {
  const raw = String(inputPath ?? '').trim()
  if (!raw) throw new Error('path is required')
  const bases =
    scope === 'vault'
      ? [RUNTIME.vaultRoot, RUNTIME.workspaceRoot, path.normalize(os.homedir())]
      : [RUNTIME.workspaceRoot, RUNTIME.vaultRoot, path.normalize(os.homedir())]

  if (path.isAbsolute(raw)) {
    const abs = path.normalize(raw)
    const home = path.normalize(os.homedir())
    for (const b of bases) {
      const bn = path.normalize(b)
      const under =
        process.platform === 'win32'
          ? abs.toLowerCase().startsWith(bn.toLowerCase()) || abs.toLowerCase().startsWith(home.toLowerCase())
          : abs.startsWith(bn) || abs.startsWith(home)
      if (under) return abs
    }
    throw new Error('absolute path must be under workspace, vault, or user home directory')
  }
  const relBase = scope === 'vault' ? RUNTIME.vaultRoot : RUNTIME.workspaceRoot
  const target = path.resolve(relBase, raw)
  if (!isPathUnder(target, relBase)) throw new Error('Path escapes allowed root')
  return target
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

function createPtySession({ id, cwd = '.', cwdScope = 'workspace', cols = 120, rows = 36, shell = 'powershell' }) {
  const absCwd = resolveScopedPath(cwd, cwdScope === 'vault' ? 'vault' : 'workspace')
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

async function readDirectoryConfigFromDisk() {
  const fp = path.join(RUNTIME.vaultRoot, '05-SYSTEM', 'directory.config.json')
  try {
    const raw = await fs.readFile(fp, 'utf8')
    const o = JSON.parse(raw)
    return { ...DEFAULT_DIRECTORY_CONFIG, ...o, keys: { ...DEFAULT_DIRECTORY_CONFIG.keys, ...(o.keys || {}) } }
  } catch {
    return { ...DEFAULT_DIRECTORY_CONFIG }
  }
}

async function vaultBootstrap() {
  await refreshRuntime()
  const root = RUNTIME.vaultRoot
  await fs.mkdir(root, { recursive: true })
  for (const rel of VAULT_SUBDIRS) {
    await fs.mkdir(path.join(root, rel), { recursive: true })
  }

  const readmePath = path.join(root, 'README.md')
  if (!existsSync(readmePath)) {
    await fs.writeFile(readmePath, VAULT_README_CONTENT, 'utf8')
  }

  const sys = path.join(root, '05-SYSTEM')
  const dc = path.join(sys, 'directory.config.json')
  if (!existsSync(dc)) {
    await fs.writeFile(dc, JSON.stringify(DEFAULT_DIRECTORY_CONFIG, null, 2), 'utf8')
  }
  const rc = path.join(sys, 'rule.config.json')
  if (!existsSync(rc)) {
    await fs.writeFile(rc, JSON.stringify({ version: 1, rules: [] }, null, 2), 'utf8')
  }
  const ac = path.join(sys, 'agent.config.json')
  const defaultAgentConfig = {
    version: 1,
    projectKey: RUNTIME.projectKey,
    memory: {
      protectedPaths: ['README.md', '00-INBOX', '01-HUMAN-NOTES', '02-AGENT-MEMORY', '03-PROJECTS', '04-RESOURCES', '05-SYSTEM'],
      protectedDepth: 2,
      shortTermRetentionDays: 7,
      autoPrune: false,
    },
    discovery: {
      skills: { enabled: true, workspaceDir: 'skills' },
      plugins: { enabled: true, source: 'openclaw/clawhub' },
      chatHistory: { enabled: true, sessionId: 'workbench-terminal-ai', recentTurnsStorageKey: 'zytrader-workbench-recent-turns:v2' },
    },
  }
  if (!existsSync(ac)) {
    await fs.writeFile(ac, JSON.stringify(defaultAgentConfig, null, 2), 'utf8')
  }
  await refreshRuntime()
  return { ok: true, vaultRoot: RUNTIME.vaultRoot }
}

function registerIpcHandlers() {
  ipcMain.handle('zytrader:fs:list', async (_event, dir = '.', opts = {}) => {
    const scope = opts?.scope === 'vault' ? 'vault' : 'workspace'
    const abs = resolveScopedPath(dir, scope)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    return {
      ok: true,
      dir,
      scope,
      entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
    }
  })

  ipcMain.handle('zytrader:fs:read', async (_event, filePath, opts = {}) => {
    const scope = opts?.scope === 'vault' ? 'vault' : 'workspace'
    const abs = resolveScopedPath(filePath, scope)
    try {
      const content = await fs.readFile(abs, 'utf8')
      return { ok: true, path: filePath, scope, content }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code === 'ENOENT') {
        return { ok: false, path: filePath, scope, error: 'not_found' }
      }
      return {
        ok: false,
        path: filePath,
        scope,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('zytrader:fs:write', async (_event, filePath, content, opts = {}) => {
    const scope = opts?.scope === 'vault' ? 'vault' : 'workspace'
    const abs = resolveScopedPath(filePath, scope)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content ?? '', 'utf8')
    return { ok: true, path: filePath, scope }
  })

  ipcMain.handle('zytrader:fs:delete', async (_event, targetPath, opts = {}) => {
    const scope = opts?.scope === 'vault' ? 'vault' : 'workspace'
    if (scope === 'vault' && shouldProtectVaultPath(targetPath)) {
      return { ok: false, path: targetPath, scope, error: 'protected path: AGENT-ROOT level-1/2 and README.md are immutable' }
    }
    const abs = resolveScopedPath(targetPath, scope)
    await fs.rm(abs, { recursive: true, force: true })
    return { ok: true, path: targetPath, scope }
  })

  ipcMain.handle('zytrader:terminal:exec', async (_event, command, cwd = '.', cwdScope = 'workspace') => {
    const sc = cwdScope === 'vault' ? 'vault' : 'workspace'
    const absCwd = resolveScopedPath(cwd, sc)
    const execOptions = {
      cwd: absCwd,
      windowsHide: true,
      timeout: 120000,
      ...(process.platform === 'win32' ? { shell: process.env.ComSpec || 'cmd.exe' } : {}),
    }
    return await new Promise((resolve) => {
      exec(command, execOptions, (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : 0
        resolve({ ok: !error, command, cwd, cwdScope: sc, code, stdout: stdout ?? '', stderr: stderr ?? '' })
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

    const normalizedProvider = String(provider || 'custom').toLowerCase()
    const root = String(baseUrl).replace(/\/$/, '')
    try {
      let resp
      if (normalizedProvider === 'openai') {
        const url = root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 32,
            messages: [{ role: 'user', content: `ping from ${normalizedProvider}` }],
          }),
        })
      } else {
        const url = root.endsWith('/v1') ? `${root}/messages` : `${root}/v1/messages`
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 32,
            messages: [{ role: 'user', content: `ping from ${normalizedProvider}` }],
          }),
        })
      }
      const body = await resp.text()
      return { ok: resp.ok, status: resp.status, body: body.slice(0, 1000) }
    } catch (e) {
      return { ok: false, status: 500, body: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('zytrader:host:openPath', async (_event, inputPath, opts = {}) => {
    try {
      const raw = String(inputPath ?? '').trim()
      if (/^https?:\/\//i.test(raw) || /^www\./i.test(raw)) {
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        await shell.openExternal(url)
        return { ok: true, path: url }
      }
      const scope = opts?.scope === 'vault' ? 'vault' : 'workspace'
      const abs = resolveHostOpenPath(inputPath, scope)
      const err = await shell.openPath(abs)
      return { ok: !err, path: abs, error: err || undefined }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:open', async (_event, url) => {
    try {
      const w = createComputerWindow(String(url || 'https://www.baidu.com'))
      return { ok: true, url: w.webContents.getURL() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:navigate', async (_event, url) => {
    try {
      const w = createComputerWindow(String(url || 'https://www.baidu.com'))
      const target = /^https?:\/\//i.test(String(url || '')) ? String(url) : `https://${String(url || '')}`
      await w.loadURL(target)
      return { ok: true, url: w.webContents.getURL() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:evaluate', async (_event, script) => {
    try {
      if (!computerWin || computerWin.isDestroyed()) return { ok: false, error: 'computer window not open' }
      const result = await computerWin.webContents.executeJavaScript(String(script || ''), true)
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:snapshot', async () => {
    try {
      if (!computerWin || computerWin.isDestroyed()) return { ok: false, error: 'computer window not open' }
      const dataUrl = await computerWin.webContents.executeJavaScript(
        `(() => ({ title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 4000) }))()`,
        true,
      )
      return { ok: true, snapshot: dataUrl }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:workspace:info', async () => {
    await refreshRuntime()
    return {
      ok: true,
      root: RUNTIME.workspaceRoot,
      exists: existsSync(RUNTIME.workspaceRoot),
      vaultRoot: RUNTIME.vaultRoot,
      vaultMode: RUNTIME.vaultMode,
      vaultConfigured: RUNTIME.vaultConfigured,
      projectKey: RUNTIME.projectKey,
      workspaceFromEnv: RUNTIME.workspaceFromEnv,
    }
  })

  ipcMain.handle('zytrader:workspace:setRoot', async (_event, nextRoot) => {
    const raw = String(nextRoot ?? '').trim()
    if (!raw) return { ok: false, error: 'path required' }
    const abs = path.resolve(raw)
    if (!existsSync(abs)) return { ok: false, error: 'path does not exist' }
    const cfg = await readAppConfigFile()
    cfg.workspaceRoot = abs
    await writeAppConfigFile(cfg)
    await refreshRuntime()
    return { ok: true, root: RUNTIME.workspaceRoot, vaultRoot: RUNTIME.vaultRoot }
  })

  ipcMain.handle('zytrader:workspace:pickRoot', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(parent ?? undefined, {
      title: '选择工程文件夹（代码仓库根目录）',
      properties: ['openDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || !result.filePaths?.length) {
      return { ok: false, canceled: true }
    }
    const abs = path.resolve(result.filePaths[0])
    if (!existsSync(abs)) return { ok: false, error: 'path does not exist' }
    const cfg = await readAppConfigFile()
    cfg.workspaceRoot = abs
    await writeAppConfigFile(cfg)
    await refreshRuntime()
    return {
      ok: true,
      root: RUNTIME.workspaceRoot,
      exists: existsSync(RUNTIME.workspaceRoot),
      vaultRoot: RUNTIME.vaultRoot,
      vaultMode: RUNTIME.vaultMode,
      vaultConfigured: RUNTIME.vaultConfigured,
      projectKey: RUNTIME.projectKey,
      workspaceFromEnv: RUNTIME.workspaceFromEnv,
    }
  })

  ipcMain.handle('zytrader:vault:setConfig', async (_event, partial) => {
    const cfg = await readAppConfigFile()
    cfg.vault = { ...cfg.vault, ...(partial || {}) }
    await writeAppConfigFile(cfg)
    await refreshRuntime()
    return { ok: true, vault: cfg.vault, vaultRoot: RUNTIME.vaultRoot }
  })

  ipcMain.handle('zytrader:vault:bootstrap', async () => {
    try {
      return await vaultBootstrap()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('zytrader:vault:resolve', async (_event, key) => {
    await refreshRuntime()
    const k = String(key ?? '').trim()
    if (!k) return { ok: false, error: 'key required' }
    const dc = await readDirectoryConfigFromDisk()
    const rel = dc.keys[k]
    if (!rel) return { ok: false, error: `unknown key: ${k}` }
    const abs = path.join(RUNTIME.vaultRoot, ...rel.split('/'))
    const norm = path.normalize(abs)
    if (!isPathUnder(norm, RUNTIME.vaultRoot)) {
      return { ok: false, error: 'invalid path' }
    }
    return { ok: true, key: k, relative: rel, absolute: norm }
  })
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

function createComputerWindow(url = 'https://www.baidu.com') {
  if (computerWin && !computerWin.isDestroyed()) return computerWin
  computerWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    autoHideMenuBar: true,
    title: 'Computer Use',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  computerWin.on('closed', () => {
    computerWin = null
  })
  const target = /^https?:\/\//i.test(String(url || '')) ? String(url) : `https://${String(url || 'www.baidu.com')}`
  computerWin.loadURL(target)
  return computerWin
}

app.whenReady().then(async () => {
  await refreshRuntime()
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
