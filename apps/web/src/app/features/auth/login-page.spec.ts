import {
  provideHttpClient,
  withXsrfConfiguration,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  TitleStrategy,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { AppTitleStrategy } from '../../core/title/app-title.strategy';
import { LoginPage } from './login-page';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'planner@probedesk.local',
  role: 'PLANNER' as const,
};

const INVALID_CREDENTIALS = {
  code: 'UNAUTHENTICATED',
  message: 'Invalid email or password.',
  requestId: 'req-login-1',
};

describe('LoginPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideHttpClient(
          withXsrfConfiguration({
            cookieName: 'XSRF-TOKEN',
            headerName: 'X-XSRF-TOKEN',
          }),
        ),
        provideHttpClientTesting(),
        provideRouter(routes, withDisabledInitialNavigation()),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
  });

  async function openLogin(
    returnUrl?: string,
  ): Promise<RouterTestingHarness> {
    const url =
      returnUrl === undefined
        ? '/login'
        : `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return harness;
  }

  function rootOf(harness: RouterTestingHarness): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function typeInto(
    root: HTMLElement,
    selector: string,
    value: string,
  ): void {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (input === null) {
      throw new Error(`Input not found: ${selector}`);
    }

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function submit(root: HTMLElement): void {
    const form = root.querySelector('form');
    if (form === null) {
      throw new Error('Login form not found');
    }

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('shows required field errors without sending a request', async () => {
    const harness = await openLogin();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    submit(root);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Email is required.');
    expect(root.textContent).toContain('Password is required.');
    expect(http.match('/api/auth/login')).toHaveLength(0);
  });

  it('rejects a malformed email before sending a request', async () => {
    const harness = await openLogin();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#email', 'not-an-email');
    typeInto(root, '#password', 'demo-password');
    submit(root);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('Enter a valid email address.');
    expect(http.match('/api/auth/login')).toHaveLength(0);
  });

  it('submits once, disables the button while pending, and returns to the requested screen', async () => {
    const harness = await openLogin('/runs');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/';

    typeInto(root, '#email', ' planner@probedesk.local ');
    typeInto(root, '#password', 'demo-password');
    submit(root);
    harness.detectChanges();

    const button = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain('Signing in…');

    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'planner@probedesk.local',
      password: 'demo-password',
    });
    expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('csrf-token');

    submit(root);
    expect(http.match('/api/auth/login')).toHaveLength(0);

    request.flush(ACCOUNT);
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/runs');
    expect(root.textContent).toContain('Run History');
  });

  it('shows a failed sign-in message, keeps the input, and re-enables the button', async () => {
    const harness = await openLogin();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#email', 'planner@probedesk.local');
    typeInto(root, '#password', 'wrong-password');
    submit(root);

    http
      .expectOne('/api/auth/login')
      .flush(INVALID_CREDENTIALS, {
        status: 401,
        statusText: 'Unauthorized',
      });
    await harness.fixture.whenStable();
    harness.detectChanges();

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'The email or password is incorrect.',
    );
    expect(root.querySelector<HTMLInputElement>('#email')?.value).toBe(
      'planner@probedesk.local',
    );
    expect(root.querySelector<HTMLInputElement>('#password')?.value).toBe(
      'wrong-password',
    );

    const button = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain('Sign in');
  });

  it('uses an explicit rate-limit message and shows the request ID', async () => {
    const harness = await openLogin();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#email', 'planner@probedesk.local');
    typeInto(root, '#password', 'demo-password');
    submit(root);

    http.expectOne('/api/auth/login').flush(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit reached.',
        requestId: 'req-rate-limit',
      },
      { status: 429, statusText: 'Too Many Requests' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Too many sign-in attempts. Wait a moment and try again.',
    );
    expect(root.textContent).toContain('Request ID:');
    expect(root.textContent).toContain('req-rate-limit');
  });

  it('maps field errors from the API onto the matching controls', async () => {
    const harness = await openLogin();
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#email', 'planner@probedesk.local');
    typeInto(root, '#password', 'demo-password');
    submit(root);

    http.expectOne('/api/auth/login').flush(
      {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        requestId: 'req-fields',
        fieldErrors: [
          {
            path: 'email',
            code: 'INVALID',
            message: 'This email is not registered.',
          },
          {
            path: 'password',
            code: 'INVALID',
            message: 'The password does not match.',
          },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(root.textContent).toContain('This email is not registered.');
    expect(root.textContent).toContain('The password does not match.');
  });

  it('rejects an external return URL and falls back to Test Plans', async () => {
    const harness = await openLogin('//evil.example/steal');
    const root = rootOf(harness);
    const http = TestBed.inject(HttpTestingController);

    typeInto(root, '#email', 'planner@probedesk.local');
    typeInto(root, '#password', 'demo-password');
    submit(root);
    http.expectOne('/api/auth/login').flush(ACCOUNT);

    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/plans');
  });

  it('toggles password visibility with an accessible control', async () => {
    const harness = await openLogin();
    const root = rootOf(harness);

    const toggle = root.querySelector<HTMLButtonElement>('.password-toggle');
    expect(toggle?.getAttribute('aria-label')).toBe('Show password');
    expect(root.querySelector<HTMLInputElement>('#password')?.type).toBe(
      'password',
    );

    toggle?.click();
    harness.detectChanges();

    expect(root.querySelector<HTMLInputElement>('#password')?.type).toBe('text');
    expect(toggle?.getAttribute('aria-label')).toBe('Hide password');
  });
});
