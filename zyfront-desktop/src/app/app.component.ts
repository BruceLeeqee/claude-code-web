import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ClaudeAgentService } from './core/claude-agent.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  /**
   * 必须尽早构造，以便订阅 AppSettingsService 并把 API Key 写入 ClaudeClient。
   * 仅打开工作台时若未注入本服务，会导致请求始终无 Key（401）。
   */
  private readonly _agentSettingsBridge = inject(ClaudeAgentService);
}
