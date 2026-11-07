import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavContent, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthFacade } from '../../core/auth/auth.facade';
import { roleLabel } from '../../core/auth/auth.types';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes.service';

interface NavigationItem {
  readonly path: string;
  readonly label: string;
  readonly icon: 'plans' | 'history' | 'compare' | 'devices';
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { path: '/plans', label: 'Test Plans', icon: 'plans' },
  { path: '/devices', label: 'Devices', icon: 'devices' },
  { path: '/runs', label: 'Run History', icon: 'history' },
  { path: '/compare', label: 'Compare Runs', icon: 'compare' },
];

@Component({
  selector: 'app-shell',
  imports: [
    MatButtonModule,
    MatSidenavModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthFacade);
  private readonly unsavedChanges = inject(UnsavedChangesService);

  private readonly mainContent = viewChild<ElementRef<HTMLElement>>('mainContent');
  private readonly navToggle = viewChild<ElementRef<HTMLButtonElement>>('navToggle');
  private readonly contentScroller = viewChild(MatSidenavContent);

  protected readonly navigationItems = NAVIGATION_ITEMS;
  protected readonly compactViewport = signal(false);
  private readonly mobileNavigationOpen = signal(false);
  private readonly signOutPromptOpen = signal(false);

  protected readonly navMode = computed(() => (this.compactViewport() ? 'over' : 'side'));

  protected readonly sidenavOpened = computed(() =>
    this.compactViewport() ? this.mobileNavigationOpen() : true,
  );

  protected readonly roleLabel = computed(() => roleLabel(this.auth.role()));

  protected readonly userEmail = computed(() => this.auth.user()?.email ?? null);

  protected readonly canCreatePlan = computed(() => this.auth.role() === 'PLANNER');
  protected readonly canStartRun = computed(() => this.auth.role() === 'OPERATOR');

  constructor() {
    this.watchViewport();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.mobileNavigationOpen.set(false);
        afterNextRender(
          () => {
            const scroller = this.contentScroller();
            if (typeof scroller?.scrollTo === 'function') {
              scroller.scrollTo({ top: 0, left: 0 });
            }
            this.focusMainContent();
          },
          { injector: this.injector },
        );
      });
  }

  protected toggleNavigation(): void {
    if (this.compactViewport()) {
      this.mobileNavigationOpen.update((open) => !open);
    }
  }

  protected onSidenavOpenedChange(opened: boolean): void {
    if (this.compactViewport()) {
      this.mobileNavigationOpen.set(opened);
    }
  }

  protected closeNavigationOnNavigate(): void {
    if (this.compactViewport()) {
      this.mobileNavigationOpen.set(false);
    }
  }

  /**
   * The overlay navigation is a modal surface on compact viewports. Escape
   * closes it and returns focus to the toggle, matching the dialog pattern.
   * Open Material dialogs keep their own Escape handling.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected onDocumentEscape(event: Event): void {
    if (!this.compactViewport() || !this.mobileNavigationOpen()) {
      return;
    }
    if (document.querySelector('.cdk-overlay-container .mat-mdc-dialog-container')) {
      return;
    }

    event.preventDefault();
    this.mobileNavigationOpen.set(false);
    afterNextRender(() => this.navToggle()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected signOut(): void {
    if (this.auth.pending() || this.signOutPromptOpen()) {
      return;
    }

    this.signOutPromptOpen.set(true);
    this.unsavedChanges
      .confirmLeave()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (allowed) => {
          this.signOutPromptOpen.set(false);
          if (allowed) {
            this.revokeSession();
          }
        },
        error: () => this.signOutPromptOpen.set(false),
      });
  }

  private revokeSession(): void {
    this.auth
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.notify('success', 'You have signed out.');
          void this.router.navigateByUrl('/login');
        },
        error: () => {
          this.notify('error', this.auth.error()?.message ?? 'Sign out failed. Please try again.');
        },
      });
  }

  /**
   * The snackbar implementation is loaded on demand so the signed-out shell
   * does not put the Material overlay package in the initial bundle.
   */
  private notify(kind: 'success' | 'error', message: string): void {
    void import('../../shared/notifications/notification.service')
      .then(({ NotificationService }) => {
        const notifications = this.environmentInjector.get(NotificationService);
        if (kind === 'success') {
          notifications.success(message);
        } else {
          notifications.error(message);
        }
      })
      .catch(() => undefined);
  }

  protected onSkipLinkClick(event: MouseEvent): void {
    event.preventDefault();
    this.focusMainContent();
  }

  private focusMainContent(): void {
    this.mainContent()?.nativeElement.focus({ preventScroll: true });
  }

  private watchViewport(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(max-width: 1023px)');
    this.compactViewport.set(query.matches);

    const onChange = (event: MediaQueryListEvent): void => {
      this.compactViewport.set(event.matches);
    };

    query.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
  }
}
