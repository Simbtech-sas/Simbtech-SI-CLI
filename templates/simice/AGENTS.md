# Working in this repository

An **on-premise desktop application** — Tauri, a local database, an offline
licence, and optionally sync with a cloud instance. It runs on a machine you do
not control and cannot log into.

## What is load-bearing here

**The licence gate.** Ed25519, verified offline, at startup and on a timer.
Never "check later", never trust the system clock alone — clock rollback is
detected on purpose. `crates/licence` has 8 tests; add one whenever you touch it.

**Sync, if enabled.** `crates/sync` holds the protocol and it mirrors a server
written in another language. Three properties are not negotiable:

- The **idempotency key is written when a change is queued**, never when it is
  sent. A retried push must replay the same key, or a timeout applies the batch
  twice.
- `baseVersion` is read **at send time** from `sync_versions`, not at queue time.
- The cursor comes from the **server's reply**, never from counting locally.

`cargo test -p sync` and `cargo test -p licence` run without a GUI toolkit. Keep
it that way: put logic in the crates, not in the Tauri app crate, so it stays
testable on any machine.

## Everything else

1. **Do not build what exists.** `si list tools` before writing an integration.
2. **Simplest thing that works.**
3. **One file, one thing.** Nothing over ~300 lines.
4. **Security.** Encrypt at rest (SQLCipher). Never log a licence key or a sync
   credential. Validate anything read from disk — on-premise means a user can
   edit the database by hand. Fail closed.
5. **Finish means tested.** `cargo test`, `pnpm typecheck`, then actually launch
   the app and use the feature. A test that fails without your change.

### Then check you did not break something else

Your new test passing says nothing about the rest. Run the **whole** suite, then
grep for every caller of anything whose signature, return shape or default you
changed — a function used in three places and fixed for one is two new bugs.

### Then go looking for the edge cases you created

Not the ones the feature is about; the ones the implementation introduced. Read
your own diff adversarially:

- **The second time** — retries and redeliveries are normal. Is it a no-op?
- **Nothing** — empty list, null, zero, a missing optional field.
- **The boundary** — the 31st, the last page, exactly the limit and one past it.
- **Concurrently** — two callers, same row, same instant.
- **The dependency down** — does it degrade, or take the process with it?
- **Hostile input** — not malformed, *crafted*.

Where the answer is "I do not know", find out. Where it is "that would be bad",
fix it. Where you decide it is acceptable, say so with the reason — a known
limit somebody chose is a decision; the same limit undocumented is an incident
with a delay on it.

State plainly what you did not do — especially anything you could not verify on
a machine without the GTK/WebKit headers.
