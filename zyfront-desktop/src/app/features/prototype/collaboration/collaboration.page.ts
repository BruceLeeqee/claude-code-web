import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';

@Component({
  selector: 'app-collaboration-page',
  standalone: true,
  imports: [NgFor, FormsModule, NzButtonModule, NzSelectModule, NzProgressModule],
  templateUrl: './collaboration.page.html',
  styleUrls: ['../prototype-page.scss', './collaboration.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaborationPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
