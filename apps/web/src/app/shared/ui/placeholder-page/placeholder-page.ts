import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PageHeader } from '../page-header/page-header';

/**
 * Honest placeholder used until the task that owns a route lands.
 * It deliberately does not render invented data or simulate backend behaviour.
 */
@Component({
  selector: 'app-placeholder-page',
  imports: [PageHeader],
  template: `
    <app-page-header [title]="title()" [subtitle]="subtitle()" />
    <section class="placeholder-panel" aria-labelledby="placeholder-heading">
      <p class="placeholder-eyebrow">Not implemented yet</p>
      <h2 id="placeholder-heading">This screen is not available yet</h2>
      <p class="placeholder-message">{{ message() }}</p>
      <p class="placeholder-task">
        Planned delivery task: <strong>{{ task() }}</strong>
      </p>
      <div class="placeholder-actions">
        <ng-content />
      </div>
    </section>
  `,
  styleUrl: './placeholder-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPage {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly message = input.required<string>();
  readonly task = input.required<string>();
}
