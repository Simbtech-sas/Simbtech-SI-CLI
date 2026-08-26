import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../../../config/app-config.service';
import type { AccessTokenPayload, Role } from '../domain/jwt-payload';

export type RequestWithPrincipal = FastifyRequest & { principal?: AccessTokenPayload };

/**
 * Verifies tokens issued by an external OIDC provider (Keycloak, ZITADEL).
 *
 * Differences from the built-in guard that matter:
 *
 * - **RS256 with a rotating public key.** The key is fetched from the provider's
 *   JWKS endpoint and cached; `jose` re-fetches on an unknown `kid`, so a key
 *   rotation does not require a redeploy.
 * - **The algorithm is still pinned.** An external issuer does not remove the
 *   `alg: none` problem — it moves it.
 * - **`tenantId` comes from a claim the provider is configured to emit.** Map it
 *   in the provider (a Keycloak client mapper, a ZITADEL custom claim); if it is
 *   missing the request is rejected rather than defaulted, because a request with
 *   no tenant would be a request RLS cannot scope.
 */
@Injectable()
export class OidcAccessGuard implements CanActivate {
  private readonly log = new Logger(OidcAccessGuard.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly tenantClaim: string;
  private readonly roleClaim: string;

  constructor(config: AppConfigService) {
    const oidc = config.oidc;
    if (!oidc) {
      throw new Error('OIDC_ISSUER and OIDC_AUDIENCE are required when auth is an external provider');
    }
    this.issuer = oidc.issuer;
    this.audience = oidc.audience;
    this.tenantClaim = oidc.tenantClaim;
    this.roleClaim = oidc.roleClaim;
    this.jwks = createRemoteJWKSet(new URL(oidc.jwksUri));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing access token');

    let claims: JWTPayload;
    try {
      const verified = await jwtVerify(header.slice('Bearer '.length), this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        // Pinned, for the same reason the built-in guard pins HS256.
        algorithms: ['RS256'],
      });
      claims = verified.payload;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const tenantId = claims[this.tenantClaim];
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      // Failing closed. A token without a tenant cannot be scoped, and treating
      // it as "no tenant" would run queries with an unset GUC.
      this.log.warn(`token for ${String(claims.sub)} has no "${this.tenantClaim}" claim`);
      throw new UnauthorizedException('Token carries no tenant');
    }

    req.principal = {
      sub: String(claims.sub ?? ''),
      email: typeof claims['email'] === 'string' ? claims['email'] : '',
      tenantId,
      membershipId: String(claims['membership_id'] ?? claims.sub ?? ''),
      role: normaliseRole(claims[this.roleClaim]),
      permissions: normalisePermissions(claims['permissions'] ?? claims['scope']),
    };
    return true;
  }
}

/** Unknown or absent roles collapse to the least privilege, never the most. */
function normaliseRole(claim: unknown): Role {
  const value = Array.isArray(claim) ? claim[0] : claim;
  return value === 'owner' || value === 'admin' ? value : 'member';
}

function normalisePermissions(claim: unknown): string[] | undefined {
  if (Array.isArray(claim)) return claim.filter((c): c is string => typeof c === 'string');
  // OAuth `scope` is a space-delimited string.
  if (typeof claim === 'string') return claim.split(' ').filter(Boolean);
  return undefined;
}
