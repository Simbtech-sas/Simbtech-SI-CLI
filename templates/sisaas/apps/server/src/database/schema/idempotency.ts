import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const idempotencyStatus = pgEnum('idempotency_status', ['in_progress', 'completed']);

/**
 * Request-level idempotency.
 *
 * A client that times out and retries a POST would otherwise create the charge,
 * the order or the transfer twice — and the client cannot tell, because it never
 * saw the first response. The key makes the retry return the ORIGINAL response
 * instead of doing the work again.
 *
 * `request_hash` is what stops the dangerous case: reusing a key with a
 * different body. That is a client bug, and replaying the old response for it
 * would hide a real mistake. It is rejected instead.
 *
 * Scoped by tenant so a key from one tenant can never collide with — or reveal
 * anything to — another.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id'), // si:when multi-tenant
    /** The client-supplied Idempotency-Key header. */
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    /** sha256 of the request body — same key + different body is a client error. */
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatus('status').notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Pruned after this. A key is a short-lived retry token, not a record. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // The uniqueness that makes the whole thing work: the first request wins the
    // insert, every retry loses it and reads the winner's result.
    uniqueIndex('idempotency_tenant_key').on(t.tenantId, t.key, t.method, t.path),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);
