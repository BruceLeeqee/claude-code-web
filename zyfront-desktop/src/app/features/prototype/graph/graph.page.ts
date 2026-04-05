import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { PrototypeCoreFacade } from '../shared/prototype-core.facade';

@Component({
  selector: 'app-graph-page',
  standalone: true,
  imports: [NgFor, NgIf, NzCardModule, NzButtonModule],
  templateUrl: './graph.page.html',
  styleUrl: '../prototype-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
