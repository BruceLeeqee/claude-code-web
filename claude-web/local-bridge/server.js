/**
 * 本地 Bridge（Node + Express）
 * - 为前端提供受 BRIDGE_ROOT 约束的文件读写、目录列表、终端命令（白名单）、工具统一入口
 * - WebSocket 交互式终端（需 token）
 * - 代理探测上游 Anthropic 兼容 API，避免浏览器 CORS
 * 环境变量：BRIDGE_PORT, BRIDGE_HOST, BRIDGE_ROOT, BRIDGE_TOKEN, BRIDGE_CORS_ORIGIN
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.BRIDGE_PORT || 8787);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const ROOT = path.resolve(process.env.BRIDGE_ROOT || path.resolve(process.cwd(), '..'));
const TOKEN = process.env.BRIDGE_TOKEN || 'change-me-bridge-token';
const CORS_ORIGIN = process.env.BRIDGE_CORS_ORIGIN || 'http://localhost:4200';
const AUDIT_LOG_PATH = path.resolve(process.cwd(), 'local-bridge', 'audit.log');

/** 允许 terminal.exec 使用的命令名列表（仅检查首个 token） */
const DEFAULT_ALLOWED_COMMANDS = [
  'git',
  'npm',
  'pnpm',
  'yarn',
  'node',
  'npx',
  'python',
  'pip',
  'ls',
  'dir',
  'echo',
  'type',
  'cat',
  'rg',
  'tsc',
  'start',
  'explorer',
  'cmd',
];
/** local.open_app 允许启动的 Windows 程序 */
const ALLOWED_OPEN_APPS = ['notepad', 'calc', 'mspaint'];
/** 明确拒绝的危险命令片段 */
const BLOCKED_COMMANDS = ['rm -rf /', 'shutdown', 'reboot', 'format', 'mkfs'];

const sessions = new Map();

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '4mb' }));

/** 追加一行 JSON 审计日志（失败静默） */
function appendAudit(record) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
  try {
    fssync.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fssync.appendFileSync(AUDIT_LOG_PATH, line, 'utf8');
  } catch {
    // ignore audit write failures
  }
}

/** 从 Header 或 Query 读取 bridge token */
function extractAuthToken(req) {
  const headerToken = req.headers['x-bridge-token'];
  if (typeof headerToken === 'string') return headerToken;
  return String(req.query.token || '');
}

/** 校验 x-bridge-token / token 与 BRIDGE_TOKEN 一致 */
function authGuard(req, res, next) {
  const incoming = extractAuthToken(req);
  if (!incoming || incoming !== TOKEN) {
    appendAudit({ type: 'auth_denied', ip: req.ip, path: req.path });
    return res.status(401).json({ ok: false, error: 'Unauthorized bridge access' });
  }
  return next();
}

/** 将相对路径解析为 ROOT 下的绝对路径，并禁止跳出沙箱 */
function resolveSafe(inputPath = '.') {
  const abs = path.resolve(ROOT, inputPath);
  if (!abs.startsWith(ROOT)) {
    throw new Error('Path is outside allowed root');
  }
  return abs;
}

/** 非空路径且不能等于沙箱根目录，避免把「工作区文件夹」当文件读写 */
function resolveSafeFilePath(relPath, toolName) {
  const trimmed = String(relPath ?? '').trim();
  if (!trimmed) {
    throw new Error(
      `${toolName}: path is required (non-empty path under the workspace, e.g. "docs/notes.md")`
    );
  }
  const abs = resolveSafe(trimmed);
  if (path.normalize(abs) === path.normalize(ROOT)) {
    throw new Error(
      `${toolName}: path cannot be the workspace root or "." — use a concrete file path (e.g. "output/slides.pptx").`
    );
  }
  return abs;
}

