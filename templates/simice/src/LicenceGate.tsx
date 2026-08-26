import { useEffect, useState, type ReactNode } from 'react';
import { installLicence, licenceStatus, machineFingerprint, type LicenceReport } from './licence';

/**
 * Nothing renders until the licence is checked, and an expired licence never
 * reaches the app. The Rust side re-checks on a timer too — an install left
 * running for months must eventually notice.
 */
export function LicenceGate({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<LicenceReport>();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void licenceStatus().then(setReport);
    void machineFingerprint().then(setFingerprint);
    // Re-check hourly so a licence that lapses mid-session is caught.
    const timer = setInterval(() => void licenceStatus().then(setReport), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (!report) return <p className="p-8 text-neutral-500">Checking licence…</p>;

  if (report.state === 'denied') {
    return (
      <main className="mx-auto max-w-xl space-y-5 p-10">
        <h1 className="text-2xl font-bold">Licence required</h1>
        <p className="text-red-600">{report.message}</p>

        <label className="block space-y-2">
          <span className="text-sm font-medium">Paste your licence key</span>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full rounded-lg border border-neutral-300 p-3 font-mono text-xs"
          />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          disabled={busy || token.trim().length === 0}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            installLicence(token.trim())
              .then(setReport)
              .catch((e: unknown) => setError(String(e)))
              .finally(() => setBusy(false));
          }}
          className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Activate'}
        </button>

        {fingerprint ? (
          <p className="pt-4 text-xs text-neutral-500">
            This machine's fingerprint — send it to your supplier for a machine-bound licence:
            <br />
            <code className="font-mono">{fingerprint}</code>
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <>
      {report.state === 'grace' ? (
        <div role="alert" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          {report.message}
        </div>
      ) : null}
      {children}
    </>
  );
}
