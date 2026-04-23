import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';

export type TaskTimelineItemStatus = 'pending' | 'running' | 'completed' | 'failed';

@Component({
  selector: 'app-task-timeline-item',
  standalone: true,
  imports: [CommonModule, NzIconModule],
  template: `
    <div class="timeline-item"
      [class.completed]="status() === 'completed'"
      [class.running]="status() === 'running'"
      [class.failed]="status() === 'failed'"
      [class.pending]="status() === 'pending'">
      <div class="timeline-rail">
        <span class="timeline-dot">
          <span *ngIf="status() === 'completed'" class="dot-check" nz-icon nzType="check" nzTheme="fill"></span>
          <span *ngIf="status() === 'running'" class="dot-spinner" nz-icon nzType="loading" nzTheme="outline" nzSpin></span>
          <span *ngIf="status() === 'failed'" class="dot-fail" nz-icon nzType="close" nzTheme="outline"></span>
          <span *ngIf="status() === 'pending'" class="dot-wait"></span>
        </span>
        <span class="timeline-line"></span>
      </div>
      <div class="timeline-content">
        <span class="timeline-task-title">{{ title() }}</span>
        <span *ngIf="status() === 'running' && currentStep()" class="timeline-step">{{ currentStep() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .timeline-item {
      display: flex;
      gap: 12px;
      padding-bottom: 8px;
    }

    .timeline-rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 20px;
      flex-shrink: 0;
    }

    .timeline-dot {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: #f0f0f0;
      font-size: 12px;
    }

    .timeline-item.completed .timeline-dot {
      background: #52c41a;
      color: white;
    }

    .timeline-item.running .timeline-dot {
      background: #1890ff;
      color: white;
    }

    .timeline-item.failed .timeline-dot {
      background: #ff4d4f;
      color: white;
    }

    .timeline-item.pending .timeline-dot {
      background: #d9d9d9;
    }

    .dot-wait {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #bfbfbf;
    }

    .timeline-line {
      width: 2px;
      flex: 1;
      min-height: 20px;
      background: #e8e8e8;
      margin-top: 4px;
    }

    .timeline-item.completed .timeline-line {
      background: #52c41a;
    }

    .timeline-content {
      display: flex;
      flex-direction: column;
      padding-top: 2px;
      flex: 1;
      min-width: 0;
    }

    .timeline-task-title {
      font-size: 13px;
      color: #262626;
      line-height: 1.4;
    }

    .timeline-item.pending .timeline-task-title {
      color: #8c8c8c;
    }

    .timeline-step {
      font-size: 12px;
      color: #8c8c8c;
      margin-top: 4px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskTimelineItemComponent {
  readonly taskId = input.required<string>();
  readonly title = input.required<string>();
  readonly status = input<TaskTimelineItemStatus>('pending');
  readonly currentStep = input<string>();
}
