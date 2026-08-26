import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload } from '../domain/jwt-payload';
import type { RequestWithPrincipal } from './jwt-access.guard';

/** Injects the authenticated principal (set by JwtAccessGuard) into a handler. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const req = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
    return req.principal as AccessTokenPayload;
  },
);
