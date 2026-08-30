import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { Shell } from '@/components/shell';
import { getCluster } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ClusterPage() {
  const cluster = await getCluster();
  const controlPlane = cluster.nodes.filter((n) => n.role === 'control-plane').length;
  const workers = cluster.nodes.filter((n) => n.role === 'worker').length;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <PageHeader title="Cluster" subtitle={`${cluster.brand} · mesh ${cluster.wireguardCidr}`} />

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-2xl font-semibold text-foreground">{cluster.nodes.length}</p>
            <p className="text-xs text-muted-foreground">nodes</p>
          </Card>
          <Card className="p-5">
            <p className="text-2xl font-semibold text-foreground">{controlPlane}</p>
            <p className="text-xs text-muted-foreground">control plane</p>
          </Card>
          <Card className="p-5">
            <p className="text-2xl font-semibold text-foreground">{workers}</p>
            <p className="text-xs text-muted-foreground">workers</p>
          </Card>
        </div>

        {cluster.nodes.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-foreground">No nodes yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              <Link href="/nodes" className="font-medium text-primary hover:underline">
                Add the first one
              </Link>{' '}
              — it becomes the control plane.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {cluster.nodes.map((node) => (
              <div key={node.name} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-foreground">{node.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {node.ip} · mesh {node.wireguardIp}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {node.role}
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </Shell>
  );
}
