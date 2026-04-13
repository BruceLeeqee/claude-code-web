import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { QuantLayoutComponent } from '../quant-layout.component';

type NodeKind = 'input' | 'filter' | 'logic' | 'exit';

interface StrategyNode {
  id: string;
  title: string;
  subtitle: string;
  kind: NodeKind;
  x: number;
  y: number;
}

interface StrategyTemplate {
  id: string;
  name: string;
  prompt: string;
  summary: string;
  nodes: StrategyNode[];
}

@Component({
  selector: 'app-quant-strategy-canvas-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, QuantLayoutComponent],
  templateUrl: './quant-strategy-canvas.page.html',
  styleUrl: './quant-strategy-canvas.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantStrategyCanvasPageComponent {
  private readonly router = inject(Router);

  protected readonly promptInput = signal(
    '我想做一个中短线策略，针对科技股，当日涨幅超过3%且成交量是前五日均值2倍时买入，回撤5%止损，盈利15%止盈。',
  );

  protected readonly templates = signal<StrategyTemplate[]>([
    {
      id: 'momentum',
      name: '动量增强模板',
      prompt: '科技股 + 量比 > 2 + 当日涨幅 > 3% + 止损5% + 止盈15%',
      summary: '适合趋势加速阶段，强调量价共振与严格风控。',
      nodes: [
        { id: 'n1', title: '板块: 纳斯达克100', subtitle: 'Data Input', kind: 'input', x: 6, y: 30 },
        { id: 'n2', title: '量比 > 2.0', subtitle: 'Signal Filter', kind: 'filter', x: 30, y: 26 },
        { id: 'n3', title: '价格涨幅 > 3%', subtitle: 'Signal Filter', kind: 'filter', x: 30, y: 52 },
        { id: 'n4', title: '触发多头', subtitle: 'Logic AND', kind: 'logic', x: 54, y: 39 },
        { id: 'n5', title: '移动止损: 5%', subtitle: 'Exit Strategy', kind: 'exit', x: 78, y: 20 },
        { id: 'n6', title: '目标收益: 15%', subtitle: 'Exit Strategy', kind: 'exit', x: 78, y: 58 },
      ],
    },
    {
      id: 'mean-reversion',
      name: '均值回归模板',
      prompt: '大盘震荡 + RSI<30 反弹 + MACD金叉 + 分批止盈',
      summary: '适合高波动震荡阶段，关注超卖反弹和分层退出。',
      nodes: [
        { id: 'n1', title: '标的池: 成长股篮子', subtitle: 'Data Input', kind: 'input', x: 6, y: 30 },
        { id: 'n2', title: 'RSI < 30', subtitle: 'Signal Filter', kind: 'filter', x: 30, y: 24 },
        { id: 'n3', title: 'MACD 金叉确认', subtitle: 'Signal Filter', kind: 'filter', x: 30, y: 50 },
        { id: 'n4', title: '反转信号触发', subtitle: 'Logic AND', kind: 'logic', x: 54, y: 37 },
        { id: 'n5', title: '止损: 3.5%', subtitle: 'Exit Strategy', kind: 'exit', x: 78, y: 18 },
        { id: 'n6', title: '分批止盈: 8% / 12%', subtitle: 'Exit Strategy', kind: 'exit', x: 78, y: 56 },
      ],
    },
  ]);

  protected readonly selectedTemplateId = signal<StrategyTemplate['id']>('momentum');
  protected readonly selectedNodeId = signal('n4');
  protected readonly generationLog = signal<string[]>([
    '提取标的：科技板块(XLK)',
    '解析触发器：涨幅>3% 且 Volume > 2x Avg',
    '配置退出：止损5%，止盈15%',
  ]);
  protected readonly actionToast = signal('');
  protected readonly rightSidebarVisible = signal(true);

  protected readonly selectedTemplate = computed(() => {
    const list = this.templates();
    return list.find((x) => x.id === this.selectedTemplateId()) ?? list[0];
  });

  protected readonly selectedNode = computed(
    () => this.selectedTemplate().nodes.find((x) => x.id === this.selectedNodeId()) ?? this.selectedTemplate().nodes[0],
  );

  protected onPromptInput(event: Event): void {
    this.promptInput.set((event.target as HTMLTextAreaElement).value);
  }

  protected useTemplate(id: StrategyTemplate['id']): void {
    this.selectedTemplateId.set(id);
    this.selectedNodeId.set('n4');
    this.pushLog(`已加载模板：${this.selectedTemplate().name}`);
  }

  protected selectNode(id: string): void {
    this.selectedNodeId.set(id);
  }

  protected toggleRightSidebar(): void {
    this.rightSidebarVisible.update((v) => !v);
  }

  protected generateStrategy(): void {
    const input = this.promptInput().trim();
    if (!input) {
      this.showToast('请先输入策略描述');
      return;
    }
    this.pushLog(`AI 已根据输入重算节点（字符数 ${input.length}）`);
    this.showToast('策略生成完成，已刷新画布节点');
  }

  protected runBacktest(): void {
    this.showToast('已触发回测任务，正在跳转到回测页面');
    void this.router.navigate(['/prototype/quant/backtest']);
  }

  protected saveTemplate(): void {
    this.showToast('模板已保存到本地草稿');
  }

  protected updateSelectedNodeTitle(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const tid = this.selectedTemplateId();
    const nid = this.selectedNodeId();

    this.templates.update((list) =>
      list.map((tpl) => {
        if (tpl.id !== tid) return tpl;
        return {
          ...tpl,
          nodes: tpl.nodes.map((n) => (n.id === nid ? { ...n, title: value || n.title } : n)),
        };
      }),
    );
  }

  protected trackByNode(_: number, item: StrategyNode): string {
    return item.id;
  }

  private pushLog(message: string): void {
    this.generationLog.update((logs) => [message, ...logs].slice(0, 6));
  }

  private showToast(message: string): void {
    this.actionToast.set(message);
    setTimeout(() => {
      if (this.actionToast() === message) this.actionToast.set('');
    }, 2200);
  }
}
