# Working in this repository

A **Expo / React Native** mobile app that talks to a SiSAAS backend.

## The part that is easy to get wrong

**This app has no cookie jar.** It sends `X-Client-Type: native`, and the API
returns the refresh token in the response body instead of an httpOnly cookie.
Do not "simplify" that away — a browser must never receive the refresh token in
a body, and this app can never receive it any other way. Both halves are load-bearing.

Tokens live in **SecureStore**, never AsyncStorage — AsyncStorage is plain text on a rooted device.

**Never log a token, a password or an email address.** A mobile log is written
to a device you do not control and is read by anything with log access.

The API base URL is an environment variable, never a constant. Point it at your
machine, not at production, while developing.

## Everything else

1. **Do not build what exists.** `si list tools` before writing an integration,
   and check the backend — most features belong there, not in three mobile apps.
2. **Simplest thing that works.** No abstraction for one screen.
3. **One file, one thing.** A feature is a directory. Nothing over ~300 lines.
4. **Security.** Validate anything from the network before rendering it.
   Certificate pinning if you handle payments. Fail closed.
5. **Finish means tested.** pnpm typecheck, then run it on a device or simulator — actually tap through the flow. Leave a test
   that fails without your change.

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

State plainly what you did not do, especially anything you could not test on a
real device.
