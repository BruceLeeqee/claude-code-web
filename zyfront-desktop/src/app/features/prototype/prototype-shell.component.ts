import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppSettingsService } from '../../core/app-settings.service';
import { GlobalShellFrameComponent } from '../../shared/global-shell-frame.component';

@Component({
  selector: 'app-prototype-shell',
  standalone: true,
  imports: [RouterOutlet, GlobalShellFrameComponent],
  templateUrl: './prototype-shell.component.html',
  styleUrl: './prototype-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrototypeShellComponent implements OnDestroy {
  private readonly appSettings = inject(AppSettingsService);
  private readonly settingsSub: Subscription;

  protected readonly llmAvailable = signal(this.hasLlmConfigured());

  constructor() {
    this.settingsSub = this.appSettings.settings$.subscribe(() => {
      this.llmAvailable.set(this.hasLlmConfigured());
    });
  }

  ngOnDestroy(): void {
    this.settingsSub.unsubscribe();
  }

  private hasLlmConfigured(): boolean {
    const s = this.appSettings.value;
    return Boolean(s.apiKey?.trim() && s.model?.trim());
  }
}
