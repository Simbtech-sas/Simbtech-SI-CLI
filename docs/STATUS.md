# Build status

Tracks the milestones in the approved plan. Only "done" means verified by a
command that fails when the thing breaks.

| # | Milestone | State |
|---|---|---|
| 1 | Monorepo + `packages/core` + `si` shell | **done** |
| 2 | SiSAAS template + `si new` | **done** |
| 3 | `packages/nest` generator (`si scaffold`) | **done** |
| 4 | `packages/tools` registry + `si add` | **done** (34 tools) |
| 5 | SiBILE ×3 (RN / Flutter / Capacitor) | **done** |
| 6 | SiMICE (Tauri v2, licensing, LAN/sync) | **done** |
| 7 | SiCAL (fully local, no network) | **done** |
| 8 | platform flavor (k3s, CNPG, Kafka, VPS UI) | **done** (cluster ops untested against real hardware) |
| 9 | Publish `@simbtech/si` | **ready** — packs, installs and runs from tarballs; `pnpm release <version>` publishes |

## Compliance reporting

```
si compliance                 report this project against a framework
si compliance --write         also write docs/compliance/<id>.md
si compliance --strict        exit non-zero on anything missing (for CI)
```

Ships one framework: the security, sovereignty and traceability rigour a **state
information system** is held to — and anyone else who wants that bar. 109
requirements across security, IAM, cryptography, data protection and
sovereignty, auditability, ACID guarantees, architecture, performance,
availability, continuity, observability and DevOps.

**Every line is evidence or the absence of it** — a path the tool found, or a
statement that it found nothing. A requirement declared checkable whose probe
finds nothing reports **missing**, not satisfied; a test asserts exactly that by
running the whole framework against an empty directory and requiring every
code-level item to come back missing. A matrix that grades itself is not a
matrix.

The organisational count is printed as prominently as the satisfied one:

```
29 satisfied   20 partial   26 missing   23 organisational   11 in the ops repo

23 of 109 cannot be satisfied by code. Plans, tests,
contracts and sign-off are the other half, and no command produces them.
```

That honesty is the feature. A tool that reported continuity plans and
penetration tests as green would produce a clean sheet for a bid the
organisation would fail.

Its first run found a real gap: scaffolded projects shipped **no CI at all**.
They now get typecheck, lint, test, `nest build`, `verify:security`, `pnpm
audit`, and a second job proving RLS isolation against a real Postgres as the
owner role.

## Rules for AI agents

Every flavor ships `AGENTS.md`, plus a one-paragraph `CLAUDE.md` and
`.clinerules` that point at it.

**One file of substance, not five copies.** Cursor, Codex, Antigravity, Cline
and 30+ others read `AGENTS.md` natively; Claude Code reads `CLAUDE.md`. Five
copies of a security rule where one is stale is worse than one file, so the
others are pointers.

The rules are specific to this codebase, not generic advice — they name the
actual commands, and a test fails if they cite a script the template does not
ship or a `pnpm` task that does not exist. Rules an agent tries and finds broken
are rules it learns to ignore.

What they cover, each with its reason attached:

- **Do not build what exists** — `si list features`, `si list tools`, `si add`,
  then a well-maintained open-source project, checked for stars, last commit and
  licence. Say what you found.
- **The simplest thing that works** — a seven-rung ladder, stop at the first that
  holds. No abstraction for one caller, none "for later".
- **One file, one thing** — a feature is a directory with domain/application/
  infrastructure/interface; layers point inward; nothing over ~300 lines.
- **Security, disproportionately** — tenant id from the verified token only,
  `FORCE` RLS, raw-body signature checks, constant-time compare *with a length
  guard*, algorithm pinning, money in decimals, fail closed.
- **Finish means tested** — `nest build` (not just `tsc --noEmit`), `si start
  dev`, smoke-test by hand, and a test that fails without the change.

Each flavor gets the rules that matter to it: SiCAL leads with "nothing may leave
the machine" and the check that enforces it; SiMICE with the licence gate and the
three sync invariants; the mobile ones with why `X-Client-Type: native` exists and
must not be simplified away; platform with "generated manifests are generated".

## Using it

