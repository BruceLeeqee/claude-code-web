// @ts-nocheck
const electronModule = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const { existsSync, readFileSync, mkdirSync } = require('fs')
const fsNative = require('fs')
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

/** @type {Map<string, { watcher: import('fs').FSWatcher; debounceTimer: ReturnType<typeof setTimeout> | null; wc: Electron.WebContents; closed: boolean }>} */
const fsDirWatchers = new Map()
let fsWatchSeq = 0

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

/** 避免 executeJavaScript / 页面挂起导致 IPC 永不返回（如 SSL 握手重试） */
function promiseWithTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

const DEFAULT_DIRECTORY_CONFIG = {
  version: 1,
  keys: {
    inbox: '00-HUMAN-TEMP',
    'inbox-human': '00-HUMAN-TEMP/human',
    'inbox-agent': '00-HUMAN-TEMP/agent',
    'human-notes': '01-HUMAN-NOTES',
    'agent-memory': '02-AGENT-MEMORY',
    'agent-short-term': '02-AGENT-MEMORY/01-Short-Term',
    /** 兼容旧工具名：与 agent-long-user 同目录 */
    'agent-long-term': '02-AGENT-MEMORY/02-Long-User',
    'agent-long-user': '02-AGENT-MEMORY/02-Long-User',
    'agent-long-feedback': '02-AGENT-MEMORY/03-Long-Feedback',
    'agent-long-project': '02-AGENT-MEMORY/04-Long-Projects',
    'agent-long-reference': '02-AGENT-MEMORY/05-Long-Reference',
    'agent-context': '02-AGENT-MEMORY/06-Context',
    /** 索引与元数据同层 07-Meta */
    'agent-meta': '02-AGENT-MEMORY/07-Meta',
    /** 长期记忆索引：manifest / time-index / topic-index */
    'agent-memory-index': '02-AGENT-MEMORY/07-Meta',
    'agent-skills': '03-AGENT-TOOLS/01-Skills',
    'agent-plugins': '03-AGENT-TOOLS/02-Plugins',
    projects: '04-PROJECTS',
    resources: '05-RESOURCES',
    system: '06-SYSTEM',
  },
}

const VAULT_SUBDIRS = [
  path.join('00-HUMAN-TEMP', 'human'),
  path.join('00-HUMAN-TEMP', 'agent'),
  path.join('01-HUMAN-NOTES', '01-Daily'),
  path.join('01-HUMAN-NOTES', '02-Knowledge'),
  path.join('01-HUMAN-NOTES', '03-Notes'),
  path.join('01-HUMAN-NOTES', '04-Tags'),
  path.join('02-AGENT-MEMORY', '01-Short-Term'),
  path.join('02-AGENT-MEMORY', '02-Long-User'),
  path.join('02-AGENT-MEMORY', '03-Long-Feedback'),
  path.join('02-AGENT-MEMORY', '04-Long-Projects'),
  path.join('02-AGENT-MEMORY', '05-Long-Reference'),
  path.join('02-AGENT-MEMORY', '06-Context'),
  path.join('02-AGENT-MEMORY', '07-Meta'),
  path.join('02-AGENT-MEMORY', '07-Meta', 'tools'),
  path.join('03-AGENT-TOOLS', '01-Skills'),
  path.join('03-AGENT-TOOLS', '02-Plugins'),
  '04-PROJECTS',
  path.join('05-RESOURCES', 'images'),
  path.join('05-RESOURCES', 'files'),
  path.join('05-RESOURCES', 'media'),
  path.join('05-RESOURCES', 'templates'),
  '06-SYSTEM',
]

