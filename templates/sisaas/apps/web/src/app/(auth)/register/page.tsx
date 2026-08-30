'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { register } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';

// si:when-begin multi-tenant
/** Mirrors the server's slug rule. Kept in sync by hand — the server still wins. */
const SLUG = /^[a-z][a-z0-9-]{1,30}$/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
}
// si:when-end

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // si:when-begin multi-tenant
  const [tenantName, setTenantName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  // si:when-end
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // si:when-begin multi-tenant
  const slugError =
    slug && !SLUG.test(slug) ? 'Lowercase letters, digits and dashes; must start with a letter.' : null;
  // si:when-end

  const passwordError =
    password && password.length < 8 ? 'At least 8 characters.' : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim() || undefined,
        tenantName: tenantName.trim(), // si:when multi-tenant
        slug, // si:when multi-tenant
      });
      router.replace('/dashboard');
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Create an account</h1>
        {/* si:when-begin single-tenant */}
        <p className="text-xs text-muted-foreground">
          The first account created owns the app.
        </p>
        {/* si:when-end */}
        {/* si:when-begin multi-tenant */}
        <p className="text-xs text-muted-foreground">You will own the new workspace.</p>
        {/* si:when-end */}
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>

        <Field id="name" label="Your name" hint="Optional.">
          <Input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {/* si:when-begin multi-tenant */}
        <Field id="tenantName" label="Workspace name">
          <Input
            id="tenantName"
            required
            value={tenantName}
            onChange={(e) => {
              setTenantName(e.target.value);
              // Derive the address until the user edits it themselves, then stop:
              // silently rewriting what someone typed is the worse surprise.
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>

        <Field
          id="slug"
          label="Workspace address"
          hint={slug ? `${slug}.simbkit.local` : 'Used as the subdomain.'}
          error={slugError}
        >
          <Input
            id="slug"
            required
            value={slug}
            aria-invalid={Boolean(slugError)}
            aria-describedby={slugError ? 'slug-error' : undefined}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </Field>
        {/* si:when-end */}

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

        <Field id="password" label="Password" error={passwordError}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? 'password-error' : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
