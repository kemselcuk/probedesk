import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

/**
 * P4-04 will replace this placeholder with snapshot loading and the live event
 * stream. Meanwhile the route must not trap the user: the recorded run is
 * already available on `/runs/:runId`, so the placeholder links there.
 */
@Component({
  selector: 'app-live-run-page',
  imports: [MatButtonModule, PlaceholderPage, RouterLink],
  template: `
    <app-placeholder-page
      title="Live Run"
      subtitle="Follow execution progress and measurements as they arrive."
      message="Snapshot loading, reconnect handling, and the live event stream arrive with P4-04. Until then, open the run details screen to inspect the recorded snapshot."
      task="P4-04"
    >
      @if (runId(); as id) {
        <a mat-flat-button id="live-run-details-link" [routerLink]="['/runs', id]">
          View run details
        </a>
      } @else {
        <a mat-stroked-button routerLink="/runs">Open Run History</a>
      }
    </app-placeholder-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveRunPage {
  private readonly route = inject(ActivatedRoute);

  protected readonly runId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('runId') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('runId') ?? '' },
  );
}
