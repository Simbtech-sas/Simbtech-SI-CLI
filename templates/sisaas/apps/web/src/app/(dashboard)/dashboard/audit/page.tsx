'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, FormError, PageHeader, Skeleton } from '@/components/ui';
import { listAudit, verifyAudit, type AuditEntry, type ChainVerification } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const PHASE: Record<AuditEntry['phase'], string> = {
  intent: 'border-amber-500/40 text-amber-700 dark:text-amber-400',
  committed: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  failed: 'border-red-500/40 text-red-600 dark:text-red-400',
  event: 'border-border text-muted-foreground',
};

export default function AuditPage() {
  const session = useSession();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ChainVerification | null>(null);
  const [busy, setBusy] = useState(false);

  const allowed = session.role === 'owner' || session.role === 'admin';

  const load = useCallback(async (before?: number) => {
    try {
      const page = await listAudit(before);
      setEntries((prev) => (before && prev ? [...prev, ...page] : page));
      setError(null);
    } catch (err) {
      setError(toUserMessage(err));
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function onVerify() {
    setBusy(true);
    try {
      setCheck(await verifyAudit());
    } catch (err) {
      setError(toUserMessage(err));
    }
    setBusy(false);
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Card className="p-8 text-center">
          <p className="text-sm text-foreground">The audit log is for owners and admins.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It records who did what, which makes it the first thing a compromised account
            would read.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Audit log" subtitle="Append-only, hash-chained, newest first.">
        <Button size="sm" onClick={() => void onVerify()} loading={busy}>
          Verify chain
        </Button>
      </PageHeader>

      <FormError>{error}</FormError>

      {check && (
        <Card
          className={
            check.ok
              ? 'border-emerald-500/30 bg-emerald-500/5 p-4'
              : 'border-red-500/30 bg-red-500/5 p-4'
          }
        >
          <p className="text-sm text-foreground">
            {check.ok
              ? `${check.count} entr${check.count === 1 ? 'y' : 'ies'} verified — every hash matches.`
              : `Chain broken at seq ${check.brokenAtSeq} (${check.reason}).`}
          </p>
          {check.ok && (
            <p className="mt-1 text-xs text-muted-foreground">
              This proves internal consistency. An attacker who can rewrite every row produces a
              chain that verifies too — anchor the head hash somewhere else to catch that.
            </p>
          )}
        </Card>
      )}

      {entries === null ? (
        <Skeleton className="h-40" />
      ) : entries.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-foreground">Nothing recorded yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Call <code>audit.around(...)</code> around an operation worth evidence of.
          </p>
        </Card>
      ) : (
        <>
          <Card className="divide-y divide-border">
            {entries.map((e) => (
              <div key={e.seq} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
                <span className="font-mono text-xs text-muted-foreground">#{e.seq}</span>
                <span className="text-sm font-medium text-foreground">{e.action}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${PHASE[e.phase]}`}
                >
                  {e.phase}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                {e.targetType && (
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {e.targetType}
                    {e.targetId ? ` · ${e.targetId}` : ''}
                  </span>
                )}
              </div>
            ))}
          </Card>
          {entries.length >= 50 && (
            <div className="flex justify-center">
              <Button size="sm" onClick={() => void load(entries[entries.length - 1]!.seq)}>
                Load older
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
