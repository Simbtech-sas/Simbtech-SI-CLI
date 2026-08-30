'use client';

import { useState } from 'react';
import { Button, Card, Field, Input } from '@/components/ui';
import { Result } from '@/components/result';
import { addServiceAction, type ActionResult } from '@/lib/actions';

const SELECT =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11';

export function AddServiceForm() {
  const [name, setName] = useState('');
  const [aggregates, setAggregates] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [database, setDatabase] = useState<'shared' | 'dedicated'>('shared');
  const [loadBalancing, setLoadBalancing] = useState<'round-robin' | 'sticky' | 'canary'>(
    'round-robin',
  );
  const [replicas, setReplicas] = useState('2');
  const [canaryWeight, setCanaryWeight] = useState('10');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await addServiceAction({
      name: name.trim(),
      aggregates: aggregates.trim() || undefined,
      repoUrl: repoUrl.trim() || undefined,
      database,
      loadBalancing,
      replicas: Number(replicas) || undefined,
      canaryWeight: Number(canaryWeight) || undefined,
    });
    setResult(res);
    setBusy(false);
    if (res.ok) setName('');
  }

  return (
    <Card className="space-y-4 p-5">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="name" label="Service name" hint="Becomes billing-api, billing-db and so on.">
          <Input
            id="name"
            required
            placeholder="billing"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          id="aggregates"
          label="Aggregates"
          hint="Comma-separated, one Kafka topic each. Defaults to the service name."
        >
          <Input
            id="aggregates"
            placeholder="billing, payment"
            value={aggregates}
            onChange={(e) => setAggregates(e.target.value)}
          />
        </Field>

        <Field id="repoUrl" label="Repository" hint="Optional — where ArgoCD reads the manifests.">
          <Input
            id="repoUrl"
            placeholder="https://github.com/acme/billing"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
        </Field>

        <Field
          id="database"
          label="Database"
          hint={
            database === 'shared'
              ? 'Its own database inside the platform cluster. Isolated logically.'
              : 'A Postgres cluster of its own: own CPU, disk, version — and two more pods to run.'
          }
        >
          <select
            id="database"
            className={SELECT}
            value={database}
            onChange={(e) => setDatabase(e.target.value as 'shared' | 'dedicated')}
          >
            <option value="shared">Shared cluster</option>
            <option value="dedicated">Dedicated cluster</option>
          </select>
        </Field>

        <Field
          id="loadBalancing"
          label="Load balancing"
          hint={
            loadBalancing === 'sticky'
              ? 'Only for in-memory session state — it defeats even balancing and loses sessions when a replica dies.'
              : loadBalancing === 'canary'
                ? 'A weighted split for a rollout, not for steady state.'
                : 'Even spread. Correct whenever any replica can serve any request.'
          }
        >
          <select
            id="loadBalancing"
            className={SELECT}
            value={loadBalancing}
            onChange={(e) =>
              setLoadBalancing(e.target.value as 'round-robin' | 'sticky' | 'canary')
            }
          >
            <option value="round-robin">Round robin</option>
            <option value="sticky">Sticky sessions</option>
            <option value="canary">Canary</option>
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="replicas" label="Replicas" hint="Two is the minimum that survives a reboot.">
            <Input
              id="replicas"
              type="number"
              min={1}
              value={replicas}
              onChange={(e) => setReplicas(e.target.value)}
            />
          </Field>

          {loadBalancing === 'canary' && (
            <Field id="canaryWeight" label="Canary traffic %">
              <Input
                id="canaryWeight"
                type="number"
                min={0}
                max={100}
                value={canaryWeight}
                onChange={(e) => setCanaryWeight(e.target.value)}
              />
            </Field>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            Generate
          </Button>
        </div>
      </form>

      <Result result={result} />
    </Card>
  );
}
