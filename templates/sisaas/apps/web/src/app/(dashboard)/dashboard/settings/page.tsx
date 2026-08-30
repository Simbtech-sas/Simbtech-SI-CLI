'use client';

import { useState } from 'react';
import { Button, Card, Field, FormError, Input, PageHeader } from '@/components/ui';
import { changePassword, updateProfile } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

export default function SettingsPage() {
  // The shell already resolved it; /auth/profile would be the same answer twice.
  const session = useSession();

  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Settings" subtitle="Your profile and password." />
      <ProfileForm profile={session.user} />
      <PasswordForm />
    </div>
  );
}

type Profile = { id: string; email: string; name: string | null };

function ProfileForm({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.name ?? '');
  const [state, setState] = useState<{ error?: string | null; saved?: boolean; busy?: boolean }>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await updateProfile({ name: name.trim() });
      setState({ saved: true });
    } catch (err) {
      setState({ error: toUserMessage(err) });
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-foreground">Profile</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{state.error}</FormError>

        <Field id="p-email" label="Email" hint="Changing this is not wired up yet.">
          <Input id="p-email" value={profile.email} disabled readOnly />
        </Field>

        <Field id="p-name" label="Name">
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="flex items-center justify-end gap-3">
          {state.saved && <span className="text-xs text-muted-foreground">Saved.</span>}
          <Button type="submit" variant="primary" loading={state.busy}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [state, setState] = useState<{ error?: string | null; saved?: boolean; busy?: boolean }>({});

  const tooShort = next && next.length < 8 ? 'At least 8 characters.' : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await changePassword(current, next);
      // Clear both: leaving a password sitting in a form field is the kind of
      // thing that ends up in a screenshot.
      setCurrent('');
      setNext('');
      setState({ saved: true });
    } catch (err) {
      setState({ error: toUserMessage(err) });
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-foreground">Password</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{state.error}</FormError>

        <Field id="pw-current" label="Current password">
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>

        <Field id="pw-next" label="New password" error={tooShort}>
          <Input
            id="pw-next"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            aria-invalid={Boolean(tooShort)}
            aria-describedby={tooShort ? 'pw-next-error' : undefined}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>

        <div className="flex items-center justify-end gap-3">
          {state.saved && <span className="text-xs text-muted-foreground">Password changed.</span>}
          <Button type="submit" variant="primary" loading={state.busy}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
