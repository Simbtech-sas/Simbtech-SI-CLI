import { z } from 'zod';

/**
 * An event contract. The topic is derived, never hand-written, so a producer and
 * a consumer cannot disagree about where a message lives.
 *
 * Topic format: `<service>.<aggregate>.v<version>` — the same string the
 * Debezium EventRouter is configured to route `aggregatetype` to.
 */
export interface EventContract<T extends z.ZodTypeAny = z.ZodTypeAny> {
  service: string;
  aggregate: string;
  type: string;
  version: number;
  schema: T;
  readonly topic: string;
}

export function defineEvent<T extends z.ZodTypeAny>(
  def: Omit<EventContract<T>, 'topic'>,
): EventContract<T> {
  return { ...def, topic: `${def.service}.${def.aggregate}.v${def.version}` };
}

/** What a consumer receives: the validated payload plus the routing metadata. */
export interface EventEnvelope<P> {
  /** Outbox row id. The idempotency key — see `processed_events`. */
  id: string;
  type: string;
  aggregateId: string;
  /** Null for platform-level events that belong to no tenant. */
  tenantId: string | null;
  occurredAt: Date;
  payload: P;
}

export type PayloadOf<C> = C extends EventContract<infer T> ? z.infer<T> : never;
