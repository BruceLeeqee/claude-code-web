import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';

export type AgentStatus = 'idle' | 'running' | 'thinking' | 'completed' | 'failed';

interface AgentCardInput {
  agentId: string;
  agentName: string;
  role: string;
  status: AgentStatus;
}

@Component({
  selector: 'app-agent-card',
  standalone: true,
  imports: [CommonModule, NzIconModule],
  template: `
    <div class="agent-display-card">
      <div class="agent-icon-wrapper"
        [class.running]="status() === 'running' || status() === 'thinking'"
        [class.idle]="status() === 'idle'">
        <span nz-icon [nzType]="roleIcon()" nzTheme="outline"></span>
      </div>
      <div class="agent-info-wrapper">
        <div class="agent-name-text">{{ agentName() }}</div>
        <div class="agent-status-text"
          [class.running]="status() === 'running' || status() === 'thinking'"
          [class.idle]="status() === 'idle'">
          {{ statusText() }}
        </div>
      </div>
    </div>
  `,
  styles: [`
    .agent-display-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: #fafafa;
      border-radius: 6px;
      cursor: default;
      transition: background 0.2s;
    }

    .agent-display-card:hover {
      background: #f0f0f0;
    }

    .agent-icon-wrapper {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }

    .agent-icon-wrapper.idle {
      background: #e6e6e6;
      color: #595959;
    }

    .agent-icon-wrapper.running {
      background: #e6f7ff;
      color: #1890ff;
    }

    .agent-info-wrapper {
      flex: 1;
      min-width: 0;
    }

    .agent-name-text {
      font-size: 13px;
      font-weight: 500;
      color: #262626;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .agent-status-text {
      font-size: 12px;
      color: #8c8c8c;
    }

    .agent-status-text.running {
      color: #1890ff;
    }

    .agent-status-text.idle {
      color: #595959;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentCardComponent {
  readonly agentId = input.required<string>();
  readonly agentName = input.required<string>();
  readonly role = input.required<string>();
  readonly status = input<AgentStatus>('idle');

  protected roleIcon(): string {
    const icons: Record<string, string> = {
      leader: 'crown',
      planner: 'block',
      executor: 'play-circle',
      reviewer: 'eye',
      researcher: 'search',
      validator: 'check-circle',
      coordinator: 'swap',
    };
    return icons[this.role()] || 'user';
  }

  protected statusText(): string {
    const texts: Record<string, string> = {
      idle: '空闲',
      running: '运行中',
      thinking: '思考中',
      completed: '已完成',
      failed: '失败',
    };
    return texts[this.status()] || this.status();
  }
}
