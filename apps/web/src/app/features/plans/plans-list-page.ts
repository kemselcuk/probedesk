import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-plans-list-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Test Plans"
      subtitle="Draft, publish, and inspect versioned measurement plans."
      message="The role-aware plan list, draft entry point, and published version links arrive with P2-03. No plans are loaded on this screen yet."
      task="P2-03"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlansListPage {}
