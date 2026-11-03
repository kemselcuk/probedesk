import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-plan-version-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Published Plan"
      subtitle="Read-only view of an immutable published plan version."
      message="The published version contents, version list, and new-draft action are delivered with P2-07. No version data is loaded on this screen yet."
      task="P2-07"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanVersionPage {}
