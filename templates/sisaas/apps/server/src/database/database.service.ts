import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { AppConfigService } from '../config/app-config.service';
import { createDatabase, type DrizzleDb, type PgClient } from './drizzle';
import * as schema from './schema';

/** Transaction-local GUC that RLS policies read to scope every query. */
export const TENANT_ID_GUC = 'app.tenant_id';

export type TenantTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  /** Raw client — use for non-tenant-scoped tables (users, auth) and health checks. */
  readonly db: DrizzleDb;
  /** BYPASSRLS connection for the super-admin realm (cross-tenant). May be unset. */
  readonly adminDb?: DrizzleDb;
  private readonly client: PgClient;
  private readonly adminClient?: PgClient;

  constructor(config: AppConfigService) {
    const app = createDatabase(config.databaseUrl);
    this.db = app.db;
    this.client = app.client;

    const adminUrl = config.adminDatabaseUrl;
    if (adminUrl) {
      const admin = createDatabase(adminUrl);
      this.adminDb = admin.db;
      this.adminClient = admin.client;
    }
  }

  /** The BYPASSRLS admin connection. Throws if ADMIN_DATABASE_URL is not set. */
  requireAdminDb(): DrizzleDb {
    if (!this.adminDb) {
      throw new Error('ADMIN_DATABASE_URL is not configured');
    }
    return this.adminDb;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
    if (this.adminClient) await this.adminClient.end({ timeout: 5 });
  }

  /**
   * Sets the tenant context on an existing transaction. Use inside a manual
   * `db.transaction(...)` when earlier statements must run WITHOUT a context
   * (e.g. creating the tenant row itself) before tenant-scoped writes.
   */
  async setTenantContext(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.execute(sql`select set_config(${TENANT_ID_GUC}, ${tenantId}, true)`);
  }

  /**
   * Runs `fn` inside a transaction with `app.tenant_id` set to `tenantId`.
   * RLS policies read that GUC, so every query inside is automatically confined
   * to the tenant. `set_config(..., true)` is transaction-local, so a pooled
   * connection can NEVER leak tenant context to the next request.
   */
  async runInTenantContext<T>(
    tenantId: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await this.setTenantContext(tx, tenantId);
      return fn(tx);
    });
  }
}
