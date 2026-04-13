import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-quant-shell',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './quant-shell.component.html',
  styleUrl: './quant-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuantShellComponent {}