/** 校验命令非空、无黑名单片段且首词在白名单 */
function ensureCommandAllowed(command) {
  const normalized = String(command || '').trim();
  if (!normalized) throw new Error('Empty command is not allowed');

  for (const bad of BLOCKED_COMMANDS) {
    if (normalized.toLowerCase().includes(bad.toLowerCase())) {
      throw new Error(`Blocked dangerous command pattern: ${bad}`);
    }
  }

  const commandName = normalized.split(/\s+/)[0]?.toLowerCase();
  if (!DEFAULT_ALLOWED_COMMANDS.includes(commandName)) {
    throw new Error(`Command not in allowlist: ${commandName}`);
  }
}

/** 在沙箱 cwd 下用 shell 执行命令，带超时杀进程 */
async function runCommand(command, cwd = '.', timeoutMs = 15000) {
  ensureCommandAllowed(command);
  const safeCwd = resolveSafe(cwd);

  const output = await new Promise((resolve) => {
    const child = spawn(command, {
      cwd: safeCwd,
      shell: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (buf) => {
      stdout += buf.toString();
    });

    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
    }, Math.max(500, Number(timeoutMs) || 15000));

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });

  return { command, cwd: safeCwd, ...output };
}

app.use('/api', authGuard);

const UPSTREAM_BASE_URL = (process.env.BRIDGE_UPSTREAM_BASE_URL || 'https://api.minimaxi.com/anthropic').replace(/\/$/, '');

