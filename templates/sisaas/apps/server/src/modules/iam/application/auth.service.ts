import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isUniqueViolation } from '../../../database/db-errors';
import type {
  AccessTokenPayload,
  AuthSessionMeta,
  Role,
} from '../../auth/domain/jwt-payload';
import { IamRepository } from '../infrastructure/iam.repository';
import { PasswordService } from '../infrastructure/password.service';
import { TokenService } from './token.service';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; email: string; name: string | null };
  tenant: { id: string; slug: string; name: string };
  role: Role;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  tenantName: string;
  slug: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: IamRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterInput, meta: AuthSessionMeta): Promise<AuthResult> {
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const { user, tenant, membership } = await this.repo.createAccount({
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        tenantName: dto.tenantName,
        slug: dto.slug.toLowerCase(),
      });
      return this.buildSession(user, tenant, membership, meta);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('Email or workspace address already taken');
      }
      throw e;
    }
  }

  async login(
    dto: { email: string; password: string },
    meta: AuthSessionMeta,
  ): Promise<AuthResult> {
    const user = await this.repo.findUserByEmail(dto.email.toLowerCase());
    if (!user?.passwordHash || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const membership = await this.repo.findFirstMembership(user.id);
    if (!membership) throw new UnauthorizedException('No workspace');
    const tenant = await this.repo.getTenantById(membership.tenantId);
    if (!tenant) throw new UnauthorizedException('No workspace');
    return this.buildSession(user, tenant, membership, meta);
  }

  /** Rotate the refresh token and mint a matching fresh access token. */
  async refresh(
    presented: string,
    meta: AuthSessionMeta,
  ): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
    let rotated;
    try {
      rotated = await this.tokens.rotate(presented, meta);
    } catch {
      throw new UnauthorizedException('Invalid session');
    }
    const user = await this.repo.findUserById(rotated.userId);
    const membership = await this.repo.findMembership(
      rotated.userId,
      rotated.tenantId,
    );
    if (!user || !membership) throw new UnauthorizedException('Invalid session');
    const accessToken = await this.tokens.signAccessToken(
      this.payload(user.id, user.email, membership.tenantId, membership.id, membership.role),
    );
    return {
      accessToken,
      refreshToken: rotated.refresh.token,
      refreshExpiresAt: rotated.refresh.expiresAt,
    };
  }

  async logout(presented: string): Promise<void> {
    await this.tokens.revoke(presented);
  }

  async getProfile(userId: string) {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, name: user.name };
  }

  async updateProfile(userId: string, patch: { name?: string }): Promise<void> {
    await this.repo.updateProfile(userId, patch);
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<{ ok: true }> {
    const user = await this.repo.findUserById(userId);
    if (!user?.passwordHash) throw new UnauthorizedException();
    const ok = await this.passwords.verify(user.passwordHash, current);
    if (!ok) throw new UnauthorizedException('Wrong password');
    await this.repo.updatePasswordHash(userId, await this.passwords.hash(next));
    return { ok: true };
  }

  /** Is this email / workspace slug free? For the signup form. */
  async checkAvailability(input: { email?: string; slug?: string }) {
    const [emailTaken, slugTaken] = await Promise.all([
      input.email
        ? this.repo.findUserByEmail(input.email).then(Boolean)
        : Promise.resolve(false),
      input.slug
        ? this.repo.findTenantBySlug(input.slug).then(Boolean)
        : Promise.resolve(false),
    ]);
    return {
      emailAvailable: input.email ? !emailTaken : undefined,
      slugAvailable: input.slug ? !slugTaken : undefined,
    };
  }

  /**
   * Build the access-token claims.
   *
   * Granted permissions are embedded here because every OTHER service verifies
   * them without a database — this service is the only one that can read a
   * membership row. Keep the list small: it is in every request header.
   */
  private payload(
    sub: string,
    email: string,
    tenantId: string,
    membershipId: string,
    role: Role,
    permissions: Record<string, boolean> = {},
  ): AccessTokenPayload {
    const granted = Object.keys(permissions).filter((key) => permissions[key] === true);
    return {
      sub,
      email,
      tenantId,
      membershipId,
      role,
      ...(granted.length > 0 ? { permissions: granted } : {}),
    };
  }

  private async buildSession(
    user: { id: string; email: string; name: string | null },
    tenant: { id: string; slug: string; name: string },
    membership: { id: string; role: Role; permissions?: Record<string, boolean> },
    meta: AuthSessionMeta,
  ): Promise<AuthResult> {
    const accessToken = await this.tokens.signAccessToken(
      this.payload(
        user.id,
        user.email,
        tenant.id,
        membership.id,
        membership.role,
        membership.permissions,
      ),
    );
    const refresh = await this.tokens.startSession(user.id, tenant.id, meta);
    return {
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      role: membership.role,
    };
  }
}
