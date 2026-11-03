import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * Single application-wide entry point for transient user notifications.
 * Screens call this service instead of opening snack bars directly.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 4000,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      panelClass: 'probedesk-notification-success',
      politeness: 'polite',
    });
  }

  info(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 5000,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      panelClass: 'probedesk-notification-info',
      politeness: 'polite',
    });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 8000,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      panelClass: 'probedesk-notification-error',
      politeness: 'assertive',
    });
  }
}
