import { bigserial, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';

/**
 * Write-ahead phases.
 *
 * A sensitive operation writes `intent` BEFORE it runs and `committed` or
 * `failed` after. An intent with no outcome is itself evidence — of a crash, a
 * rollback, or a killed process — which an audit written only on success cannot
 * give you. That is the property this exists for: a log of attempts, not just of
 * things that worked.
 */
export const auditPhase = pgEnum('audit_phase', ['intent', 'committed', 'failed', 'event']);

/**
 * Append-only, tamper-evident audit log.
 *
 * Three properties, each enforced rather than assumed:
 *
 * 1. **Ordered** — `seq` is a monotonic bigserial. Ordering by a timestamp is
 *    ambiguous the moment two entries land in the same millisecond.
 * 2. **Tamper-evident** — every row carries `hash = sha256(prev_hash ‖ content)`.
 *    Altering any row breaks every hash after it, so a single edit is detectable
 *    without a second copy of the data.
 * 3. **Append-only** — a database trigger rejects UPDATE and DELETE, and the app
 *    role is not granted them. Convention is not enforcement.
 *
 * Not RLS-scoped: a platform-level action belongs to no tenant, and the chain
 * must be verifiable across the whole table.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    /** Chain position. The only correct order to read or verify this table in. */
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: uuid('id').notNull().unique().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    phase: auditPhase('phase').notNull().default('event'),
    /** Links an `intent` to the `committed` or `failed` that answers it. */
    correlationId: uuid('correlation_id'),
    /** Hash of the previous entry in this chain. Null only for the first. */
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_idx').on(t.tenantId, t.seq),
    index('audit_log_correlation_idx').on(t.correlationId),
  ],
);
