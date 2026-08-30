import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm'; // si:when multi-tenant
import { eq, sql } from 'drizzle-orm'; // si:when single-tenant
import { DatabaseService } from '../../../database/database.service';
// si:when-begin multi-tenant
import {
  memberships,
  refreshTokens,
  tenants,
  users,
} from '../../../database/schema';
// si:when-end
import { refreshTokens, users } from '../../../database/schema'; // si:when single-tenant
import type { Role } from '../../auth/domain/jwt-payload';

type UserRow = typeof users.$inferSelect;
// si:when-begin multi-tenant
type TenantRow = typeof tenants.$inferSelect;
type MembershipRow = typeof memberships.$inferSelect;
// si:when-end
type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export interface NewAccount {
  email: string;
  passwordHash: string;
  name?: string;
  tenantName: string; // si:when multi-tenant
  slug: string; // si:when multi-tenant
}

export interface NewRefreshToken {
  userId: string;
  tenantId: string; // si:when multi-tenant
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
}

// si:when-begin multi-tenant
/**
 * Persistence for the identity layer (users, tenants, memberships,
 * refresh_tokens). These tables are NOT RLS-scoped — auth must read across
 * tenants — so everything here uses the raw `db` connection.
 */
// si:when-end
/** Persistence for the identity layer: users and their refresh tokens. */ // si:when single-tenant
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

  // si:when-begin multi-tenant
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
  // si:when-end

  // si:when-begin single-tenant
  /**
   * Create the user. The first account to register owns the app; every later one
   * is a plain member until somebody promotes it.
   *
   * The advisory lock is what makes "first" mean something: two simultaneous
   * first registrations would otherwise both read "no users yet" and both come
   * out owners. Held for the transaction, released on commit.
   */
  async createAccount(input: NewAccount): Promise<{ user: UserRow }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('iam:first-owner'))`);
      const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
          role: existing ? 'member' : 'owner',
        })
        .returning();
      return { user };
    });
  }
  // si:when-end

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
