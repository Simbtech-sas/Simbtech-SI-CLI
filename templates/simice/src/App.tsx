import { useEffect, useState } from 'react';
import { LicenceGate } from './LicenceGate';
import { deploymentMode, licenceStatus, type LicenceReport } from './licence';

function Home() {
  const [report, setReport] = useState<LicenceReport>();
  const [mode, setMode] = useState<string>();

  useEffect(() => {
    void licenceStatus().then(setReport);
    void deploymentMode().then(setMode);
  }, []);

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-10">
      <h1 className="text-3xl font-bold">Simbkit</h1>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-neutral-500">Licensed to</dt>
        <dd>{report?.customer ?? '—'}</dd>
        <dt className="text-neutral-500">Days remaining</dt>
        <dd>{report?.daysRemaining ?? '—'}</dd>
        <dt className="text-neutral-500">Deployment mode</dt>
        <dd>{mode ?? '—'}</dd>
        <dt className="text-neutral-500">Features</dt>
        <dd>{report?.features.join(', ') || 'none'}</dd>
      </dl>
      <p className="pt-4 text-sm text-neutral-500">
        Replace this screen with your application. The licence gate around it stays.
      </p>
    </main>
  );
}

export function App() {
  return (
    <LicenceGate>
      <Home />
    </LicenceGate>
  );
}