```
si new my-app          scaffold a project
si compliance --fix    install what a framework requires and you lack
si api billing         add another service to it
si add livekit blnk    wire in more tools
si list tools          browse the registry
si scaffold Product    generate a feature module
si doctor              check the local toolchain
```

`si new` asks **four** questions:

```
  What are you building?      → SiSAAS
  Single deployable or…?      → a service per domain
  Where do services keep data? → one cluster, a database each
  Open-source tools           → [grouped, nothing preselected]

  Defaults    auth Built-in · storage MinIO · uploads Presigned · …
  Change any of these?        → no
```

It used to ask ten. What changed:

- **The brand is derived from the directory.** It is the npm scope, the Postgres
  roles and the dev domain — so it matters, and `my-app` → `myapp` is right
  almost every time. A question whose answer is already on screen is one to
  delete. `--brand` still overrides.
- **Seven infrastructure choices became one confirm.** Each has a defensible
  default, and asking somebody to pick an observability stack before they have
  written a line is not a decision, it is an obstacle. Saying yes to "change any
  of these?" lets you pick *which* to revisit rather than walking all seven.
- **The data question is conditional.** With one app there is one database and
  nothing to decide, so it is not asked.
- **Tools are one grouped multi-select**, nothing preselected: a tool you did not
  ask for is a container you will not run and an env var you will not set.

Every answer is still a flag, so CI never sees a prompt:
`si new app -f sisaas -p service --data per-service --tool livekit blnk -y`.

### Running it

```
si start dev        everything up, migrated, app running
si stop             stack down (--volumes drops the data too)
```

The order is the whole value. By hand it is `infra:up`, wait for Postgres to
actually *accept a connection* rather than merely have a container, copy
`.env.example`, migrate, then start — and getting it wrong produces a connection
error that reads like a bug in the app.

```
http://localhost:8080   the API              8090   through the gateway
http://localhost:3100   the web app          8091   Traefik dashboard
http://localhost:8025   Mailpit              8085   Redpanda console
```

**Traefik runs locally too**, and it is not decorative: `pnpm dev` runs the app
on the host, so a file provider routes the gateway to it. One origin means
cookies, CORS and redirects behave in development the way they will behind the
cluster's ingress — rather than working on `localhost:3100` and breaking the
first time they meet a real domain. `--scale server=3` exercises the balancer,
which is where you find out something was holding state in memory.

This is **docker compose, not the cluster.** The platform runs k3s and Argo, and
reproducing that locally costs minutes per iteration; here the app runs on the
host against containerised dependencies and a save reloads in a second. What you
do not get is the cluster's own behaviour — ingress rules, resource limits, CNPG
failover. Those belong in the ops repo, and the number of VPS is `si node add`
there, against real machines.

### Adding a service later

`si api billing` is `si new` pointed at `services/billing`, with every answer it
can reuse taken from the parent. The root records them in `.si/project.json` at
scaffold time — brand, layout, data topology, auth — because two services that
disagree about data topology is not a choice anybody made, it is a question that
got asked twice. The built-in identity is the one thing never inherited: it would
give the service its own user store and its own token issuer, a second answer to
"who is this user".

## How to verify what exists

```bash
# CLI: 48 unit tests + 30 in the platform control plane + 9 crypto tests in the template
pnpm test && pnpm build
pnpm smoke                  # scaffolds all 7 flavors and checks each rebrands cleanly
node packages/si/dist/index.js doctor

# Scaffold a project from the local templates
SI_TEMPLATE_DIR="$PWD/templates" node packages/si/dist/index.js new /tmp/demo -f sisaas -b demo -y

# The scaffolded project builds…
cd /tmp/demo && pnpm install && pnpm typecheck

# …and its tenant isolation actually holds
cp apps/server/.env.example apps/server/.env
pnpm infra:up && pnpm db:migrate && pnpm verify:rls
```

```bash
# Generate a full feature module into a scaffolded project
cd /tmp/demo
si scaffold Product -m catalog --fields "name:string sku:string:unique price:money stock:int"
si scaffold Order   -m sales   --fields "total:money" --cqrs
pnpm typecheck          # both shapes compile
pnpm db:migrate && pnpm verify:rls
```

