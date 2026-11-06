import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { PlansApi } from './plans-api';
import type { CopyPlanResponse, PublishedRevision } from './plans-api.types';

/** One instance per dialog: an uncertain HTTP response retains its request key. */
@Injectable()
export class PlanCopyFacade {
  private readonly api = inject(PlansApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly destroyRef = inject(DestroyRef);
  readonly source = signal<PublishedRevision | null>(null);
  readonly sourceLoading = signal(false);
  readonly sourceError = signal<ApiErrorView | null>(null);
  readonly pending = signal(false);
  readonly error = signal<ApiErrorView | null>(null);
  readonly result = signal<CopyPlanResponse | null>(null);
  private lastRequest: { identity: string; key: string } | null = null;

  loadSource(versionId: string): void {
    if (this.sourceLoading()) return;
    this.sourceLoading.set(true);
    this.sourceError.set(null);
    this.api
      .getVersion(versionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (source) => {
          this.source.set(source);
          this.sourceLoading.set(false);
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
    const identity = JSON.stringify([source.id, name]);
    if (this.lastRequest?.identity !== identity) {
      this.lastRequest = { identity, key: crypto.randomUUID() };
    }
    this.pending.set(true);
    this.error.set(null);
    this.api
      .copyPlan(source.id, { name }, this.lastRequest.key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
