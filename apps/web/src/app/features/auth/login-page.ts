import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlaceholderPage } from '../../shared/ui/placeholder-page/placeholder-page';

@Component({
  selector: 'app-login-page',
  imports: [PlaceholderPage],
  template: `
    <app-placeholder-page
      title="Sign in"
      subtitle="Access ProbeDesk with one of the prepared accounts."
      message="Authentication, session loading, and role-aware navigation arrive with P1-07. No credentials are accepted on this screen yet."
      task="P1-07"
    />
  `,
  styleUrl: './login-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {}