`verify:rls` is the one that matters. It bypasses the application entirely and
interrogates Postgres, because the database is the isolation boundary. Removing
`FORCE ROW LEVEL SECURITY` from a migration, migrating as a superuser, or widening
the CDC grant each make exactly one check fail (confirmed by doing all three).

## Adding open-source tools

```bash
si list tools                  # what applies to this project's flavor
si list tools -c finance --all
si add livekit blnk medusa     # deps, compose services, env keys, a client module
si add meilisearch --dry-run
```

30 entries across 18 categories, each a YAML file in
`packages/si-tools/registry/`. Adding a tool is adding a file — no TypeScript
changes. An entry declares dependencies, a docker-compose fragment, env keys,
Handlebars files, and where to register them; `si add` applies all of it and is
idempotent, so running it twice changes nothing.

Compose merging goes through a YAML *Document*, so the dev stack keeps its
comments and a service you have edited locally is never overwritten.

## What `si scaffold` emits

One command produces the whole vertical slice, in the SiSAAS shape:
Drizzle schema · numbered migration with `ENABLE` + `FORCE` RLS + policy · domain
types · tx-taking repository · service (or CQRS command/query handlers) with
outbox publishing · nestjs-zod DTOs · guarded controller · module — then registers
it in the schema barrel, `app.module.ts`, `worker.module.ts` and the shared events
package, and installs any package the generated code imports.

`money` is a decimal string in TypeScript and `numeric(20,4)` in Postgres at every
layer. It never becomes a float.

## Single deployable or microservices

One SiSAAS template, three shapes — chosen at `si new`, prompted if not given:

```bash
si new my-app       -f sisaas -p mono       # one app, events in-process (default)
si new identity-api -f sisaas -p identity   # owns users/tenants, ISSUES tokens
si new billing-api  -f sisaas -p service    # verifies tokens, no user records
```

`mono` runs no broker: the dev stack is 5 containers instead of 8, and events are
delivered by a poller claiming outbox rows. Publishers and handlers are byte-identical
across all three, so splitting later swaps the transport and the infrastructure —
it does not rewrite application code.

Inside a platform repo, a service is registered — or bought in — with one command:

```bash
service add billing --aggregate invoice   # from the NestJS boilerplate
service add ledger  --from blnk           # an open-source tool, as a service
service add search  --from meilisearch
```

15 of the 30 registry tools are deployable servers; the rest are client
libraries and `--from` refuses them with a pointer to `si add` instead.

**Exactly one service issues tokens.** Everything else imports `modules/auth`
(verification only, no database) rather than `modules/iam`. Permissions ride in
the token so no service needs a synchronous call to identity. `tenants` is a
local projection everywhere but identity, fed by events — which is what lets a
feature table hold a real foreign key without a cross-service join.

## A full architecture, chosen at scaffold time

`si new` asks six questions (or takes them as flags). Every group has a way out,
and `--blank` opts out of all of them.

| Choice | Options | Default |
|---|---|---|
| `--auth` | builtin · keycloak · zitadel · **none** | builtin |
| `--storage` | minio · s3 · **none** | minio |
| `--uploads` | presigned · tusd · **none** | presigned |
| `--workflows` | temporal · **none** | none |
| `--observability` | umami · posthog · openreplay · **none** | none |
| `--loadtest` | k6 · **none** | k6 |

```bash
si new my-app -f sisaas --auth keycloak --uploads tusd --workflows temporal
si new my-app -f sisaas --blank        # skeleton only, wire it yourself
```

Each option contributes features (which prune marked lines), registry tools
(installed automatically) and removals — all declared in `.si/template.json`, so
adding "use Ory instead" is a JSON entry, not a code change.

Incoherent combinations are refused with a reason rather than scaffolded:
a feature service cannot use the built-in identity (that is a second token
issuer), and `--uploads tusd --storage none` has nowhere to put the bytes.

**Testing**: Jest is configured for unit (`pnpm test`) and integration
(`pnpm test:e2e`, needs the docker stack), and k6 ships load tests with
thresholds that fail CI rather than graphs nobody reads.

## Payments and subscriptions

Two providers, and the choice is the user's — at scaffold time or later:

```bash
si new app -f sisaas --payments kpay|joonapay|both|none
si add payments-kpay          # Mobile Money, card, PayPal across 12 countries
si add payments-joonapay      # Mobile Money, cards, Wave in West Africa; plus payouts
si add subscriptions          # plans, trials, renewals, dunning
si add lago                   # or an external billing engine instead
si add killbill
```

