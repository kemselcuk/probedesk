import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import type { Subscription } from 'rxjs';
import { HttpErrorNormalizer, type ApiErrorView } from '../../core/http/http-error-normalizer';
import { ReportsApi, type ExportFormat } from './reports-api';
@Component({
  selector: 'app-run-export-actions',
  imports: [MatButtonModule],
  template: `<div class="actions" aria-label="Download recorded results">
      <button
        mat-stroked-button
        type="button"
        [disabled]="pending() !== null"
        (click)="download('csv')"
      >
        {{ pending() === 'csv' ? 'Downloading CSV…' : 'Download CSV' }}
      </button>
      <button
        mat-stroked-button
        type="button"
        [disabled]="pending() !== null"
        (click)="download('json')"
      >
        {{ pending() === 'json' ? 'Downloading JSON…' : 'Download JSON' }}
      </button>
    </div>
    @if (error(); as error) {
      <p role="alert">
        {{ error.message }}
        @if (error.requestId) {
          <span>Request ID: {{ error.requestId }}</span>
        }
      </p>
    }
    <span class="visually-hidden" role="status">{{ message() }}</span>`,
  styles: `
    :host {
      display: block;
      margin-top: var(--pd-space-2);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-2);
    }
    p {
      overflow-wrap: anywhere;
      line-height: var(--pd-font-body-relaxed-line);
      color: var(--pd-danger);
      margin: var(--pd-space-2) 0;
    }
    p span {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunExportActions {
  readonly runId = input.required<string>();
  protected readonly pending = signal<ExportFormat | null>(null);
  protected readonly error = signal<ApiErrorView | null>(null);
  protected readonly message = signal('');
  private readonly api = inject(ReportsApi);
  private readonly errors = inject(HttpErrorNormalizer);
  private readonly document = inject(DOCUMENT);
  private request: Subscription | null = null;
  private readonly urls = new Map<string, ReturnType<typeof setTimeout>>();
  constructor() {
    effect(() => {
      this.runId();
      this.request?.unsubscribe();
      this.pending.set(null);
      this.error.set(null);
      this.message.set('');
      this.cleanup();
    });
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      this.cleanup();
    });
  }
  protected download(format: ExportFormat): void {
    if (this.pending()) return;
    const id = this.runId();
    this.pending.set(format);
    this.error.set(null);
    this.message.set('');
    this.request = this.api.export(id, format).subscribe({
      next: (blob) => {
        let url: string | null = null;
        const link = this.document.createElement('a');
        try {
          url = URL.createObjectURL(blob);
          link.href = url;
          link.download = `probedesk-run-${id.toLowerCase()}.${format}`;
          link.hidden = true;
          this.document.body.append(link);
          link.click();
          const currentUrl = url;
          this.urls.set(
            url,
            setTimeout(() => {
              URL.revokeObjectURL(currentUrl);
              this.urls.delete(currentUrl);
            }, 1000),
          );
          this.message.set(`${format.toUpperCase()} download started.`);
        } catch (error) {
          if (url) URL.revokeObjectURL(url);
          this.error.set(this.errors.normalize(error));
        } finally {
          link.remove();
          this.pending.set(null);
        }
      },
      error: (error: unknown) => {
        this.error.set(this.errors.normalize(error));
        this.pending.set(null);
      },
    });
  }
  private cleanup(): void {
    for (const [url, timer] of this.urls) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
}
