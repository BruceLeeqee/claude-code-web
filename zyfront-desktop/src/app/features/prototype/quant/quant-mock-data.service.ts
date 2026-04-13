import { Injectable } from '@angular/core';

export type RangeKey = 'day' | 'week' | 'month';

export interface RankingItem {
  id: string;
  name: string;
  score: number;
  pnlPct: number;
}

export interface DecisionEvent {
  ts: string;
  tag: '模型推断' | '风控拦截' | '交易执行';
  content: string;
}

export interface BacktestMetric {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'neutral';
}

export interface BacktestTradeRow {
  time: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  price: string;
  volume: string;
  pnl: string;
  pnlTone?: 'up' | 'down' | 'neutral';
}

export interface LiveQuoteItem {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  volumeText: string;
}

export interface LivePositionRow {
  symbol: string;
  qty: number;
  avgCost: number;
  lastPrice: number;
  pnl: number;
}

@Injectable({ providedIn: 'root' })
export class QuantMockDataService {
  private readonly dayCurve = [100, 102, 101, 105, 108, 107, 110, 115, 118, 122];
  private readonly weekCurve = [100, 101, 100, 102, 103, 102, 104, 106, 105, 108, 110, 111, 113, 112];
  private readonly monthCurve = [100, 101, 100, 102, 103, 102, 104, 105, 104, 106, 108, 109, 108, 110, 112, 111, 113, 114, 115, 116, 115, 117, 119, 120, 119, 121, 123, 124, 125, 127];

  private readonly rankingData: RankingItem[] = [
    { id: 's1', name: 'AI-多因子动量-V4', score: 9.4, pnlPct: 24.5 },
    { id: 's2', name: '深度神经网络-中性-B', score: 8.8, pnlPct: 18.2 },
    { id: 's3', name: '高频套利-5min-PRO', score: 8.2, pnlPct: 15.1 },
    { id: 's4', name: '基本面LLM分析器', score: 7.9, pnlPct: 12.8 },
    { id: 's5', name: '波动率极值回归', score: 7.2, pnlPct: -1.2 },
  ];

  private readonly decisionCandidates: Omit<DecisionEvent, 'ts'>[] = [
    { tag: '模型推断', content: '模型更新：半导体因子权重上调至 0.31。' },
    { tag: '风控拦截', content: '组合回撤接近 4% 软阈值，自动降低杠杆至 1.6。' },
    { tag: '交易执行', content: '分批减仓完成：卖出 $TSLA 120 股，滑点 1.8bps。' },
  ];

  private readonly backtestMetrics: BacktestMetric[] = [
    { label: '年化收益率', value: '42.5%', tone: 'up' },
    { label: '最大回撤', value: '-8.2%', tone: 'down' },
    { label: '夏普比率', value: '2.45' },
    { label: '索提诺比率', value: '3.12' },
    { label: '交易胜率', value: '64.5%', tone: 'up' },
    { label: '盈亏比', value: '2.8:1' },
  ];

  private readonly backtestStrategyCurve = [100, 102, 101, 105, 108, 107, 110, 115, 114, 118, 122, 125, 124, 128, 132, 131, 135, 140, 142, 145, 144, 148, 152, 155, 153, 158, 162, 165, 168, 172];
  private readonly backtestBenchmarkCurve = [100, 101, 100, 102, 103, 102, 104, 105, 104, 106, 108, 109, 108, 110, 112, 111, 113, 114, 115, 116, 115, 117, 119, 120, 119, 121, 123, 124, 125, 127];

  private readonly backtestRiskPie = [
    { name: '科技', value: 45 },
    { name: '半导体', value: 20 },
    { name: '金融', value: 15 },
    { name: '现金', value: 10 },
    { name: '其他', value: 10 },
  ] as const;

