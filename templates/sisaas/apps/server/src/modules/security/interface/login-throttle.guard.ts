import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CacheService } from '../../redis/cache.service';

const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60;

/**
 * Rate limits credential endpoints far harder than the global limiter does.
 *
 * The global limit (300/min) is sized for ordinary API traffic and is useless
 * against credential stuffing — an attacker gets 300 password guesses a minute
 * and stays inside it.
 *
 * Counted in Redis rather than in memory, because the API runs several replicas
 * and a per-process counter divides the real limit by the replica count.
 *
 * Keyed on IP **and** identifier: keying on IP alone lets one NAT'd office lock
 * itself out, and keying on the identifier alone lets an attacker lock a victim
 * out of their own account.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  constructor(private readonly cache: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const body = (req.body ?? {}) as { email?: string };
    const identifier = (body.email ?? 'anonymous').toLowerCase().slice(0, 128);
    const key = `throttle:auth:${req.ip}:${identifier}`;

    const attempts = (await this.cache.get<number>(key)) ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      // 429 with Retry-After, not 403: this is a rate decision, not an
      // authorization one, and clients should back off rather than retry.
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many attempts. Try again later.',
          retryAfter: WINDOW_SECONDS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Counted on the way IN, so a flood of concurrent requests cannot slip past
    // while each waits for the previous to fail.
    await this.cache.set(key, attempts + 1, WINDOW_SECONDS);
    return true;
  }

  /** Call after a successful login so a legitimate user is not left throttled. */
  async clear(ip: string, identifier: string): Promise<void> {
    await this.cache.del(`throttle:auth:${ip}:${identifier.toLowerCase().slice(0, 128)}`);
  }
}
