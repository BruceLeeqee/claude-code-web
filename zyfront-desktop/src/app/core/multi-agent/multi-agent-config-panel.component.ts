import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzSliderModule } from 'ng-zorro-antd/slider';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { MultiAgentConfigService } from './services/multi-agent-config.service';
import { ModeSwitchApiService } from './services/mode-switch-api.service';
import type { ExecutionMode } from './services/execution-mode-decider.service';

@Component({
  selector: 'app-multi-agent-config-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzSwitchModule,
    NzSliderModule,
    NzDividerModule,
    NzCardModule,
    NzSelectModule,
  ],
  template: `
    <div class="config-panel">
      <nz-card nzTitle="多智能体配置" nzSize="small">
        <div class="config-section">
          <div class="config-item">
            <span class="config-label">启用多智能体模式</span>
            <nz-switch 
              [(ngModel)]="enabled" 
              (ngModelChange)="onEnabledChange($event)">
            </nz-switch>
          </div>

          <nz-divider></nz-divider>

          <div class="config-item">
            <span class="config-label">最大智能体数量</span>
            <div class="config-value">
              <nz-slider 
                [nzMin]="1" 
                [nzMax]="10" 
                [(ngModel)]="maxAgents"
                (ngModelChange)="onMaxAgentsChange($event)"
                [nzDisabled]="!enabled()">
              </nz-slider>
              <span class="value-label">{{ maxAgents() }}</span>
            </div>
          </div>

          <nz-divider></nz-divider>

          <div class="config-item">
            <span class="config-label">执行模式</span>
            <nz-select 
              [(ngModel)]="forceMode" 
              (ngModelChange)="onForceModeChange($event)"
              [nzDisabled]="!enabled()"
              style="width: 120px;">
              <nz-option nzValue="auto" nzLabel="自动决策"></nz-option>
              <nz-option nzValue="single" nzLabel="单Agent"></nz-option>
              <nz-option nzValue="multi" nzLabel="多智能体"></nz-option>
            </nz-select>
          </div>

          <nz-divider></nz-divider>

          <div class="config-item">
            <span class="config-label">后端模式</span>
            <nz-select 
              [(ngModel)]="defaultBackend" 
              (ngModelChange)="onBackendChange($event)"
              [nzDisabled]="!enabled()"
              style="width: 120px;">
              <nz-option nzValue="in-process" nzLabel="进程内"></nz-option>
              <nz-option nzValue="tmux" nzLabel="Tmux"></nz-option>
              <nz-option nzValue="iterm2" nzLabel="iTerm2"></nz-option>
            </nz-select>
          </div>
        </div>

        <div class="config-actions">
          <button nz-button nzType="default" (click)="resetToDefaults()">
            <span nz-icon nzType="reload" nzTheme="outline"></span>
            恢复默认
          </button>
        </div>
      </nz-card>

      <nz-card nzTitle="当前状态" nzSize="small" style="margin-top: 12px;">
        <div class="status-section">
          <div class="status-item">
            <span class="status-label">当前模式</span>
            <span class="status-value" [class.single]="currentMode() === 'single'" [class.multi]="currentMode() === 'multi'">
              {{ currentMode() === 'single' ? '单Agent' : '多智能体' }}
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">决策方式</span>
            <span class="status-value">
              {{ isForced() ? '强制模式' : '自动决策' }}
            </span>
          </div>
          <div class="status-item" *ngIf="modeReason()">
            <span class="status-label">决策原因</span>
            <span class="status-value">{{ modeReason() }}</span>
          </div>
        </div>
      </nz-card>
    </div>
  `,
  styles: [`
    .config-panel {
      padding: 12px;
    }
    .config-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .config-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .config-label {
      font-size: 13px;
      color: #ccc;
    }
    .config-value {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      max-width: 200px;
    }
    .value-label {
      font-size: 13px;
      color: #fff;
      min-width: 20px;
    }
    .config-actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
    }
    .status-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-label {
      font-size: 12px;
      color: #888;
    }
    .status-value {
      font-size: 12px;
      color: #fff;
      &.single {
        color: #60a5fa;
      }
      &.multi {
        color: #c084fc;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiAgentConfigPanelComponent {
  private readonly configService = inject(MultiAgentConfigService);
  private readonly modeSwitchApi = inject(ModeSwitchApiService);

  protected readonly enabled = signal(this.configService.isEnabled());
  protected readonly maxAgents = signal(this.configService.getMaxAgents());
  protected readonly forceMode = signal<string>(this.configService.getForceMode() || 'auto');
  protected readonly defaultBackend = signal(this.configService.getDefaultBackend());

  protected readonly currentMode = signal<ExecutionMode>(this.modeSwitchApi.mode());
  protected readonly isForced = signal(this.modeSwitchApi.isForced());
  protected readonly modeReason = signal('');

  onEnabledChange(enabled: boolean): void {
    this.configService.setEnabled(enabled);
  }

  onMaxAgentsChange(max: number): void {
    this.configService.setMaxAgents(max);
  }

  onForceModeChange(mode: string): void {
    if (mode === 'auto') {
      this.configService.clearForceMode();
      this.modeSwitchApi.clearForce();
    } else {
      this.configService.setForceMode(mode as ExecutionMode);
      if (mode === 'single') {
        this.modeSwitchApi.switchToSingle();
      } else {
        this.modeSwitchApi.switchToMulti();
      }
    }
    this.currentMode.set(this.modeSwitchApi.mode());
    this.isForced.set(this.modeSwitchApi.isForced());
  }

  onBackendChange(backend: 'in-process' | 'tmux' | 'iterm2'): void {
    this.configService.setDefaultBackend(backend);
  }

  resetToDefaults(): void {
    this.configService.resetToDefaults();
    this.enabled.set(this.configService.isEnabled());
    this.maxAgents.set(this.configService.getMaxAgents());
    this.forceMode.set(this.configService.getForceMode() || 'auto');
    this.defaultBackend.set(this.configService.getDefaultBackend());
  }
}
