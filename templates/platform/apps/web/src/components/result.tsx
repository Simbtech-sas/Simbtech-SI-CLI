import { Card } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';

/** What an action did, or why it refused. */
export function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400"
      >
        {result.error}
      </p>
    );
  }
  return (
    <Card className="space-y-2 p-4" role="status">
      <p className="text-sm text-foreground">{result.message}</p>
      {result.detail && result.detail.length > 0 && (
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {result.detail.join('\n')}
        </pre>
      )}
    </Card>
  );
}
