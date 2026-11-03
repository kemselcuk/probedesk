import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-plan-editor-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Plan Editor"
      subtitle="Edit the ordered steps of a measurement plan draft."
      message="The typed dynamic step form and draft saving are delivered by the P2-03 plan flow and its follow-up editor tasks. No plan or step data is loaded yet."
      task="P2-03"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanEditorPage {}