Both sit behind one `PaymentProvider` port (`payments-core`, pulled in
automatically). Providers register themselves at boot, and `PaymentRegistry`
routes a charge **by currency and method** — refusing, rather than guessing,
when neither can settle it. Configure both and a XOF Mobile Money charge goes to
whichever declares XOF; ask for a USSD prompt and the one that can actually push
one wins.

What the port deliberately does not hide is `capabilities`. Providers differ in
ways that change behaviour, and papering over that produces an abstraction that
lies:

| | KPay | JoonaPay |
|---|---|---|
| USSD push | yes | no — hosted checkout only |
| Auto-charge | no | no |
| Methods | Mobile Money, card, PayPal | Mobile Money, card, Wave |
| Refunds | full, 7 days | none — `refund()` throws |

**KPay** covers every method the provider accepts — Mobile Money by direct USSD
prompt or hosted link, plus card and PayPal — with the mode as the merchant's
choice (`KPAY_DEFAULT_MODE`, overridable per request). Card and PayPal always
open the hosted page; there is no USSD form for them.

Three things the integration refuses to get wrong:

- **A `kpay_live_` key outside production throws at boot.** The key prefix picks
  the environment, not the URL, so nothing else would signal it.
- **Two different HMAC secrets** — the webhook signs the raw body, the gateway
  return signs `status|reference|externalId|ts`. Mixing them yields a verifier
  that accepts nothing, or everything.
- **A valid return signature is not proof of payment.** The customer controls
  their browser and can replay it; the status is confirmed through the API before
  anything is marked paid.

**JoonaPay** collects through a hosted page. Three of its own traps, each
handled rather than documented:

- **The envelope decides, not the HTTP status.** `success: false` arrives with a
  200, so a status-only check reads a failure as a success.
- **Two status vocabularies for the same payment** — `completed` over REST,
  `SUCCESS` over the webhook. Both normalise to the port's `settled` before
  anything is stored, so the same outcome cannot land in two states.
- **`expired` is not a failure.** No money moved and nothing went wrong; the
  customer simply never paid. Mapping it to `failed` sends dunning mail to
  people who were never charged, so it maps to `cancelled`.

Its `success_url` query string is **unsigned** — anyone can type it. It routes
the user; the webhook settles the order. And its published signature sample calls
`timingSafeEqual` without a length check, which throws: a one-character forged
header would return 500 instead of 401. Ours compares lengths first.

**Subscriptions** are built around a constraint card-shaped engines do not have:
**Mobile Money cannot auto-charge.** There is no card on file, so every renewal
is a request the customer approves on their phone. Hence a `pending_payment`
state and a week-long grace period, rather than an immediate jump to past_due.
Billing sits behind `BILLING_PORT`, so a card processor can replace KPay without
the lifecycle code changing — but `capabilities.autoCharge` is read, not assumed.

Suspension cuts **access** and keeps **data**. Cancellation takes effect at
period end, because the customer paid for that period.

### Reminders, invoices and receipts — over events, not method calls

Nothing in billing calls the mailer. The processor writes a fact to the outbox
and a handler turns that fact into a message:

```
dunning step ──▶ outbox ──▶ (in-process | Kafka) ──▶ handler ──▶ queued email
```

Both halves commit in **one transaction**. A mail server outage cannot roll back
a suspension, and a suspension that commits cannot lose its notification. Moving
notifications into their own service later changes where the handler file lives
and nothing else.

The reminder cadence is the dunning schedule — day 0, 2, 5, then suspend at 7 —
and `attempt` is derived from where the schedule is, not counted separately, so
a job that missed a run sends "reminder 3" rather than repeating "reminder 1".

| Event | Email |
|---|---|
| `TrialEnding` | trial ends in N days, renews at X |
| `SubscriptionPaymentRequested` | amount due, days of access left |
| `SubscriptionPaymentFailed` | why, and that we will ask again |
| `SubscriptionSuspended` | **your data has not been deleted** |
| `InvoiceIssued` | invoice, attached |
| `InvoicePaid` | receipt, attached |

