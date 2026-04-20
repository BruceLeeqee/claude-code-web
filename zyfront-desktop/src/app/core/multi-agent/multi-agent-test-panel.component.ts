import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzListModule } from 'ng-zorro-antd/list';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzTypographyModule } from 'ng-zorro-antd/typography';
import { MultiAgentTestService, type TestCase, type TestResult } from './multi-agent-test.service';

@Component({
  selector: 'app-multi-agent-test-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzCardModule,
    NzInputModule,
    NzListModule,
    NzTagModule,
    NzSpinModule,
    NzAlertModule,
    NzDividerModule,
    NzTypographyModule,
  ],
  template: `
    <nz-card nzTitle="多智能体测试面板" [nzExtra]="extraTemplate">
      <nz-alert
        nzType="info"
        nzMessage="测试说明"
        nzDescription="此面板用于测试多智能体系统的自动任务拆分和智能体创建功能。选择测试案例或输入自定义请求，系统将自动规划任务并创建相应的智能体。"
        nzShowIcon
        style="margin-bottom: 16px;"
      ></nz-alert>

      <nz-divider nzText="预设测试案例"></nz-divider>

      <nz-list [nzDataSource]="testCases()" nzItemLayout="vertical">
        <nz-list-item *ngFor="let tc of testCases(); let i = index">
          <nz-list-item-meta
            [nzTitle]="tc.name"
            [nzDescription]="tc.description"
          ></nz-list-item-meta>
          <div style="margin-top: 8px;">
            <nz-tag nzColor="blue">预期任务: {{ tc.expectedTaskCount || '?' }}</nz-tag>
            <nz-tag nzColor="green">预期智能体: {{ tc.expectedAgents || '?' }}</nz-tag>
          </div>
          <div style="margin-top: 12px;">
            <button
              nz-button
              nzType="primary"
              nzSize="small"
              [nzLoading]="running() && current() === tc.name"
              [disabled]="running()"
              (click)="runTest(tc)"
            >
              运行测试
            </button>
          </div>
        </nz-list-item>
      </nz-list>

      <nz-divider nzText="自定义测试"></nz-divider>

      <div style="margin-bottom: 16px;">
        <nz-input-group [nzAddOnAfter]="customButton">
          <input
            type="text"
            nz-input
            [(ngModel)]="customRequest"
            placeholder="输入自定义测试请求..."
          />
        </nz-input-group>
        <ng-template #customButton>
          <button
            nz-button
            nzType="primary"
            [nzLoading]="running() && current() === 'custom'"
            [disabled]="running() || !customRequest()"
            (click)="runCustomTest()"
          >
            执行
          </button>
        </ng-template>
      </div>

      <nz-divider nzText="复杂度分析"></nz-divider>

      <div *ngIf="complexity()" style="margin-bottom: 16px;">
        <nz-tag [nzColor]="getComplexityColor(complexity()!.level)">
          复杂度: {{ complexity()!.level }}
        </nz-tag>
        <nz-tag>预估子任务: {{ complexity()!.estimatedSubtasks }}</nz-tag>
        <div style="margin-top: 8px;">
          <span>分析因素:</span>
          <ul>
            <li *ngFor="let factor of complexity()!.factors">{{ factor }}</li>
          </ul>
        </div>
      </div>

      <button
        nz-button
        nzType="default"
        [disabled]="running() || !customRequest()"
        (click)="analyzeComplexity()"
      >
        分析复杂度
      </button>

      <nz-divider nzText="测试结果"></nz-divider>

      <div *ngIf="running()" style="text-align: center; padding: 24px;">
        <nz-spin nzSimple nzTip="正在执行测试..."></nz-spin>
      </div>

      <div *ngIf="!running() && results().length === 0" style="text-align: center; color: #999; padding: 24px;">
        暂无测试结果，请运行测试案例
      </div>

      <div *ngFor="let result of results(); let i = index" style="margin-bottom: 16px;">
        <nz-card
          [nzTitle]="result.testCase"
          [nzExtra]="result.success ? '✅ 成功' : '❌ 失败'"
          nzSize="small"
        >
          <p><strong>耗时:</strong> {{ result.duration }}ms</p>

          <div *ngIf="result.error" style="color: red;">
            <strong>错误:</strong> {{ result.error }}
          </div>

          <div *ngIf="result.taskGraph">
            <nz-divider nzText="任务图"></nz-divider>
            <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px;">{{ formatTaskGraph(result.taskGraph) }}</pre>
          </div>

          <div *ngIf="result.agents && result.agents.length > 0">
            <nz-divider nzText="创建的智能体"></nz-divider>
            <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px;">{{ formatAgents(result.agents) }}</pre>
          </div>
        </nz-card>
      </div>

      <div *ngIf="results().length > 0" style="text-align: center; margin-top: 16px;">
        <button nz-button nzType="default" (click)="clearResults()">
          清空结果
        </button>
      </div>
    </nz-card>

    <ng-template #extraTemplate>
      <button
        nz-button
        nzType="primary"
        [nzLoading]="running()"
        [disabled]="running()"
        (click)="runAllTests()"
      >
        运行全部测试
      </button>
    </ng-template>
  `,
  styles: [`
    :host {
      display: block;
      padding: 16px;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiAgentTestPanelComponent {
  private readonly testService = inject(MultiAgentTestService);

  readonly testCases = signal<TestCase[]>(this.testService.getTestCases());
  readonly results = this.testService.results;
  readonly running = this.testService.running;
  readonly current = this.testService.current;

  readonly customRequest = signal<string>('');
  readonly complexity = signal<{
    level: 'simple' | 'medium' | 'complex';
    factors: string[];
    estimatedSubtasks: number;
  } | null>(null);

  async runTest(testCase: TestCase): Promise<void> {
    await this.testService.runTest(testCase);
  }

  async runCustomTest(): Promise<void> {
    const request = this.customRequest();
    if (!request) return;

    const customTestCase: TestCase = {
      name: 'custom',
      description: '自定义测试',
      userRequest: request,
    };

    await this.testService.runTest(customTestCase);
  }

  async runAllTests(): Promise<void> {
    await this.testService.runAllTests();
  }

  async analyzeComplexity(): Promise<void> {
    const request = this.customRequest();
    if (!request) return;

    const result = await this.testService.analyzeRequest(request);
    this.complexity.set(result);
  }

  clearResults(): void {
    this.testService.clearResults();
    this.complexity.set(null);
  }

  getComplexityColor(level: 'simple' | 'medium' | 'complex'): string {
    switch (level) {
      case 'simple': return 'green';
      case 'medium': return 'orange';
      case 'complex': return 'red';
    }
  }

  formatTaskGraph(taskGraph: ReturnType<typeof this.testService.formatTaskGraph> extends string ? Parameters<typeof this.testService.formatTaskGraph>[0] : never): string {
    return this.testService.formatTaskGraph(taskGraph as any);
  }

  formatAgents(agents: ReturnType<typeof this.testService.formatAgents> extends string ? Parameters<typeof this.testService.formatAgents>[0] : never): string {
    return this.testService.formatAgents(agents as any);
  }
}
