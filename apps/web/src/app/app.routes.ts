import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/auth/auth.guards';
import { unsavedChangesGuard } from './features/plans/unsaved-changes.guard';

/**
 * Feature routes are lazy so each screen is loaded only when it is visited.
 * Static paths are declared before parameterized paths that could shadow them.
 * The API repeats every role check; guards only avoid unusable screens.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    loadComponent: () => import('./features/auth/login-page').then((module) => module.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/app-shell/app-shell').then((module) => module.AppShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'plans',
      },
      {
        path: 'plans',
        title: 'Test Plans',
        loadComponent: () =>
          import('./features/plans/plans-list-page').then((module) => module.PlansListPage),
      },
      {
        path: 'plans/:planId/edit',
        title: 'Plan Editor',
        canActivate: [roleGuard(['PLANNER'])],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/plans/plan-editor-page').then((module) => module.PlanEditorPage),
      },
      {
        path: 'plans/:planId/versions/:versionId',
        title: 'Published Plan',
        loadComponent: () =>
          import('./features/plans/plan-version-page').then((module) => module.PlanVersionPage),
      },
      {
        path: 'runs',
        title: 'Run History',
        loadComponent: () =>
          import('./features/runs/run-history-page').then((module) => module.RunHistoryPage),
      },
      {
        path: 'runs/new',
        title: 'Start Run',
        loadComponent: () =>
          import('./features/runs/start-run-page').then((module) => module.StartRunPage),
      },
      {
        path: 'runs/:runId/live',
        title: 'Live Run',
        loadComponent: () =>
          import('./features/runs/live-run-page').then((module) => module.LiveRunPage),
      },
      {
        path: 'runs/:runId',
        title: 'Run Details',
        loadComponent: () =>
          import('./features/runs/run-details-page').then((module) => module.RunDetailsPage),
      },
      {
        path: 'compare',
        title: 'Compare Runs',
        loadComponent: () =>
          import('./features/comparisons/compare-runs-page').then(
            (module) => module.CompareRunsPage,
          ),
      },
      {
        path: 'not-authorized',
        title: 'Not available',
        loadComponent: () =>
          import('./features/auth/not-authorized-page').then((module) => module.NotAuthorizedPage),
      },
      {
        path: '**',
        title: 'Page not found',
        loadComponent: () =>
          import('./features/not-found/not-found-page').then((module) => module.NotFoundPage),
      },
    ],
  },
];
