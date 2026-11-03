import {
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/** Announced, visually distinct loading state for asynchronous screens. */
@Component({
  selector: 'app-loading-state',
  imports: [MatProgressSpinnerModule],
  template: `
    <div class="state state--loading" role="status" aria-live="polite" aria-busy="true">
      <mat-spinner class="state-spinner" diameter="32" aria-hidden="true" />
      <p class="state-message">{{ message() }}</p>
    </div>
  `,
  styleUrl: './loading-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingState {
  readonly message = input('Loading…');
}
