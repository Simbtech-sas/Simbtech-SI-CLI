import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants'; // si:when multi-tenant

// Example tenant-scoped feature table. Every row carries `tenant_id`; RLS (see
// drizzle/0000_init.sql) confines all access to the current tenant context.
// Copy this file + the widgets module as the template for a new feature.
export const widgets = pgTable(
  'widgets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // si:when-begin multi-tenant
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // si:when-end
    name: text('name').notNull(),
    description: text('description'),
    quantity: integer('quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('widgets_tenant_idx').on(t.tenantId)], // si:when multi-tenant
  () => [], // si:when single-tenant
);
