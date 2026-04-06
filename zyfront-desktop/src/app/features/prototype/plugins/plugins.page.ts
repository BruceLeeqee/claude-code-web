import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';

@Component({
  selector: 'app-plugins-page',
  standalone: true,
  imports: [NgFor, FormsModule, NzButtonModule, NzInputModule],
  templateUrl: './plugins.page.html',
  styleUrls: ['../prototype-page.scss', './plugins.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginsPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
