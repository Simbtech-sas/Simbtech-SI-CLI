import { computeAuditHash, type AuditEntryCore } from '../domain/audit-hash';
import { verifyRows } from './audit.service';

const AT = new Date('2026-08-28T12:00:00.000Z');

function core(overrides: Partial<AuditEntryCore> = {}): AuditEntryCore {
  return {
    prevHash: null,
    tenantId: 't1',
    action: 'widget.deleted',
    targetType: 'widget',
    targetId: 'w1',
    metadata: { actorUserId: 'u1' },
    phase: 'event',
    correlationId: null,
    createdAt: AT,
    ...overrides,
  };
}

/** Build a valid chain the way the service does. */
function chain(entries: Array<Partial<AuditEntryCore>>) {
  let prevHash: string | null = null;
  return entries.map((e, i) => {
    const c = core({ ...e, prevHash });
    const hash = computeAuditHash(c);
    prevHash = hash;
    return {
      seq: i + 1,
      id: `id-${i}`,
      tenantId: c.tenantId,
      actorUserId: null,
      action: c.action,
      targetType: c.targetType,
      targetId: c.targetId,
      metadata: c.metadata,
      phase: c.phase,
      correlationId: c.correlationId,
      prevHash: c.prevHash,
      hash,
      createdAt: c.createdAt,
    };
  });
}

describe('audit hash', () => {
  it('is deterministic regardless of key order in metadata', () => {
    // The hash is recomputed from what Postgres returns, and jsonb does not
    // preserve key order. A non-canonical hash would fail verification on rows
    // nobody touched.
    const a = computeAuditHash(core({ metadata: { b: 2, a: 1, nested: { y: 1, x: 2 } } }));
    const b = computeAuditHash(core({ metadata: { a: 1, nested: { x: 2, y: 1 }, b: 2 } }));
    expect(a).toBe(b);
  });

  it('changes when any hashed field changes', () => {
    const base = computeAuditHash(core());
    expect(computeAuditHash(core({ action: 'widget.created' }))).not.toBe(base);
    expect(computeAuditHash(core({ targetId: 'w2' }))).not.toBe(base);
    expect(computeAuditHash(core({ metadata: { actorUserId: 'u2' } }))).not.toBe(base);
    expect(computeAuditHash(core({ phase: 'intent' }))).not.toBe(base);
    expect(computeAuditHash(core({ correlationId: 'c1' }))).not.toBe(base);
    expect(computeAuditHash(core({ createdAt: new Date(AT.getTime() + 1) }))).not.toBe(base);
    expect(computeAuditHash(core({ prevHash: 'x' }))).not.toBe(base);
  });
});

describe('chain verification', () => {
  it('accepts an intact chain', () => {
    const result = verifyRows(chain([{}, { action: 'a' }, { action: 'b' }]) as never);
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it('accepts an empty chain', () => {
    expect(verifyRows([])).toEqual({ ok: true, count: 0 });
  });

  it('detects an edited entry', () => {
    // The whole point: one altered field, caught without a second copy of the data.
    const rows = chain([{}, { action: 'a' }, { action: 'b' }]);
    rows[1]!.action = 'tampered';
    const result = verifyRows(rows as never);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash-mismatch');
    expect(result.brokenAtSeq).toBe(2);
  });

  it('detects a deleted entry', () => {
    const rows = chain([{}, { action: 'a' }, { action: 'b' }]);
    rows.splice(1, 1);
    const result = verifyRows(rows as never);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('broken-link');
  });

  it('detects a reordered chain', () => {
    const rows = chain([{}, { action: 'a' }, { action: 'b' }]);
    [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    expect(verifyRows(rows as never).ok).toBe(false);
  });

  it('detects an entry inserted in the middle with a valid own hash', () => {
    // A forger who recomputes the inserted row's hash still cannot make the NEXT
    // row's prev_hash match, without rewriting everything after it.
    const rows = chain([{}, { action: 'a' }]);
    const forged = { ...rows[0]!, seq: 2, action: 'forged' };
    forged.hash = computeAuditHash({
      prevHash: rows[0]!.hash,
      tenantId: 't1',
      action: 'forged',
      targetType: 'widget',
      targetId: 'w1',
      metadata: { actorUserId: 'u1' },
      phase: 'event',
      correlationId: null,
      createdAt: AT,
    });
    forged.prevHash = rows[0]!.hash;
    const tampered = [rows[0]!, forged, { ...rows[1]!, seq: 3 }];
    expect(verifyRows(tampered as never).ok).toBe(false);
  });

  it('a full rewrite is internally consistent — which is why the head must be anchored', () => {
    // Honest limit of the mechanism: an attacker who can rewrite every row
    // produces a chain that verifies. Detection needs the head hash stored
    // somewhere they do not control.
    const rewritten = chain([{ action: 'innocent' }, { action: 'innocent' }]);
    expect(verifyRows(rewritten as never).ok).toBe(true);
  });
});
