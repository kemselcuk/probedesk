import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Observable, map } from 'rxjs';
import { AuthFacade } from './auth.facade';
import type { AuthenticatedUser, Role } from './auth.types';

/** Requires a resolved session; anonymous visitors are sent to the login page. */
export const authGuard: CanActivateFn = (_route, state) => authorize(state);

/**
 * Requires an authenticated user with one of the allowed roles. The API checks
 * the same permission; this guard only prevents an unusable screen from loading.
 */
export function roleGuard(allowedRoles: readonly Role[]): CanActivateFn {
  return (_route, state) => authorize(state, allowedRoles);
}

function authorize(
  state: RouterStateSnapshot,
  allowedRoles?: readonly Role[],
): boolean | UrlTree | Observable<boolean | UrlTree> {
  const auth = inject(AuthFacade);
  const router = inject(Router);

  const decide = (user: AuthenticatedUser | null): boolean | UrlTree => {
    if (user === null) {
      return router.createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url === '/' ? '/plans' : state.url },
      });
    }

    if (allowedRoles !== undefined && !allowedRoles.includes(user.role)) {
      return router.createUrlTree(['/not-authorized']);
    }

    return true;
  };

  if (auth.status() !== 'unknown') {
    return decide(auth.user());
  }

  return auth.loadSession().pipe(map(decide));
}
