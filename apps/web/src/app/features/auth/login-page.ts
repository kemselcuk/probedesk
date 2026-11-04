import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthFacade } from '../../core/auth/auth.facade';
import { sanitizeReturnUrl } from '../../core/auth/return-url';

@Component({
  selector: 'app-login-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  protected readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly returnUrl = sanitizeReturnUrl(
    this.route.snapshot.queryParamMap.get('returnUrl'),
  );

  /** Set by the auth interceptor after a protected request returned 401. */
  protected readonly sessionExpired =
    this.route.snapshot.queryParamMap.get('reason') === 'session-expired';

  protected readonly passwordVisible = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected readonly formError = computed(() => {
    const error = this.auth.error();
    if (error === null) {
      return null;
    }

    if (error.code === 'TOO_MANY_REQUESTS') {
      return 'Too many sign-in attempts. Wait a moment and try again.';
    }

    if (error.code === 'UNAUTHENTICATED') {
      return 'The email or password is incorrect. Please try again.';
    }

    return error.message;
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clearServerErrors());

    // The login route is outside the shell, so no shared focus manager runs.
    // Move focus to the heading when the login page opens, including after a
    // session-expiry redirect, instead of leaving it on the document body.
    afterNextRender(
      () => document.getElementById('login-heading')?.focus(),
      { injector: this.injector },
    );
  }

  protected submit(): void {
    if (this.auth.pending()) {
      return;
    }

    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }

    const credentials = this.form.getRawValue();
    this.auth
      .login(
        of({
          email: credentials.email.trim(),
          password: credentials.password,
        }),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          void this.router.navigateByUrl(this.returnUrl);
        },
        error: () => {
          this.applyServerFieldErrors();
        },
      });
  }

  protected togglePassword(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected emailServerError(): string | null {
    return this.readServerError(this.form.controls.email.getError('server'));
  }

  protected passwordServerError(): string | null {
    return this.readServerError(this.form.controls.password.getError('server'));
  }

  private applyServerFieldErrors(): void {
    const fieldErrors = this.auth.error()?.fieldErrors ?? [];

    for (const fieldError of fieldErrors) {
      const control =
        fieldError.path === 'email'
          ? this.form.controls.email
          : fieldError.path === 'password'
            ? this.form.controls.password
            : null;

      if (control !== null) {
        control.setErrors({
          ...control.errors,
          server: fieldError.message,
        });
      }
    }

    if (fieldErrors.length > 0) {
      this.form.markAllAsTouched();
    }
  }

  private clearServerErrors(): void {
    for (const control of [
      this.form.controls.email,
      this.form.controls.password,
    ]) {
      if (control.hasError('server')) {
        control.setErrors(null);
        control.updateValueAndValidity({ emitEvent: false });
      }
    }

    if (this.auth.error() !== null) {
      this.auth.clearError();
    }
  }

  private readServerError(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }
}
