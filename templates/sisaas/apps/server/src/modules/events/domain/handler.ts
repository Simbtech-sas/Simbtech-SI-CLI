import type { EventContract, EventEnvelope, PayloadOf } from '@simbkit/events';
import type { TenantTx } from '../../../database/database.service';

/**
 * A handler runs INSIDE the transaction that claims the event. Whatever it
 * writes commits atomically with the `processed_events` row, so a crash halfway
 * through cannot leave the event marked done with its effects half-applied.
 */
export type EventHandler<C extends EventContract> = (
  envelope: EventEnvelope<PayloadOf<C>>,
  tx: TenantTx,
) => Promise<void>;

export interface Registration {
  contract: EventContract;
  /** Distinguishes handlers when one service handles the same event twice. */
  name: string;
  handle: EventHandler<EventContract>;
}
