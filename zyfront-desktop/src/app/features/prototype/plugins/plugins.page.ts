import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { PrototypeCoreFacade } from '../shared/prototype-core.facade';

@Component({
  selector: 'app-plugins-page',
  standalone: true,
  imports: [NgFor, NzCardModule, NzButtonModule],
  templateUrl: './plugins.page.html',
  styleUrl: '../prototype-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginsPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