const VAULT_README_CONTENT = `AGENT-ROOT/  # 根目录（可自定义路径）
├── 00-HUMAN-TEMP/     # 临时收纳（人类随手记、Agent 临时记忆）
│   ├── human/
│   └── agent/
├── 01-HUMAN-NOTES/    # 人类正式笔记
├── 02-AGENT-MEMORY/   # Agent 记忆
│   ├── 01-Short-Term/
│   ├── 02-Long-User/
│   ├── 03-Long-Feedback/
│   ├── 04-Long-Projects/
│   ├── 05-Long-Reference/
│   ├── 06-Context/
│   └── 07-Meta/       # 索引 manifest / time-index / topic-index；子目录 tools 构建索引
├── 03-AGENT-TOOLS/
│   ├── 01-Skills/     # 技能根：每技能一子目录，入口须为 SKILL.md 或 Skill.md 或 skill.md
│   └── 02-Plugins/    # 插件根
├── 04-PROJECTS/       # 工程与代码仓库（唯一 projects 根）
├── 05-RESOURCES/
└── 06-SYSTEM/         # directory.config.json / rule.config.json / agent.config.json`

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
  // 2) 若工作区位于 .../AGENT-ROOT/04-PROJECTS/<project>（或旧版 03-PROJECTS），vault 根回退到外层 AGENT-ROOT
  // 3) 其他情况回退到 workspaceRoot
  if (nestedRel) {
    const vr = nestedRel === '.' ? workspaceRoot : path.join(workspaceRoot, nestedRel)
    return { vaultRoot: path.normalize(vr), mode: 'nested', projectKey: pk }
  }

  const wsNorm = path.normalize(workspaceRoot)
  const parts = wsNorm.split(path.sep)
  const projectsIdx = parts.findIndex(
    (p, i) => i > 0 && parts[i - 1] === 'AGENT-ROOT' && (p === '04-PROJECTS' || p === '03-PROJECTS'),
  )
  if (projectsIdx > 0) {
    const root = parts.slice(0, projectsIdx).join(path.sep) || path.sep
    return { vaultRoot: path.normalize(root), mode: 'nested', projectKey: pk }
  }

  return { vaultRoot: wsNorm, mode: 'nested', projectKey: pk }
}

/** 在 Vault 根生成 Cursor/VS Code 排除项（库层目录）；仅当尚无 .vscode/settings.json 时写入，避免覆盖用户配置 */
const AGENT_ROOT_CURSOR_HIDE_DIRS = {
  '00-HUMAN-TEMP': true,
  '01-HUMAN-NOTES': true,
  '02-AGENT-MEMORY': true,
  '03-AGENT-TOOLS': true,
  '03-PROJECTS': true,
  '04-RESOURCES': true,
  '05-RESOURCES': true,
  '05-SYSTEM': true,
  '06-SYSTEM': true,
}

async function ensureVaultRootCursorHideSettings(vaultRoot) {
  if (!vaultRoot || !existsSync(vaultRoot)) return
  try {
    const vscDir = path.join(vaultRoot, '.vscode')
    const vscFp = path.join(vscDir, 'settings.json')
    if (existsSync(vscFp)) {
      try {
        const raw = await fs.readFile(vscFp, 'utf8')
        let cur = JSON.parse(raw)
        if (typeof cur !== 'object' || cur === null) cur = {}
        let dirty = false
        const fe =
          typeof cur['files.exclude'] === 'object' &&
          cur['files.exclude'] !== null &&
          !Array.isArray(cur['files.exclude'])
            ? { ...cur['files.exclude'] }
            : {}
        const se =
          typeof cur['search.exclude'] === 'object' &&
          cur['search.exclude'] !== null &&
          !Array.isArray(cur['search.exclude'])
            ? { ...cur['search.exclude'] }
            : {}
        for (const k of Object.keys(AGENT_ROOT_CURSOR_HIDE_DIRS)) {
          if (fe[k] === undefined) {
            fe[k] = true
            dirty = true
          }
          if (se[k] === undefined) {
            se[k] = true
            dirty = true
          }
        }
        if (dirty) {
          cur['files.exclude'] = fe
          cur['search.exclude'] = se
          await fs.writeFile(vscFp, JSON.stringify(cur, null, 2), 'utf8')
        }
      } catch {
        /* 已有文件但非合法 JSON 等 */
      }
      return
    }
    await fs.mkdir(vscDir, { recursive: true })
    const blob = {
      'files.exclude': { ...AGENT_ROOT_CURSOR_HIDE_DIRS },
      'search.exclude': { ...AGENT_ROOT_CURSOR_HIDE_DIRS },
    }
    await fs.writeFile(vscFp, JSON.stringify(blob, null, 2), 'utf8')
  } catch {
    /* 忽略：无写权限等 */
  }
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
  const sysDir6 = path.join(vaultRoot, '06-SYSTEM')
  const sysDir5 = path.join(vaultRoot, '05-SYSTEM')
  RUNTIME.workspaceRoot = ws
  RUNTIME.vaultRoot = vaultRoot
  RUNTIME.vaultMode = mode
  RUNTIME.projectKey = projectKey
  RUNTIME.workspaceFromEnv = fromEnv
  RUNTIME.vaultConfigured = existsSync(sysDir6) || existsSync(sysDir5)
  void ensureVaultRootCursorHideSettings(vaultRoot)
}

