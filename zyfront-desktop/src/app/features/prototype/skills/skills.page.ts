import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';

@Component({
  selector: 'app-skills-page',
  standalone: true,
  imports: [NgFor, NzCardModule, NzButtonModule, NzTagModule],
  templateUrl: './skills.page.html',
  styleUrls: ['../prototype-page.scss', './skills.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPrototypePageComponent {
  protected readonly facade = inject(PrototypeCoreFacade);

  protected readonly activeSkill = computed(() => {
    const skills = this.facade.skills();
    // skills 初始固定不为空：保证模板可直接读取 name/desc
    return (skills.find((s: { active: boolean }) => s.active) ?? skills[0])!;
  });
}
