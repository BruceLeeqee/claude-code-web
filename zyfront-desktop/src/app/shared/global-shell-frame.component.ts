import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';

@Component({
  selector: 'app-global-shell-frame',
  standalone: true,
  imports: [NgFor, NgIf, RouterLink, RouterLinkActive, NzButtonModule, NzIconModule],
  templateUrl: './global-shell-frame.component.html',
  styleUrl: './global-shell-frame.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalShellFrameComponent {
  @Input() llmAvailable = false;
  @Input() showExplorerToggle = false;
  /** 标题栏：显示/隐藏左侧主侧栏（如工程目录） */
  @Input() showLeftPanelToggle = false;
  @Input() leftPanelVisible = true;
  @Input() showTerminalMenuToggle = false;
  @Input() showSettingsToggle = false;
  @Input() showRightPanelToggle = false;
  @Input() terminalMenuVisible = true;
  @Input() rightPanelVisible = true;

  @Output() toggleLeftPanel = new EventEmitter<void>();
  @Output() toggleTerminalMenu = new EventEmitter<void>();
  @Output() toggleRightPanel = new EventEmitter<void>();
  @Output() openProject = new EventEmitter<void>();

  protected readonly fileMenuItems = [{ key: 'open-project', label: '打开工程…' }];

  protected handleFileMenuAction(key: string): void {
    if (key === 'open-project') this.openProject.emit();
  }
}