`PaymentSettled` from either provider closes the loop: it settles the invoice,
which extends the period and publishes `InvoicePaid`, which sends the receipt.
Subscriptions never learn which provider paid; payments never learn that
subscriptions exist.

Every billing email carries `payUrl` **or** `ussdHint`, never assumes one: a
"Pay now" button is useless to a customer whose prompt arrives on their handset.

### Invoices and receipts

No invoice library. The maintained options are a template designer to learn
(`pdfme`), a hosted service wearing a package (`easyinvoice`), or unmaintained
(`pdf-invoice`, last published 2022) — and all of them fix the layout that tax
rules keep changing. An invoice is a table; the hard parts are the numbers and
the legal fields, which no library knows for your jurisdiction anyway.

So: an HTML document, rendered to PDF by **Gotenberg** (`si add gotenberg`),
which is already in the registry and is the renderer Chrome prints with. With no
Gotenberg configured the document is attached as **HTML rather than skipped** — a
customer with an HTML invoice is inconvenienced; a customer with none has to
email support and finance has a gap.

Totals are computed in **integer minor units**. `0.1 + 0.2` in floats is
`0.30000000000000004`, and an invoice one centime out is an invoice a customer
disputes. Zero-decimal currencies (XAF, XOF…) print without decimals, because
"5 000,00 FCFA" is wrong in the way that makes people email support.

Seller identity comes from `SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_TAX_ID`,
`SELLER_TAX_RATE`. An unset rate prints **no tax line at all**, rather than 0%.

## One database per service, or one cluster per service

Two different things, and the second is the choice:

- **A database of its own** is already the floor. `si service add billing` creates
  a `billing` database with a `billing` owner role. No service can read another's
  tables — that is what the events are for.
- **A cluster of its own** is what `--database dedicated` adds.

```bash
si service add billing                          # shared cluster (default)
si service add billing --database dedicated     # its own Postgres cluster
```

| | Shared cluster | `--database dedicated` |
|---|---|---|
| Isolation | database + owner role | + CPU, memory, disk, version |
| A runaway query | starves every service | starves one |
| Postgres upgrade | one window for everyone | on its own schedule |
| Backups | one destination, one retention | its own prefix and retention |
| WAL | **one log, every service's slot** | its own |
| Cost | 3 pods total | +2 pods, +1 thing to upgrade |

That WAL row is the one that bites in practice. On a shared cluster every
service's Debezium slot sits on one write-ahead log, so **a stalled consumer
retains WAL for everybody** and can fill the disk under services that are working
fine. A dedicated cluster contains that to one service.

The choice is made once and everything follows it — the `Database` CR, the
credentials Secret, and Debezium's connection. That last one matters: point
Debezium at the shared cluster while the tables live in a dedicated one and it
tails a WAL that never contains this service's outbox. Nothing errors; no event
ever arrives. A test asserts no generated file for a dedicated service mentions
the shared cluster.

Services read their host from the `<name>-db` Secret rather than composing
`<brand>-pg-rw` themselves, so switching a service between the two is a flag, not
an edit to its deployment.

Default stays **shared**: one operator handling failover, backups and PITR for
everything beats N single-instance databases, none replicated, none backed up.
Reach for `dedicated` per service, deliberately — not as a house style.

## Mobile against the backend

The three SiBILE stacks and the SiSAAS API were written correctly for their own
worlds and had never been run against each other. One flow was broken three ways:

| | Server did | Client expected |
|---|---|---|
| login | `Set-Cookie: refresh_token` (httpOnly) | `refreshToken` in the body |
| refresh | read the **cookie** only | sent `{refreshToken}` in the **body** |
| refresh reply | `{accessToken}` | `{accessToken, refreshToken}` |

So every mobile app stored `undefined`, and the user was logged out the moment
the access token expired. A native app has no cookie jar; it has Keychain and
Keystore.

The fix is one server change for all three clients: a client that sends
`X-Client-Type: native` gets the refresh token in the body and may send it back
in the body. A browser sends no such header and keeps the httpOnly cookie —
which is the only thing keeping that token away from XSS. Not user-agent
sniffing: that is a guess about a security decision, and it is wrong on every
embedded webview.

Verified against a running API: browser register returns **no** `refreshToken`
in the body; native register returns one, `/auth/me` accepts the access token,
refresh rotates, the rotated token works, and the old one is **401** — reuse
detection still fires.

