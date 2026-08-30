'use client';

import { useState } from 'react';
import { Button, Card, Field, Input } from '@/components/ui';
import { Result } from '@/components/result';
import { addNodeAction, type ActionResult } from '@/lib/actions';

export function AddNodeForm({ hasControlPlane }: { hasControlPlane: boolean }) {
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    // The role is not a field: the first node is the control plane and every
    // one after is a worker. k3s HA needs an external datastore and a load
    // balancer, so offering a second control plane would offer a broken cluster.
    const res = await addNodeAction({ ip: ip.trim(), name: name.trim() || undefined });
    setResult(res);
    setBusy(false);
    if (res.ok) {
      setIp('');
      setName('');
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          id="ip"
          label="Public address"
          hint={
            hasControlPlane
              ? 'Joins as a worker.'
              : 'The first node becomes the control plane.'
          }
        >
          <Input
            id="ip"
            required
            placeholder="203.0.113.10"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
          />
        </Field>

        <Field id="name" label="Name" hint="Optional — derived from the brand and role if blank.">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            Add node
          </Button>
        </div>
      </form>

      <Result result={result} />
    </Card>
  );
}
