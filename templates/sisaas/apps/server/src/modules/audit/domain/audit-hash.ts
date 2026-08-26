import { createHash } from 'node:crypto';

export type AuditPhase = 'intent' | 'committed' | 'failed' | 'event';

/**
 * The content that is hashed.
 *
 * `seq` is deliberately absent: the chain's order is already enforced by
 * `prevHash` linkage, and hashing a value the database assigns on insert would
 * mean computing the hash after the write. Reordering rows by editing `seq` is
 * still caught, because verification walks in `seq` order and recomputes — a
 * swap breaks the recomputed chain.
 *
 * `actorUserId` is hashed as part of `metadata`, not as a column: the
 * `actor_user_id` FK is `ON DELETE SET NULL`, so deleting a user would otherwise
 * silently invalidate every entry they ever caused.
 */
export interface AuditEntryCore {
  prevHash: string | null;
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  phase: AuditPhase;
  correlationId: string | null;
  createdAt: Date;
}

/** Deterministic JSON (sorted keys) so the same logical value always hashes equal. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // jsonb drops these anyway
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * `sha256(prev_hash ‖ canonical content)`.
 *
 * Chaining is what makes a single edit detectable: changing any row changes its
 * hash, which invalidates the `prev_hash` of the next row, and so on to the end.
 * An attacker must rewrite every subsequent entry — and if the head hash is
 * anchored anywhere outside the database, they cannot do even that undetected.
 */
export function computeAuditHash(entry: AuditEntryCore): string {
  // Normalised exactly as Postgres jsonb would store it, so the hash computed at
  // write time equals the hash recomputed at verify time.
  const metadata: unknown = JSON.parse(JSON.stringify(entry.metadata ?? {}));
  const canonical = JSON.stringify([
    entry.prevHash,
    entry.tenantId,
    entry.action,
    entry.targetType,
    entry.targetId,
    stableStringify(metadata),
    entry.phase,
    entry.correlationId,
    entry.createdAt.toISOString(),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
