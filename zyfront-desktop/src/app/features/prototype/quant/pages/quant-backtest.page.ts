import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgClass, NgFor, NgIf } from '@angular/common';
import * as echarts from 'echarts';
import { QuantLayoutComponent } from '../quant-layout.component';
import {
  QuantMockDataService,
  type BacktestMetric,
  type BacktestTradeRow,
} from '../quant-mock-data.service';

@Component({
  selector: 'app-quant-backtest-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, QuantLayoutComponent],
  templateUrl: './quant-backtest.page.html',
  styleUrls: ['./quant-page.scss', './quant-backtest.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantBacktestPageComponent implements AfterViewInit, OnDestroy {
  private readonly mock = inject(QuantMockDataService);
  private readonly router = inject(Router);

  @ViewChild('curveChartRef', { static: true })
  private readonly curveChartRef?: ElementRef<HTMLDivElement>;

  @ViewChild('riskPieRef', { static: true })
  private readonly riskPieRef?: ElementRef<HTMLDivElement>;

  protected readonly metrics = signal<BacktestMetric[]>(this.mock.getBacktestMetrics());
  protected readonly trades = signal<BacktestTradeRow[]>(this.mock.getBacktestTrades());
  protected readonly actionToast = signal('');

  private curveChart?: echarts.ECharts;
  private pieChart?: echarts.ECharts;
  private toastTimer?: ReturnType<typeof setTimeout>;

  ngAfterViewInit(): void {
    this.initCharts();
    window.addEventListener('resize', this.handleResize);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.handleResize);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.curveChart?.dispose();
    this.pieChart?.dispose();
  }

  protected exportReport(): void {
    this.showToast('回测报告导出任务已提交');
  }

  protected deployToLive(): void {
    this.showToast('已推送到实盘候选队列，正在跳转实盘页面');
    void this.router.navigate(['/prototype/quant/live-trading']);
  }

  protected viewAllTrades(): void {
    this.showToast('下一阶段接入完整交易记录弹层');
  }

  protected trackByTrade(_: number, row: BacktestTradeRow): string {
    return `${row.time}-${row.symbol}-${row.side}`;
  }

  private initCharts(): void {
    if (this.curveChartRef?.nativeElement) {
      this.curveChart = echarts.init(this.curveChartRef.nativeElement, 'dark');
      this.renderCurveChart();
    }

    if (this.riskPieRef?.nativeElement) {
      this.pieChart = echarts.init(this.riskPieRef.nativeElement, 'dark');
      this.renderPieChart();
    }
  }

  private renderCurveChart(): void {
    if (!this.curveChart) return;
    const curve = this.mock.getBacktestCurve();

    this.curveChart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 360,
      tooltip: { trigger: 'axis' },
      grid: { top: 24, left: 44, right: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: curve.strategy.map((_, i) => `Day ${i + 1}`),
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#94a3b8' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1f2937' } },
        axisLabel: { color: '#94a3b8' },
      },
      series: [
        {
          name: '策略收益',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: curve.strategy,
          lineStyle: { width: 2.6, color: '#3b82f6' },
        },
        {
          name: '基准收益',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: curve.benchmark,
          lineStyle: { width: 2.2, color: '#64748b' },
        },
      ],
    });
  }

  private renderPieChart(): void {
    if (!this.pieChart) return;

    this.pieChart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          label: { color: '#cbd5e1', fontSize: 11 },
          itemStyle: {
            borderRadius: 8,
            borderColor: '#0b1220',
            borderWidth: 2,
          },
          data: this.mock.getBacktestRiskPie(),
        },
      ],
    });
  }

  private readonly handleResize = () => {
    this.curveChart?.resize();
    this.pieChart?.resize();
  };

  private showToast(message: string): void {
    this.actionToast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.actionToast.set(''), 2200);
  }
}
