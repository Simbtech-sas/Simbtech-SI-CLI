'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, Skeleton } from '@/components/ui';
import { me, type Session } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';

export default function DashboardHome() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    me()
      .then(setSession)
      .catch((e) => setError(toUserMessage(e)));
  }, []);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Dashboard" subtitle="Your current session" />

      {error && (
        <p className="rounded-lg border border-border px-3 py-2 text-sm text-red-500">{error}</p>
      )}

      {!session && !error ? (
        <Skeleton className="h-24" />
      ) : (
        session && (
          <Card className="space-y-2 p-5">
            <p className="text-sm text-foreground">
              Signed in as <span className="font-medium">{session.user.email}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Tenant: {session.tenant.name} ({session.tenant.slug})
            </p>
          </Card>
        )
      )}
    </div>
  );
}
