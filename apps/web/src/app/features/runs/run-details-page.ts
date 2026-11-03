import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-run-details-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Run Details"
      subtitle="Review the recorded rules, measurements, and outcome of a run."
      message="Recorded run details, partial-result explanations, and the run-again action arrive with P5-03. No run is loaded on this screen yet."
      task="P5-03"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunDetailsPage {}
