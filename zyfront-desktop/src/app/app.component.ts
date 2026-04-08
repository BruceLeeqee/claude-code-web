import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TeamMemorySyncService } from './core/memory/team/team-memory-sync.service';
import { RuntimeSettingsSyncService } from './core/runtime-settings-sync.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly _runtimeSettingsSync = inject(RuntimeSettingsSyncService);
  private readonly _teamMemorySync = inject(TeamMemorySyncService);

  constructor() {
    void this._teamMemorySync.start();
  }
}
