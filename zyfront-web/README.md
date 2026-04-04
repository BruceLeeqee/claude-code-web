# claude-web（Angular 前端）

本目录为 **claude-code-web** 仓库中的 Angular 应用与 **local-bridge** 入口。

## 常用命令

```bash
npm install
npm run bridge:start   # 本机 Bridge（默认 :8787）
npm start              # ng serve（默认 :4200）
npm run build
```

## 说明

- 端到端架构、Bridge API、安全与环境变量见仓库根目录 [**../README.md**](../README.md)。
- Bridge 脚本：`./local-bridge/server.js`（`npm run bridge:start`）。
- `zyfront-core` 依赖：`file:../zyfront-core`（与核心包并列于仓库根目录）。
