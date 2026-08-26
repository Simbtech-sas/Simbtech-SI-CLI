import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Require an `Idempotency-Key` header on this route and replay the original
 * response for a repeat.
 *
 * Put it on anything a retry must not do twice: charges, transfers, orders,
 * outbound messages. Do NOT put it on plain reads or on genuinely repeatable
 * writes — every guarded request costs a row and a round trip.
 *
 * `required: false` honours a key when the client sends one but does not insist,
 * which suits an endpoint that is only sometimes dangerous.
 */
export const Idempotent = (options: { required?: boolean } = {}) =>
  SetMetadata(IDEMPOTENT_KEY, { required: options.required ?? true });
