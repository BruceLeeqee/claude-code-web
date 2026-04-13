import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { QuantLayoutComponent } from '../quant-layout.component';

interface TraceStep {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  summary: string;
  status: 'ok' | 'focus';
  detail: {
    shap: { label: string; value: number }[];
    source: string;
    riskProof: { label: string; value: string }[];
  };
}

@Component({
  selector: 'app-quant-traceability-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, DecimalPipe, QuantLayoutComponent],
  templateUrl: './quant-traceability.page.html',
  styleUrls: ['./quant-page.scss', './quant-traceability.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantTraceabilityPageComponent {
  protected readonly decisionId = signal('DEC-98234-L4');
  protected readonly selectedStepId = signal('step-3');
  protected readonly toast = signal('');

  protected readonly steps = signal<TraceStep[]>([
    {
      id: 'step-1',
      index: 1,
      title: '原始数据接入 (Ingestion)',
      subtitle: '从 12 个数据源同步实时报价与宏观因子',
      summary: 'Quote: AMZN · News: 利好',
      status: 'ok',
      detail: {
        shap: [
          { label: '成交量动量', value: 0.22 },
          { label: '情绪评分', value: 0.17 },
          { label: '板块联动', value: -0.06 },
        ],
        source: 'Bloomberg + TradingView + 内部 Tick Aggregator',
        riskProof: [
          { label: '数据完整性', value: '99.97%' },
          { label: '迟到包占比', value: '0.02%' },
        ],
      },
    },
    {
      id: 'step-2',
      index: 2,
      title: '特征提取与转换 (Feature Engineering)',
      subtitle: '计算 120+ 技术指标，识别关键形态',
      summary: 'RSI(65) · Breakout(True)',
      status: 'ok',
      detail: {
        shap: [
          { label: '成交量动量', value: 0.36 },
          { label: '情绪评分', value: 0.24 },
          { label: '板块联动', value: -0.08 },
        ],
        source: 'Feature Store v2 · 技术指标引擎',
        riskProof: [
          { label: '特征覆盖率', value: '98.6%' },
          { label: '异常特征剔除', value: '14 项' },
        ],
      },
    },
    {
      id: 'step-3',
      index: 3,
      title: '模型推断 (Inference)',
      subtitle: 'Transformer 对未来 30min 走势预测',
      summary: '上涨概率 84.2%',
      status: 'focus',
      detail: {
        shap: [
          { label: '成交量动量', value: 0.42 },
          { label: '情绪评分', value: 0.28 },
          { label: '板块联动', value: -0.12 },
        ],
        source: '“云计算部门在Q1财报前夕表现超预期，多个大型企业增加订单...”',
        riskProof: [
          { label: '模型版本', value: 'Transformer-Live-v4.8' },
          { label: '推断耗时', value: '76ms' },
        ],
      },
    },
    {
      id: 'step-4',
      index: 4,
      title: '风险检查 (Pre-Trade Risk)',
      subtitle: '校验 VaR、杠杆、行业集中度与订单流水线',
      summary: '通路安全',
      status: 'ok',
      detail: {
        shap: [
          { label: '成交量动量', value: 0.1 },
          { label: '情绪评分', value: 0.05 },
          { label: '板块联动', value: -0.03 },
        ],
        source: '风险规则引擎 2026.04',
        riskProof: [
          { label: 'VaR 消耗额', value: '¥1,204 / 剩余 ¥300k' },
          { label: '滑点预估', value: '0.02% (2bps)' },
        ],
      },
    },
    {
      id: 'step-5',
      index: 5,
      title: '指令下达 (Execution)',
      subtitle: '委托成功，实盘同步完成',
      summary: '均价 $178.45 · 数量 500',
      status: 'ok',
      detail: {
        shap: [
          { label: '成交量动量', value: 0.06 },
          { label: '情绪评分', value: 0.02 },
          { label: '板块联动', value: -0.01 },
        ],
        source: 'OMS 执行回报 + 券商成交回执',
        riskProof: [
          { label: '成交滑点', value: '1.7bps' },
          { label: '回执状态', value: 'SUCCESS' },
        ],
      },
    },
  ]);

  protected readonly selectedStep = computed(
    () => this.steps().find((x) => x.id === this.selectedStepId()) ?? this.steps()[0],
  );

  protected pickStep(id: string): void {
    this.selectedStepId.set(id);
  }

  protected refreshDecision(): void {
    const now = Date.now().toString().slice(-6);
    this.decisionId.set(`DEC-${now}-L4`);
    this.showToast('已刷新追溯链路（模拟）');
  }

  protected exportAudit(): void {
    this.showToast(`审计存证导出任务已提交：${this.decisionId()}.pdf`);
  }

  protected trackByStep(_: number, item: TraceStep): string {
    return item.id;
  }

  private showToast(message: string): void {
    this.toast.set(message);
    setTimeout(() => {
      if (this.toast() === message) this.toast.set('');
    }, 2200);
  }
}
