import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface QuantNavItem {
  label: string;
  path: string;
}

@Component({
  selector: 'app-quant-layout',
  standalone: true,
  imports: [NgFor, NgIf, RouterLink, RouterLinkActive],
  templateUrl: './quant-layout.component.html',
  styleUrl: './quant-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantLayoutComponent {
  @Input({ required: true }) title = '';
  @Input() subtitle = '';

  protected readonly navVisible = signal(true);

  protected readonly navItems: QuantNavItem[] = [
    { label: '中枢调度面板', path: '/prototype/quant/dashboard' },
    { label: '策略生成画布', path: '/prototype/quant/strategy-canvas' },
    { label: '智能回测系统', path: '/prototype/quant/backtest' },
    { label: '实盘交易系统', path: '/prototype/quant/live-trading' },
    { label: '风险控制中心', path: '/prototype/quant/risk-control' },
    { label: '全流程追溯', path: '/prototype/quant/traceability' },
  ];

  protected toggleNav(): void {
    this.navVisible.update((v) => !v);
  }
}
