import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatSidenavContent, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { AuthFacade, Role } from '../../core/auth/auth.facade';

interface NavigationItem {
  readonly path: string;
  readonly label: string;
  readonly description: string;
}

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  PLANNER: 'Planner',
  OPERATOR: 'Operator',
  VIEWER: 'Viewer',
};

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    path: '/plans',
    label: 'Test Plans',
    description: 'Draft, publish, and inspect plans',
  },
  {
    path: '/runs',
    label: 'Run History',
    description: 'Review recorded executions',
  },
  {
    path: '/compare',
    label: 'Compare Runs',
    description: 'Compare two terminal runs',
  },
];

@Component({
  selector: 'app-shell',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatListModule,
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthFacade);

  private readonly mainContent = viewChild<ElementRef<HTMLElement>>('mainContent');
  private readonly contentScroller = viewChild(MatSidenavContent);

  protected readonly navigationItems = NAVIGATION_ITEMS;
  protected readonly compactViewport = signal(false);
  private readonly mobileNavigationOpen = signal(false);

  protected readonly navMode = computed(() =>
    this.compactViewport() ? 'over' : 'side',
  );

  protected readonly sidenavOpened = computed(() =>
    this.compactViewport() ? this.mobileNavigationOpen() : true,
  );

  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role === null ? 'Not signed in' : ROLE_LABELS[role];
  });

  protected readonly canCreatePlan = computed(
    () => this.auth.role() === 'PLANNER',
  );
  protected readonly canStartRun = computed(
    () => this.auth.role() === 'OPERATOR',
  );

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
            this.contentScroller()?.scrollTo({ top: 0, left: 0 });
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

  protected onSkipLinkClick(event: MouseEvent): void {
    event.preventDefault();
    this.focusMainContent();
  }

  private focusMainContent(): void {
    this.mainContent()?.nativeElement.focus({ preventScroll: true });
  }

  private watchViewport(): void {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const query = window.matchMedia('(max-width: 959px)');
    this.compactViewport.set(query.matches);

    const onChange = (event: MediaQueryListEvent): void => {
      this.compactViewport.set(event.matches);
    };

    query.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
  }
}
