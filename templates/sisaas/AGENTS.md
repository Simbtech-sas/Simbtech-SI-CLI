# Working in this repository

You are an AI agent with write access to a codebase that will hold other
people's money and other people's personal data. Read this before your first
edit. It is not style advice — most of it is load-bearing, and the parts that
look pedantic are the ones that caused an incident somewhere.

Every rule below ends with *why*. If a rule ever conflicts with what the code
plainly needs, follow the code and say so — but say so, out loud, rather than
quietly deciding the rule was decorative.

---

## 1. Do not build what exists

**Before writing a feature, look for it.** In this order:

```bash
si list features          # written for this stack: auth reset, billing, sync…
si list tools             # 40 vetted open-source services, wired by one command
si add <id>               # deps, compose, env, module registration — all of it
```

There is already a payment port with two providers, a subscription engine with
dunning, an audit log with a hash chain, a webhook bridge, an outbox, RLS
tenancy, presigned uploads and a licence system. Re-implementing any of them
produces a second, worse copy that nobody maintains.

If it is not here, look for a **well-maintained open-source project** — check the
star count, the last commit date, and the licence before proposing it. A
dependency added today is a dependency somebody patches at 3am in two years.

Say what you found and what you chose. "I could not find one" is an acceptable
answer only after you looked.

## 2. The simplest thing that works

Stop at the first approach that holds:

1. Does this need to exist at all? Speculative need is not need.
2. Is it already in this codebase? Reuse it.
3. Does the standard library do it? Use that.
4. Does a platform feature cover it — a database constraint instead of
   application code, CSS instead of JavaScript?
5. Is an already-installed dependency enough?
6. Can it be one line?
7. Only then: the smallest code that works.

No interface with one implementation. No factory for one product. No
configuration for a value that never changes. No abstraction "for later" —
later can build it, with the benefit of knowing what it needed.

When you deliberately take a shortcut, mark it and name the ceiling:

```ts
// ponytail: in-memory map, fine to ~10k entries. Redis if it outgrows one process.
```

## 3. One file, one thing

- **A feature is a directory**, not a file that grew. `modules/<feature>/` with
  `domain/`, `application/`, `infrastructure/`, `interface/`.
- **A file exports one main thing.** If you cannot name a file after what it
  does, it does more than one thing.
- **Layers point inward.** `interface` may import `application`; `domain`
  imports nothing from the others. A domain rule that reaches for a database is
  a rule you cannot test.
- **No file over ~300 lines.** Not a style rule: past that, nobody reads the
  whole thing before changing part of it.
- **Delete rather than comment out.** Git remembers; commented code does not
  say whether it is a plan or a corpse.

Follow the shape of the code already there. `modules/widgets/` is the worked
example — read it before adding a module.

## 4. Security is not negotiable

Be paranoid here, deliberately and disproportionately. Everything in this list
is either a rule this codebase already enforces or a hole it was closed against.

**Tenancy**
- The tenant id comes from the **verified token**. Never from a body, a query
  string, a header, or a webhook payload. A caller that can name its own tenant
  can name someone else's.
- Every tenant-scoped table gets `ENABLE` **and** `FORCE ROW LEVEL SECURITY`.
  Without `FORCE`, the owner role bypasses the policy and the isolation is
  decorative. `pnpm verify:rls` proves it against a live database.
- Reads and writes go through `runInTenantContext`. It sets the GUC
  transaction-locally, so a pooled connection cannot leak context to whoever
  checks it out next.

**Secrets and credentials**
- Nothing secret in git. Not in a compose file, not in a fixture, not "just for
  now". `pnpm verify:security` fails the build on a committed credential.
- Compare secrets in constant time, and **check the length first** —
  `timingSafeEqual` throws on a mismatch, and an unhandled throw in a webhook
  route is a denial-of-service lever aimed at your own pipeline.

**Webhooks and tokens**
- Verify signatures against the **raw body**. Re-serialising changes key order
  and whitespace, the MAC stops matching, and the usual "fix" is to stop
  verifying.
- Pin the JWT algorithm. Trusting a token's own `alg` is how `alg: none` works.
- A signed redirect is **not** proof of payment. Confirm through the provider's
  API before marking anything paid.
- Assume every webhook arrives twice. Idempotency is a database constraint, not
  a hope.

**Money**
- Decimal strings and integer minor units. Never a float. `0.1 + 0.2` is not
  `0.3`, and an invoice one centime out is an invoice a customer disputes.
- Refuse a fraction in a currency that has no minor unit rather than rounding
  it. Rounding is a decision the merchant did not make.

**Input and output**
- Validate at the boundary with the zod schemas already in `interface/dto`.
- Never log a token, a password, a full card number, or an email address.
- Fail **closed**. If you cannot verify something, refuse it. An unverifiable
  request is a hostile one, not a probably-fine one.

