import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type ViewType = 'arena' | 'network' | 'cognitive' | 'monitor';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent {
  protected readonly activeTab = signal<ViewType>('arena');

  protected switchTab(tab: ViewType): void {
    this.activeTab.set(tab);
  }
}
