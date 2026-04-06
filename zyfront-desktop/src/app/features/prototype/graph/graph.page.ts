import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';

@Component({
  selector: 'app-graph-page',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, NzButtonModule],
  templateUrl: './graph.page.html',
  styleUrls: ['../prototype-page.scss', './graph.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
