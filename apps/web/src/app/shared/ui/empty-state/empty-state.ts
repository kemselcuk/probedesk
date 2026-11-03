import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Announced empty state for a loaded screen that has no rows to show. */
@Component({
  selector: 'app-empty-state',
  template: `
    <section class="state state--empty" role="status" aria-live="polite">
      <div class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M6 4h9l3 3v13H6V4Zm8 1.5V8h2.5M9 12h6M9 15h6"
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
        <div class="state-actions">
          <ng-content />
        </div>
      </div>
    </section>
  `,
  styleUrl: './empty-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyState {
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
}
