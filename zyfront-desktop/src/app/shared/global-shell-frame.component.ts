import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';

@Component({
  selector: 'app-global-shell-frame',
  standalone: true,
  imports: [NgIf, RouterLink, RouterLinkActive, NzButtonModule, NzIconModule],
  templateUrl: './global-shell-frame.component.html',
  styleUrl: './global-shell-frame.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalShellFrameComponent {
  @Input() llmAvailable = false;
  @Input() showExplorerToggle = false;
  @Input() showTerminalMenuToggle = false;
  @Input() showSettingsToggle = false;
  @Input() showRightPanelToggle = false;
  @Input() explorerVisible = true;
  @Input() terminalMenuVisible = true;
  @Input() rightPanelVisible = true;

  @Output() toggleExplorer = new EventEmitter<void>();
  @Output() toggleTerminalMenu = new EventEmitter<void>();
  @Output() toggleRightPanel = new EventEmitter<void>();
}
