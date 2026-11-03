import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

/** Announced error state with an optional retry action. */
@Component({
  selector: 'app-error-state',
  imports: [MatButtonModule],
  template: `
    <section class="state state--error" role="alert">
      <div class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M12 8v5m0 3.5v.01M10.3 3.8 2.6 18a1.6 1.6 0 0 0 1.4 2.4h16a1.6 1.6 0 0 0 1.4-2.4L13.7 3.8a1.9 1.9 0 0 0-3.4 0Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </div>
      <div class="state-body">
        <h2 class="state-heading">{{ heading() }}</h2>
        <p class="state-message">{{ message() }}</p>
        @if (requestId(); as id) {
          <p class="request-id">
            Request ID: <code>{{ id }}</code>
          </p>
        }
        @if (retryable()) {
          <div class="state-actions">
            <button mat-stroked-button type="button" (click)="retry.emit()">
              {{ retryLabel() }}
            </button>
          </div>
        }
      </div>
    </section>
  `,
  styleUrl: './error-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorState {
  readonly heading = input('Something went wrong');
  readonly message = input.required<string>();
  readonly requestId = input<string | null>(null);
  readonly retryable = input(false);
  readonly retryLabel = input('Try again');
  readonly retry = output<void>();
}
