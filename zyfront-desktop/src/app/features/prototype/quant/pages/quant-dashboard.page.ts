import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import * as echarts from 'echarts';
import { QuantLayoutComponent } from '../quant-layout.component';
import {
  QuantMockDataService,
  type DecisionEvent,
  type RangeKey,
  type RankingItem,
} from '../quant-mock-data.service';

@Component({
  selector: 'app-quant-dashboard-page',
  standalone: true,
  imports: [NgFor, NgIf, QuantLayoutComponent],
  templateUrl: './quant-dashboard.page.html',
  styleUrls: ['./quant-page.scss', './quant-dashboard.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantDashboardPageComponent implements AfterViewInit, OnDestroy {
  private readonly mock = inject(QuantMockDataService);

  @ViewChild('chartRef', { static: true })
  private readonly chartRef?: ElementRef<HTMLDivElement>;

  protected readonly ranges: { key: RangeKey; label: string }[] = [
    { key: 'day', label: '当日' },
    { key: 'week', label: '近一周' },
    { key: 'month', label: '近一月' },
  ];

  protected readonly selectedRange = signal<RangeKey>('day');
  protected readonly ranking = signal<RankingItem[]>(this.mock.getRanking());
  protected readonly selectedRankingId = signal('s1');
  protected readonly decisionEvents = signal<DecisionEvent[]>(this.mock.getInitialDecisionEvents());
  protected readonly toastMessage = signal('');

  protected readonly selectedRanking = computed(
    () => this.ranking().find((x) => x.id === this.selectedRankingId()) ?? this.ranking()[0],
  );

  protected readonly navValueText = computed(() => this.mock.getNavSnapshot(this.selectedRange()).nav);
  protected readonly navDeltaText = computed(() => this.mock.getNavSnapshot(this.selectedRange()).delta);

  private chart?: echarts.ECharts;
  private decisionTicker?: ReturnType<typeof setInterval>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.decisionTicker = setInterval(() => {
      const next = this.mock.nextDecisionEvent();
      this.decisionEvents.update((arr) => [next, ...arr].slice(0, 6));
    }, 7000);
  }

  ngAfterViewInit(): void {
    if (!this.chartRef?.nativeElement) return;
    this.chart = echarts.init(this.chartRef.nativeElement, 'dark');
    this.renderChart();
    window.addEventListener('resize', this.handleResize);
  }

  ngOnDestroy(): void {
    if (this.decisionTicker) clearInterval(this.decisionTicker);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    window.removeEventListener('resize', this.handleResize);
    this.chart?.dispose();
  }

  protected switchRange(key: RangeKey): void {
    this.selectedRange.set(key);
    this.renderChart();
  }

  protected pickRanking(itemId: string): void {
    this.selectedRankingId.set(itemId);
  }

  protected onCreateStrategy(): void {
    this.showToast('已触发：新建 AI 策略（下一阶段接策略画布）');
  }

  protected onOpenSearch(): void {
    this.showToast('搜索面板即将接入（阶段 2）');
  }

  protected onOpenNotification(): void {
    this.showToast('当前有 3 条系统提醒待处理');
  }

  protected trackByRanking(_: number, item: RankingItem): string {
    return item.id;
  }

  protected trackByDecision(_: number, item: DecisionEvent): string {
    return `${item.ts}-${item.tag}-${item.content}`;
  }

  private renderChart(): void {
    if (!this.chart) return;
    const data = this.mock.getCurve(this.selectedRange());
    this.chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 360,
      grid: { top: 24, left: 42, right: 18, bottom: 26 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: data.map((_, idx) => `${idx + 1}`),
        axisLine: { lineStyle: { color: '#374151' } },
        axisLabel: { color: '#94a3b8' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1f2937' } },
        axisLabel: { color: '#94a3b8' },
      },
      series: [
        {
          type: 'line',
          data,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 3, color: '#3b82f6' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59,130,246,0.45)' },
              { offset: 1, color: 'rgba(59,130,246,0)' },
            ]),
          },
        },
      ],
    });
  }

  private readonly handleResize = () => {
    this.chart?.resize();
  };

  private showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage.set(''), 2400);
  }
}
