'use client';

import { useState } from 'react';
import { Button, Card, FormError, PageHeader } from '@/components/ui';
import { uploadFile, type PresignedUpload } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export default function MediaPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<PresignedUpload[]>([]);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file twice fires again
    if (!file) return;

    // Checked here for a fast, clear message; the server checks it again,
    // because a content type from a browser is a claim, not a fact.
    if (!ACCEPTED.includes(file.type)) {
      setError(`${file.type || 'That file type'} is not accepted. JPEG, PNG or WebP.`);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const result = await uploadFile(file);
      setUploaded((prev) => [result, ...prev]);
    } catch (err) {
      setError(toUserMessage(err));
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Media"
        subtitle="The browser uploads straight to storage — the bytes never touch the API."
      />

      <FormError>{error}</FormError>

      <Card className="space-y-3 p-5">
        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center transition-colors hover:bg-accent"
        >
          <span className="text-sm font-medium text-foreground">
            {busy ? 'Uploading…' : 'Choose an image'}
          </span>
          <span className="text-xs text-muted-foreground">JPEG, PNG or WebP</span>
          <input
            id="file"
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            disabled={busy}
            onChange={onChange}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          The API returns a presigned URL and the file goes to storage directly. That is why a
          large upload does not occupy a Node process for its duration.
        </p>
      </Card>

      {uploaded.length > 0 && (
        <Card className="divide-y divide-border">
          {uploaded.map((u) => (
            <div key={u.key} className="flex items-center gap-3 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u.publicUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
              />
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-foreground">{u.key}</p>
                <a
                  href={u.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs text-primary hover:underline"
                >
                  {u.publicUrl}
                </a>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