  private readonly backtestTrades: BacktestTradeRow[] = [
    { time: '2026-04-10 14:20', symbol: 'AAPL', side: 'Buy', price: '$182.40', volume: '1,200', pnl: '--', pnlTone: 'neutral' },
    { time: '2026-04-10 10:15', symbol: 'TSLA', side: 'Sell', price: '$175.10', volume: '800', pnl: '+$2,104', pnlTone: 'up' },
    { time: '2026-04-09 15:55', symbol: 'MSFT', side: 'Sell', price: '$420.45', volume: '500', pnl: '-$450', pnlTone: 'down' },
    { time: '2026-04-09 11:32', symbol: 'NVDA', side: 'Buy', price: '$890.10', volume: '300', pnl: '--', pnlTone: 'neutral' },
    { time: '2026-04-08 14:05', symbol: 'AMD', side: 'Sell', price: '$176.80', volume: '650', pnl: '+$980', pnlTone: 'up' },
    { time: '2026-04-08 09:58', symbol: 'META', side: 'Buy', price: '$512.30', volume: '260', pnl: '--', pnlTone: 'neutral' },
  ];

  private readonly liveQuotes: LiveQuoteItem[] = [
    { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 892.4, changePct: 2.16, volumeText: '31.2M' },
    { symbol: 'TSLA', name: 'Tesla Inc.', price: 175.1, changePct: -0.84, volumeText: '24.1M' },
    { symbol: 'AAPL', name: 'Apple Inc.', price: 182.4, changePct: 1.03, volumeText: '28.6M' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', price: 420.45, changePct: 0.62, volumeText: '19.4M' },
  ];

  private readonly livePositions: LivePositionRow[] = [
    { symbol: 'NVDA', qty: 320, avgCost: 874.2, lastPrice: 892.4, pnl: 5824 },
    { symbol: 'AAPL', qty: 1200, avgCost: 179.8, lastPrice: 182.4, pnl: 3120 },
    { symbol: 'TSLA', qty: 500, avgCost: 178.6, lastPrice: 175.1, pnl: -1750 },
  ];

  getRanking(): RankingItem[] {
    return [...this.rankingData];
  }

  getCurve(range: RangeKey): number[] {
    if (range === 'day') return [...this.dayCurve];
    if (range === 'week') return [...this.weekCurve];
    return [...this.monthCurve];
  }

  getNavSnapshot(range: RangeKey): { nav: string; delta: string } {
    if (range === 'day') return { nav: '¥12,854,200', delta: '+12.4%' };
    if (range === 'week') return { nav: '¥12,642,800', delta: '+9.8%' };
    return { nav: '¥12,318,500', delta: '+7.1%' };
  }

  getInitialDecisionEvents(): DecisionEvent[] {
    return [
      {
        ts: '10:42:15',
        tag: '模型推断',
        content: 'AI引擎检测到 $NVDA 形成看涨吞没形态，叠加情绪利好，确定性 84%。',
      },
      {
        ts: '10:42:18',
        tag: '风控拦截',
        content: '拟建仓位触及行业集中度阈值，建议仓位从 500 股调整为 320 股。',
      },
      {
        ts: '10:42:20',
        tag: '交易执行',
        content: '委托成功：买入 $NVDA 320 股，均价 $892.40。',
      },
    ];
  }

  nextDecisionEvent(now = new Date()): DecisionEvent {
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const pick = this.decisionCandidates[Math.floor(Math.random() * this.decisionCandidates.length)];
    return { ...pick, ts };
  }

  getBacktestMetrics(): BacktestMetric[] {
    return [...this.backtestMetrics];
  }

  getBacktestCurve(): { strategy: number[]; benchmark: number[] } {
    return {
      strategy: [...this.backtestStrategyCurve],
      benchmark: [...this.backtestBenchmarkCurve],
    };
  }

  getBacktestRiskPie(): Array<{ name: string; value: number }> {
    return this.backtestRiskPie.map((x) => ({ ...x }));
  }

  getBacktestTrades(): BacktestTradeRow[] {
    return [...this.backtestTrades];
  }

  getLiveQuotes(): LiveQuoteItem[] {
    return [...this.liveQuotes];
  }

  getLivePositions(): LivePositionRow[] {
    return [...this.livePositions];
  }

  createExecutionMessage(symbol: string, side: 'Buy' | 'Sell', qty: number, price: number): string {
    const action = side === 'Buy' ? '买入' : '卖出';
    return `委托回报：${action} ${symbol} ${qty} 股，成交均价 $${price.toFixed(2)}。`;
  }
}
