/**
 * One-shot: fix mojibake / ??? placeholders in workbench.page.ts (UTF-8).
 * Run: node scripts/fix-workbench-utf8.mjs
 */
import fs from 'node:fs';
import path from 'node:url';
import pathMod from 'node:path';

const __dirname = pathMod.dirname(path.fileURLToPath(import.meta.url));
const p = pathMod.join(__dirname, '../src/app/features/prototype/workbench/workbench.page.ts');
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const pairs = [
  [
    '/** ??????????????????????? */\ninterface MemoryVm {',
    '/** 右侧「捕获的记忆」列表项（角色 + 摘要） */\ninterface MemoryVm {',
  ],
  ['/** ???????? localStorage ? transcript ???? */', '/** 最近会话写入 localStorage；v2 含 transcript 便于完整回放 */'],
  ['/** ??????????????? */', '/** 回放时单条助手内容最大字符数 */'],
  ['  /** ???????????????????? */', '  /** 该会话完整消息序列（点击「最近会话」时按序回放） */'],
  [
    '/** ??????????????????Markdown ??????n??? */',
    '/** 从助手正文中抽取计划步骤（编号列表、Markdown 列表、「步骤n：」） */',
  ],
  [
    "protected readonly selectedContent = signal('???????????????????');",
    "protected readonly selectedContent = signal('在左侧资源管理器中点击文件以在此预览。');",
  ],
  ['/** ?????????Prism ?????? */', '/** 非「主终端」标签：Prism 语法高亮预览 */'],
  [
    '/** ???????? zyfront-core assistant.stream ? cancel ??? */',
    '/** 流式对话取消（与 zyfront-core assistant.stream 的 cancel 对应） */',
  ],
  [
    `  /** ???????/ ??????????????????????? */
  private slashHintRowActive = false;`,
    `  /** 输入 / 指令时：下一行显示同前缀补全，避免刷屏 */
  private slashHintRowActive = false;`,
  ],
  [
    `  /** ????????????????????? */
  private readonly toolMemoryTrace = signal<MemoryVm[]>([]);`,
    `  /** 工具调用轨迹，与历史消息合并为右栏「记忆」 */
  private readonly toolMemoryTrace = signal<MemoryVm[]>([]);`,
  ],
  ['/** ?????????????????????? */', '/** 将历史消息与工具轨迹合并为右栏「捕获的记忆」 */'],
  [
    "m.role === 'user' ? '??' : m.role === 'assistant' ? '??' : m.role === 'tool' ? '??' : '??'",
    "m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role === 'tool' ? '工具' : '系统'",
  ],
  ["snippet: snippet || '?????'", "snippet: snippet || '（空消息）'"],
  ["label: '??'", "label: '工具'"],
  [
    `  /** ????????????????????? */
  private bumpPlanOnToolStart(): void {`,
    `  /** 有计划步骤时：首个工具调用将一步标为进行中 */
  private bumpPlanOnToolStart(): void {`,
  ],
  ['/** ???????????????????????? */', '/** 工具成功返回：当前进行中步骤标为完成并启动下一步 */'],
  [
    `    const map: Record<CoordinationStep['status'], string> = {
      pending: '???',
      in_progress: '???',
      completed: '???',
      cancelled: '???',
    };`,
    `    const map: Record<CoordinationStep['status'], string> = {
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成',
      cancelled: '已取消',
    };`,
  ],
  [
    `    if (sec < 60) return '??';
    if (sec < 3600) return \`\${Math.floor(sec / 60)} ???\`;
    if (sec < 86400) return \`\${Math.floor(sec / 3600)} ???\`;`,
    `    if (sec < 60) return '刚刚';
    if (sec < 3600) return \`\${Math.floor(sec / 60)} 分钟前\`;
    if (sec < 86400) return \`\${Math.floor(sec / 3600)} 小时前\`;`,
  ],
  ['/** ??????? / ?? / ???parallel? */', '/** 右侧展示：对话 / 计划 / 执行（parallel） */'],
  [
    `    const map: Record<CoordinationMode, string> = {
      single: '????',
      plan: '????',
      parallel: '????',
    };`,
    `    const map: Record<CoordinationMode, string> = {
      single: '对话模式',
      plan: '计划模式',
      parallel: '执行模式',
    };`,
  ],
  [
    "const text = window.prompt('?????????????????');",
    "const text = window.prompt('每行一条计划步骤，粘贴后确定保存：');",
  ],
  [
    `  /** ??????????????????????? */
  private async appendRecentTurnAfterSuccess(userPrompt: string): Promise<void> {`,
    `  /** 助手回复成功后：拉取完整 history 写入最近会话的 transcript */
  private async appendRecentTurnAfterSuccess(userPrompt: string): Promise<void> {`,
  ],
  ['/** plan ?????????????????????? */', '/** plan 模式：从最近一条助手消息解析步骤并写入协调器 */'],
  ['this.pushToolMemory(`?? ${name}`)', 'this.pushToolMemory(`调用 ${name}`)'],
  [
    'this.aiXtermWrite(`\\r\\n\\x1b[36m[??]\\x1b[0m \\x1b[1m${name}\\x1b[0m\\x1b[90m ?\\x1b[0m`);',
    'this.aiXtermWrite(`\\r\\n\\x1b[36m[工具]\\x1b[0m \\x1b[1m${name}\\x1b[0m\\x1b[90m …\\x1b[0m`);',
  ],
  [
    "const tag = ok ? '\\x1b[32m??\\x1b[0m' : '\\x1b[31m??\\x1b[0m';",
    "const tag = ok ? '\\x1b[32m完成\\x1b[0m' : '\\x1b[31m失败\\x1b[0m';",
  ],
  [
    "this.pushToolMemory(ok ? '??????' : `?????${(error ?? '').slice(0, 80)}`);",
    "this.pushToolMemory(ok ? '工具调用完成' : `工具失败：${(error ?? '').slice(0, 80)}`);",
  ],
  [
    'this.aiXtermWrite(`\\r\\n\\x1b[36m[????]\\x1b[0m ${tag}${detail}\\r\\n`);',
    'this.aiXtermWrite(`\\r\\n\\x1b[36m[工具结果]\\x1b[0m ${tag}${detail}\\r\\n`);',
  ],
  [
    "          '\\r\\n\\x1b[33m[??]\\x1b[0m Ctrl+C ?? ? Ctrl+Shift+C ?? ? Ctrl+Shift+V ?? ? Ctrl+L ?? ? Shift+Tab ????\\r\\n',",
    "          '\\r\\n\\x1b[33m[提示]\\x1b[0m Ctrl+C 中断 · Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴 · Ctrl+L 清屏 · Shift+Tab 切换模式\\r\\n',",
  ],
  [
    "      '\\x1b[90m????shell??? ! ??????? / ?????Tab ???Shift+Tab ?? ??/??/?????? Ctrl+C ???\\x1b[0m\\r\\n',",
    "      '\\x1b[90m主终端：shell；前加 ! 显式执行。输入 / 时下一行实时显示同前缀指令；Tab 补全；Shift+Tab 切换 对话/计划/执行；流式时 Ctrl+C 中断。\\x1b[0m\\r\\n',",
  ],
  ['/** Ctrl+C?????????????????? */', '/** Ctrl+C：取消流式请求；空闲时清空当前输入行 */'],
  ["this.aiXtermWrite('\\r\\n\\x1b[33m[??]\\x1b[0m\\r\\n');", "this.aiXtermWrite('\\r\\n\\x1b[33m[中断]\\x1b[0m\\r\\n');"],
  ['this.aiXtermWrite(`\\r\\n\\x1b[36m[??]\\x1b[0m ${label} (${next})\\r\\n`);', 'this.aiXtermWrite(`\\r\\n\\x1b[36m[模式]\\x1b[0m ${label} (${next})\\r\\n`);'],
  ["this.selectedContent.set('????????');", "this.selectedContent.set('无法读取该文件。');"],
  [
    'this.aiXtermWrite(`\\r\\n[warn] ?????${parsed.name}\\r\\n`);',
    'this.aiXtermWrite(`\\r\\n[warn] 未知指令：${parsed.name}\\r\\n`);',
  ],
  [
    "this.aiXtermWrite('\\r\\n[help] ?????????????????????\\r\\n');",
    "this.aiXtermWrite('\\r\\n[help] 可用指令（自然语言直接回车即可提问助手）：\\r\\n');",
  ],
  [
    "            '\\x1b[90m???? plan???????????????????????????\\x1b[0m\\r\\n',",
    "            '\\x1b[90m已切换为 plan：助手若回复带编号列表，会自动同步到右侧「计划步骤」。\\x1b[0m\\r\\n',",
  ],
  [
    "await this.askAssistant('????? workspace ??????????????????');",
    "await this.askAssistant('请根据当前 workspace 根目录，简要分析项目结构与关键入口。');",
  ],
  [
    "return '\\r\\n\\x1b[90m?????????401?????API ????? API Key?\\x1b[0m';",
    "return '\\r\\n\\x1b[90m提示：疑似未授权（401）。请到「API 设置」检查 API Key。\\x1b[0m';",
  ],
  [
    "this.aiXtermWrite('\\r\\n\\x1b[31m[error]\\x1b[0m ??????\\r\\n');",
    "this.aiXtermWrite('\\r\\n\\x1b[31m[error]\\x1b[0m 请输入内容。\\r\\n');",
  ],
  [
    "        '\\r\\n\\x1b[31m[error]\\x1b[0m ??? API Key?\\x1b[90m ????API ???????????\\x1b[0m\\r\\n',",
    "        '\\r\\n\\x1b[31m[error]\\x1b[0m 未配置 API Key。\\x1b[90m 请打开「API 设置」填写密钥后再试。\\x1b[0m\\r\\n',",
  ],
  [
    "this.aiXtermWrite('\\x1b[90m???????\\x1b[0m\\r\\n');",
    "this.aiXtermWrite('\\x1b[90m正在请求助手…\\x1b[0m\\r\\n');",
  ],
  [
    "this.aiXtermWrite('\\r\\n[error] ??????\\r\\n');",
    "this.aiXtermWrite('\\r\\n[error] 流被异常终止\\r\\n');",
  ],
  [
    "const msg = error instanceof Error ? error.message : '????';",
    "const msg = error instanceof Error ? error.message : '未知错误';",
  ],
  [
    "this.aiXtermWrite('\\r\\n\\x1b[33m[???]\\x1b[0m\\r\\n');",
    "this.aiXtermWrite('\\r\\n\\x1b[33m[已中断]\\x1b[0m\\r\\n');",
  ],
  [
    "this.aiXtermWrite('\\r\\n\\x1b[90m?????\\x1b[0m\\r\\n');",
    "this.aiXtermWrite('\\r\\n\\x1b[90m本轮结束。\\x1b[0m\\r\\n');",
  ],
  [
    '  /** ?? `/` ??????????????????????????? */\n  private syncSlashCompletionRow(): void {',
    '  /** 输入 `/` 前缀时：在下一行实时刷新「同前缀指令」，不追加多行说明 */\n  private syncSlashCompletionRow(): void {',
  ],
  [
    "        : '\\x1b[90m(???)\\x1b[0m';",
    "        : '\\x1b[90m(无匹配)\\x1b[0m';",
  ],
];

for (const [a, b] of pairs) {
  if (!s.includes(a)) {
    console.error('MISSING fragment:\n', a.slice(0, 120));
    process.exit(1);
  }
  s = s.split(a).join(b);
}

fs.writeFileSync(p, s.replace(/\n/g, '\r\n'), 'utf8');
console.log('OK', p);
