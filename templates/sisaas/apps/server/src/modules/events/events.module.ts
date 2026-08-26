import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { OutboxService } from './application/outbox.service';
import { EventRegistry } from './application/event-registry.service';
import { EventConsumer } from './application/event-consumer.service';
import { LocalEventDispatcher } from './application/local-dispatcher.service';

/**
 * How events get from the outbox to the handlers.
 *
 * `in-process` — a single deployable. A poller claims outbox rows and calls the
 *   handlers directly. No Kafka, no Debezium, no broker to operate.
 * `kafka` — separate services. Debezium tails the WAL and publishes; each
 *   service consumes what it subscribed to.
 *
 * Publishers and handlers are identical either way. That is the whole design:
 * starting as one deployable costs nothing later, because splitting swaps this
 * setting and the infrastructure behind it — not the code.
 */
export type EventTransport = 'in-process' | 'kafka';

export interface EventsModuleOptions {
  /**
   * Deliver events in this process. True in the worker, false in the API:
   * delivery is background work, so an API restart never drops a half-handled
   * event. Publishing is available in both regardless.
   */
  consume: boolean;
  transport: EventTransport;
}

@Global()
@Module({})
export class EventsModule {
  static forRoot(options: EventsModuleOptions): DynamicModule {
    const delivery: Provider[] = !options.consume
      ? []
      : options.transport === 'kafka'
        ? [EventConsumer]
        : [LocalEventDispatcher];

    return {
      module: EventsModule,
      providers: [OutboxService, EventRegistry, ...delivery],
      exports: [OutboxService, EventRegistry],
    };
  }
}
