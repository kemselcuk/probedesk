import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-start-run-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Start Run"
      subtitle="Choose a published plan version and a simulator scenario."
      message="Plan version selection, scenario, seed, and failure settings arrive with P3-09. No run can be started from this screen yet."
      task="P3-09"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartRunPage {}