const ptySessions = new Map()

/** 合并并发：在 vault 的 07-Meta/tools 下执行 npm install + build-manifest.mjs */
let memoryIndexBuildPromise = null

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
    // Windows：允许从 Program Files / AppData 等标准安装目录启动 .exe（如 Chrome），否则 host.open_path 无法打开本机浏览器
    if (process.platform === 'win32') {
      const extraRoots = [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.LocalAppData,
        process.env.APPDATA,
      ].filter(Boolean)
      for (const er of extraRoots) {
        const root = path.normalize(er)
        if (abs.toLowerCase().startsWith(root.toLowerCase())) return abs
      }
    }
    throw new Error('absolute path must be under workspace, vault, user home, or Windows install directories (Program Files, AppData, etc.)')
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

function pickPrimarySystemDirForVault(root) {
  const v6 = path.join(root, '06-SYSTEM')
  const v5 = path.join(root, '05-SYSTEM')
  if (existsSync(v6)) return '06-SYSTEM'
  if (existsSync(v5)) return '05-SYSTEM'
  return '06-SYSTEM'
}

async function readDirectoryConfigFromDisk() {
  const root = RUNTIME.vaultRoot
  const candidates = [
    path.join(root, '06-SYSTEM', 'directory.config.json'),
    path.join(root, '05-SYSTEM', 'directory.config.json'),
  ]
  for (const fp of candidates) {
    try {
      const raw = await fs.readFile(fp, 'utf8')
      const o = JSON.parse(raw)
      return { ...DEFAULT_DIRECTORY_CONFIG, ...o, keys: { ...DEFAULT_DIRECTORY_CONFIG.keys, ...(o.keys || {}) } }
    } catch {
      /* try next */
    }
  }
  return { ...DEFAULT_DIRECTORY_CONFIG }
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

  const sysRel = pickPrimarySystemDirForVault(root)
  const sys = path.join(root, sysRel)
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
      protectedPaths: [
        'README.md',
        '00-HUMAN-TEMP',
        '00-INBOX',
        '01-HUMAN-NOTES',
        '02-AGENT-MEMORY',
        '03-AGENT-TOOLS',
        '04-PROJECTS',
        '05-RESOURCES',
        '04-RESOURCES',
        '06-SYSTEM',
        '05-SYSTEM',
      ],
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

/**
 * Windows：启动已安装浏览器。优先 shell.openPath（与资源管理器双击一致，GUI 可见性最好）；
 * 再尝试 spawn；并包含 %LOCALAPPDATA% 下常见用户级 Chrome 安装路径。
 */
async function launchWindowsRegisteredApp(appId) {
  const id = String(appId || '').trim().toLowerCase()
  if (process.platform !== 'win32') {
    return { ok: false, error: 'host.launchRegisteredApp: only implemented on Windows' }
  }
  const comspec = process.env.ComSpec || 'cmd.exe'
  const local = process.env.LOCALAPPDATA

  if (id === 'chrome' || id === 'google-chrome') {
    const candidates = [
      local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
    ].filter(Boolean)

    for (const exe of candidates) {
      if (!existsSync(exe)) continue
      try {
        const errMsg = await shell.openPath(exe)
        if (!errMsg) {
          return { ok: true, mode: 'shell.openPath', path: exe }
        }
      } catch {
        /* try next */
      }
    }

    for (const exe of candidates) {
      if (!existsSync(exe)) continue
      try {
        await new Promise((resolve, reject) => {
          const cp = spawn(exe, ['--new-window'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          })
          cp.once('error', reject)
          cp.once('spawn', () => {
            try {
              cp.unref()
            } catch {}
            resolve()
          })
        })
        return { ok: true, mode: 'spawn', path: exe }
      } catch {
        /* try next */
      }
    }

    try {
      await new Promise((resolve, reject) => {
        const cp = spawn(comspec, ['/c', 'start', '', 'chrome'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        })
        cp.once('error', reject)
        cp.once('spawn', () => {
          try {
            cp.unref()
          } catch {}
          resolve()
        })
      })
      return { ok: true, mode: 'start-alias', note: 'chrome.exe not found in common paths; used start chrome' }
    } catch (e) {
      return {
        ok: false,
        error: `Could not start Chrome: ${e instanceof Error ? e.message : String(e)}. Is Chrome installed?`,
      }
    }
  }

  if (id === 'edge' || id === 'msedge') {
    const edgeCandidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Microsoft',
        'Edge',
        'Application',
        'msedge.exe',
      ),
    ]
    for (const exe of edgeCandidates) {
      if (!existsSync(exe)) continue
      try {
        const errMsg = await shell.openPath(exe)
        if (!errMsg) return { ok: true, mode: 'shell.openPath', path: exe }
      } catch {
        /* continue */
      }
    }
    try {
      await new Promise((resolve, reject) => {
        const cp = spawn(comspec, ['/c', 'start', '', 'msedge'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        })
        cp.once('error', reject)
        cp.once('spawn', () => {
          try {
            cp.unref()
          } catch {}
          resolve()
        })
      })
      return { ok: true, mode: 'start-alias', app: 'edge' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { ok: false, error: `unknown app: ${appId} (supported: chrome, edge)` }
}

async function buildVaultMemoryIndex() {
  await refreshRuntime()
  const root = RUNTIME.vaultRoot
  if (!root || !existsSync(root)) {
    return { ok: false, error: 'vault root not configured or missing' }
  }

  const dc = await readDirectoryConfigFromDisk()
  const relMeta = dc.keys['agent-memory-index']
  if (!relMeta || typeof relMeta !== 'string') {
    return { ok: false, error: 'directory.config.json missing agent-memory-index key' }
  }

  const toolsDir = path.normalize(path.join(root, ...relMeta.split('/'), 'tools'))
  if (!isPathUnder(toolsDir, root)) {
    return { ok: false, error: 'invalid memory index tools path' }
  }

  const buildScript = path.join(toolsDir, 'build-manifest.mjs')
  const pkgJson = path.join(toolsDir, 'package.json')
  if (!existsSync(buildScript)) {
    return {
      ok: false,
      error: `missing ${path.join(relMeta, 'tools', 'build-manifest.mjs')} under vault`,
    }
  }
  if (!existsSync(pkgJson)) {
    return { ok: false, error: `missing ${path.join(relMeta, 'tools', 'package.json')} under vault` }
  }

  const command = 'npm install --no-fund --no-audit && node build-manifest.mjs'
  const execOptions = {
    cwd: toolsDir,
    windowsHide: false,
    timeout: 600_000,
    maxBuffer: 20 * 1024 * 1024,
    ...(process.platform === 'win32' ? { shell: process.env.ComSpec || 'cmd.exe' } : {}),
  }

  return await new Promise((resolve) => {
    exec(command, execOptions, (error, stdout, stderr) => {
      const code = error && typeof error.code === 'number' ? error.code : 0
      const out = String(stdout ?? '')
      const err = String(stderr ?? '')
      if (error) {
        resolve({
          ok: false,
          code,
          toolsDir,
          error: error.killed ? 'memory index build timed out after 10 minutes' : error.message || String(error),
          stdout: out.slice(-12_000),
          stderr: err.slice(-12_000),
        })
        return
      }
      resolve({
        ok: true,
        code: 0,
        toolsDir,
        stdout: out.slice(-4000),
        stderr: err.slice(-4000),
      })
    })
  })
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

  ipcMain.handle('zytrader:fs:watchDir', async (event, dir = '.', opts = {}) => {
    const scope = opts?.scope === 'vault' ? 'vault' : 'workspace'
    let abs
    try {
      abs = resolveScopedPath(dir, scope)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const watchId = `fsW_${++fsWatchSeq}`
    const wc = event.sender
    const rec = { watcher: null, debounceTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null), wc, closed: false }
    try {
      rec.watcher = fsNative.watch(
        abs,
        { recursive: true },
        () => {
          if (rec.closed || wc.isDestroyed()) return
          if (rec.debounceTimer) clearTimeout(rec.debounceTimer)
          rec.debounceTimer = setTimeout(() => {
            rec.debounceTimer = null
            if (rec.closed || wc.isDestroyed()) return
            wc.send('zytrader:fs:watch', { watchId, scope, dir, ts: Date.now() })
          }, 280)
        },
      )
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    fsDirWatchers.set(watchId, rec)
    return { ok: true, watchId, dir, scope }
  })

  ipcMain.handle('zytrader:fs:unwatchDir', async (_event, watchId) => {
    const rec = fsDirWatchers.get(watchId)
    if (!rec) return { ok: false, error: 'unknown_watch' }
    rec.closed = true
    if (rec.debounceTimer) clearTimeout(rec.debounceTimer)
    rec.debounceTimer = null
    try {
      rec.watcher.close()
    } catch {}
    fsDirWatchers.delete(watchId)
    return { ok: true }
  })

  ipcMain.handle('zytrader:terminal:exec', async (_event, command, cwd = '.', cwdScope = 'workspace') => {
    const sc = cwdScope === 'vault' ? 'vault' : 'workspace'
    const absCwd = resolveScopedPath(cwd, sc)
    const execOptions = {
      cwd: absCwd,
      // false：避免 Start-Process / start 启动的 GUI 子进程在部分环境下不可见
      windowsHide: false,
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
    const isDeepSeek = root.includes('deepseek.com')
    const isDeepSeekPro = model.toLowerCase().includes('v4-pro') || model.toLowerCase().includes('reasoner')
    try {
      let resp
      if (normalizedProvider === 'openai') {
        const url = root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`
        const body = {
          model,
          max_tokens: 32,
          messages: [{ role: 'user', content: `ping from ${normalizedProvider}` }],
        }
        if (isDeepSeek && isDeepSeekPro) {
          body.thinking = { type: 'disabled' }
        }
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        })
      } else {
        const url = root.endsWith('/v1') ? `${root}/messages` : `${root}/v1/messages`
        const body = {
          model,
          max_tokens: 32,
          messages: [{ role: 'user', content: `ping from ${normalizedProvider}` }],
        }
        if (isDeepSeek && isDeepSeekPro) {
          body.thinking = { type: 'disabled' }
        }
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
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

  ipcMain.handle('zytrader:host:launchRegisteredApp', async (_event, appId) => {
    try {
      return await launchWindowsRegisteredApp(appId)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:open', async (_event, url) => {
    try {
      const w = await loadComputerWindow(url)
      return { ok: true, url: w.webContents.getURL() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:navigate', async (_event, url) => {
    try {
      const w = await loadComputerWindow(url)
      return { ok: true, url: w.webContents.getURL() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:evaluate', async (_event, script) => {
    try {
      if (!computerWin || computerWin.isDestroyed()) return { ok: false, error: 'computer window not open' }
      const result = await promiseWithTimeout(
        computerWin.webContents.executeJavaScript(String(script || ''), true),
        45_000,
        'zytrader:computer:evaluate',
      )
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('zytrader:computer:snapshot', async () => {
    try {
      if (!computerWin || computerWin.isDestroyed()) return { ok: false, error: 'computer window not open' }
      const dataUrl = await promiseWithTimeout(
        computerWin.webContents.executeJavaScript(
          `(() => ({ title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 4000) }))()`,
          true,
        ),
        30_000,
        'zytrader:computer:snapshot',
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

  ipcMain.handle('zytrader:vault:buildMemoryIndex', async () => {
    try {
      if (memoryIndexBuildPromise) return await memoryIndexBuildPromise
      memoryIndexBuildPromise = buildVaultMemoryIndex().finally(() => {
        memoryIndexBuildPromise = null
      })
      return await memoryIndexBuildPromise
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  const MODEL_CONFIG_FILENAME = 'model.config.json'

  function getModelConfigPath() {
    const sysDir = pickPrimarySystemDirForVault(RUNTIME.vaultRoot)
    return path.join(RUNTIME.vaultRoot, sysDir, MODEL_CONFIG_FILENAME)
  }

  ipcMain.handle('zytrader:model-config:read', async () => {
    try {
      await refreshRuntime()
      const fp = getModelConfigPath()
      if (!existsSync(fp)) {
        return { ok: false, error: 'config_not_found', path: fp }
      }
      const raw = readFileSync(fp, 'utf8')
      const parsed = JSON.parse(raw)
      return { ok: true, config: parsed, path: fp }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('zytrader:model-config:write', async (_event, config) => {
    try {
      await refreshRuntime()
      const fp = getModelConfigPath()
      await fs.mkdir(path.dirname(fp), { recursive: true })
      await fs.writeFile(fp, JSON.stringify(config, null, 2), 'utf8')
      return { ok: true, path: fp }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
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

/** 与渲染进程 computer.use 一致：补全协议，空则默认百度 */
function normalizeComputerTargetUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return 'https://www.baidu.com'
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

/**
 * 创建或复用 Computer Use 窗口，并始终 loadURL（修复：旧逻辑在窗口已存在时直接 return，导致无法打开新网址）
 */
async function loadComputerWindow(url) {
  const target = normalizeComputerTargetUrl(url)
  if (!computerWin || computerWin.isDestroyed()) {
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

    // 某些站点在 Electron 内会出现重定向循环或 TLS 握手失败；
    // 主文档失败时给出可读提示，避免重复空白重试。
    computerWin.webContents.on('did-fail-load', async (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      if (!computerWin || computerWin.isDestroyed()) return

      const knownNetIssue = errorCode === -310 || errorCode === -100 || errorCode === -103
      if (!knownNetIssue) return

      const html = `
        <html>
          <head><meta charset="utf-8"><title>Computer Use 加载失败</title></head>
          <body style="font-family: Segoe UI, Arial, sans-serif; background:#111827; color:#e5e7eb; padding:24px;">
            <h2 style="margin:0 0 12px;">页面加载失败</h2>
            <p style="margin:0 0 8px;">URL: ${String(validatedURL || '').replace(/</g, '&lt;')}</p>
            <p style="margin:0 0 8px;">错误: ${String(errorDescription || 'unknown')}</p>
            <p style="margin:0;">建议：更换站点、检查代理/网络，或改用系统浏览器打开该网址。</p>
          </body>
        </html>
      `
      try {
        await computerWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      } catch {
        // ignore
      }
    })
  }
  try {
    await computerWin.loadURL(target)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/ERR_TOO_MANY_REDIRECTS/i.test(msg)) {
      // 重定向循环站点优先交给系统浏览器，避免 Electron 内持续握手/重试噪音
      await shell.openExternal(target)
      await computerWin.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          `<html><body style="font-family: Segoe UI, Arial; background:#111827; color:#e5e7eb; padding:24px;">
             <h2>已在系统浏览器打开</h2>
             <p>目标网址在 Electron 内出现重定向循环：${target}</p>
           </body></html>`,
        )}`,
      )
    } else {
      throw error
    }
  }
  computerWin.show()
  computerWin.focus()
  // 避免被主窗口完全遮挡，短暂置顶便于用户发现 Computer Use 窗口
  if (process.platform === 'win32') {
    try {
      computerWin.setAlwaysOnTop(true)
      setTimeout(() => {
        try {
          if (computerWin && !computerWin.isDestroyed()) computerWin.setAlwaysOnTop(false)
        } catch {}
      }, 600)
    } catch {}
  }
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
