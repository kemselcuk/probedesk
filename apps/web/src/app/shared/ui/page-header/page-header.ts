import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Consistent page heading and optional action area for feature screens. */
@Component({
  selector: 'app-page-header',
  template: `
    <header class="page-header">
      <div class="page-heading">
        <h1 [id]="headingId()">{{ title() }}</h1>
        @if (subtitle(); as text) {
          <p class="page-subtitle">{{ text }}</p>
        }
      </div>
      <div class="page-actions">
        <ng-content />
      </div>
    </header>
  `,
  styleUrl: './page-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly headingId = input<string | null>(null);
}
