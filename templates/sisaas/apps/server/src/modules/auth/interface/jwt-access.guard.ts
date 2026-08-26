import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../../../config/app-config.service';
import type { AccessTokenPayload } from '../domain/jwt-payload';
import { JWT_ALGORITHM, JWT_ISSUER } from '../domain/jwt.constants';

export type RequestWithPrincipal = FastifyRequest & {
  principal?: AccessTokenPayload;
};

/** Verifies the Bearer access token and attaches the principal to the request. */
@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice('Bearer '.length),
        {
          secret: this.config.jwtAccessSecret,
          // Pinned. Omitting these lets the token choose its own algorithm and
          // issuer, which is the whole algorithm-confusion class of attack.
          algorithms: [JWT_ALGORITHM],
          issuer: JWT_ISSUER,
        },
      );
      req.principal = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
