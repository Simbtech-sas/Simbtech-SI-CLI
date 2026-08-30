# Audit log

Append-only, tamper-evident, and **write-ahead**.

```bash
pnpm infra:up && pnpm db:migrate
pnpm verify:audit      # proves the guarantees against a real Postgres
pnpm test              # 18 unit tests, including tamper detection
```

## Write-ahead: record the attempt, not just the success

<!-- si:when-begin multi-tenant -->
```ts
// The intent is durable BEFORE the work runs, and survives its rollback.
await audit.around(tenantId, { action: 'invoice.void', targetId: id }, async () => {
  await this.invoices.void(tenantId, id);
});
```
<!-- si:when-end -->
<!-- si:when-begin single-tenant -->
```ts
// The intent is durable BEFORE the work runs, and survives its rollback.
await audit.around({ action: 'invoice.void', targetId: id }, async () => {
  await this.invoices.void(id);
});
```
<!-- si:when-end -->

`around()` writes `intent`, runs the work, then writes `committed` or `failed`.

Both entries go on a **separate connection** from the operation. That is the
whole point: an audit row written inside the operation's own transaction
disappears when that transaction rolls back, so a failed — or malicious —
attempt leaves no trace at all. What you want from an audit log is precisely the
record of the attempt.

An `intent` with no matching outcome is therefore meaningful on its own: it means
a crash, a rollback, or a process killed mid-operation. Query for them.

For a completed fact with no separate intent, `recordTenantEvent()` appends a
single `event` entry to the same chain.

## Tamper evidence: the hash chain

Every row carries `hash = sha256(prev_hash ‖ canonical content)`. Editing any row
changes its hash, which breaks the `prev_hash` of the next row, and so on to the
end — so a single edit is detectable **without keeping a second copy of the data**.

`verifyTenantChain()` recomputes the whole chain and reports the first `seq` that
does not reconcile, distinguishing a `hash-mismatch` (content edited) from a
`broken-link` (row removed, inserted or reordered).

Ordering is by `seq`, a bigserial — not by `created_at`, which is ambiguous the
moment two entries land in the same millisecond.

### The honest limit

An attacker who can rewrite **every** row produces a chain that verifies
perfectly. Detecting that needs the head hash stored somewhere they do not
control:

```ts
const head = await audit.headHash(tenantId);   // publish this daily <!-- si:when multi-tenant -->
const head = await audit.headHash();           // publish this daily <!-- si:when single-tenant -->
```

Send it to a log aggregator, a second database, or a signed receipt. Without an
external anchor, the chain proves internal consistency and nothing more. That is
a property of every hash chain, not a shortcoming of this one — but it is the
step people skip.

## Append-only: enforced, not assumed

- A database trigger raises on `UPDATE` and `DELETE`, **including for the table
  owner**.
- The runtime role is granted `SELECT, INSERT` only.

Corrections are new entries, never edits to old ones. `pnpm verify:audit` fails
if either trigger is missing or the grants widen — confirmed by dropping a
trigger and watching it fail.

## Not the same thing as Postgres WAL

Postgres has its own write-ahead log, for crash recovery and replication. The
platform's CloudNativePG cluster archives it for point-in-time recovery, and
Debezium reads it to publish outbox events.

This is a different mechanism at the application level: durable evidence of what
was attempted, in a table you can query and hand to an auditor.
