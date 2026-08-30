import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../../database/database.service';
import { idempotencyKeys } from '../../../database/schema';

/** How long a key is honoured. A retry token, not a record. */
const RETENTION_HOURS = 24;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type ClaimResult =
  | { outcome: 'claimed' }
  | { outcome: 'replay'; response: StoredResponse }
  | { outcome: 'in-progress' }
  | { outcome: 'conflict' };

export interface RequestIdentity {
  tenantId: string | null;
  key: string;
  method: string;
  path: string;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly database: DatabaseService) {}

  static hashBody(body: unknown): string {
    // Sorted keys, so a semantically identical body hashes the same regardless
    // of the order a client serialised it in.
    return createHash('sha256').update(stableStringify(body ?? null)).digest('hex');
  }

  /**
   * Try to claim the key.
   *
   * The unique index does the real work: exactly one concurrent request wins the
   * insert. Everything else reads what the winner recorded, which is why this
   * holds across replicas without any coordination of its own.
   */
  async claim(request: RequestIdentity): Promise<ClaimResult> {
    const requestHash = IdempotencyService.hashBody(request.body);
    const expiresAt = new Date(Date.now() + RETENTION_HOURS * 3_600_000);

    const inserted = await this.db()
      .insert(idempotencyKeys)
      .values({
        tenantId: request.tenantId, // si:when multi-tenant
        key: request.key,
        method: request.method,
        path: request.path,
        requestHash,
        status: 'in_progress',
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    if (inserted.length > 0) return { outcome: 'claimed' };

    const [existing] = await this.db()
      .select()
      .from(idempotencyKeys)
      .where(this.match(request));

    if (!existing) return { outcome: 'claimed' }; // expired and pruned between the two statements

    // Same key, different body. Replaying here would mask a client bug and could
    // silently drop a genuinely different request.
    if (existing.requestHash !== requestHash) return { outcome: 'conflict' };

    if (existing.status === 'completed' && existing.responseStatus !== null) {
      return {
        outcome: 'replay',
        response: { status: existing.responseStatus, body: existing.responseBody },
      };
    }
    // The first attempt is still running. The client should back off, not race it.
    return { outcome: 'in-progress' };
  }

  async complete(request: RequestIdentity, response: StoredResponse): Promise<void> {
    await this.db()
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        responseStatus: response.status,
        responseBody: response.body as Record<string, unknown>,
      })
      .where(this.match(request));
  }

  /**
   * Release a key whose request failed.
   *
   * A 5xx is not a result worth replaying — the caller should be able to retry
   * and actually get through. Leaving the row `in_progress` would lock the key
   * out for a day.
   */
  async release(request: RequestIdentity): Promise<void> {
    await this.db().delete(idempotencyKeys).where(this.match(request));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async prune(): Promise<void> {
    await this.db().delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  }

  // si:when-begin multi-tenant
  /**
   * The admin connection, deliberately.
   *
   * These rows are infrastructure, not tenant data: the interceptor runs before
   * any tenant context is established, and the table is scoped by an explicit
   * `tenant_id` column rather than by RLS.
   */
  // si:when-end
  /** The admin connection if one is configured, the ordinary one otherwise. */ // si:when single-tenant
  private db() {
    return this.database.adminDb ?? this.database.db;
  }

  private match(r: RequestIdentity) {
    return and(
      r.tenantId ? eq(idempotencyKeys.tenantId, r.tenantId) : isNull(idempotencyKeys.tenantId), // si:when multi-tenant
      eq(idempotencyKeys.key, r.key),
      eq(idempotencyKeys.method, r.method),
      eq(idempotencyKeys.path, r.path),
    );
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}
