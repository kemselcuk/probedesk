import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from './empty-state/empty-state';
import { ErrorState } from './error-state/error-state';
import { LoadingState } from './loading-state/loading-state';

describe('shared screen states', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders loading as an announced status with a spinner', async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingState],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadingState);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const status = root.querySelector('[role="status"]');

    expect(status?.classList.contains('state--loading')).toBe(true);
    expect(status?.textContent).toContain('Loading…');
    expect(status?.querySelector('mat-spinner')).not.toBeNull();
  });

  it('renders empty with a heading and an English explanation', async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyState],
    }).compileComponents();

    const fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('heading', 'No test plans yet');
    fixture.componentRef.setInput(
      'message',
      'Create a plan to add and publish measurement steps.',
    );
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const status = root.querySelector('[role="status"]');

    expect(status?.classList.contains('state--empty')).toBe(true);
    expect(status?.textContent).toContain('No test plans yet');
    expect(status?.textContent).toContain('Create a plan');
  });

  it('renders errors as an alert with a request id and a retry action', async () => {
    await TestBed.configureTestingModule({
      imports: [ErrorState],
    }).compileComponents();

    const fixture = TestBed.createComponent(ErrorState);
    fixture.componentRef.setInput('message', 'The run history could not be loaded.');
    fixture.componentRef.setInput('requestId', 'req-456');
    fixture.componentRef.setInput('retryable', true);
    fixture.detectChanges();

    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);

    const root = fixture.nativeElement as HTMLElement;
    const alert = root.querySelector('[role="alert"]');
    const button = alert?.querySelector('button');

    expect(alert?.classList.contains('state--error')).toBe(true);
    expect(alert?.textContent).toContain('The run history could not be loaded.');
    expect(alert?.textContent).toContain('req-456');

    button?.click();

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
