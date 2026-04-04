# Claude Code Web (CCW)

**Claude Code Web** is a browser-first developer workspace that brings a **Claude Code–style** agent loop to the web: chat, tools, planning, MCP, and skill-style extensions—backed by a **shared TypeScript core** and an **enterprise-grade Angular** shell.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Angular](https://img.shields.io/badge/Angular-17-DD0031?logo=angular)](https://angular.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)

---

## Why CCW

| Highlight | What it means |
|-----------|----------------|
| **Browser-first** | The UI and **`zyfront-core`** runtime run in the browser—no desktop shell required to use the app. |
| **Claude Code–style core** | Assistant loop, context, history, coordinator, tools, plugins, skills, and API clients live in **`zyfront-core`** (browser-safe TypeScript). |
| **Plan Mode** | **`PlanEngine`** + coordinator wiring for structured multi-step workflows (aligned with how you think in “plan then execute”). |
| **Tool system** | **`ToolSystem`** registers agent tools; optional **Local Bridge** adds sandboxed `fs.*`, `terminal.exec`, and related capabilities on your machine. |
| **MCP & extensions** | **MCP**-oriented surfaces in the stack; **plugins** and **skills** registries extend behavior without forking the core. |
| **Enterprise Angular** | Feature-based structure, DI providers, routing, and services—suitable for teams that want a serious SPA around the agent. |

---

## Architecture

```
zyfront-AI/                    # monorepo root
├── zyfront-core/             # Shared library: API, assistant, tools, MCP, skills, plugins, coordinator (TypeScript)
├── zyfront-web/              # Angular 17 SPA — browser client (chat, settings, self-check, Monaco, xterm)
├── zyfront-desktop/          # Electron + same Angular app — desktop shell (`main.js`, packaging via electron-builder)
└── README.md
```

1. The model may request **tool calls** → `zyfront-core` → (when configured) **`POST /api/tools/call`** on the Local Bridge.  
2. The bridge runs **filesystem / terminal** actions inside **`BRIDGE_ROOT`** and returns results for the next model turn.  
3. LLM traffic can be proxied through the bridge (`/api/llm/messages`, `/api/llm/stream`) depending on your setup.

The app is **not** “serverless-only”: the **optional** Local Bridge is a small **Node** process for local dev power. The **product experience** is still a **pure web client** talking to APIs you control. **`zyfront-desktop`** reuses the same UI/runtime patterns inside Electron for a packaged desktop build.

---

## Quick start (web)

From the **`zyfront-web/`** package:

```bash
cd zyfront-web
npm install
npm run bridge:start   # optional: separate terminal (see zyfront-web/local-bridge)
npm start              # ng serve → http://localhost:4200
```

## Quick start (desktop)

From **`zyfront-desktop/`** (build Angular, then Electron or installer):

```bash
cd zyfront-desktop
npm install
npm run electron:start    # ng build + electron .
# or: npm run dist       # Windows NSIS (uses ELECTRON_BUILDER_BINARIES_MIRROR in scripts for mirror-friendly downloads)
```

Configure the client via **`localStorage`**: `bridge.baseUrl`, `bridge.token` (defaults match the bridge).

Build **`zyfront-core`** when you change the library:

```bash
cd zyfront-core
npm install
npm run build
```

---

## Local Bridge (optional)

| Capability | Method / path |
|------------|----------------|
| Health | `GET /api/health` |
| List dir | `GET /api/fs/list?dir=...` |
| Read file | `GET /api/fs/read?path=...` |
| Write file | `POST /api/fs/write` |
| Delete | `DELETE /api/fs?path=...` |
| Terminal | `POST /api/terminal/exec`, `WS /ws/terminal` |
| Tool entry | `POST /api/tools/call` |

Example tool body:

```json
{
  "tool": "fs.read",
  "args": { "path": "zyfront-web/package.json" }
}
```

### Security basics

- Header **`x-bridge-token`** (and WebSocket `token`)  
- Paths confined to **`BRIDGE_ROOT`**  
- Command policy + dangerous-pattern guards  
- Audit log: `local-bridge/audit.log` (gitignored)

### Environment

| Variable | Default |
|----------|---------|
| `BRIDGE_PORT` | `8787` |
| `BRIDGE_HOST` | `127.0.0.1` |
| `BRIDGE_ROOT` | parent of bridge working directory |
| `BRIDGE_TOKEN` | `change-me-bridge-token` — **change this** |
| `BRIDGE_CORS_ORIGIN` | `http://localhost:4200` |

---

## Repo layout & docs

| Location | Purpose |
|----------|---------|
| **Root `README.md`** | Overview, architecture, bridge, security, monorepo map |
| **`zyfront-web/README.md`** | Browser app quick start (if present) |
| **`zyfront-desktop/README.md`** | Electron app / packaging notes (if present) |
| **`zyfront-core/`** | Library source; run `npm run build` after API or type changes |

**Clone root:** Any folder name works; this document uses **`zyfront-AI`** as the repository root directory name.

---

## Contributing & license

Issues and PRs are welcome. **`zyfront-core`** is **MIT**; check each package for details.

---

## Short-form promo (sound bites)

Use these as video titles, hooks, or captions (translate as needed for your audience):

- *“Claude Code Web — the agent loop in the browser.”*  
- *“Plan Mode, tools, MCP-style hooks, skills — one Angular shell.”*  
- *“`zyfront-core` in TypeScript: share logic between web and future hosts.”*  
- *“Optional Local Bridge: real FS and terminal, sandboxed.”*

**Suggested hashtags:** `#ClaudeCodeWeb` `#CCW` `#Angular` `#TypeScript` `#AI` `#WebDev` `#开源`
