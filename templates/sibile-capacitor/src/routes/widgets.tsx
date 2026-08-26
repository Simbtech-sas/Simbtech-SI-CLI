import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { widgets } from '../api/widgets';
import { useSession } from '../store/session';

/** All four states — loading, error, empty, populated. Copy the whole thing. */
export function Widgets() {
  const navigate = useNavigate();
  const signOut = useSession((s) => s.signOut);
  const query = useQuery({ queryKey: ['widgets'], queryFn: widgets.list });

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Widgets</h1>
        <button
          onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}
          className="text-sm font-medium text-brand"
        >
          Sign out
        </button>
      </header>

      {query.isPending ? <p className="py-16 text-center text-neutral-500">Loading…</p> : null}

      {query.isError ? (
        <div className="space-y-2 py-16 text-center">
          <p>Could not load widgets.</p>
          <button onClick={() => void query.refetch()} className="text-sm font-medium text-brand">
            Try again
          </button>
        </div>
      ) : null}

      {query.data?.length === 0 ? (
        <p className="py-16 text-center text-neutral-500">No widgets yet.</p>
      ) : null}

      <ul className="space-y-3">
        {query.data?.map((w) => (
          <li key={w.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-semibold">{w.name}</p>
            {w.description ? <p className="text-sm text-neutral-500">{w.description}</p> : null}
            <p className="mt-1 text-xs text-neutral-400">Quantity {w.quantity}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
