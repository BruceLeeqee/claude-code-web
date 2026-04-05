import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzIconModule } from 'ng-zorro-antd/icon';

@Component({
  selector: 'app-prototype-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NzLayoutModule, NzIconModule],
  templateUrl: './prototype-shell.component.html',
  styleUrl: './prototype-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrototypeShellComponent {}
