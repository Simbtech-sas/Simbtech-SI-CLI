# Working in this repository

A **fully local** application. Everything the rules below protect follows from
that one fact.

## The rule that defines this project

**Nothing may leave the machine.** No fetch, no XHR, no WebSocket, no beacon, no
CDN font, no analytics, no crash reporter, no CDN script tag.

This is enforced, not requested:

```bash
node scripts/verify-offline.mjs     # fails the build on any egress
pnpm verify:security
```

The CSP blocks outbound requests, and the check fails CI if one appears. If you
find yourself wanting a network call, the answer is a local alternative or no
feature. Users chose this build because their data does not go anywhere.

Persistence is **PGlite / SQLite in the browser or the Tauri shell**. Assets are
bundled, never linked.

## Everything else

1. **Do not build what exists.** `si list tools` — only local-first entries are
   offered here, and that is deliberate.
2. **Simplest thing that works.** No abstraction for one caller.
3. **One file, one thing.** Nothing over ~300 lines.
4. **Security.** No secret in git. Validate input at the boundary — a local app
   still parses files a user did not write. Never log personal data; on a local
   app the log file sits next to the data it is describing.
5. **Finish means tested.** `pnpm build`, run it, and **add a case to
   `scripts/offline-rules.test.mjs` whenever you touch anything that could
   reach the network.** A test that fails without your change, every time.

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
