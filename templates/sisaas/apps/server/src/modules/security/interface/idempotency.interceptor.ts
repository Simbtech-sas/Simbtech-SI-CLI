import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Observable, from, of, switchMap, tap, catchError, throwError } from 'rxjs';
import { IdempotencyService, type RequestIdentity } from '../application/idempotency.service';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import type { AccessTokenPayload } from '../../auth/domain/jwt-payload';

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;

/**
 * Makes a retried request safe to send.
 *
 * The first request does the work and its response is stored; a repeat with the
 * same key returns that stored response without running the handler again. A
 * client that times out mid-charge can retry without creating a second one.
 *
 * Applied per route via `@Idempotent()` rather than globally: every guarded
 * request costs a row and a round trip, and a GET has nothing to protect.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const config = this.reflector.getAllAndOverride<{ required: boolean } | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!config) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest & { principal?: AccessTokenPayload }>();
    const key = req.headers[HEADER];

    if (typeof key !== 'string' || key.length === 0) {
      if (!config.required) return next.handle();
      throw new BadRequestException(
        `This endpoint requires an ${HEADER} header — a unique value per logical operation, reused only when retrying it.`,
      );
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(`${HEADER} must be at most ${MAX_KEY_LENGTH} characters`);
    }

    const identity: RequestIdentity = {
      // Scoped to the caller's tenant, from the verified token — never a header.
      tenantId: req.principal?.tenantId ?? null, // si:when multi-tenant
      tenantId: null, // si:when single-tenant
      key,
      method: req.method,
      path: req.routeOptions?.url ?? req.url,
      body: req.body,
    };

    return from(this.idempotency.claim(identity)).pipe(
      switchMap((claim) => {
        if (claim.outcome === 'replay') {
          http.getResponse<{ status: (code: number) => unknown }>().status(claim.response.status);
          return of(claim.response.body);
        }
        if (claim.outcome === 'in-progress') {
          // The first attempt has not finished. Racing it would defeat the point.
          return throwError(
            () => new ConflictException('A request with this Idempotency-Key is still in progress.'),
          );
        }
        if (claim.outcome === 'conflict') {
          return throwError(
            () =>
              new UnprocessableEntityException(
                'This Idempotency-Key was already used with a different request body.',
              ),
          );
        }

        return next.handle().pipe(
          tap((body: unknown) => {
            const status = (http.getResponse<{ statusCode?: number }>().statusCode ?? 200) as number;
            void this.idempotency.complete(identity, { status, body });
          }),
          catchError((err: unknown) => {
            // Only a successful response is worth replaying. Releasing the key
            // on failure lets the caller retry and actually get through, instead
            // of being locked out for a day by a transient error.
            void this.idempotency.release(identity);
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}
