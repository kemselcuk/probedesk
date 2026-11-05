import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RunOutcome, RunStatus } from './runs-api.types';
import { runStatusView } from './run-status';

/**
 * The one run status badge used by history and details.
 *
 * The label is always visible next to the icon, so colour is never the only
 * carrier of the status. The view comes from `runStatusView`; this component
 * does not evaluate tolerance or infer a verdict.
 */
@Component({
  selector: 'app-run-status-badge',
  template: `
    <span [class]="'status-badge status-badge--' + view().tone">
      @switch (view().icon) {
        @case ('play') {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        }
        @case ('check') {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="m5 12 4 4L19 6"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        }
        @case ('cross') {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="2"
            />
          </svg>
        }
        @case ('stop') {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect
              x="6"
              y="6"
              width="12"
              height="12"
              rx="2"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            />
          </svg>
        }
        @case ('pause') {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M9 5v14M15 5v14"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="2"
            />
          </svg>
        }
        @case ('warning') {
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 8v5m0 3.5v.01M10.3 3.8 2.6 18a1.6 1.6 0 0 0 1.4 2.4h16a1.6 1.6 0 0 0 1.4-2.4L13.7 3.8a1.9 1.9 0 0 0-3.4 0Z"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
        }
      }
      <span class="status-label">{{ view().label }}</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .status-badge {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 2px 8px;
      border: 1px solid currentcolor;
      border-radius: 999px;
      font: 500 var(--pd-font-meta-size) / var(--pd-font-meta-line) var(--pd-font-sans);
      white-space: nowrap;
    }

    .status-badge svg {
      width: 14px;
      height: 14px;
    }

    .status-badge--passed {
      background: var(--pd-success-bg);
      color: var(--pd-success);
    }

    .status-badge--failed,
    .status-badge--error {
      background: var(--pd-danger-bg);
      color: var(--pd-danger);
    }

    .status-badge--running {
      background: var(--pd-primary-soft);
      color: var(--pd-primary);
    }

    .status-badge--cancelled {
      background: var(--pd-neutral-bg);
      color: var(--pd-neutral-text);
    }
    .status-badge--interrupted {
      background: var(--pd-warning-bg);
      color: var(--pd-warning);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunStatusBadge {
  readonly status = input.required<RunStatus>();
  readonly outcome = input<RunOutcome>(null);

  protected readonly view = computed(() => runStatusView(this.status(), this.outcome()));
}
