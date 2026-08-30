import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Cluster' },
  { href: '/nodes', label: 'Nodes' },
  { href: '/services', label: 'Services' },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-border px-4 py-3">
        <span className="text-sm font-bold text-primary">Simbkit platform</span>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
