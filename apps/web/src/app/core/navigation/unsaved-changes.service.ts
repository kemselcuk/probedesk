import { Injectable } from '@angular/core';
import { Observable, of, take } from 'rxjs';

type LeaveCheck = () => boolean | Observable<boolean>;

/**
 * Shared bridge between a screen that holds unsaved changes and global actions
 * outside its route, such as the shell's sign-out button.
 *
 * The editor registers its existing confirmation flow, so sign out uses the
 * same dialog and wording as an in-app navigation instead of silently
 * discarding local input. Session-expiry redirects never consult this service.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  private leaveCheck: LeaveCheck | null = null;

  /** Registers the active screen's check and returns an unregister function. */
  register(check: LeaveCheck): () => void {
    this.leaveCheck = check;

    return () => {
      if (this.leaveCheck === check) {
        this.leaveCheck = null;
      }
    };
  }

  /** Resolves true when leaving is allowed; false aborts the action. */
  confirmLeave(): Observable<boolean> {
    const check = this.leaveCheck;
    if (check === null) {
      return of(true);
    }

    const result = check();
    return typeof result === 'boolean' ? of(result) : result.pipe(take(1));
  }
}
