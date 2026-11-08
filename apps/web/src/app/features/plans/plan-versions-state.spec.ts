import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlansFacade } from './plans.facade';

describe('published version request ownership', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('ignores an older plan response and error after a new plan is loaded', () => {
    const facade = TestBed.inject(PlansFacade),
      http = TestBed.inject(HttpTestingController);
    facade.loadVersions('old').subscribe({ error: () => undefined });
    const old = http.expectOne('/api/plans/old/versions');
    facade.loadVersions('new').subscribe();
    http.expectOne('/api/plans/new/versions').flush([]);
    old.flush({ message: 'Old failure' }, { status: 500, statusText: 'Error' });
    expect(facade.versionsStatus()).toBe('loaded');
    expect(facade.versionsError()).toBeNull();
  });
  it('allows the same plan to reload after its previous subscriber is cancelled', () => {
    const facade = TestBed.inject(PlansFacade),
      http = TestBed.inject(HttpTestingController);
    const subscription = facade.loadVersions('plan').subscribe();
    const old = http.expectOne('/api/plans/plan/versions');
    subscription.unsubscribe();
    expect(old.cancelled).toBe(true);
    facade.loadVersions('plan').subscribe();
    http.expectOne('/api/plans/plan/versions').flush([]);
    expect(facade.versionsStatus()).toBe('loaded');
  });
});
