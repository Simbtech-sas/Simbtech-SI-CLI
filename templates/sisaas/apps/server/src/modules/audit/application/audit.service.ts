import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { DatabaseService, type TenantTx } from '../../../database/database.service';
import { auditLog } from '../../../database/schema';
import { type AuditEntryCore, type AuditPhase, computeAuditHash } from '../domain/audit-hash';

export interface AuditEvent {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  /** `seq` of the first entry whose hash does not recompute. */
  brokenAtSeq?: number;
  reason?: 'hash-mismatch' | 'broken-link';
}

/** Returned by `writeAhead`, used to close the entry out. */
export interface AuditIntent {
  correlationId: string;
  tenantId: string | null;
  event: AuditEvent;
}

// The exported transaction type, not one derived from a method signature.
// `runInTenantContext` does not exist in a single-tenant build, and deriving a
// type from it made an unrelated file fail to compile there.
type Tx = TenantTx;
type AuditRow = typeof auditLog.$inferSelect;

/**
 * Append-only, tamper-evident audit log with write-ahead semantics.
 *
 * ## Write-ahead
 *
 * `writeAhead()` records the INTENT to do something, on a **separate
 * connection**, before the operation runs. `settle()` records the outcome after.
 *
 * The separate connection is the whole point: an audit entry written inside the
 * operation's own transaction disappears when that transaction rolls back, so a
 * failed or malicious attempt leaves no trace at all. What you want from an
 * audit log is precisely the record of the attempt.
 *
 * An `intent` with no matching outcome is therefore meaningful on its own — it
 * means a crash, a rollback, or a process that was killed mid-operation.
 *
 * ## Tamper evidence
 *
 * Every entry carries `hash = sha256(prev_hash ‖ content)`. Editing any row
 * invalidates every hash after it. The table also rejects UPDATE and DELETE at
 * the database level, so the chain is verified against rows that cannot have
 * been quietly rewritten.
 *
 * **Anchor the head hash somewhere else** — another system, a daily log line, a
 * signed receipt — if you need to detect an attacker who can rewrite the whole
 * chain. Within one database, a full rewrite is undetectable by definition.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly database: DatabaseService) {}

  // ── write-ahead ─────────────────────────────────────────────────────────────

  /**
   * Record that an operation is about to happen, durably, before it does.
   *
   * Runs on its own connection so it survives the caller's rollback. Use for
   * anything you would want evidence of even if it failed: money movement,
   * permission changes, deletion, data export.
   */
  async writeAhead(
    tenantId: string | null, // si:when multi-tenant
    event: AuditEvent,
  ): Promise<AuditIntent> {
    const tenantId: string | null = null; // si:when single-tenant
    const correlationId = randomUUID();
    await this.appendOnOwnConnection(tenantId, event, 'intent', correlationId);
    return { correlationId, tenantId, event };
  }

  /** Close out an intent. Also on its own connection, for the same reason. */
  async settle(intent: AuditIntent, outcome: 'committed' | 'failed', detail?: Record<string, unknown>): Promise<void> {
    await this.appendOnOwnConnection(
      intent.tenantId,
      { ...intent.event, metadata: { ...(intent.event.metadata ?? {}), ...(detail ?? {}) } },
      outcome,
      intent.correlationId,
    );
  }

  /**
   * Run an operation with the attempt recorded before it and the outcome after,
   * whichever way it goes.
   */
  async around<T>(
    tenantId: string | null, // si:when multi-tenant
    event: AuditEvent,
    work: () => Promise<T>,
  ): Promise<T> {
    const intent = await this.writeAhead(tenantId, event); // si:when multi-tenant
    const intent = await this.writeAhead(event); // si:when single-tenant
    try {
      const result = await work();
      await this.settle(intent, 'committed');
      return result;
    } catch (err) {
      await this.settle(intent, 'failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ── plain append ────────────────────────────────────────────────────────────

  // si:when-begin multi-tenant
  /** A completed fact, with no separate intent. Joins the same chain. */
  async recordTenantEvent(tenantId: string, event: AuditEvent): Promise<void> {
    await this.appendOnOwnConnection(tenantId, event, 'event', null);
  }

  async recordPlatformEvent(event: AuditEvent): Promise<void> {
    await this.appendOnOwnConnection(null, event, 'event', null);
  }
  // si:when-end

  // si:when-begin single-tenant
  /** A completed fact, with no separate intent. Joins the one chain. */
  async record(event: AuditEvent): Promise<void> {
    await this.appendOnOwnConnection(null, event, 'event', null);
  }
  // si:when-end

  /**
   * Append inside a transaction the caller already owns.
   *
   * Only for entries that genuinely SHOULD vanish if the work rolls back — a
   * derived record of something that did not happen. Anything you want evidence
   * of regardless belongs in `writeAhead`.
   */
  async appendInTransaction(
    tx: Tx,
    tenantId: string | null, // si:when multi-tenant
    event: AuditEvent,
  ): Promise<void> {
    const tenantId: string | null = null; // si:when single-tenant
    await this.append(tx, tenantId, event, 'event', null);
  }

  // ── reading ─────────────────────────────────────────────────────────────────

  /**
   * The most recent entries, newest first.
   *
   * Paged by `seq`, which is the only correct order to read this table in: it
   * is the chain's own order, and sorting by `created_at` puts two entries
   * written in the same millisecond in an order the hashes disagree with.
   */
  // si:when-begin multi-tenant
  async recent(tenantId: string, limit = 50, before?: number): Promise<AuditRow[]> {
    return this.database.runInTenantContext(tenantId, async (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          before === undefined
            ? eq(auditLog.tenantId, tenantId)
            : and(eq(auditLog.tenantId, tenantId), lt(auditLog.seq, before)),
        )
        .orderBy(desc(auditLog.seq))
        .limit(Math.min(limit, 200)),
    );
  }
  // si:when-end
  // si:when-begin single-tenant
  async recent(limit = 50, before?: number): Promise<AuditRow[]> {
    return this.database.transaction(async (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(before === undefined ? undefined : lt(auditLog.seq, before))
        .orderBy(desc(auditLog.seq))
        .limit(Math.min(limit, 200)),
    );
  }
  // si:when-end

  // ── verification ────────────────────────────────────────────────────────────

  // si:when-begin multi-tenant
  async verifyTenantChain(tenantId: string): Promise<ChainVerification> {
    return this.database.runInTenantContext(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.tenantId, tenantId))
        .orderBy(asc(auditLog.seq));
      return verifyRows(rows);
    });
  }

  async verifyPlatformChain(): Promise<ChainVerification> {
    const rows = await this.database
      .requireAdminDb()
      .select()
      .from(auditLog)
      .where(isNull(auditLog.tenantId))
      .orderBy(asc(auditLog.seq));
    return verifyRows(rows);
  }
  // si:when-end

  // si:when-begin single-tenant
  /** There is one chain. Read it in `seq` order or the hashes mean nothing. */
  async verifyChain(): Promise<ChainVerification> {
    const rows = await this.database.db
      .select()
      .from(auditLog)
      .orderBy(asc(auditLog.seq));
    return verifyRows(rows);
  }
  // si:when-end

  /**
   * The head hash. Publish or store this outside the database periodically: it is
   * what turns "the chain is internally consistent" into "the chain has not been
   * rewritten".
   */
  async headHash(
    tenantId: string | null, // si:when multi-tenant
  ): Promise<string | null> {
    const tenantId: string | null = null; // si:when single-tenant
    const db = tenantId ? this.database.db : this.database.requireAdminDb(); // si:when multi-tenant
    const db = this.database.db; // si:when single-tenant
    const [row] = await db
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .where(tenantId ? eq(auditLog.tenantId, tenantId) : isNull(auditLog.tenantId)) // si:when multi-tenant
      .orderBy(desc(auditLog.seq))
      .limit(1);
    return row?.hash ?? null;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /**
   * Its own transaction on the pooled connection, independent of whatever the
   * caller is doing. This is what makes the entry survive the caller's rollback.
   */
  private async appendOnOwnConnection(
    tenantId: string | null,
    event: AuditEvent,
    phase: AuditPhase,
    correlationId: string | null,
  ): Promise<void> {
    // si:when-begin multi-tenant
    if (tenantId) {
      await this.database.runInTenantContext(tenantId, (tx) =>
        this.append(tx, tenantId, event, phase, correlationId),
      );
      return;
    }
    // si:when-end
    await this.database
      .requireAdminDb() // si:when multi-tenant
      .transaction((tx) => this.append(tx as Tx, null, event, phase, correlationId));
  }

  private async append(
    tx: Tx,
    tenantId: string | null,
    event: AuditEvent,
    phase: AuditPhase,
    correlationId: string | null,
  ): Promise<void> {
    // Serialise concurrent appends to one chain, so prev_hash never forks. Held
    // for the transaction, released on commit.
    const lockName = tenantId ? `audit:${tenantId}` : 'audit:platform';
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockName}))`);

    const [last] = await tx
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .where(tenantId ? eq(auditLog.tenantId, tenantId) : isNull(auditLog.tenantId)) // si:when multi-tenant
      .orderBy(desc(auditLog.seq))
      .limit(1);

    const createdAt = new Date();
    const core: AuditEntryCore = {
      prevHash: last?.hash ?? null,
      tenantId,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      metadata: { ...(event.metadata ?? {}), actorUserId: event.actorUserId ?? null },
      phase,
      correlationId,
      createdAt,
    };

    await tx.insert(auditLog).values({
      tenantId, // si:when multi-tenant
      actorUserId: event.actorUserId ?? null,
      action: core.action,
      targetType: core.targetType,
      targetId: core.targetId,
      metadata: core.metadata,
      phase,
      correlationId,
      prevHash: core.prevHash,
      hash: computeAuditHash(core),
      createdAt,
    });
  }
}

/** Exported for tests: pure, no database. */
export function verifyRows(rows: AuditRow[]): ChainVerification {
  let prevHash: string | null = null;

  for (const row of rows) {
    if (row.prevHash !== prevHash) {
      // A link that does not point at the previous row means an entry was
      // removed, inserted, or reordered.
      return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: 'broken-link' };
    }

    const expected = computeAuditHash({
      prevHash,
      tenantId: row.tenantId, // si:when multi-tenant
      tenantId: null, // si:when single-tenant
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      phase: row.phase,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    });

    if (expected !== row.hash) {
      return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: 'hash-mismatch' };
    }
    prevHash = row.hash;
  }

  return { ok: true, count: rows.length };
}
