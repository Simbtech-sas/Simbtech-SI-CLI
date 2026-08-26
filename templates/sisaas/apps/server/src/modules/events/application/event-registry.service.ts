import { Injectable, Logger } from '@nestjs/common';
import type { EventContract } from '@simbkit/events';
import type { EventHandler, Registration } from '../domain/handler';

/**
 * Where feature modules declare what they react to. Registration is a plain
 * method call from a module's `onModuleInit` — no decorators, no metadata
 * reflection, and the full set is knowable before the consumer subscribes.
 */
@Injectable()
export class EventRegistry {
  private readonly log = new Logger(EventRegistry.name);
  private readonly registrations: Registration[] = [];

  on<C extends EventContract>(contract: C, name: string, handle: EventHandler<C>): void {
    const duplicate = this.registrations.some(
      (r) => r.contract.type === contract.type && r.name === name,
    );
    if (duplicate) {
      throw new Error(`duplicate handler "${name}" for ${contract.type}`);
    }
    this.registrations.push({
      contract,
      name,
      handle: handle as EventHandler<EventContract>,
    });
    this.log.log(`handler ${name} <- ${contract.topic} / ${contract.type}`);
  }

  /** Handlers for one event type. Empty is normal — most events interest nobody here. */
  forType(type: string): Registration[] {
    return this.registrations.filter((r) => r.contract.type === type);
  }

  /** Every topic that has at least one handler. This is what the consumer subscribes to. */
  topics(): string[] {
    return [...new Set(this.registrations.map((r) => r.contract.topic))];
  }
}
