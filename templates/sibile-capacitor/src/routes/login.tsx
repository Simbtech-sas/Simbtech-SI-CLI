import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';

export function Login() {
  const navigate = useNavigate();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      void navigate('/widgets', { replace: true });
    } catch (err) {
      // One message for both failures — naming which half was wrong turns this
      // into an account-enumeration oracle.
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Incorrect email or password'
          : 'Could not sign in. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-3xl font-bold">Simbkit</h1>
          <p className="text-neutral-500">Sign in to continue</p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 w-full rounded-xl border border-neutral-300 px-4 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error !== undefined}
            className="h-12 w-full rounded-xl border border-neutral-300 px-4 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="h-12 w-full rounded-xl bg-brand font-semibold text-brand-fg disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
