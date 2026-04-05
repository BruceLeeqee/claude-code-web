import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { PrototypeCoreFacade } from '../shared/prototype-core.facade';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [NgFor, NzCardModule, NzButtonModule, NzProgressModule],
  templateUrl: './collaboration.page.html',
  styleUrl: '../prototype-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
