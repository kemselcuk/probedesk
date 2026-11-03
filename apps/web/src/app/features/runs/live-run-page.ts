import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-live-run-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Live Run"
      subtitle="Follow execution progress and measurements as they arrive."
      message="Snapshot loading, reconnect handling, and the live event stream arrive with P4-04. No run is loaded on this screen yet."
      task="P4-04"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveRunPage {}
