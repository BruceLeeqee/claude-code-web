import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { QuantLayoutComponent } from '../quant-layout.component';
import {
  QuantMockDataService,
  type LivePositionRow,
  type LiveQuoteItem,
} from '../quant-mock-data.service';

type OrderSide = 'Buy' | 'Sell';

@Component({
  selector: 'app-quant-live-trading-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, DecimalPipe, QuantLayoutComponent],
  templateUrl: './quant-live-trading.page.html',
  styleUrls: ['./quant-page.scss', './quant-live-trading.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantLiveTradingPageComponent {
  private readonly mock = inject(QuantMockDataService);

  protected readonly quotes = signal<LiveQuoteItem[]>(this.mock.getLiveQuotes());
  protected readonly positions = signal<LivePositionRow[]>(this.mock.getLivePositions());

  protected readonly selectedSymbol = signal('NVDA');
  protected readonly orderSide = signal<OrderSide>('Buy');
  protected readonly orderQty = signal(320);
  protected readonly orderPrice = signal(892.4);
  protected readonly executionFeed = signal<string[]>([
    '10:42:20 委托成功：买入 NVDA 320 股，均价 $892.40',
    '10:35:07 风控通过：AAPL 加仓申请（+200 股）',
    '10:20:13 系统提示：TSLA 波动率升高，建议降低杠杆',
  ]);
  protected readonly toast = signal('');

  protected readonly selectedQuote = computed(() => {
    const symbol = this.selectedSymbol();
    return this.quotes().find((q) => q.symbol === symbol) ?? this.quotes()[0];
  });

  protected readonly estimatedAmount = computed(() => this.orderQty() * this.orderPrice());

  protected pickSymbol(symbol: string): void {
    this.selectedSymbol.set(symbol);
    const target = this.quotes().find((q) => q.symbol === symbol);
    if (target) {
      this.orderPrice.set(target.price);
      this.pushExecution(`已切换标的：${target.symbol} (${target.name})`);
    }
  }

  protected setOrderSide(side: OrderSide): void {
    this.orderSide.set(side);
  }

  protected onQtyInput(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    this.orderQty.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }

  protected onPriceInput(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    this.orderPrice.set(Number.isFinite(n) && n > 0 ? n : 0);
  }

  protected submitOrder(): void {
    const qty = this.orderQty();
    const price = this.orderPrice();
    if (qty <= 0 || price <= 0) {
      this.showToast('请填写有效的下单数量和价格');
      return;
    }

    const msg = this.mock.createExecutionMessage(this.selectedSymbol(), this.orderSide(), qty, price);
    this.pushExecution(msg);
    this.showToast('下单成功，已写入执行队列');
  }

  protected trackByQuote(_: number, item: LiveQuoteItem): string {
    return item.symbol;
  }

  protected trackByPosition(_: number, item: LivePositionRow): string {
    return item.symbol;
  }

  private pushExecution(message: string): void {
    const ts = new Date();
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const ss = String(ts.getSeconds()).padStart(2, '0');
    this.executionFeed.update((items) => [`${hh}:${mm}:${ss} ${message}`, ...items].slice(0, 8));
  }

  private showToast(message: string): void {
    this.toast.set(message);
    setTimeout(() => {
      if (this.toast() === message) this.toast.set('');
    }, 2200);
  }
}
