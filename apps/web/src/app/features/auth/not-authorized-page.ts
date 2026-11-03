import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { AuthFacade } from '../../core/auth/auth.facade';
import { roleLabel as formatRoleLabel } from '../../core/auth/auth.types';

@Component({
  selector: 'app-not-authorized-page',
  imports: [MatButtonModule, PageHeader, RouterLink],
  template: `
    <app-page-header
      title="Not available for your role"
      subtitle="Your signed-in role does not include this action."
    />
    <section class="role-panel" aria-labelledby="role-panel-heading">
      <h2 id="role-panel-heading">This screen needs different access</h2>
      <p>
        You are signed in as <strong>{{ roleLabel() }}</strong>. ProbeDesk keeps
        plan editing, publishing, and test execution limited to the role that
        owns them. The API enforces the same rule.
      </p>
      <p>
        Read-only screens such as Test Plans, Run History, Run Details, and
        Compare Runs remain available to every role.
      </p>
      <a mat-stroked-button routerLink="/plans">Go to Test Plans</a>
    </section>
  `,
  styleUrl: './not-authorized-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotAuthorizedPage {
  private readonly auth = inject(AuthFacade);

  protected readonly roleLabel = computed(() =>
    formatRoleLabel(this.auth.role()),
  );
}
