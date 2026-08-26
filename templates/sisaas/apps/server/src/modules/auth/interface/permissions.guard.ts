import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithPrincipal } from './jwt-access.guard';

export const PERMISSION_KEY = 'permission';

/** Require a granular permission (owner always passes; others need the grant). */
export const RequiresPermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Checks the permission carried in the verified token — no database, no call to
 * the identity service. That is what lets this guard run in every service rather
 * than only in the one that owns the membership tables.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { principal } = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (!principal) throw new UnauthorizedException();
    if (principal.role === 'owner') return true;
    if (principal.permissions?.includes(required)) return true;

    throw new ForbiddenException('Missing permission');
  }
}
