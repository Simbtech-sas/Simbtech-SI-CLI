# Working in this repository

The **infrastructure control plane**. Code here provisions machines, writes
GitOps manifests and holds cluster credentials. A mistake here is not a bug in a
feature — it is an outage across every service at once.

## Before you touch anything

- **Generated manifests are generated.** Edit the generator in
  `apps/control-plane/src/services/`, never the YAML it produced — the next
  `service add` will disagree with what is running.
- **No credential is ever written to git.** The pattern is a `secret-bootstrap`
  Job that generates a random secret in-cluster and does nothing on every run
  after. `bash scripts/verify-security.sh` fails the build on a literal one.
- **Every reference follows the same choice.** A service on a dedicated database
  cluster whose Debezium still points at the shared one tails a WAL that never
  contains its outbox. Nothing errors; no event ever arrives.
- **Destructive operations ask first.** Re-running the network bootstrap flaps
  the WireGuard mesh fleet-wide. Say so before doing it, not after.

## Everything else

1. **Do not build what exists.** `si list tools` — 40 entries deploy with one
   command and a generated database.
2. **Simplest thing that works.** The reference this replaced kept three
   index-aligned shell arrays; that is the failure mode to avoid.
3. **One file, one thing.** Nothing over ~300 lines.
4. **Finish means tested.** `npm test` in `apps/control-plane` — 41 tests, and
   they assert the generated YAML parses and carries no plaintext credential.
   Add one that fails without your change. Cluster operations that need real
   hardware: say plainly that you could not verify them.

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

State plainly what you did not do.
