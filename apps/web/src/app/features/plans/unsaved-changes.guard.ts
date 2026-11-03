import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';

/** A screen that can veto navigation while it holds unsaved changes. */
export interface PendingChangesAware {
  canLeave(): boolean | Observable<boolean>;
}

/**
 * Route guard for the plan editor. The component owns the confirmation dialog
 * so the warning uses the same Material accessibility behaviour as the screen.
 *
 * Sign-in and authorization redirects are never blocked: the session is already
 * unusable there, so keeping the editor open would only hide the real state.
 */
export const unsavedChangesGuard: CanDeactivateFn<PendingChangesAware> = (
  component,
  _currentRoute,
  _currentState,
  nextState,
) => {
  if (nextState.url.startsWith('/login') || nextState.url.startsWith('/not-authorized')) {
    return true;
  }

  return component.canLeave();
};
