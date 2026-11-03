/**
 * TEMPORARY wire types for the auth endpoints.
 *
 * P1-05 replaces this file with the generated OpenAPI client. Keep these shapes
 * identical to docs/api.md until then; do not grow them into a second API model.
 */
import type { Role } from './auth.types';

export interface LoginRequestDto {
  readonly email: string;
  readonly password: string;
}

export interface AuthUserDto {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
}

export interface ApiFieldErrorDto {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** Error envelope shared by every API endpoint. */
export interface ApiErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly fieldErrors?: readonly ApiFieldErrorDto[];
}
