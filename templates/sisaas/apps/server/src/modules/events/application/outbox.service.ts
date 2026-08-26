import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { lt } from 'drizzle-orm';
import type { EventContract, PayloadOf } from '@simbkit/events';
import { DatabaseService, type TenantTx } from '../../../database/database.service';
import { outboxEvents } from '../../../database/schema';

/** Outbox rows exist only until Debezium has read the WAL. A week is generous. */
const RETENTION_DAYS = 7;

export interface PublishInput<C extends EventContract> {
  /** The aggregate this is about. Becomes the Kafka message key, so all events
   *  for one aggregate land on one partition and stay ordered. */
  aggregateId: string;
  payload: PayloadOf<C>;
  /** Omit for platform-level events that belong to no tenant. */
  tenantId?: string | null;
}

/**
 * The only way this service announces anything.
 *
 * `publish` takes the caller's transaction on purpose: the outbox row and the
 * domain change it describes commit together or not at all. If the transaction
 * rolls back, the event was never announced — which is the correct outcome and
 * the reason `producer.send()` appears nowhere in this codebase.
 *
 * Debezium tails the WAL and does the actual publishing, so Kafka being down
 * cannot fail a write here.
 */
@Injectable()
export class OutboxService {
  private readonly log = new Logger(OutboxService.name);

  constructor(private readonly database: DatabaseService) {}

  async publish<C extends EventContract>(
    tx: TenantTx,
    contract: C,
    input: PublishInput<C>,
  ): Promise<void> {
    // Validate against the shared contract before it can reach a consumer.
    // A payload that fails here is a bug in this service, not bad input.
    const payload = contract.schema.parse(input.payload) as Record<string, unknown>;

    await tx.insert(outboxEvents).values({
      aggregatetype: contract.aggregate,
      aggregateid: input.aggregateId,
      type: contract.type,
      payload,
      tenantId: input.tenantId ?? null,
    });
  }

  /**
   * Outbox rows are write-once and read only by Debezium's WAL tail, so they can
   * be dropped as soon as the connector is safely past them. Without this the
   * table grows forever.
   *
   * ponytail: runs in both the API and the worker. The DELETE is idempotent, so
   * the second one finds nothing. Move it behind `consume` if that ever matters.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.database.db
      .delete(outboxEvents)
      .where(lt(outboxEvents.createdAt, cutoff))
      .returning({ id: outboxEvents.id });
    if (deleted.length > 0) {
      this.log.log(`pruned ${deleted.length} outbox rows older than ${RETENTION_DAYS}d`);
    }
  }
}