## Kafka and Temporal

They are not alternatives, and choosing between them is the wrong question:

| | Kafka | Temporal |
|---|---|---|
| Shape | fanout — "this happened" | orchestration — one process, many steps |
| Time | now | days, with durable timers |
| Failure | consumer retries one message | the whole process resumes where it was |
| State | none; each message stands alone | full history, replayable |

```bash
si new app -f sisaas --workflows temporal
```

They meet at exactly **two seams**, and nothing else:

```
event ────▶ startIdempotent()      an event begins or advances a process
workflow ─▶ publishEvent activity  a process announces what it did
```

A workflow never produces to Kafka directly. It calls an activity that writes an
**outbox row** — because Temporal retries a failed activity, and a direct produce
that failed after the broker got it would publish twice.

The **workflow id is derived, never generated**: `<tenantId>:<workflow>:<key>`,
with `RejectDuplicate`. Kafka will deliver the same event twice; without this the
second delivery starts a second onboarding — two welcome emails and two seven-day
timers. One namespace with the tenant in the id, not a namespace per tenant.

The shipped example is tenant onboarding, which is the shape neither other tool
handles: a Kafka consumer cannot wait seven days (it must hand the message back
and keep its place somewhere else — a hand-written state machine plus a cron), and
a chain of delayed BullMQ jobs has no shared history, so a failure at step three
cannot see what steps one and two did. Here **the wait is the code**:
`condition(() => verified, '7 days')`, which survives a restart and a deploy.

Workflow code is replayed on every worker restart, so it must be deterministic —
no `Date.now()`, no `Math.random()`, no I/O. All of that lives in activities. The
signal names sit in their own file so the API can send a signal without importing
workflow code and evaluating `proxyActivities` outside the sandbox.

The Temporal worker runs **inside the existing background worker process**, not a
fourth deployable. The API holds a client and only ever starts and signals — an
API replica polling the task queue would pick up workflow tasks and drop them
mid-deploy.

`pnpm test:e2e` runs the workflow against a **real Temporal server** with time
skipping: the seven-day timer fires in about a second. Mocking a durable timer
proves only that a mock was called.

### Payments, waiting on a workflow

```bash
si add payments-reconcile
```

The hole this closes is real and was open until now: a Mobile Money webhook is a
best-effort HTTP call from someone else's network. **When one is lost the money
still moved**, and nothing polled — the payment sat `pending`, the invoice stayed
unpaid, dunning ran, and a customer who had paid got suspended.

```
PaymentRequested ─▶ awaitPayment workflow
                      │
   webhook ───────────┤ signal  ─▶ exits in seconds, never polls
                      │
   no webhook ────────┤ 2m, 5m, 15m, 1h, 4h ─▶ ask the provider
                      │
                      └ 24h ─▶ abandoned (not failed — nobody claimed it did)
```

The happy path costs nothing: the webhook signals the workflow before the first
poll is due, and a test asserts zero polls on that path — otherwise every payment
in production makes a needless call inside the provider's rate limit.

`PaymentReconciled` is a **separate event** from `PaymentSettled`. Every one of
them is a webhook that was not delivered: a trickle is normal for Mobile Money, a
spike means your endpoint is unreachable — and nothing else would tell you,
because the money still arrives.

The poll is provider-agnostic. Each provider's repository registers a reconciler
with `PaymentRegistry`, the same way providers register themselves, so a third
provider never means editing a workflow.

## Imported tools on the event bus

```bash
si add integrations
```

Medusa, Documenso, LiveKit, tusd, n8n, Cal.com, Blnk, Directus and the rest all
announce things by HTTP callback, each with its own signature scheme. Wiring each
to its own listener is N integrations that drift. Instead, one door:

```
POST /webhooks/:source ──▶ verify ──▶ record ──▶ outbox ──▶ IntegrationEventReceived
```

Enable a source in `webhook-sources.ts` and put its secret in the environment. An
unlisted source gets **404**; a configured source with no secret gets **503** —
never a silent accept.

Verification, recording and publishing happen in **one transaction**, keyed on
`(source, delivery_id)`. Every webhook system on earth retries; a redelivery
inserts nothing and therefore publishes nothing, so the database and every
consumer stay idempotent together rather than the database alone.

