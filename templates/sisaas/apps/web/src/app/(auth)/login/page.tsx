'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { login } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/dashboard');
    } catch (err) {
      // Never distinguish "no such account" from "wrong password": the pair is
      // an account-enumeration oracle, and the server already answers both the
      // same way.
      setError(toUserMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Sign in</h1>
        <p className="text-xs text-muted-foreground">Welcome back to Simbkit.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>

        <Field id="email" label="Email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field id="password" label="Password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        No account?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </Card>
  );
}
