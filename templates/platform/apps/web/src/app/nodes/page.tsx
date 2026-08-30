import { Card, PageHeader } from '@/components/ui';
import { Shell } from '@/components/shell';
import { getCluster } from '@/lib/actions';
import { AddNodeForm } from './add-node-form';

export const dynamic = 'force-dynamic';

export default async function NodesPage() {
  const cluster = await getCluster();

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <PageHeader
          title="Nodes"
          subtitle="Adding one allocates its mesh address and rewrites cluster/inventory.env."
        />

        {cluster.warning && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {cluster.warning}
          </p>
        )}

        <AddNodeForm hasControlPlane={cluster.nodes.some((n) => n.role === 'control-plane')} />

        {cluster.nodes.length > 0 && (
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
