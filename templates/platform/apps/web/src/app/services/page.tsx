import { PageHeader } from '@/components/ui';
import { Shell } from '@/components/shell';
import { AddServiceForm } from './add-service-form';

export default function ServicesPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <PageHeader
          title="Add a service"
          subtitle="Writes the ArgoCD Application, the Kafka topics, the database and the routing into gitops/."
        />
        <AddServiceForm />
        <p className="text-xs text-muted-foreground">
          Nothing is deployed here. The files land in the repo; ArgoCD applies them once you commit
          and push — which is what makes the cluster&apos;s state reviewable.
        </p>
      </div>
    </Shell>
  );
}
