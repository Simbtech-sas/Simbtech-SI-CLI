import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">Simbkit</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        An application starter. Create an account to reach your dashboard.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/register"
          className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
