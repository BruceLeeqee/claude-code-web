import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzIconModule } from 'ng-zorro-antd/icon';
import {
  type AgentCardIconKey,
  type AgentStatus,
  type UiAgent,
  PrototypeCoreFacade,
} from '../../../shared/prototype-core.facade';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [NgClass, NgFor, NgIf, FormsModule, NzButtonModule, NzSelectModule, NzIconModule],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);

  /** 原型：Agent 数量下拉（仅展示，不改变列表长度） */
  protected agentCount = '4';
  protected readonly gitBranch = signal('');
  protected readonly dashboardSyncedAt = signal(this.formatDashboardTime(new Date()));

  protected readonly agentStats = computed(() => {
    const list = this.facade.agents();
    return {
      online: list.filter((a) => a.status !== 'error').length,
      executing: list.filter((a) => a.status === 'executing').length,
      waiting: list.filter((a) => a.status === 'waiting').length,
    };
  });

  constructor() {
    void this.refreshGitBranch();
  }

  protected refreshDashboard(): void {
    this.dashboardSyncedAt.set(this.formatDashboardTime(new Date()));
    void this.refreshGitBranch();
  }

  private formatDashboardTime(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private async refreshGitBranch(): Promise<void> {
    const cwd = '.';
    const firstLine = (out: string) => (out ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    try {
      const z = window.zytrader;
      if (!z?.terminal?.exec) {
        this.gitBranch.set('');
        return;
      }
      let line = firstLine((await z.terminal.exec('cmd.exe /c git branch --show-current 2>nul', cwd)).stdout ?? '');
      if (!line) {
        line = firstLine((await z.terminal.exec('cmd.exe /c git rev-parse --abbrev-ref HEAD 2>nul', cwd)).stdout ?? '');
      }
      if (line === 'HEAD') {
        const short = firstLine((await z.terminal.exec('cmd.exe /c git rev-parse --short HEAD 2>nul', cwd)).stdout ?? '');
        line = short ? `HEAD（分离于 ${short}）` : 'HEAD';
      }
      if (!line) {
        const sb = (await z.terminal.exec('cmd.exe /c git status -sb 2>nul', cwd)).stdout ?? '';
        const m = sb.match(/^##\s+([^\s.]+)/m);
        if (m?.[1]) line = m[1].trim();
      }
      this.gitBranch.set(line);
    } catch {
      this.gitBranch.set('');
    }
  }

  protected cardIconType(key: AgentCardIconKey): string {
    const m: Record<AgentCardIconKey, string> = {
      code: 'code',
      security: 'safety',
      architecture: 'deployment-unit',
      doc: 'file-text',
    };
    return m[key];
  }

  protected statusPill(agent: UiAgent): { label: string; icon: string; mod: string; spin?: boolean } {
    const map: Record<AgentStatus, { label: string; icon: string; mod: string; spin?: boolean }> = {
      preparing: { label: '准备中', icon: 'loading-3-quarters', mod: 'st-prep', spin: true },
      executing: { label: '执行中', icon: 'loading-3-quarters', mod: 'st-exec', spin: true },
      waiting: { label: '等待响应', icon: 'clock-circle', mod: 'st-wait' },
      paused: { label: '已暂停', icon: 'pause', mod: 'st-pause' },
      completed: { label: '已完成', icon: 'check', mod: 'st-done' },
      error: { label: '异常', icon: 'close', mod: 'st-err' },
    };
    return map[agent.status];
  }

  /** 原型底部栏：模拟资源占用 */
  protected readonly mockCpu = 12;
  protected readonly mockMemGb = 1.4;
  protected readonly mockMemTotalGb = 8;
  protected readonly mockUptime = '14h 22m';
}
