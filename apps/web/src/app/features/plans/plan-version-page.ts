import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-plan-version-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Published Plan"
      subtitle="Read-only view of an immutable published plan version."
      message="Published version details arrive with the P2-03 plan flow and its follow-up version tasks. No version data is loaded yet."
      task="P2-03"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanVersionPage {}
