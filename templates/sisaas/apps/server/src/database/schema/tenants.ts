import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tenantStatus = pgEnum('tenant_status', ['trialing', 'active', 'suspended']);

/**
 * Present in every service.
 *
 * In the identity service this is the source of truth. In every other service it
 * is a local PROJECTION, kept current by consuming tenant events — which is what
 * lets a feature table hold a real foreign key to it instead of a loose uuid,
 * and what keeps a request from needing a synchronous call to identity.
 *
 * Only identity writes to it directly. Elsewhere, the event handler does.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: tenantStatus('status').notNull().default('trialing'),
    customDomain: text('custom_domain'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tenants_slug_idx').on(t.slug)],
);
