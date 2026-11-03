import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import type { LoginRequestDto, AuthUserDto } from './auth-api.types';
import type { AuthenticatedUser, LoginCredentials } from './auth.types';

/**
 * Typed boundary for the auth endpoints.
 *
 * Every URL is same-origin and relative so the browser sends the session cookie
 * and the development proxy keeps working without a configurable API origin.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  login(credentials: LoginCredentials): Observable<AuthenticatedUser> {
    const request: LoginRequestDto = {
      email: credentials.email,
      password: credentials.password,
    };

    return this.http
      .post<AuthUserDto>('/api/auth/login', request)
      .pipe(map(toAuthenticatedUser));
  }

  me(): Observable<AuthenticatedUser> {
    return this.http
      .get<AuthUserDto>('/api/auth/me')
      .pipe(map(toAuthenticatedUser));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', null);
  }
}

function toAuthenticatedUser(user: AuthUserDto): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}
