import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, signal } from '@angular/core';
import { NgFor } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { PrototypeCoreFacade } from '../../../shared/prototype-core.facade';
import { SkillCreateWizardComponent } from './skill-create-wizard.component';

@Component({
  selector: 'app-skills-page',
  standalone: true,
  imports: [NgFor, NzCardModule, NzButtonModule, NzTagModule, RouterLink, RouterLinkActive, SkillCreateWizardComponent],
  templateUrl: './skills.page.html',
  styleUrls: ['../prototype-page.scss', './skills.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPrototypePageComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly facade = inject(PrototypeCoreFacade);
  protected readonly createMode = signal(false);

  protected readonly activeSkill = computed(() => {
    const skills = this.facade.skills();
    // skills 初始固定不为空：保证模板可直接读取 name/desc
    return (skills.find((s: { active: boolean }) => s.active) ?? skills[0])!;
  });

  openCreateWizard(): void {
    this.createMode.set(true);
    this.cdr.markForCheck();
  }

  closeCreateWizard(): void {
    this.createMode.set(false);
    this.cdr.markForCheck();
  }

  completeCreateWizard(payload: { name: string; desc: string }): void {
    this.facade.addSkill(payload);
    this.createMode.set(false);
    this.cdr.markForCheck();
  }
}
