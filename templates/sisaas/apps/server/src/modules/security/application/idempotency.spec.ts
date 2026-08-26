import { IdempotencyService } from './idempotency.service';

describe('idempotency request hashing', () => {
  it('is stable regardless of key order', () => {
    // A client that serialises the same object differently must not be told its
    // request conflicts with itself.
    const a = IdempotencyService.hashBody({ amount: '10.00', currency: 'XAF', ref: 'r1' });
    const b = IdempotencyService.hashBody({ ref: 'r1', currency: 'XAF', amount: '10.00' });
    expect(a).toBe(b);
  });

  it('is stable for nested objects and arrays', () => {
    const a = IdempotencyService.hashBody({ items: [{ id: 1, qty: 2 }], meta: { x: 1, y: 2 } });
    const b = IdempotencyService.hashBody({ meta: { y: 2, x: 1 }, items: [{ qty: 2, id: 1 }] });
    expect(a).toBe(b);
  });

  it('changes when any value changes', () => {
    // This is what catches a key reused with a different body — the case where
    // replaying the old response would hide a real client bug.
    const base = IdempotencyService.hashBody({ amount: '10.00' });
    expect(IdempotencyService.hashBody({ amount: '10.01' })).not.toBe(base);
    expect(IdempotencyService.hashBody({ amount: 10.0 })).not.toBe(base);
    expect(IdempotencyService.hashBody({ amount: '10.00', extra: 1 })).not.toBe(base);
  });

  it('array order is significant', () => {
    // Reordering a list is a different request: [debit, credit] is not
    // [credit, debit].
    expect(IdempotencyService.hashBody([1, 2])).not.toBe(IdempotencyService.hashBody([2, 1]));
  });

  it('distinguishes null, undefined-stripped and empty', () => {
    expect(IdempotencyService.hashBody(null)).not.toBe(IdempotencyService.hashBody({}));
    // undefined is dropped by JSON, so these are the same request on the wire.
    expect(IdempotencyService.hashBody({ a: 1, b: undefined })).toBe(
      IdempotencyService.hashBody({ a: 1 }),
    );
  });
});
