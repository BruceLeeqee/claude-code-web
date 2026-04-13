import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { QuantLayoutComponent } from '../quant-layout.component';

interface RiskRule {
  id: string;
  name: string;
  desc: string;
  threshold: number;
  unit: '%' | 'x' | '万元';
  enabled: boolean;
}

interface RiskAlert {
  id: string;
  ts: string;
  level: 'high' | 'medium';
  title: string;
  detail: string;
  acknowledged: boolean;
}

@Component({
  selector: 'app-quant-risk-control-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, QuantLayoutComponent],
  templateUrl: './quant-risk-control.page.html',
  styleUrls: ['./quant-page.scss', './quant-risk-control.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantRiskControlPageComponent {
  private readonly router = inject(Router);

  protected readonly rules = signal<RiskRule[]>([
    { id: 'r1', name: '行业集中度限制', desc: '单行业仓位不得超过组合总市值阈值', threshold: 25, unit: '%', enabled: true },
    { id: 'r2', name: '账户杠杆上限', desc: '总杠杆倍数控制，超出即触发限仓', threshold: 2.2, unit: 'x', enabled: true },
    { id: 'r3', name: '单策略日亏损上限', desc: '超过上限后自动暂停该策略当日交易', threshold: 120, unit: '万元', enabled: true },
    { id: 'r4', name: '单笔滑点上限', desc: '成交滑点异常时触发告警并降低交易频率', threshold: 0.25, unit: '%', enabled: false },
  ]);

  protected readonly alerts = signal<RiskAlert[]>([
    {
      id: 'a1',
      ts: '10:42:18',
      level: 'high',
      title: '科技板块集中度接近阈值',
      detail: 'NVDA 建仓申请触发行业集中度预警，建议仓位从 500 股调整为 320 股。',
      acknowledged: false,
    },
    {
      id: 'a2',
      ts: '10:35:07',
      level: 'medium',
      title: '杠杆率上升',
      detail: '当前账户杠杆 2.08x，接近配置阈值 2.2x。',
      acknowledged: false,
    },
    {
      id: 'a3',
      ts: '10:20:13',
      level: 'medium',
      title: 'TSLA 波动率异常',
      detail: '5 分钟波动率超过 2σ，建议临时降低下单频率。',
      acknowledged: true,
    },
  ]);

  protected readonly selectedRuleId = signal('r1');
  protected readonly toast = signal('');

  protected readonly selectedRule = computed(() => this.rules().find((x) => x.id === this.selectedRuleId()) ?? this.rules()[0]);
  protected readonly pendingAlerts = computed(() => this.alerts().filter((x) => !x.acknowledged).length);

  protected selectRule(id: string): void {
    this.selectedRuleId.set(id);
  }

  protected toggleRule(id: string): void {
    this.rules.update((rows) => rows.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    const changed = this.rules().find((x) => x.id === id);
    if (changed) {
      this.showToast(`${changed.name} 已${changed.enabled ? '启用' : '停用'}`);
    }
  }

  protected updateThreshold(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    const value = Number.isFinite(n) && n > 0 ? n : 0;
    const rid = this.selectedRuleId();
    this.rules.update((rows) => rows.map((r) => (r.id === rid ? { ...r, threshold: value } : r)));
  }

  protected saveRule(): void {
    const rule = this.selectedRule();
    this.showToast(`已保存规则：${rule.name}（阈值 ${rule.threshold}${rule.unit}）`);
  }

  protected acknowledgeAlert(id: string): void {
    this.alerts.update((rows) => rows.map((r) => (r.id === id ? { ...r, acknowledged: true } : r)));
    this.showToast('告警已确认并归档，正在跳转追溯页面');
    void this.router.navigate(['/prototype/quant/traceability']);
  }

  protected trackByRule(_: number, item: RiskRule): string {
    return item.id;
  }

  protected trackByAlert(_: number, item: RiskAlert): string {
    return item.id;
  }

  private showToast(message: string): void {
    this.toast.set(message);
    setTimeout(() => {
      if (this.toast() === message) this.toast.set('');
    }, 2200);
  }
}
