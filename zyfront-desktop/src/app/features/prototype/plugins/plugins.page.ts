import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { UiTool } from '../../../shared/prototype-core.facade';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';

interface HubPluginItem {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  author: string;
}

const PLUGIN_FALLBACK_ITEMS: HubPluginItem[] = [
  { id: 'plugin.github-context', name: 'GitHub Context', desc: '读取 PR / Issue / Commit 上下文并注入代理。', tags: ['GitHub', 'MCP'], author: 'ClawHub' },
  { id: 'plugin.jira-sync', name: 'Jira Sync', desc: '同步需求状态并生成任务推进建议。', tags: ['Jira', 'PM'], author: 'ClawHub' },
  { id: 'plugin.postgres-explorer', name: 'Postgres Explorer', desc: '查询 schema、索引与执行计划。', tags: ['DB', 'MCP'], author: 'ClawHub' },
  { id: 'plugin.redis-insight', name: 'Redis Insight', desc: '缓存键扫描与热点分析。', tags: ['Redis'], author: 'ClawHub' },
  { id: 'plugin.k8s-operator', name: 'K8s Operator', desc: '查看集群资源与事件告警。', tags: ['K8s', 'DevOps'], author: 'ClawHub' },
  { id: 'plugin.openapi-assist', name: 'OpenAPI Assist', desc: '解析 API 规范并生成调用模板。', tags: ['API'], author: 'ClawHub' },
];

