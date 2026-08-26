'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { Button } from '@/components/ui';
import { logout, me, type Session } from '@/lib/api';

/**
 * Authed route-group shell. Resolves the session through the api client on
 * mount (which transparently refreshes an expired access token); a signed-out
 * visitor is bounced to the landing page rather than shown a broken dashboard.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    me()
      .then((s) => {
        if (!active) return;
        setSession(s);
        setReady(true);
      })
      .catch(() => active && router.replace('/'));
    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    await logout();
    router.replace('/');
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-bold text-primary">Simbkit</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{session?.tenant.name}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Shell>{children}</Shell>
    </ThemeProvider>
  );
}
