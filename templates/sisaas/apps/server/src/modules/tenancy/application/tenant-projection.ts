import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { TenantProvisioned, TenantSuspended, TenantUpdated } from '@simbkit/events';
import { EventRegistry } from '../../events/application/event-registry.service';
import { tenants } from '../../../database/schema';

/**
 * Keeps this service's local `tenants` table current from identity's events.
 *
 * This is what makes tenant_id a real foreign key in every service rather than a
 * loose uuid, without any service calling identity on the hot path. The table is
 * a read model: identity owns the truth, this is a copy that follows.
 *
 * In the identity service this handler is removed — writing your own projection
 * from your own events is a loop.
 */
@Injectable()
export class TenantProjection implements OnModuleInit {
  private readonly log = new Logger(TenantProjection.name);

  constructor(private readonly registry: EventRegistry) {}

  onModuleInit(): void {
    // Upsert, not insert: events are at-least-once and may arrive out of order
    // after a replay, so applying the same one twice must be harmless.
    this.registry.on(TenantProvisioned, 'tenant-projection', async (event, tx) => {
      await tx
        .insert(tenants)
        .values({
          id: event.payload.tenantId,
          slug: event.payload.slug,
          name: event.payload.name,
          status: event.payload.status,
        })
        .onConflictDoUpdate({
          target: tenants.id,
          set: { slug: event.payload.slug, name: event.payload.name, status: event.payload.status, updatedAt: new Date() },
        });
      this.log.log(`tenant ${event.payload.slug} projected`);
    });

    this.registry.on(TenantUpdated, 'tenant-projection', async (event, tx) => {
      await tx
        .update(tenants)
        .set({
          slug: event.payload.slug,
          name: event.payload.name,
          status: event.payload.status,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, event.payload.tenantId));
    });

    this.registry.on(TenantSuspended, 'tenant-projection', async (event, tx) => {
      // Suspension is not deletion: the rows stay, the tenant simply stops
      // being served. Deleting would cascade away data the customer may return to.
      await tx
        .update(tenants)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(eq(tenants.id, event.payload.tenantId));
    });
  }
}
