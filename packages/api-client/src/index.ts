/**
 * The single contract boundary between the API and the Angular application.
 *
 * `schema.ts` is generated from `apps/api/openapi.json` by
 * `npm run openapi:generate`. Do not edit it by hand. Never import NestJS or
 * Prisma types in the frontend; import these generated types instead.
 */
export type { components, operations, paths } from './schema.js';
