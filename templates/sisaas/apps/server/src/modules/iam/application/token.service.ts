import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { ACCESS_TOKEN_TTL, JWT_ALGORITHM, JWT_ISSUER } from '../../auth/domain/jwt.constants';
import type {
  AccessTokenPayload,
  AuthSessionMeta,
} from '../../auth/domain/jwt-payload';
import { IamRepository } from '../infrastructure/iam.repository';

const REFRESH_TTL_DAYS = 30;

export interface IssuedRefresh {
  token: string; // opaque — returned to the client, never stored
  expiresAt: Date;
}

/** Fast, indexable hash for opaque refresh tokens (NOT for passwords). */
function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

/**
 * Mints access JWTs and manages the rotating refresh-token family. Access tokens
 * are stateless (verified by JwtAccessGuard); refresh tokens are opaque, hashed
 * at rest, and rotated on every use with reuse-detection that revokes the family.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly repo: IamRepository,
  ) {}

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.jwtAccessSecret,
      // Must match what every verifier pins, or nothing accepts these tokens.
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      expiresIn: ACCESS_TOKEN_TTL,
    });
  }

  /** Start a fresh refresh-token family (login / register / tenant switch). */
  async startSession(
    userId: string,
    tenantId: string, // si:when multi-tenant
    meta: AuthSessionMeta,
  ): Promise<IssuedRefresh> {
    return this.mint(userId, tenantId, randomBytes(16).toString('hex'), meta); // si:when multi-tenant
    return this.mint(userId, randomBytes(16).toString('hex'), meta); // si:when single-tenant
  }

  /**
   * Rotate a presented refresh token: verify it, revoke it, issue the next in the
   * same family. A revoked-but-presented token means theft → the whole family is
   * revoked and the caller is rejected.
   */
  async rotate(
    presented: string,
    meta: AuthSessionMeta,
  ): Promise<{ refresh: IssuedRefresh; userId: string; tenantId: string }> { // si:when multi-tenant
  ): Promise<{ refresh: IssuedRefresh; userId: string }> { // si:when single-tenant
    const row = await this.repo.findRefreshTokenByHash(sha256(presented));
    if (!row || row.expiresAt < new Date()) {
      throw new Error('invalid_refresh');
    }
    if (row.revokedAt) {
      await this.repo.revokeFamily(row.familyId);
      throw new Error('refresh_reuse');
    }
    const next = randomBytes(16).toString('hex');
    await this.repo.rotateRefreshToken(row.id, sha256(next));
    // si:when-begin multi-tenant
    if (!row.tenantId) throw new Error('invalid_refresh');
    const refresh = await this.mint(
      row.userId,
      row.tenantId,
      next,
      meta,
      row.familyId,
    );
    return { refresh, userId: row.userId, tenantId: row.tenantId };
    // si:when-end
    // si:when-begin single-tenant
    const refresh = await this.mint(row.userId, next, meta, row.familyId);
    return { refresh, userId: row.userId };
    // si:when-end
  }

  async revoke(presented: string): Promise<void> {
    await this.repo.revokeRefreshTokenByHash(sha256(presented));
  }

  private async mint(
    userId: string,
    tenantId: string, // si:when multi-tenant
    token: string,
    meta: AuthSessionMeta,
    familyId?: string,
  ): Promise<IssuedRefresh> {
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
    await this.repo.insertRefreshToken({
      userId,
      tenantId, // si:when multi-tenant
      familyId: familyId ?? randomBytes(16).toString('hex'),
      tokenHash: sha256(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });
    return { token, expiresAt };
  }
}
