import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, type Observable } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { PlansApi } from './plans-api';
import type { CopyPlanResponse, PublishedRevision } from './plans-api.types';
import { PlanCopyActions } from './plan-copy-actions';

/** Dialog view state; submitted actions recover through the user-scoped store. */
@Injectable()
export class PlanCopyFacade {
  private readonly api = inject(PlansApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly actions = inject(PlanCopyActions);
  readonly source = signal<PublishedRevision | null>(null);
  readonly sourceLoading = signal(false);
  readonly sourceError = signal<ApiErrorView | null>(null);
  readonly pending = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  readonly result = signal<CopyPlanResponse | null>(null);
  readonly initialName = signal('');

  loadSource(versionId: string): void {
    if (this.sourceLoading()) return;
    this.sourceLoading.set(true);
    this.sourceError.set(null);
    this.api
      .getVersion(versionId)
      .pipe(
        map((source) => {
          if (source.id.toLowerCase() !== versionId.toLowerCase()) {
            throw new MalformedApiResponseError(
              'Read copy source',
              'the version identity does not match the request.',
            );
          }
          return source;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (source) => {
          this.source.set(source);
          this.sourceLoading.set(false);
          // Slice by UTF-16 budget, but never leave half a surrogate pair.
          const prefix = source.name.slice(0, 93).replace(/[\uD800-\uDBFF]$/, '');
          this.initialName.set(this.actions.savedName(source.id) ?? `${prefix} (copy)`);
          const recovery = this.actions.recovery(source.id);
          if (recovery !== null) this.observe(recovery);
        },
        error: (error: unknown) => {
          this.sourceError.set(this.errors.normalize(error));
          this.sourceLoading.set(false);
        },
      });
  }

  clearError(): void {
    this.error.set(null);
  }

  submit(nameInput: string): void {
    const source = this.source();
    if (source === null || this.pending() || this.result() !== null) return;
    const name = nameInput.trim();
    this.observe(this.actions.execute(source, name));
  }

  private observe(request: Observable<CopyPlanResponse>): void {
    this.pending.set(true);
    this.error.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.pending.set(false);
        this.result.set(result);
      },
      error: (error: unknown) => {
        this.pending.set(false);
        this.error.set(this.errors.normalize(error));
      },
    });
  }
}