If you are unsure whether something is a security decision, treat it as one and
say why in the pull request.

## 5. Finish means tested

A feature is not done when it compiles. It is done when you have watched it work.

```bash
pnpm typecheck && pnpm test     # fast; run constantly
pnpm --filter '*/server' exec nest build   # tsc --noEmit does NOT catch emit errors
si start dev                    # the whole stack, migrated, running
pnpm test:e2e                   # integration, needs the stack up
pnpm verify:security            # committed secrets, tenant handling
pnpm verify:rls                 # isolation, proven against a real database
pnpm verify:audit               # the audit chain
```

**After every feature, smoke-test it end to end** — actually call the endpoint,
actually read the row, actually see the email in Mailpit at
`http://localhost:8025`. Unit tests passing while the application cannot start
is a real state this repository has been in.

**Write the test that fails without your change.** A test that passes before and
after proves nothing. For anything non-trivial — a branch, a loop, a parser, a
money path, a security check — leave behind the smallest runnable thing that
breaks if the logic breaks.

### Then check you did not break something else

Your new test passing says nothing about the rest. Run **everything**, not the
file you were working in:

```bash
pnpm typecheck && pnpm test && pnpm --filter '*/server' exec nest build
pnpm verify:security && pnpm verify:rls && pnpm verify:audit
```

Then look at what you touched:

- **Who else calls this?** Grep for every caller before you accept a changed
  signature, a changed return shape, or a new thrown error. A function used in
  three places and fixed for one is two new bugs.
- **Did a default change?** A default is an answer given to everyone who did not
  ask. Changing one silently changes behaviour for every existing caller.
- **Did a shared file move?** An anchor, a module registration, a compose port,
  an env key — those are shared surfaces, and the breakage lands somewhere you
  are not looking.
- **Does it still start?** `si start dev`. A DI graph that compiles and cannot
  boot is a real failure mode here, and only starting the process finds it.

### Then go looking for the edge cases you just created

Not the ones the feature is about — the ones the *implementation* introduced.
Read your own diff adversarially and answer these out loud:

- **What happens the second time?** Retries and redeliveries are normal, not
  exceptional. Every webhook arrives twice; every timed-out request gets sent
  again. Is the second one a no-op, or a second charge?
- **What happens with nothing?** Empty list, empty string, null, zero, a missing
  optional field, a user with no tenant. `[0]` on an empty array is `undefined`,
  and it travels a long way before it fails.
- **What happens at the boundary?** The 31st of the month. The last page. Exactly
  the limit, and one past it. Midnight in another timezone. Zero, and negative.
- **What happens concurrently?** Two requests for the same row at the same
  instant. Does the guard hold, or did you read-then-write where one conditional
  `UPDATE` was needed?
- **What happens when the dependency is down?** Slow, unreachable, or returning
  something that is not JSON. Does it degrade, or take the process with it? An
  optional tool must never stop the app from booting.
- **What happens with hostile input?** Not malformed — *crafted*. A tenant id in
  a body, a signature of the wrong length, a payload of 10MB, a name that is
  markup.
- **What did I assume that is only true today?** A tag that exists, a field a
  vendor has not renamed, a clock that moves forward.

Where an answer is "I do not know", find out. Where it is "that would be bad",
write the test and fix it. Where you decide it is acceptable, **say so in the
pull request** with the reason — a known limit somebody chose is a decision; the
same limit undocumented is an incident waiting for a date.

## 6. Events, not reaching into each other

- Announce through the **outbox**, in the same transaction as the change:
  `outbox.publish(tx, SomeEvent, {...})`. Never `producer.send()`. A crash
  between the write and the publish is the bug this prevents.
- React by registering a handler in `EventRegistry`. Handlers run inside the
  transaction that marks the event processed.
- One service never reads another's tables. That is what the events are for.

## 7. Before you open a pull request

- [ ] Did I check whether this already exists? What did I find?
- [ ] Is this the simplest approach that works, or the first one I thought of?
- [ ] One file, one thing — would a reviewer find it where they expect?
- [ ] Every security rule above, considered rather than skipped.
- [ ] Built (`nest build`), started (`si start dev`), smoke-tested by hand.
- [ ] A test that fails without this change.
- [ ] Full suite run, not just my file — nothing else broke.
- [ ] Every caller of anything I changed, checked.
- [ ] Edge cases I created, listed and answered: second call, empty, boundary,
      concurrent, dependency down, hostile input.
- [ ] No secret, token or personal data in the diff or the logs.

State plainly what you did **not** do. An unfinished edge case you name is a
task; one you hide is a bug with a delay on it.
