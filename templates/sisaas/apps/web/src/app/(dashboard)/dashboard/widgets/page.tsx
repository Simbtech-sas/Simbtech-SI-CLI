'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Field, FormError, Input, PageHeader, Skeleton, Textarea } from '@/components/ui';
import {
  createWidget,
  deleteWidget,
  listWidgets,
  updateWidget,
  type Widget,
  type WidgetInput,
} from '@/lib/api';
import { toUserMessage } from '@/lib/errors';

/**
 * The reference feature, end to end: list, create, edit, delete.
 *
 * Copy this page next to the module you copy from `modules/widgets`. What is
 * worth keeping is the idempotency key and the fact that every mutation reloads
 * from the server rather than patching local state — an optimistic list that
 * drifts from the database is a bug you find in support, not in testing.
 */
export default function WidgetsPage() {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Widget | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setWidgets(await listWidgets());
      setError(null);
    } catch (err) {
      setError(toUserMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(w: Widget) {
    if (!confirm(`Delete “${w.name}”?`)) return;
    try {
      await deleteWidget(w.id);
      await load();
    } catch (err) {
      setError(toUserMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Widgets" subtitle="The example feature module, wired end to end.">
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          New widget
        </Button>
      </PageHeader>

      <FormError>{error}</FormError>

      {editing && (
        <WidgetForm
          widget={editing === 'new' ? null : editing}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {widgets === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : widgets.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-foreground">No widgets yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one to see the outbox publish a `WidgetCreated` event.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {widgets.map((w) => (
            <li key={w.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{w.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {w.description || 'No description'} · qty {w.quantity}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(w)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void onDelete(w)}>
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WidgetForm({
  widget,
  onDone,
  onCancel,
}: {
  widget: Widget | null;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(widget?.name ?? '');
  const [description, setDescription] = useState(widget?.description ?? '');
  const [quantity, setQuantity] = useState(String(widget?.quantity ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One key for this form, not one per submit. A create that times out and is
  // retried has to present the SAME key, or the server makes a second widget.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const input: WidgetInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      quantity: Number(quantity) || 0,
    };
    try {
      if (widget) await updateWidget(widget.id, input);
      else await createWidget(input, idempotencyKey);
      await onDone();
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>

        <Field id="w-name" label="Name">
          <Input id="w-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field id="w-description" label="Description" hint="Optional.">
          <Textarea
            id="w-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field id="w-quantity" label="Quantity">
          <Input
            id="w-quantity"
            type="number"
            min={0}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {widget ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
