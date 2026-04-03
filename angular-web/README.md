# Claude Web Agent (Angular) + Local Bridge

这个项目现在已经打通“浏览器 Claude -> 本地后端中转 -> 本地文件系统/终端命令/工具调用”的完整链路。

## 架构

- **前端（Angular）**
  - Chat / Settings 页面
  - `claude-core` 运行时
  - `ToolSystem` 已注册桥接工具：
    - `fs.list`
    - `fs.read`
    - `fs.write`
    - `fs.delete`
    - `terminal.exec`
- **本地中转服务（Node.js）**
  - 路径：`local-bridge/server.js`
  - 提供 HTTP + WebSocket 能力
  - 负责本地文件/命令操作与安全控制

## 完整调用链

1. 浏览器内 Claude 触发工具调用
2. `claude-core` 的 `ToolSystem` 调用 bridge tool
3. 前端通过 `/api/tools/call` 请求本地 bridge
4. bridge 执行真实本地文件/终端操作
5. 返回结果给前端和 Claude 会话

终端流式输出通过：
- `ws://127.0.0.1:8787/ws/terminal`

LLM 请求统一通过 bridge：
- `POST /api/llm/messages`
- `POST /api/llm/stream`

## 本地 Bridge API

### Health
- `GET /api/health`

### 文件系统
- `GET /api/fs/list?dir=...`
- `GET /api/fs/read?path=...`
- `POST /api/fs/write`
- `DELETE /api/fs?path=...`

### 终端
- `POST /api/terminal/exec`
- `WS /ws/terminal`

### 工具统一入口
- `POST /api/tools/call`

示例：

```json
{
  "tool": "fs.read",
  "args": { "path": "angular-web/package.json" }
}
```

## 安全机制（上线基础）

- Token 鉴权
  - HTTP Header: `x-bridge-token`
  - WebSocket Query: `token`
- 路径沙箱：限制在 `BRIDGE_ROOT` 内
- 命令白名单：只允许安全命令集合
- 危险模式拦截：阻断高风险命令片段
- 审计日志：`local-bridge/audit.log`

## 环境变量

- `BRIDGE_PORT`（默认 `8787`）
- `BRIDGE_HOST`（默认 `127.0.0.1`）
- `BRIDGE_ROOT`（默认项目上级目录）
- `BRIDGE_TOKEN`（默认 `change-me-bridge-token`，上线必须修改）
- `BRIDGE_CORS_ORIGIN`（默认 `http://localhost:4200`）

## 启动方式

安装依赖：

```bash
npm install
```

启动本地 bridge：

```bash
npm run bridge:start
```

启动前端：

```bash
npm start
```

## 前端桥接配置

前端通过 localStorage 读取：
- `bridge.baseUrl`（默认 `http://127.0.0.1:8787`）
- `bridge.token`（默认 `change-me-bridge-token`）

可在浏览器控制台设置：

```js
localStorage.setItem('bridge.baseUrl', 'http://127.0.0.1:8787');
localStorage.setItem('bridge.token', 'your-strong-token');
```

## 上线建议（下一步）

- 命令 allowlist 做到“命令 + 参数级别”
- 加入速率限制（rate limit）和并发限制
- 增加 TLS（https/wss）
- 桥接服务独立部署（systemd/pm2/winsw）
- tool schema 校验（zod/ajv）
- 细化 RBAC（只读文件模式 / 受限执行模式）
