import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Kafka, type Consumer, type Producer, type EachMessagePayload } from 'kafkajs';
import type { EventEnvelope } from '@simbkit/events';
import { AppConfigService } from '../../../config/app-config.service';
import { DatabaseService, type TenantTx } from '../../../database/database.service';
import { processedEvents } from '../../../database/schema';
import { EventRegistry } from './event-registry.service';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

/**
 * Headers set by Debezium's EventRouter. The connector config that produces them
 * lives in the platform repo; if you change one side, change the other:
 *
 *   TABLE_FIELD_EVENT_ID=id
 *   TABLE_FIELD_EVENT_KEY=aggregateid
 *   TABLE_FIELD_EVENT_TYPE=type
 *   TABLE_FIELD_EVENT_TIMESTAMP=created_at
 *   TABLE_FIELD_EVENT_PAYLOAD=payload
 *   TABLE_FIELDS_ADDITIONAL_PLACEMENT=type:header:eventType,tenant_id:header:tenantId
 */
const HEADER_ID = 'id';
const HEADER_TYPE = 'eventType';
const HEADER_TENANT = 'tenantId';

@Injectable()
export class EventConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(EventConsumer.name);
  private consumer?: Consumer;
  private producer?: Producer;
  private readonly group: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
    private readonly registry: EventRegistry,
  ) {
    this.group = this.config.kafka?.groupId ?? this.config.serviceName;
  }

  /**
   * Subscribes after every module has booted, so `EventRegistry` already holds
   * every handler and the topic list is complete.
   */
  async onApplicationBootstrap(): Promise<void> {
    const kafka = this.config.kafka;
    if (!kafka) {
      this.log.log('KAFKA_BROKERS unset — event consumer disabled');
      return;
    }
    const topics = this.registry.topics();
    if (topics.length === 0) {
      this.log.log('no event handlers registered — consumer not started');
      return;
    }

    const client = new Kafka({
      clientId: kafka.clientId,
      brokers: kafka.brokers,
      ssl: kafka.ssl,
      ...(kafka.sasl ? { sasl: { mechanism: 'scram-sha-512' as const, ...kafka.sasl } } : {}),
    });

    this.producer = client.producer();
    await this.producer.connect();

    this.consumer = client.consumer({ groupId: this.group });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics, fromBeginning: false });
    await this.consumer.run({ eachMessage: (p) => this.handle(p) });
    this.log.log(`consuming ${topics.join(', ')} as group "${this.group}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }

  private header(payload: EachMessagePayload, key: string): string | null {
    const raw = payload.message.headers?.[key];
    if (raw === undefined || raw === null) return null;
    const value = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    return value.length > 0 ? value : null;
  }

  private async handle(payload: EachMessagePayload): Promise<void> {
    const id = this.header(payload, HEADER_ID);
    const type = this.header(payload, HEADER_TYPE);
    if (!id || !type) {
      // Not an outbox message. Skipping is right: failing would block the
      // partition on something no redelivery can fix.
      this.log.warn(`${payload.topic}: message without ${HEADER_ID}/${HEADER_TYPE} headers, skipped`);
      return;
    }

    const registrations = this.registry.forType(type);
    if (registrations.length === 0) return;

    const tenantId = this.header(payload, HEADER_TENANT);
    const body: unknown = payload.message.value ? JSON.parse(payload.message.value.toString()) : {};

    for (const registration of registrations) {
      const parsed = registration.contract.schema.safeParse(body);
      if (!parsed.success) {
        // A payload that does not match the contract will never match it on a
        // retry either. Straight to the DLQ.
        this.log.error(`${type}: payload failed contract validation — routing to DLQ`);
        await this.toDlq(payload, `contract validation: ${parsed.error.message}`);
        continue;
      }

      const envelope: EventEnvelope<unknown> = {
        id,
        type,
        aggregateId: payload.message.key?.toString() ?? '',
        tenantId,
        occurredAt: new Date(Number(payload.message.timestamp)),
        payload: parsed.data,
      };

      await this.runWithRetry(registration.name, envelope, async (tx) => {
        // Claim first. `onConflictDoNothing` returning nothing means another
        // delivery of this same event already ran — Kafka is at-least-once, so
        // this is expected traffic, not an error.
        const claimed = await tx
          .insert(processedEvents)
          .values({ eventId: id, consumer: `${this.group}:${registration.name}` })
          .onConflictDoNothing()
          .returning({ eventId: processedEvents.eventId });
        if (claimed.length === 0) return;

        await registration.handle(envelope, tx);
      }, payload);
    }
  }

  private async runWithRetry(
    handlerName: string,
    envelope: EventEnvelope<unknown>,
    work: (tx: TenantTx) => Promise<void>,
    raw: EachMessagePayload,
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // The claim and the handler's writes share one transaction, so a failure
        // rolls back both and the event is genuinely un-processed on retry.
        if (envelope.tenantId) {
          await this.database.runInTenantContext(envelope.tenantId, work); // si:when multi-tenant
          await this.database.transaction(work); // si:when single-tenant
        } else {
          await this.database.db.transaction(work);
        }
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === MAX_ATTEMPTS) {
          this.log.error(`${handlerName} failed ${MAX_ATTEMPTS}x on ${envelope.type}: ${message}`);
          await this.toDlq(raw, `${handlerName}: ${message}`);
          return;
        }
        this.log.warn(`${handlerName} attempt ${attempt} on ${envelope.type} failed: ${message}`);
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * 2 ** (attempt - 1)));
      }
    }
  }

  /**
   * A poison message must leave the partition, or it blocks every message behind
   * it forever. The original bytes and headers are preserved so it can be
   * replayed once the bug is fixed.
   */
  private async toDlq(payload: EachMessagePayload, reason: string): Promise<void> {
    if (!this.producer) return;
    try {
      await this.producer.send({
        topic: `${payload.topic}.dlq`,
        messages: [
          {
            key: payload.message.key,
            value: payload.message.value,
            headers: {
              ...payload.message.headers,
              dlqReason: reason,
              dlqConsumerGroup: this.group,
              dlqOriginalTopic: payload.topic,
            },
          },
        ],
      });
    } catch (err) {
      this.log.error(`failed to write to DLQ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
