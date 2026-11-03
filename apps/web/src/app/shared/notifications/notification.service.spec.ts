import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: MatSnackBar, useValue: { open } },
      ],
    });
  });

  it('uses an assertive announcement for errors', () => {
    TestBed.inject(NotificationService).error('The plan could not be saved.');

    expect(open).toHaveBeenCalledWith(
      'The plan could not be saved.',
      'Dismiss',
      expect.objectContaining({
        duration: 8000,
        politeness: 'assertive',
        panelClass: 'probedesk-notification-error',
      }),
    );
  });

  it('uses a polite announcement for success', () => {
    TestBed.inject(NotificationService).success('Plan saved.');

    expect(open).toHaveBeenCalledWith(
      'Plan saved.',
      'Dismiss',
      expect.objectContaining({
        duration: 4000,
        politeness: 'polite',
        panelClass: 'probedesk-notification-success',
      }),
    );
  });
});
