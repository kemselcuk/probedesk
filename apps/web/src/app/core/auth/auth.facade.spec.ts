import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AuthFacade } from './auth.facade';

describe('AuthFacade', () => {
  it('starts signed out and exposes role checks for later screens', () => {
    const auth = TestBed.inject(AuthFacade);

    expect(auth.role()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.hasRole('PLANNER')).toBe(false);

    auth.role.set('OPERATOR');

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.hasRole('PLANNER', 'OPERATOR')).toBe(true);
    expect(auth.hasRole('VIEWER')).toBe(false);
  });
});