### Reacting to a tool

The bridge used to publish into a void — no listener existed, so an accepted,
recorded and published webhook looked identical to one that was never sent. Two
things now close that:

```ts
onIntegrationEvent(registry, 'medusa', 'order.placed',
  z.object({ id: z.string(), total: z.number() }),
  async (order, envelope, tx) => { /* … */ });
```

and `IntegrationAuditHandler`, which listens to everything and records it. It is
deliberately the dullest possible consumer — no decisions, no tool required — so
"did Documenso ever call us?" has an answer on a fresh install.

Two sources are enabled and were checked against the vendor's own documentation:

| | Scheme | Tamper-evident |
|---|---|---|
| **Documenso** | `X-Documenso-Secret` carries the secret itself | no — that is their design |
| **LiveKit** | JWT whose `sha256` claim hashes the body | yes |

LiveKit's is verified with `node:crypto`, not a JWT library: it is HS256 with a
secret we already hold. The algorithm is **pinned** (trusting the token's own
`alg` is how `alg: none` works), `exp` is required, and the body hash is checked
— a valid token replayed against a different payload is rejected, which is the
whole reason the claim exists. The rest of the presets stay commented and
marked unverified; a plausible-but-wrong header fails closed, which is safe and
looks exactly like an outage.

### How you actually reach each tool

Three modes, not one. Assuming everything is REST is how you end up calling
`endpoints.base('temporal')` and reading a confusing error about a variable that
was never going to exist.

| Mode | Tools | You write |
|---|---|---|
| **HTTP, you call it** | meilisearch, typesense, gotenberg, imgproxy, ollama, directus, listmonk, calcom, n8n, medusa, blnk, documenso, umami, unleash, novu, openfga, tusd, lago, killbill, langfuse, keygen, k6, grafana-stack | `endpoints.call(id, path)` |
| **Its own protocol** | temporal (gRPC), zitadel + keycloak (OIDC), livekit (per-room JWT), minio (S3), mosquitto (MQTT), sentry + openreplay (SDK config) | that tool's SDK |
| **Nothing to call** | pglite (in-process), postgis (a Postgres extension), maplibre, yjs (browser) | just import it |

`ToolEndpoints` refuses the second and third groups **by name**, saying what to
use instead — `"temporal" is not reached over REST: gRPC — use TemporalClient`.
That is the difference between an error that teaches and one that sends you
looking for a variable nobody was ever meant to set.

### Calling a tool

29 tools expose an HTTP API and each declares a `*_URL`, and until now nothing
read them — every caller would have reached for `process.env` alone, where a
typo becomes `fetch("undefined/api/…")` far from its cause.

```ts
await endpoints.call('meilisearch', '/indexes/products/search', { method: 'POST', body });
```

`ToolEndpoints` resolves the **address** and the **credential**, not the API.
Wrapping 29 vendor SDKs behind one interface would be worse than `fetch` at all
of them. Auth headers are set only where the scheme is a single known header;
LiveKit signs a per-room JWT and Keycloak needs a token exchange, so those return
no headers rather than wrong ones — a guessed header is a 401 that reads like a
wrong key. A registry test fails if a tool is added whose URL key is neither
`<ID>_URL` nor mapped.

The two directions are deliberately not symmetric. **Inbound is events**, because
a tool announcing something has many possible readers and no idea who they are.
**Outbound is a direct call**, because asking one tool one question over a broker
is request-response built on fan-out.

`data` is deliberately **untyped**. Medusa and Documenso own their payload shapes
and change them on their own release schedule; a hand-written schema for someone
else's JSON is compile-time safety that does not exist and breaks in production on
their next minor. Narrow it in your handler with a schema you own, so a payload
change fails one handler loudly instead of silently taking a different branch.

Three signature schemes are supported. `bearer-token` proves the caller knows the
secret, not that this body came from them — it cannot detect tampering, and is
only for tools that offer nothing better (LiveKit).

## Prebuilt features

Application code you would otherwise write on every project, added on demand:

```bash
si list features
si add forgot-password notifications-email cloud-sync
```

