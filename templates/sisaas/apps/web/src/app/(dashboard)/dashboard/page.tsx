'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { listWidgets } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function DashboardHome() {
  // From the shell, which already resolved it. Fetching it again here is a
  // second request for an answer the app is holding.
  const session = useSession();
  const [widgetCount, setWidgetCount] = useState<number | null>(null);

  useEffect(() => {
    // A count, not a list: the overview should not go slow because one feature
    // grew. Swallowed on failure — a broken tile must not hide the session.
    listWidgets()
      .then((w) => setWidgetCount(w.length))
      .catch(() => setWidgetCount(null));
  }, []);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="Dashboard" subtitle="Your current session" />

      <Card className="space-y-2 p-5">
        <p className="text-sm text-foreground">
          Signed in as <span className="font-medium">{session.user.email}</span>
        </p>
        {/* si:when-begin multi-tenant */}
        <p className="text-xs text-muted-foreground">
          Tenant: {session.tenant.name} ({session.tenant.slug})
        </p>
        {/* si:when-end */}
        <p className="text-xs text-muted-foreground">Role: {session.role}</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/dashboard/widgets" className="block">
          <Card className="p-5 transition-colors hover:bg-accent">
            <p className="text-sm font-medium text-foreground">Widgets</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {widgetCount === null ? 'The example feature module' : `${widgetCount} in your account`}
            </p>
          </Card>
        </Link>
        <Link href="/dashboard/settings" className="block">
          <Card className="p-5 transition-colors hover:bg-accent">
            <p className="text-sm font-medium text-foreground">Settings</p>
            <p className="mt-1 text-xs text-muted-foreground">Profile and password</p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
