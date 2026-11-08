import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, tap, throwError } from 'rxjs';
import { AuthSessionStore } from '../../core/auth/auth-session.store';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import { PlansApi } from './plans-api';
import type { CopyPlanResponse, PublishedRevision } from './plans-api.types';

interface CopyAction {
  readonly name: string;
  readonly key: string;
  request: Observable<CopyPlanResponse> | null;
  result: CopyPlanResponse | null;
}

/**
 * In-memory recovery belongs to the signed-in user and source version, rather
 * than a routed button. An in-flight request survives overlay/route teardown.
 * Acknowledged actions are removed so a later deliberate copy is a new action.
 */
@Injectable({ providedIn: 'root' })
export class PlanCopyActions {
  private readonly api = inject(PlansApi);
  private readonly auth = inject(AuthSessionStore);
  private readonly actions = new Map<string, CopyAction>();

  savedName(versionId: string): string | null {
    return this.actions.get(this.scope(versionId))?.name ?? null;
  }

  recovery(versionId: string): Observable<CopyPlanResponse> | null {
    const action = this.actions.get(this.scope(versionId));
    return action?.result ? of(action.result) : (action?.request ?? null);
  }

  execute(source: PublishedRevision, name: string): Observable<CopyPlanResponse> {
    const scope = this.scope(source.id);
    let action = this.actions.get(scope);
    if (!action || action.name !== name) {
      action = { name, key: crypto.randomUUID(), request: null, result: null };
      this.actions.set(scope, action);
    }
    if (action.result) return of(action.result);
    if (action.request) return action.request;
    const current = action;
    current.request = this.api.copyPlan(source.id, { name }, current.key).pipe(
      map((result) => {
        if (
          result.planId.toLowerCase() === source.planId.toLowerCase() ||
          result.draftRevisionId.toLowerCase() === source.id.toLowerCase() ||
          result.planId.toLowerCase() === result.draftRevisionId.toLowerCase()
        ) {
          throw new MalformedApiResponseError(
            'Copy plan',
            'the target is not an independent draft.',
          );
        }
        return result;
      }),
      tap((result) => {
        current.result = result;
      }),
      catchError((error: unknown) => {
        current.request = null;
        return throwError(() => error);
      }),
      // Keep the already-submitted HTTP action alive if its dialog disappears.
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return current.request;
  }

  acknowledge(versionId: string, planId: string): void {
    const scope = this.scope(versionId);
    if (this.actions.get(scope)?.result?.planId === planId) this.actions.delete(scope);
  }

  private scope(versionId: string): string {
    return `${this.auth.user()?.id ?? 'signed-out'}:${versionId.toLowerCase()}`;
  }
}
