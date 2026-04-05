import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { PrototypeCoreFacade } from '../shared/prototype-core.facade';

@Component({
  selector: 'app-models-page',
  standalone: true,
  imports: [FormsModule, NzCardModule, NzButtonModule, NzInputModule, NzProgressModule],
  templateUrl: './models.page.html',
  styleUrl: '../prototype-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelsPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);

  protected readonly model = signal(this.facade.settings().model);
  protected readonly maxTokens = signal(this.facade.settings().cost.maxSessionCostUsd.toString());

  protected save(): void {
    this.facade.saveModelSettings({ model: this.model() });
  }

  protected reset(): void {
    this.facade.resetModelSettings();
    this.model.set(this.facade.settings().model);
  }
}
