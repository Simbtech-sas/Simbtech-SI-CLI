import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../database/database.service';
import {
  memberships,
  refreshTokens,
  tenants,
  users,
} from '../../../database/schema';
import type { Role } from '../../auth/domain/jwt-payload';

type UserRow = typeof users.$inferSelect;
type TenantRow = typeof tenants.$inferSelect;
type MembershipRow = typeof memberships.$inferSelect;
type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export interface NewAccount {
  email: string;
  passwordHash: string;
  name?: string;
  tenantName: string;
  slug: string;
}

export interface NewRefreshToken {
  userId: string;
  tenantId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Persistence for the identity layer (users, tenants, memberships,
 * refresh_tokens). These tables are NOT RLS-scoped — auth must read across
 * tenants — so everything here uses the raw `db` connection.
 */
@Injectable()
export class IamRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  findUserByEmail(email: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  findUserById(id: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  getTenantById(id: string): Promise<TenantRow | undefined> {
    return this.db.query.tenants.findFirst({ where: eq(tenants.id, id) });
  }

  findTenantBySlug(slug: string): Promise<TenantRow | undefined> {
    return this.db.query.tenants.findFirst({ where: eq(tenants.slug, slug) });
  }

  /** Create tenant + owner user + owner membership atomically. */
  async createAccount(
    input: NewAccount,
  ): Promise<{ user: UserRow; tenant: TenantRow; membership: MembershipRow }> {
    return this.db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({ name: input.tenantName, slug: input.slug })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
        })
        .returning();
      const [membership] = await tx
        .insert(memberships)
        .values({ tenantId: tenant.id, userId: user.id, role: 'owner' })
        .returning();
      return { user, tenant, membership };
    });
  }

  findMembership(
    userId: string,
    tenantId: string,
  ): Promise<MembershipRow | undefined> {
    return this.db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, userId),
        eq(memberships.tenantId, tenantId),
      ),
    });
  }

  findFirstMembership(userId: string): Promise<MembershipRow | undefined> {
    return this.db.query.memberships.findFirst({
      where: eq(memberships.userId, userId),
    });
  }

  findMembershipById(
    id: string,
    tenantId: string,
  ): Promise<MembershipRow | undefined> {
    return this.db.query.memberships.findFirst({
      where: and(eq(memberships.id, id), eq(memberships.tenantId, tenantId)),
    });
  }

  async updateProfile(
    userId: string,
    patch: { name?: string },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updatePasswordHash(userId: string, hash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // ── refresh tokens ──────────────────────────────────────────────────────────

  async insertRefreshToken(t: NewRefreshToken): Promise<void> {
    await this.db.insert(refreshTokens).values(t);
  }

  findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRow | undefined> {
    return this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });
  }

  /** Revoke the presented token and record what replaced it (rotation). */
  async rotateRefreshToken(id: string, nextHash: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedByHash: nextHash })
      .where(eq(refreshTokens.id, id));
  }

  async revokeRefreshTokenByHash(tokenHash: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.familyId, familyId));
  }
}
