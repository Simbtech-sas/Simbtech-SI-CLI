import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { and, asc, isNull, sql } from 'drizzle-orm';
import type { EventEnvelope } from '@simbkit/events';
import { DatabaseService, type TenantTx } from '../../../database/database.service';
import { outboxEvents, processedEvents } from '../../../database/schema';
import { EventRegistry } from './event-registry.service';

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;

/**
 * Delivers outbox events inside a single deployable — no Kafka, no Debezium.
 *
 * The point of this class is that `OutboxService.publish()` and every handler are
 * **identical** whether you run as one app or as many. Splitting later swaps the
 * transport and the infrastructure; it does not rewrite a single publisher or
 * subscriber. That is what makes "start as one deployable" a real starting point
 * rather than a decision you pay for twice.
 *
 * Polling rather than an in-memory emitter, deliberately: a handler must not run
 * for a transaction that rolled back, and it must still run if the process dies
 * between the commit and the delivery. Only a durable row gives both.
 */
@Injectable()
export class LocalEventDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(LocalEventDispatcher.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly registry: EventRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (this.registry.topics().length === 0) {
      this.log.log('no event handlers registered — in-process dispatcher idle');
    }
    this.log.log('delivering events in-process (single deployable)');
    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    // Do not hold the process open just to poll.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Guarded so a slow batch cannot overlap the next tick. */
  private async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      let delivered = 0;
      // Keep going while a full batch comes back, so a burst is not spread
      // across many poll intervals.
      for (;;) {
        const batch = await this.claim();
        if (batch.length === 0) break;
        for (const row of batch) await this.deliver(row);
        delivered += batch.length;
        if (batch.length < BATCH_SIZE) break;
      }
      if (delivered > 0) this.log.debug(`dispatched ${delivered} event(s)`);
    } catch (err) {
      this.log.error(`dispatch pass failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Claim a batch atomically.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes running more than one instance safe:
   * two processes take disjoint rows instead of both taking the same one.
   */
  private async claim(): Promise<Array<typeof outboxEvents.$inferSelect>> {
    const claimed = await this.database.db.execute<typeof outboxEvents.$inferSelect>(sql`
      update outbox_events set dispatched_at = now()
      where id in (
        select id from outbox_events
        where dispatched_at is null
        order by created_at
        limit ${BATCH_SIZE}
        for update skip locked
      )
      returning *
    `);
    return [...claimed];
  }

  private async deliver(row: typeof outboxEvents.$inferSelect): Promise<void> {
    const registrations = this.registry.forType(row.type);
    if (registrations.length === 0) return;

    for (const registration of registrations) {
      const parsed = registration.contract.schema.safeParse(row.payload);
      if (!parsed.success) {
        // Same rule as the Kafka consumer: a payload that fails its own contract
        // will not pass on a retry.
        this.log.error(`${row.type}: payload failed contract validation, dropped`);
        continue;
      }

      const envelope: EventEnvelope<unknown> = {
        id: row.id,
        type: row.type,
        aggregateId: row.aggregateid,
        tenantId: row.tenantId, // si:when multi-tenant
        tenantId: null, // si:when single-tenant
        occurredAt: row.createdAt,
        payload: parsed.data,
      };

      await this.runWithRetry(registration.name, envelope, async (tx) => {
        // Idempotent for the same reason the Kafka path is: a redelivery after a
        // crash must not apply the side effect twice.
        const claimedRow = await tx
          .insert(processedEvents)
          .values({ eventId: row.id, consumer: `in-process:${registration.name}` })
          .onConflictDoNothing()
          .returning({ eventId: processedEvents.eventId });
        if (claimedRow.length === 0) return;

        await registration.handle(envelope, tx);
      });
    }
  }

  private async runWithRetry(
    handlerName: string,
    envelope: EventEnvelope<unknown>,
    work: (tx: TenantTx) => Promise<void>,
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // si:when-begin multi-tenant
        if (envelope.tenantId) {
          await this.database.runInTenantContext(envelope.tenantId, work);
        } else {
          await this.database.db.transaction(work);
        }
        // si:when-end
        await this.database.db.transaction(work); // si:when single-tenant
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === MAX_ATTEMPTS) {
          // No DLQ topic here. The row stays marked dispatched and the failure is
          // logged loudly — re-running it is a manual, deliberate act.
          this.log.error(
            `${handlerName} failed ${MAX_ATTEMPTS}x on ${envelope.type} (${envelope.id}): ${message}`,
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
      }
    }
  }
}
