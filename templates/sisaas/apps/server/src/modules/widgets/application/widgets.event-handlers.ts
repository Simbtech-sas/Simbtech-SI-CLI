import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TenantProvisioned } from '@simbkit/events';
import { EventRegistry } from '../../events/application/event-registry.service';
import { WidgetsRepository } from '../infrastructure/widgets.repository';

/**
 * How this service reacts to something another service did.
 *
 * `TenantProvisioned` is owned by the identity service; we only depend on its
 * contract. The handler runs inside the transaction that claims the event, so
 * the widget it creates and the "this event is handled" record commit together —
 * a crash mid-way replays the whole thing cleanly.
 *
 * Copy this file as the pattern for your own subscriptions.
 */
@Injectable()
export class WidgetsEventHandlers implements OnModuleInit {
  private readonly log = new Logger(WidgetsEventHandlers.name);

  constructor(
    private readonly registry: EventRegistry,
    private readonly repo: WidgetsRepository,
  ) {}

  onModuleInit(): void {
    this.registry.on(TenantProvisioned, 'seed-starter-widget', async (event, tx) => {
      // The transaction already carries the tenant GUC (the consumer read it
      // from the message header), so this insert is RLS-scoped like any other.
      await this.repo.create(tx, event.payload.tenantId, {
        name: 'Getting started',
        description: `Starter widget for ${event.payload.name}`,
        quantity: 1,
      });
      this.log.log(`seeded starter widget for tenant ${event.payload.slug}`);
    });
  }
}