/** Proxy to Anthropic-compatible POST /v1/messages. Streaming uses the same path; the JSON body must include "stream": true (set by claude-core). */
async function forwardToUpstream(req, res, isStream, upstreamPath) {
  try {
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];

    const upstreamHeaders = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (typeof authHeader === 'string' && authHeader.trim()) {
      upstreamHeaders.Authorization = authHeader;
    } else if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
      upstreamHeaders['x-api-key'] = apiKeyHeader;
      upstreamHeaders.Authorization = `Bearer ${apiKeyHeader}`;
    } else {
      return res.status(401).json({ ok: false, error: 'Missing Authorization or x-api-key header' });
    }

    const url = `${UPSTREAM_BASE_URL}${upstreamPath}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(req.body || {}),
    });

    appendAudit({
      type: isStream ? 'proxy_stream' : 'proxy_message',
      path: upstreamPath,
      status: upstream.status,
    });

    if (isStream) {
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/plain; charset=utf-8');
      if (!upstream.body) {
        return res.end();
      }
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (error) {
    appendAudit({ type: 'proxy_error', path: upstreamPath, error: String(error.message || error) });
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
}

app.post('/api/llm/messages', authGuard, async (req, res) => {
  await forwardToUpstream(req, res, false, '/v1/messages');
});

app.post('/api/llm/stream', authGuard, async (req, res) => {
  await forwardToUpstream(req, res, true, '/v1/messages');
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, root: ROOT, now: Date.now(), version: '1.0.0' });
});

app.get('/api/debug/routes', (_req, res) => {
  const routes = [];
  const stack = app?._router?.stack ?? [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    const methods = Object.keys(layer.route.methods ?? {}).filter((k) => layer.route.methods[k]);
    routes.push({ path, methods });
  }
  res.json({ ok: true, routes });
});

app.get('/api/fs/list', async (req, res) => {
  try {
    const dir = resolveSafe(String(req.query.dir || '.'));
    const entries = await fs.readdir(dir, { withFileTypes: true });
    appendAudit({ type: 'fs_list', dir });
    res.json({
      ok: true,
      dir,
      entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

app.get('/api/fs/read', async (req, res) => {
  try {
    const target = resolveSafe(String(req.query.path || ''));
    const content = await fs.readFile(target, 'utf8');
    appendAudit({ type: 'fs_read', path: target });
    res.json({ ok: true, path: target, content });
  } catch (error) {
    res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

app.post('/api/fs/write', async (req, res) => {
  try {
    const { path: targetPath, content } = req.body || {};
    if (!targetPath || typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'path and content are required' });
    }

    const target = resolveSafe(targetPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    appendAudit({ type: 'fs_write', path: target, bytes: Buffer.byteLength(content, 'utf8') });
    return res.json({ ok: true, path: target });
  } catch (error) {
    return res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

app.delete('/api/fs', async (req, res) => {
  try {
    const target = resolveSafe(String(req.query.path || ''));
    await fs.rm(target, { recursive: true, force: true });
    appendAudit({ type: 'fs_delete', path: target });
    res.json({ ok: true, path: target });
  } catch (error) {
    res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

app.post('/api/terminal/exec', async (req, res) => {
  const { command, cwd = '.', timeoutMs = 15000 } = req.body || {};
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ ok: false, error: 'command is required' });
  }

  try {
    const output = await runCommand(command, cwd, timeoutMs);
    appendAudit({ type: 'terminal_exec', command, cwd: output.cwd, code: output.code });
    return res.json({ ok: true, ...output });
  } catch (error) {
    appendAudit({ type: 'terminal_exec_error', command, error: String(error.message || error) });
    return res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

app.post('/api/model/test', async (req, res) => {
  const { baseUrl, apiKey, model, provider = 'minimax' } = req.body || {};
  if (!baseUrl || !apiKey || !model) {
    return res.status(400).json({ ok: false, error: 'baseUrl, apiKey, model are required' });
  }

  try {
    const url = `${String(baseUrl).replace(/\/$/, '')}/v1/messages`;
    const body = {
      model,
      max_tokens: 64,
      temperature: 0,
      messages: [{ role: 'user', content: 'ping' }],
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'x-provider': String(provider),
    };

    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    appendAudit({ type: 'model_test', baseUrl, model, status: upstream.status });

    return res.status(upstream.ok ? 200 : 400).json({
      ok: upstream.ok,
      status: upstream.status,
      body: text,
    });
  } catch (error) {
    appendAudit({ type: 'model_test_error', error: String(error.message || error) });
    return res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

/** Agent 工具统一入口：fs.* / terminal.exec / local.open_app 等 */
app.post('/api/tools/call', async (req, res) => {
  const { tool, args } = req.body || {};
  try {
    if (tool === 'fs.list') return res.json(await fsListTool(args));
    if (tool === 'fs.read') return res.json(await fsReadTool(args));
    if (tool === 'fs.write') return res.json(await fsWriteTool(args));
    if (tool === 'fs.delete') return res.json(await fsDeleteTool(args));
    if (tool === 'terminal.exec') return res.json(await terminalExecTool(args));
    if (tool === 'local.open_app') return res.json(await openLocalAppTool(args));
    return res.status(400).json({ ok: false, error: `Unsupported tool: ${tool}` });
  } catch (error) {
    return res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

/** 工具：列目录 */
async function fsListTool(args = {}) {
  const dir = resolveSafe(String(args.dir || '.'));
  const entries = await fs.readdir(dir, { withFileTypes: true });
  appendAudit({ type: 'tool_fs_list', dir });
  return {
    ok: true,
    tool: 'fs.list',
    data: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
  };
}

/** 工具：读文本文件 */
async function fsReadTool(args = {}) {
  const target = resolveSafeFilePath(args.path, 'fs.read');
  const content = await fs.readFile(target, 'utf8');
  appendAudit({ type: 'tool_fs_read', path: target });
  return { ok: true, tool: 'fs.read', data: { path: target, content } };
}

/** 工具：写 UTF-8 文本；禁止根路径与已存在目录 */
async function fsWriteTool(args = {}) {
  const target = resolveSafeFilePath(args.path, 'fs.write');
  const content = String(args.content ?? '');
  try {
    const st = await fs.stat(target);
    if (st.isDirectory()) {
      throw new Error(
        'fs.write: path is a directory, not a file. Use a file path such as "exports/deck.pptx".'
      );
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      // create new file
    } else {
      throw e;
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  appendAudit({ type: 'tool_fs_write', path: target, bytes: Buffer.byteLength(content, 'utf8') });
  return { ok: true, tool: 'fs.write', data: { path: target } };
}

/** 工具：删除文件或目录（递归） */
async function fsDeleteTool(args = {}) {
  const target = resolveSafeFilePath(args.path, 'fs.delete');
  await fs.rm(target, { recursive: true, force: true });
  appendAudit({ type: 'tool_fs_delete', path: target });
  return { ok: true, tool: 'fs.delete', data: { path: target } };
}

/** 工具：打开白名单 Windows 应用 */
async function openLocalAppTool(args = {}) {
  const app = String(args.app || '').toLowerCase();
  if (!ALLOWED_OPEN_APPS.includes(app)) {
    throw new Error(`App not in allowlist: ${app}`);
  }

  const windowsCommand = app === 'notepad' ? 'start "" notepad' : app === 'calc' ? 'start "" calc' : 'start "" mspaint';
  const out = await runCommand(windowsCommand, '.', 5000);
  appendAudit({ type: 'tool_open_local_app', app, code: out.code });
  return { ok: true, tool: 'local.open_app', data: { app, ...out } };
}

/** 工具：执行 shell 命令（内部调用 runCommand） */
async function terminalExecTool(args = {}) {
  const out = await runCommand(String(args.command || ''), String(args.cwd || '.'), Number(args.timeoutMs || 15000));
  appendAudit({ type: 'tool_terminal_exec', command: out.command, cwd: out.cwd, code: out.code });
  return { ok: true, tool: 'terminal.exec', data: out };
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Local bridge listening on http://${HOST}:${PORT}`);
  console.log(`Allowed root: ${ROOT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});

const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, `http://${HOST}:${PORT}`).searchParams;
  const token = params.get('token') || '';
  if (!token || token !== TOKEN) {
    ws.send(JSON.stringify({ type: 'error', data: 'Unauthorized websocket access' }));
    ws.close();
    appendAudit({ type: 'ws_auth_denied', ip: req.socket?.remoteAddress || 'unknown' });
    return;
  }

  const sessionId = params.get('sessionId') || `s_${crypto.randomUUID()}`;
  sessions.set(sessionId, { child: null });

  ws.send(JSON.stringify({ type: 'ready', ts: Date.now(), sessionId }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const session = sessions.get(sessionId);
      if (!session) return;

      if (msg.type === 'exec') {
        if (session.child) {
          ws.send(JSON.stringify({ type: 'error', data: 'A command is already running in this session' }));
          return;
        }

        ensureCommandAllowed(msg.command);
        const safeCwd = resolveSafe(msg.cwd || '.');
        const child = spawn(msg.command, { cwd: safeCwd, shell: true, env: process.env });
        session.child = child;

        appendAudit({ type: 'ws_exec', sessionId, command: msg.command, cwd: safeCwd });

        child.stdout.on('data', (buf) => ws.send(JSON.stringify({ type: 'stdout', data: buf.toString(), sessionId })));
        child.stderr.on('data', (buf) => ws.send(JSON.stringify({ type: 'stderr', data: buf.toString(), sessionId })));
        child.on('close', (code) => {
          ws.send(JSON.stringify({ type: 'exit', code: code ?? 0, sessionId }));
          appendAudit({ type: 'ws_exit', sessionId, code: code ?? 0 });
          session.child = null;
        });
      }

      if (msg.type === 'kill' && session.child) {
        session.child.kill();
        appendAudit({ type: 'ws_kill', sessionId });
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', data: String(error.message || error) }));
    }
  });

  ws.on('close', () => {
    const session = sessions.get(sessionId);
    if (session?.child) session.child.kill();
    sessions.delete(sessionId);
    appendAudit({ type: 'ws_close', sessionId });
  });
});
