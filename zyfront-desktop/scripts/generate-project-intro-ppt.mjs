import PptxGenJS from 'pptxgenjs';
import path from 'node:path';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'ZyTrader Desktop';
pptx.company = 'ZyFront AI';
pptx.subject = 'Project Introduction';
pptx.title = 'ZyFront AI / ZyTrader Desktop 项目介绍';
pptx.lang = 'zh-CN';

const theme = {
  bg: '0F172A',
  card: '1E293B',
  accent: '38BDF8',
  text: 'E2E8F0',
  sub: '94A3B8',
};

function title(slide, t, s) {
  slide.background = { color: theme.bg };
  slide.addText(t, { x: 0.7, y: 0.5, w: 12.0, h: 0.6, color: theme.text, fontSize: 30, bold: true });
  if (s) slide.addText(s, { x: 0.7, y: 1.2, w: 12.0, h: 0.4, color: theme.sub, fontSize: 14 });
  slide.addShape(pptx.ShapeType.line, { x: 0.7, y: 1.65, w: 2.6, h: 0, line: { color: theme.accent, pt: 2 } });
}

// 1 封面
{
  const s = pptx.addSlide();
  title(s, 'ZyFront AI / ZyTrader Desktop', '项目介绍与当前建设进展');
  s.addText('面向本地可控 AI 工作台的桌面化实现', {
    x: 0.7, y: 2.3, w: 8.8, h: 0.6, color: theme.text, fontSize: 20, bold: true,
  });
  s.addText('关键方向：Workbench + Vault 记忆体系 + ClawHub 技能生态', {
    x: 0.7, y: 3.0, w: 11.5, h: 0.5, color: theme.sub, fontSize: 14,
  });
}

// 2 项目定位
{
  const s = pptx.addSlide();
  title(s, '1. 项目定位', '统一人类笔记、Agent 记忆与开发工作流');
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.7, y: 2.0, w: 12.0, h: 3.8,
    fill: { color: theme.card }, line: { color: '334155', pt: 1 }, radius: 0.1,
  });
  s.addText([
    { text: '• 桌面端内置 Workbench：', options: { bold: true } },
    { text: '集成终端、编辑器、任务拆解与记忆面板\n' },
    { text: '• Vault 目录规范：', options: { bold: true } },
    { text: '统一管理 INBOX / HUMAN-NOTES / AGENT-MEMORY / PROJECTS / RESOURCES\n' },
    { text: '• 本地优先：', options: { bold: true } },
    { text: '文件可见、可追溯、可备份，避免黑盒\n' },
    { text: '• 可扩展：', options: { bold: true } },
    { text: '通过工具、技能与规则引擎持续增强自动化能力' },
  ], { x: 1.1, y: 2.35, w: 11.2, h: 3.2, color: theme.text, fontSize: 15, breakLine: true });
}

// 3 核心架构
{
  const s = pptx.addSlide();
  title(s, '2. 核心架构', 'Electron 主进程 + Angular 前端 + 本地文件系统');
  const cols = [
    { x: 0.8, title: 'Desktop Shell', body: 'main.js / preload.js\nIPC 能力桥接\n终端与文件访问' },
    { x: 4.6, title: 'Workbench UI', body: 'Angular 页面\nMonaco 编辑器\n任务与记忆可视化' },
    { x: 8.4, title: 'Local Vault', body: 'Obsidian-Agent-Vault\n标准目录与配置\n记忆持久化' },
  ];
  for (const c of cols) {
    s.addShape(pptx.ShapeType.roundRect, {
      x: c.x, y: 2.0, w: 3.2, h: 3.4,
      fill: { color: theme.card }, line: { color: '334155', pt: 1 }, radius: 0.08,
    });
    s.addText(c.title, { x: c.x + 0.2, y: 2.25, w: 2.8, h: 0.35, color: theme.accent, bold: true, fontSize: 14 });
    s.addText(c.body, { x: c.x + 0.2, y: 2.75, w: 2.8, h: 2.4, color: theme.text, fontSize: 12, breakLine: true });
  }
}

// 4 当前进展
{
  const s = pptx.addSlide();
  title(s, '3. 当前进展', '近期已落地能力（摘要）');
  const items = [
    'Vault bootstrap / resolve IPC 已打通，支持标准目录初始化',
    'Workbench 目录树支持固定结构展示与空目录提示',
    'AgentMemoryService 已支持 short/long/context 读写更新',
    'ClawHub 技能页已接入 CLI 搜索/安装/更新/日志展示',
    '技能安装来源标注（builtin/custom/clawhub）已可视化',
  ];
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 1.9, w: 12.0, h: 4.2, fill: { color: theme.card }, line: { color: '334155', pt: 1 }, radius: 0.08,
  });
  s.addText(items.map((x) => `• ${x}`).join('\n'), {
    x: 1.1, y: 2.25, w: 11.3, h: 3.6, color: theme.text, fontSize: 14, breakLine: true,
  });
}

// 5 下一步
{
  const s = pptx.addSlide();
  title(s, '4. 下一步规划', '稳定性、可观测性与生态扩展');
  s.addText('短期（1~2 周）', { x: 0.8, y: 2.0, w: 3.2, h: 0.4, color: theme.accent, bold: true, fontSize: 14 });
  s.addText('• 规则引擎声明式配置落地\n• memory tool 全链路回归\n• 关键页面样式预算优化', {
    x: 0.8, y: 2.45, w: 4.0, h: 2.0, color: theme.text, fontSize: 12,
  });
  s.addText('中期（1~2 月）', { x: 4.8, y: 2.0, w: 3.2, h: 0.4, color: theme.accent, bold: true, fontSize: 14 });
  s.addText('• ClawHub 配置与鉴权 UI\n• 记忆检索增强（跨笔记/记忆）\n• 项目级自动化规则模板', {
    x: 4.8, y: 2.45, w: 4.0, h: 2.0, color: theme.text, fontSize: 12,
  });
  s.addText('长期', { x: 8.8, y: 2.0, w: 3.2, h: 0.4, color: theme.accent, bold: true, fontSize: 14 });
  s.addText('• 多 Agent 协同\n• 云同步能力\n• 记忆图谱可视化决策支持', {
    x: 8.8, y: 2.45, w: 3.6, h: 2.0, color: theme.text, fontSize: 12,
  });
}

const out = path.resolve('E:/zyfront-AI/zyfront-desktop/output/project-intro-zyfront-ai.pptx');
await pptx.writeFile({ fileName: out });
console.log(`PPT generated: ${out}`);
