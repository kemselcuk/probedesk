import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-compare-runs-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Compare Runs"
      subtitle="Compare two terminal runs of the same plan."
      message="Run selection, rule differences, and side-by-side charts arrive with P6-02. No runs are compared on this screen yet."
      task="P6-02"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompareRunsPage {}