A **feature** differs from a **tool**: a tool is an external service you run, a
feature is code and a migration in your own repo. `si add` numbers the migration
against what the project already has, so two features added on different days
cannot collide.

| Feature | What it saves you rewriting |
|---|---|
| `notifications-email` | Queued transactional email with typed templates |
| `forgot-password` | Reset by single-use hashed token, enumeration-safe |
| `cloud-sync` | Keyed endpoints for on-premise ↔ cloud sync, with reconciliation |

## Cloud sync (SiMICE ↔ SaaS)

`si add cloud-sync` on the SaaS side gives an on-premise install:

```
GET  /sync/handshake            confirm the key, report the cursor
GET  /sync/pull?since=<cursor>  changes after the cursor, capped and resumable
POST /sync/push                 apply a batch — Idempotency-Key REQUIRED
POST /sync/files/upload-url     presigned; bytes never pass through the API
GET  /sync/files/download-url
```

Authenticated by a per-install key — hashed at rest, revocable per site, and
authorising exactly one tenant. Nothing reads a tenant id from the request: a
machine that could name its own tenant could name someone else's.

Changes are tagged with the install that produced them and never echoed back,
or two installs bounce the same row forever.

**Reconciliation is by version, not timestamp.** Each record carries a `version`;
the install pushes the version it last saw, and a mismatch is a genuine conflict —
clocks on separate machines disagree, and two edits a second apart still conflict.

Per-entity policies: `remote-wins`, `local-wins`, `last-write-wins`, `merge`, and
`manual`. **The default is `manual`** — neither side is applied, both payloads are
kept whole in `sync_conflicts`, and a person decides. A silent default that
discards someone's work should have to be chosen deliberately.

**The schedule is server-owned**: interval plus an optional window and timezone,
returned on every handshake. Changing a site's cadence must not require visiting
a machine behind a customer's firewall.

## Edge and load balancing

The platform ships cert-manager (three ClusterIssuers), Traefik configured as
ingress **and** API gateway, and gateway middleware for HTTPS redirect, HSTS and
edge rate limiting. `service add --balancing round-robin|sticky|canary` picks the
strategy per service.

These were previously *referenced* by the generated ingress annotations and never
shipped — a TLS-exposed service would have failed silently.

## Audit log

Append-only, tamper-evident and write-ahead — see `templates/sisaas/docs/AUDIT.md`.

```bash
pnpm verify:audit     # 9 checks against a real Postgres
```

- **Write-ahead.** `audit.around()` records the intent on a separate connection
  before the work runs, so a failed or rolled-back attempt still leaves evidence.
  An intent with no outcome means a crash or a rollback.
- **Hash chain** in real columns (`seq`, `prev_hash`, `hash`), not stashed in
  jsonb. Ordered by a bigserial, because a timestamp is ambiguous within a
  millisecond.
- **Append-only enforced by the database** — a trigger rejects UPDATE and DELETE
  even for the table owner, and the runtime role has SELECT/INSERT only.

The limit is stated rather than hidden: an attacker who rewrites every row leaves
a chain that verifies. `headHash()` exists to be anchored outside the database.

## Security

Every flavor ships `verify:security`, wired into `pnpm smoke` and CI:

```bash
pnpm verify:security   # all 7 flavors
pnpm verify:rls        # sisaas — the live tenant-isolation proof
npm --prefix apps/server test   # sisaas — 9 crypto tests
```

The exercise found a **live vulnerability in our own template**: none of the
three JWT verifiers pinned an algorithm, so `alg: none` would have been accepted.
Fixed at all three call sites, and the gate now fails if a pin is lost.

Three of the fork's measures were deliberately **not** ported — regex SQL/XSS
blocking and `X-XSS-Protection` — because they break legitimate input while
protecting against nothing parameterised queries and output encoding do not
already handle. Reasoning in `adr-003-security.md`.

## Decisions recorded so far

- DDD layering always; **CQRS is per-module opt-in**, not the default. The service
  owns the transaction, the repository takes one — so a domain write and its
  outbox event are a single commit.
- Migrations run as a **non-superuser owner** (`<brand>_owner`). See
  `adr-001-events-and-data.md`.
- Events: transactional outbox + Debezium. Services never call `producer.send()`.
- Consumers run in the **worker**, not the API, and are idempotent via
  `processed_events`.
