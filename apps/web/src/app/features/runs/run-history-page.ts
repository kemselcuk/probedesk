import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-run-history-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Run History"
      subtitle="Filter and inspect recorded test runs."
      message="Filters, pagination, status labels, and run detail links arrive with P5-02. No runs are loaded on this screen yet."
      task="P5-02"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunHistoryPage {}
