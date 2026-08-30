import { Injectable, NotFoundException } from '@nestjs/common';
import { WidgetCreated, WidgetDeleted, WidgetUpdated } from '@simbkit/events';
import { DatabaseService } from '../../../database/database.service';
import { OutboxService } from '../../events/application/outbox.service';
import type { NewWidget, WidgetPatch } from '../domain/widget';
import { WidgetsRepository } from '../infrastructure/widgets.repository';

/**
 * The unit of work lives here, not in the repository. Every write opens ONE
 * transaction and does both halves inside it: the domain change and the outbox
 * row announcing it. Roll back and neither happened — which is why this service
 * never calls a Kafka producer.
 *
 * The single-tenant build. Identical to the multi-tenant one except that there
 * is no tenant to scope to: `transaction` instead of `runInTenantContext`, and
 * no tenantId threaded through every signature. Nothing else changes, which is
 * the point — the shape a feature module copies is the same either way.
 */
@Injectable()
export class WidgetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WidgetsRepository,
    private readonly outbox: OutboxService,
  ) {}

  list() {
    return this.db.transaction((tx) => this.repo.list(tx));
  }

  async get(id: string) {
    const widget = await this.db.transaction((tx) => this.repo.get(tx, id));
    if (!widget) throw new NotFoundException('Widget not found');
    return widget;
  }

  create(input: NewWidget) {
    return this.db.transaction(async (tx) => {
      const widget = await this.repo.create(tx, input);
      await this.outbox.publish(tx, WidgetCreated, {
        aggregateId: widget.id,
        payload: { id: widget.id, name: widget.name, quantity: widget.quantity },
      });
      return widget;
    });
  }

  async update(id: string, patch: WidgetPatch) {
    const widget = await this.db.transaction(async (tx) => {
      const row = await this.repo.update(tx, id, patch);
      if (!row) return undefined;
      await this.outbox.publish(tx, WidgetUpdated, {
        aggregateId: row.id,
        payload: { id: row.id, name: row.name, quantity: row.quantity },
      });
      return row;
    });
    if (!widget) throw new NotFoundException('Widget not found');
    return widget;
  }

  async remove(id: string) {
    const ok = await this.db.transaction(async (tx) => {
      const removed = await this.repo.remove(tx, id);
      if (removed) {
        await this.outbox.publish(tx, WidgetDeleted, { aggregateId: id, payload: { id } });
      }
      return removed;
    });
    if (!ok) throw new NotFoundException('Widget not found');
    return { ok: true };
  }
}
