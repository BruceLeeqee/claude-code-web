import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { PrototypeCoreFacade } from '../shared/prototype-core.facade';

@Component({
  selector: 'app-skills-page',
  standalone: true,
  imports: [NgFor, NzCardModule, NzButtonModule, NzTagModule],
  templateUrl: './skills.page.html',
  styleUrl: '../prototype-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);
}
