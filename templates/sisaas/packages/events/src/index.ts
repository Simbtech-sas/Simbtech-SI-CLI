import { z } from 'zod';
import { defineEvent, type EventContract } from './contract.ts';

/**
 * Every event this system knows about.
 *
 * The machinery lives in `contract.ts` so a feature's contract file can import
 * `defineEvent` without importing this module — which would be a cycle, since
 * this module imports every feature's contracts back.
 */
export * from './contract.ts';

// ── Contracts ─────────────────────────────────────────────────────────────────
// Example, mirroring the `widgets` feature module. Replace with your own; the
// shape is the point, not the widget.

const widgetPayload = z.object({
  id: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int(),
});

export const WidgetCreated = defineEvent({
  service: 'simbkit',
  aggregate: 'widget',
  type: 'WidgetCreated',
  version: 1,
  schema: widgetPayload,
});

export const WidgetUpdated = defineEvent({
  service: 'simbkit',
  aggregate: 'widget',
  type: 'WidgetUpdated',
  version: 1,
  schema: widgetPayload,
});

export const WidgetDeleted = defineEvent({
  service: 'simbkit',
  aggregate: 'widget',
  type: 'WidgetDeleted',
  version: 1,
  schema: z.object({ id: z.string().uuid() }),
});

// An event owned by ANOTHER service. This is the normal case: you depend on this
// package to react to things you did not publish. `service` is theirs, not yours.
// si:when-begin single-tenant
export const UserRegistered = defineEvent({
  service: 'identity',
  aggregate: 'user',
  type: 'UserRegistered',
  version: 1,
  schema: z.object({
    userId: z.string().uuid(),
    email: z.string().email(),
    name: z.string().nullable(),
  }),
});
// si:when-end

// si:when-begin multi-tenant
const tenantPayload = z.object({
  tenantId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['trialing', 'active', 'suspended']),
});

export const TenantProvisioned = defineEvent({
  service: 'identity',
  aggregate: 'tenant',
  type: 'TenantProvisioned',
  version: 1,
  schema: tenantPayload,
});

export const TenantUpdated = defineEvent({
  service: 'identity',
  aggregate: 'tenant',
  type: 'TenantUpdated',
  version: 1,
  schema: tenantPayload,
});

export const TenantSuspended = defineEvent({
  service: 'identity',
  aggregate: 'tenant',
  type: 'TenantSuspended',
  version: 1,
  schema: z.object({ tenantId: z.string().uuid(), reason: z.string().optional() }),
});
// si:when-end

/** Every contract this service knows about, keyed by `type`. */
export const EVENTS = {
  // si:events
  WidgetCreated,
  WidgetUpdated,
  WidgetDeleted,
  // si:when-begin multi-tenant
  TenantProvisioned,
  TenantUpdated,
  TenantSuspended,
  // si:when-end
  UserRegistered, // si:when single-tenant
} as const satisfies Record<string, EventContract>;

export type EventType = keyof typeof EVENTS;

/** All distinct topics — what a consumer subscribes to and what the platform creates. */
export function allTopics(): string[] {
  return [...new Set(Object.values(EVENTS).map((e) => e.topic))];
}
