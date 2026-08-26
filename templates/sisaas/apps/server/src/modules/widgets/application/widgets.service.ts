import { Injectable, NotFoundException } from '@nestjs/common';
import { WidgetCreated, WidgetDeleted, WidgetUpdated } from '@simbkit/events';
import { DatabaseService } from '../../../database/database.service';
import { OutboxService } from '../../events/application/outbox.service';
import type { NewWidget, WidgetPatch } from '../domain/widget';
import { WidgetsRepository } from '../infrastructure/widgets.repository';

/**
 * The unit of work lives here, not in the repository. Every write opens ONE
 * tenant-scoped transaction and does both halves inside it: the domain change
 * and the outbox row announcing it. Roll back and neither happened — which is
 * why this service never calls a Kafka producer.
 *
 * This module is the reference every feature module is copied from. Keep the
 * shape: service owns the transaction, repository takes it.
 */
@Injectable()
export class WidgetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WidgetsRepository,
    private readonly outbox: OutboxService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenantContext(tenantId, (tx) => this.repo.list(tx));
  }

  async get(tenantId: string, id: string) {
    const widget = await this.db.runInTenantContext(tenantId, (tx) => this.repo.get(tx, id));
    if (!widget) throw new NotFoundException('Widget not found');
    return widget;
  }

  create(tenantId: string, input: NewWidget) {
    return this.db.runInTenantContext(tenantId, async (tx) => {
      const widget = await this.repo.create(tx, tenantId, input);
      await this.outbox.publish(tx, WidgetCreated, {
        aggregateId: widget.id,
        tenantId,
        payload: { id: widget.id, name: widget.name, quantity: widget.quantity },
      });
      return widget;
    });
  }

  async update(tenantId: string, id: string, patch: WidgetPatch) {
    const widget = await this.db.runInTenantContext(tenantId, async (tx) => {
      const row = await this.repo.update(tx, id, patch);
      if (!row) return undefined;
      await this.outbox.publish(tx, WidgetUpdated, {
        aggregateId: row.id,
        tenantId,
        payload: { id: row.id, name: row.name, quantity: row.quantity },
      });
      return row;
    });
    if (!widget) throw new NotFoundException('Widget not found');
    return widget;
  }

  async remove(tenantId: string, id: string) {
    const ok = await this.db.runInTenantContext(tenantId, async (tx) => {
      const removed = await this.repo.remove(tx, id);
      if (removed) {
        await this.outbox.publish(tx, WidgetDeleted, { aggregateId: id, tenantId, payload: { id } });
      }
      return removed;
    });
    if (!ok) throw new NotFoundException('Widget not found');
    return { ok: true };
  }
}
