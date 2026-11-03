import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { AuthFacade } from './core/auth/auth.facade';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // A refresh starts with no client state; guards share this single `/auth/me`
    // request when a protected deep link is the first navigation.
    this.auth
      .loadSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => undefined);
  }
}
