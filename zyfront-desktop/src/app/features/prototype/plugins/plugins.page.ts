import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  protected readonly loadingPlugins = signal(false);
  protected readonly installingPluginIds = signal<Record<string, boolean>>({});
  protected readonly hubError = signal('');
  protected readonly commandLog = signal('');

  protected readonly clawHubPlugins = signal<HubPluginItem[]>([]);

  protected readonly filteredPlugins = computed(() => {
    const q = this.pluginQuery().trim().toLowerCase();
    return this.clawHubPlugins().filter((x) => !q || `${x.id} ${x.name} ${x.desc}`.toLowerCase().includes(q));
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
