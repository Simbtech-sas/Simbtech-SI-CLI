import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Transactional outbox ──────────────────────────────────────────────────────
// A service NEVER calls producer.send(). It writes its domain change and one
// outbox row in the SAME transaction; Debezium tails the WAL and publishes to
// Kafka. That is what makes "the thing happened" and "the event was announced"
// atomic without a distributed transaction.
//
// Column names are Debezium's EventRouter defaults (aggregatetype, aggregateid,
// type, payload) — lowercase and unsuffixed on purpose. Renaming them means
// reconfiguring every Debezium connector.
//
// Not RLS-scoped, for the same reason audit_log is not: platform-level events
// carry no tenant. Nothing serves these rows to users; only Debezium reads them.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Routed to a topic, e.g. `widget` -> `<service>.widget.v1`. */
    aggregatetype: text('aggregatetype').notNull(),
    /** Kafka message key — guarantees per-aggregate ordering within a partition. */
    aggregateid: text('aggregateid').notNull(),
    /** Event name inside the topic, e.g. `WidgetCreated`. */
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Null for platform-level events. Propagated to consumers as a header. */
    tenantId: uuid('tenant_id'), // si:when multi-tenant
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set by the in-process dispatcher in a single deployable. Untouched in a
     * microservice deployment, where Debezium tails the WAL and never writes.
     *
     * The column exists in both so that splitting a monolith apart later is an
     * infrastructure change, not a migration.
     */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_events_created_idx').on(t.createdAt),
    // Partial index: the dispatcher only ever asks for undispatched rows, and
    // without this that query degrades as the table grows.
    index('outbox_events_undispatched_idx')
      .on(t.createdAt)
      .where(sql`dispatched_at is null`),
  ],
);

// ── Consumer-side idempotency ─────────────────────────────────────────────────
// Debezium delivers at-least-once, so every consumer WILL see duplicates. A
// redelivery hits this primary key, is acknowledged, and does nothing. Without
// it, a rebalance silently double-applies side effects.
export const processedEvents = pgTable(
  'processed_events',
  {
    eventId: uuid('event_id').notNull(),
    consumer: text('consumer').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.consumer] }),
    index('processed_events_at_idx').on(t.processedAt),
  ],
);
