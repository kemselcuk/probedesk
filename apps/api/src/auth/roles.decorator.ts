import { SetMetadata } from '@nestjs/common';
import type { Role } from '../prisma/generated/client.js';

export const ROLES_METADATA_KEY = 'probedesk:roles';

/** Declares which roles may call a controller or handler. */
export function Roles(...roles: Role[]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_METADATA_KEY, roles);
}
