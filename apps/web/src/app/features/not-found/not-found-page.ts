import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-not-found-page',
  imports: [MatButtonModule, PageHeader, RouterLink],
  template: `
    <app-page-header
      title="Page not found"
      subtitle="The address you followed does not match a ProbeDesk screen."
    />
    <section class="not-found" aria-labelledby="not-found-heading">
      <h2 id="not-found-heading">We couldn't find that page</h2>
      <p>
        Check the address, or continue with one of the links below. A mistyped
        route never loads a partial screen.
      </p>
      <div class="not-found-actions">
        <a mat-stroked-button routerLink="/plans">Go to Test Plans</a>
        <a mat-button routerLink="/runs">Go to Run History</a>
      </div>
    </section>
  `,
  styleUrl: './not-found-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