@Component({
  selector: 'app-plugins-page',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, NzButtonModule, NzInputModule],
  templateUrl: './plugins.page.html',
  styleUrls: ['../prototype-page.scss', './plugins.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginsPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);

  protected readonly pluginQuery = signal('openclaw plugin');
  protected readonly toolQuery = signal('');
  protected readonly loadingPlugins = signal(false);
  protected readonly installingPluginIds = signal<Record<string, boolean>>({});
  protected readonly hubError = signal('');
  protected readonly commandLog = signal('');
  protected readonly toolCategoryFilter = signal<'all' | UiTool['category']>('all');

  protected readonly clawHubPlugins = signal<HubPluginItem[]>([]);

  protected readonly filteredPlugins = computed(() => {
    const q = this.pluginQuery().trim().toLowerCase();
    return this.clawHubPlugins().filter((x) => !q || `${x.id} ${x.name} ${x.desc}`.toLowerCase().includes(q));
  });

  protected readonly availableTools = computed(() => {
    const q = this.toolQuery().trim().toLowerCase();
    const cat = this.toolCategoryFilter();
    return this.facade.tools().filter((x) => {
      if (cat !== 'all' && x.category !== cat) return false;
      return !q || `${x.id} ${x.name} ${x.desc} ${x.category}`.toLowerCase().includes(q);
    });
  });

  constructor() {
    void this.refreshPluginsFromHub();
    void this.detectPluginCli();
  }

  protected async refreshPluginsFromHub(): Promise<void> {
    const q = this.pluginQuery().trim() || 'openclaw plugin';
    this.loadingPlugins.set(true);
    this.hubError.set('');

    try {
      const text = await this.searchHub(`${q}`);
      const parsed = this.parseSearchOutput(text);
      this.clawHubPlugins.set(parsed.length ? parsed : PLUGIN_FALLBACK_ITEMS);
    } catch (e) {
      this.hubError.set(e instanceof Error ? e.message : '插件市场加载失败');
      this.clawHubPlugins.set([]);
    } finally {
      this.loadingPlugins.set(false);
    }
  }

  protected isPluginInstalled(id: string): boolean {
    return this.facade.plugins().some((p) => p.id === id && p.installed);
  }

  protected isInstallingPlugin(id: string): boolean {
    return Boolean(this.installingPluginIds()[id]);
  }

  protected async installPluginFromHub(item: HubPluginItem): Promise<void> {
    if (this.isPluginInstalled(item.id)) return;

    this.installingPluginIds.update((m) => ({ ...m, [item.id]: true }));
    this.hubError.set('');

    try {
      const cmd = `openclaw plugins install clawhub:${this.escapeArg(item.id)} --yes`;
      const run = await window.zytrader.terminal.exec(cmd, '.');
      let output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim();
      this.appendLog(`$ ${cmd}\n${output}`);

      if (!run.ok && /unknown option|not recognized|not found|command not found|不是内部或外部命令/i.test(output)) {
        const fallback = await window.zytrader.terminal.exec(`openclaw plugins install clawhub:${this.escapeArg(item.id)}`, '.');
        output = `${fallback.stdout ?? ''}\n${fallback.stderr ?? ''}`.trim();
        this.appendLog(`$ openclaw plugins install clawhub:${item.id}\n${output}`);
        if (!fallback.ok) throw new Error(output || '安装插件失败');
      } else if (!run.ok) {
        throw new Error(output || '安装插件失败');
      }

      this.facade.togglePlugin(item.id);
    } catch (e) {
      this.hubError.set(e instanceof Error ? e.message : '安装插件失败');
    } finally {
      this.installingPluginIds.update((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
    }
  }

  protected setToolCategoryFilter(v: 'all' | UiTool['category']): void {
    this.toolCategoryFilter.set(v);
  }

  protected categoryLabel(c: UiTool['category']): string {
    const m: Record<UiTool['category'], string> = {
      file: '文件',
      search: '搜索',
      web: '联网',
      terminal: '终端',
      planning: '任务',
      analysis: '分析',
      question: '问答',
    };
    return m[c] ?? c;
  }

  protected toolDetailLines(tool: UiTool): string[] {
    const byId: Record<string, string[]> = {
      'tool.files.read': ['作用：读取文件内容。', '典型场景：查看源码/日志。', '注意：大文件建议分段读取。'],
      'tool.files.write': ['作用：写入或覆盖文件。', '典型场景：生成配置/脚本。', '注意：覆盖写入不可逆。'],
      'tool.files.edit': ['作用：精确替换文件片段。', '典型场景：补丁修改。', '注意：oldString 必须精确命中。'],
      'tool.files.glob': ['作用：按模式查找路径。', '典型场景：批量定位文件。', '注意：当前为轻量 glob 语义。'],
      'tool.files.grep': ['作用：全文搜索匹配行。', '典型场景：定位调用点。', '注意：当前为简化 grep 能力。'],
      'tool.web.search': ['作用：联网检索信息。', '典型场景：查询最新资料。', '注意：当前为降级搜索实现。'],
      'tool.web.fetch': ['作用：抓取网页正文。', '典型场景：提取文档文本。', '注意：受网络/CORS/站点限制。'],
      'tool.todo.write': ['作用：维护任务清单。', '典型场景：复杂任务拆解。', '注意：支持 merge/replace。'],
      'tool.ask.question': ['作用：结构化提问。', '典型场景：收集选项决策。', '注意：当前为降级回填实现。'],
      'tool.plan.enter': ['作用：进入计划模式。', '典型场景：先计划再执行。', '注意：依赖运行时协调器。'],
      'tool.plan.exit': ['作用：退出计划模式。', '典型场景：计划完成后恢复执行。', '注意：会切回 single 模式。'],
      'tool.task.stop': ['作用：请求停止当前任务。', '典型场景：中断错误流程。', '注意：为协作式中断。'],
      'tool.tool.search': ['作用：搜索可用工具。', '典型场景：模型工具路由前检索。', '注意：按名称/描述关键词匹配。'],
      'tool.tools.doctor': ['作用：输出工具健康度总览。', '典型场景：查看 native/degraded 数量。', '注意：用于运行时能力盘点。'],
      'tool.notebook.edit': ['作用：编辑 ipynb 指定单元。', '典型场景：自动修改实验笔记本。', '注意：当前支持最小 JSON 单元写入。'],
      'tool.brief.generate': ['作用：生成简要摘要。', '典型场景：快速压缩长文本信息。', '注意：可用 maxChars 控制摘要长度。'],
      'tool.skill.run': ['作用：执行技能模板（降级）。', '典型场景：串联技能流程验证。', '注意：当前为本地降级执行。'],
      'tool.mcp.list_resources': ['作用：列出 MCP 资源（降级）。', '典型场景：先做资源目录探查。', '注意：当前依赖本地注册表回退。'],
      'tool.mcp.read_resource': ['作用：读取 MCP 资源（降级）。', '典型场景：按 ID 获取资源详情。', '注意：当前依赖本地注册表回退。'],
      'tool.lsp.query': ['作用：执行 LSP 查询（降级）。', '典型场景：桥接前先给出结构化占位结果。', '注意：需接入宿主 LSP IPC 才能全量可用。'],
      'tool.powershell.exec': ['作用：执行 PowerShell 命令。', '典型场景：Windows 管理脚本执行。', '注意：当前通过 terminal.exec 转发。'],
      'tool.workflow.run': ['作用：运行工作流（降级）。', '典型场景：预演 workflow 编排输入输出。', '注意：当前为占位执行，待接工作流引擎。'],
      'tool.cron.create': ['作用：创建定时触发器。', '典型场景：计划任务调度。', '注意：当前存储于本地运行时注册表。'],
      'tool.cron.delete': ['作用：删除定时触发器。', '典型场景：清理无效调度。', '注意：按 id 删除。'],
      'tool.cron.list': ['作用：列出定时触发器。', '典型场景：核对当前调度配置。', '注意：用于调度可观测。'],
      'tool.remote.trigger': ['作用：登记远程触发请求。', '典型场景：模拟 webhook/远程事件。', '注意：当前为本地队列实现。'],
      'tool.monitor.snapshot': ['作用：采集运行时快照。', '典型场景：查看本地状态与 key 数量。', '注意：轻量监控，不替代 APM。'],
      'tool.worktree.enter': ['作用：进入 worktree 模式（降级）。', '典型场景：多分支工作目录切换。', '注意：待接入 git worktree 实执行。'],
      'tool.worktree.exit': ['作用：退出 worktree 模式（降级）。', '典型场景：回收临时工作树。', '注意：待接入 git worktree 实执行。'],
      'tool.terminal.capture': ['作用：终端输出捕获（降级）。', '典型场景：采集执行日志快照。', '注意：待接入终端会话抓取能力。'],
      'tool.ctx.inspect': ['作用：上下文检查（降级）。', '典型场景：查看运行时上下文摘要。', '注意：待接上下文压缩内核。'],
      'tool.snip.create': ['作用：创建片段记录。', '典型场景：保存关键输出或命令。', '注意：写入本地运行时片段库。'],
      'tool.sleep': ['作用：延时等待。', '典型场景：轮询前等待、节流。', '注意：单位毫秒。'],
      'tool.agent.run': ['作用：Agent 任务执行（降级）。', '典型场景：先打通任务路由。', '注意：待接入真实多 Agent 执行层。'],
      'tool.task.output': ['作用：写入任务输出日志。', '典型场景：持续记录阶段结果。', '注意：按 taskId 追踪。'],
      'tool.notify.push': ['作用：推送通知（降级）。', '典型场景：结果完成提醒。', '注意：待接宿主通知通道。'],
      'tool.userfile.send': ['作用：发送用户文件（降级）。', '典型场景：交付附件或导出产物。', '注意：待接真实传输通道。'],
      'tool.pr.subscribe': ['作用：订阅 PR 事件（降级）。', '典型场景：跟踪 PR webhook 更新。', '注意：待接 GitHub webhook 基建。'],
    };

    return (
      byId[tool.id] ?? [
        '作用：提供可编排的能力扩展。',
        '典型场景：按工具类别在 Agent 流程中调用。',
        '注意：请结合具体工具输入参数使用。',
      ]
    );
  }

  protected toolCapability(tool: UiTool): 'native' | 'degraded' {
    const degraded = new Set([
      'tool.files.edit',
      'tool.files.glob',
      'tool.files.grep',
      'tool.web.search',
      'tool.ask.question',
      'tool.skill.run',
      'tool.lsp.query',
      'tool.mcp.list_resources',
      'tool.mcp.read_resource',
      'tool.workflow.run',
      'tool.worktree.enter',
      'tool.worktree.exit',
      'tool.terminal.capture',
      'tool.ctx.inspect',
      'tool.agent.run',
      'tool.notify.push',
      'tool.userfile.send',
      'tool.pr.subscribe',
    ]);
    return degraded.has(tool.id) ? 'degraded' : 'native';
  }

  protected toolCapabilityLabel(tool: UiTool): string {
    return this.toolCapability(tool) === 'native' ? '状态：原生可用' : '状态：降级可用';
  }

  private async searchHub(query: string): Promise<string> {
    const cmd = `clawhub search "${this.escapeArg(query)}" --limit 24`;
    const primary = await window.zytrader.terminal.exec(cmd, '.');
    let text = `${primary.stdout ?? ''}\n${primary.stderr ?? ''}`.trim();
    this.appendLog(`$ ${cmd}\n${text}`);

    if (!primary.ok || /not recognized|not found|command not found|不是内部或外部命令/i.test(text)) {
      const fallback = await window.zytrader.terminal.exec(`openclaw skills search "${this.escapeArg(query)}"`, '.');
      text = `${fallback.stdout ?? ''}\n${fallback.stderr ?? ''}`.trim();
      this.appendLog(`$ openclaw skills search "${query}"\n${text}`);
      if (!fallback.ok) {
        throw new Error('未检测到 clawhub/openclaw CLI。请先安装并配置。');
      }
    }

    return text;
  }

  private parseSearchOutput(text: string): HubPluginItem[] {
    const lines = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !/^search results|^found\s+\d+/i.test(x));

    const out: HubPluginItem[] = [];
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z0-9._/-]{2,})\s*(?:-|\||:)\s*(.+)$/);
      if (!m) continue;
      const id = m[1].trim();
      const desc = m[2].trim();
      out.push({ id, name: this.prettyNameFromId(id), desc, tags: this.guessTags(id, desc), author: 'ClawHub' });
    }

    const uniq = new Map<string, HubPluginItem>();
    for (const it of out) if (!uniq.has(it.id)) uniq.set(it.id, it);
    return [...uniq.values()].slice(0, 24);
  }

  private prettyNameFromId(id: string): string {
    const last = id.split('/').pop() ?? id;
    return last.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }

  private guessTags(id: string, desc: string): string[] {
    const src = `${id} ${desc}`.toLowerCase();
    const tags: string[] = [];
    if (src.includes('plugin')) tags.push('Plugin');
    if (src.includes('mcp')) tags.push('MCP');
    if (src.includes('github')) tags.push('GitHub');
    if (!tags.length) tags.push('General');
    return tags.slice(0, 3);
  }

  private appendLog(text: string): void {
    const now = new Date().toLocaleTimeString();
    const next = `${this.commandLog()}\n[${now}] ${text}`.trim();
    this.commandLog.set(next.slice(-12000));
  }

  private async detectPluginCli(): Promise<void> {
    const check = await window.zytrader.terminal.exec('openclaw --version', '.');
    if (!check.ok) {
      const text = `${check.stdout ?? ''}\n${check.stderr ?? ''}`.trim();
      if (/not recognized|not found|command not found|不是内部或外部命令/i.test(text)) {
        this.hubError.set('未检测到 openclaw CLI，无法自动识别已安装插件。请先安装 openclaw。');
      }
    }
  }

  private escapeArg(raw: string): string {
    return String(raw).replace(/"/g, '\\"');
  }
}
