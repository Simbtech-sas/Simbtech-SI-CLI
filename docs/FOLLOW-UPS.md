# Follow-ups

What is deliberately not done, so it is tracked rather than forgotten.

## Untested against real hardware

**The platform's cluster operations have never touched a VPS.** Manifests parse,
scripts pass `bash -n`, and the allocator, inventory and generator logic have 30
tests — but `bootstrap-network.sh` and `bootstrap-k3s.sh` have not run against a
real machine. Provision a throwaway VPS and run both before trusting them.

`shellcheck` is not installed on the development machine, so that step is skipped
locally. CI runs it.

## Needs a real provider to finish

- **Keycloak / ZITADEL auth.** The OIDC guard is written and compiles, but has
  not verified a token from a live provider. The tenant-claim mapping in
  particular is provider-specific and needs confirming against a real realm.
- **tusd upload hook.** The compose fragment and the contract are in place; the
  HMAC-verified completion hook needs an end-to-end run against real S3.
- **Temporal.** Wired into the dev stack and the registry. No workflow has been
  executed.

## Belongs in the pipeline, not the templates

- Dependency scanning (`pnpm audit`, Dependabot/Renovate).
- Container image scanning (Trivy or similar) before anything is pushed.
- Secret scanning on push (gitleaks). The templates check their own tree; a push
  hook catches what a developer adds later.

## Known trade-offs, recorded on purpose

- **Permissions in the token** go stale until the next refresh (15 minutes).
  Anything needing instant revocation is a check against live state, not a
  permission. See `adr-001`.
- **Outbox retention** is a 7-day prune. High-volume services should shorten it,
  and a replication slot nobody consumes will fill the disk — see the platform
  runbook.
- **One control plane.** HA k3s needs an embedded etcd and a load balancer in
  front of the API; `node add --role control-plane` refuses a second rather than
  half-supporting it.
- **Three security measures from the upstream CLI were not ported** — regex
  SQL/XSS filtering and `X-XSS-Protection`. Reasoning in `adr-003`. If you want
  them regardless, they are a contained addition.

## Cross-flavor integration

- **SiMICE cloud-sync: the protocol is written and verified; the Tauri glue is
  not.** `crates/sync` has the wire format, cursor handling, outbox batching,
  idempotency and conflict handling, with 12 tests, plus a `ureq` transport
  proven against a live server. Still missing: the `SyncStore` implementation
  over `tauri-plugin-sql`, the background loop that honours the server's
  `intervalSeconds`, and the Tauri commands that surface status and conflicts.
  None of it compiles on a machine without GTK/WebKit headers, which is why it
  was left rather than written unchecked.
- ~~**SiMICE's `cloud-sync` mode is an enum and nothing else.**~~ `deployment.rs`
  has `Mode::CloudSync` with a comment promising "a local database plus an
  outbox that syncs to a cloud API when reachable" — there is no outbox table,
  no HTTP client and no pull loop. Meanwhile the SiSAAS `cloud-sync` feature
  ships the whole server side: handshake, pull, push, presigned file URLs,
  conflicts and resolution. **The protocol has a complete server and no client.**
  Picking `--mode cloud-sync` today gets you a desktop app that syncs nothing.
- **`--with-backend` for SiBILE was never implemented.** The plan describes it;
  no flag exists. Mobile apps are pointed at a backend by env var
  (`EXPO_PUBLIC_API_URL`, `VITE_API_URL`, `--dart-define=API_URL`), which works,
  but "a mobile SaaS in one command" is not a thing you can run.
- **The Tauri crate has never been compiled anywhere.** `webkit2gtk-4.1` is
  absent on the development machine, and `cargo check` on the app crate was
  OOM-killed twice at ~1.2GB free. The `licence` crate builds and its 8 tests
  pass; the app crate and the desktop bundle are unverified. CI on a machine
  with the GTK/WebKit headers is the only way to know.

## Local development

- **`si start dev` is compose, and there is no local cluster path.** Testing the
  platform's own manifests — ingress rules, CNPG failover, Argo sync — still
  means a real cluster. k3d would give a faithful local one and `--agents N` is
  the honest analogue of "how many VPS", but neither k3d nor kubectl is present
  on this machine, so nothing was written for it rather than shipped unverified.
- **The gateway routes to the host by `host.docker.internal`.** Verified on
  Linux via `extra_hosts: host-gateway`; not tried on macOS or Windows, where
  Docker Desktop provides it natively and should just work.

## SiAPP — done

Finished and verified end to end. `si new -f siapp` scaffolds, builds with
`nest build`, migrates against a real Postgres (7 tables, no tenant column, no
RLS, no memberships) and boots both the API and the worker. Register / login /
refresh / guarded CRUD were exercised against a live database: the first account
registers as `owner` under an advisory lock, the second as `member`, the access
token carries no tenant claim, and a demotion written straight into the database
takes effect on the next refresh.

`role` and `permissions` live on the user row. That was the open design
question; memberships are gone, and a single-tenant app still needs to say who
may do what.

Three things worth knowing:

- **The security posture is different, not weaker-by-accident.** With no RLS,
  the controller guard is the entire boundary, so `verify-security.sh` grew a
  single-tenant section that fails the build on a controller with no
  `@UseGuards`. That check was proven against a real regression before it was
  trusted.
- **`tenants` is dropped, not kept as a one-row table.** Going multi-tenant later
  is a migration with a backfill, and the scaffolded `docs/ARCHITECTURE.md` says
  so plainly rather than implying a switch exists.
- **`verify:rls` is removed but its `package.json` entry is not.** A marker in a
  package.json breaks it for npm and for the tests that read it, so the script
  is deleted and the scaffold's notes tell the user to delete the one line.

Two gates came out of building it, both proven to fail on the real bug first:
composition must never leave an unterminated block comment (a marker on a
closing `*/` deletes it and the comment swallows the class below — `nest build`
catches it, nothing earlier does), and a variant file swapped in by one choice
must be deleted by its siblings.

## Payments, subscriptions and Temporal on a single-tenant build — done

All four compose into SiAPP now, and both flavours boot with every one of them
wired in (`scripts/boot.sh payments-core payments-kpay payments-joonapay
payments-reconcile temporal subscriptions`).

Tool templates are Handlebars rather than marker-pruned, so a tenancy-dependent
one branches on `{{#if multiTenant}}`. `si new` passes the choice through;
`si add` reads it back off `.si/project.json`, defaulting to multi-tenant when
there is no record — a project scaffolded before the field existed is a SiSAAS
one, and guessing the other way would strip a tenant column out of a project
that has one.

What the single-tenant shapes came out as:

- **Payments** — no `tenant_id`, no RLS policy, `UNIQUE (external_id)` instead of
  `(tenant_id, external_id)`.
- **Subscriptions** — a subscription belongs to a **user**
  (`one_subscription_per_user`). Invoices reach their owner through
  `subscription_id`; the `tenant_id` on that table only ever existed so RLS had
  something on it to scope by.
- **Temporal** — the workflow id loses its tenant segment, and the worked example
  becomes user onboarding rather than tenant onboarding. Same seven-day timer,
  same lesson, a subject the flavour actually has.
- **LiveKit** — rooms lose the tenant prefix that was doing the isolating, and the
  docstring now says plainly that the guard issuing the token is the boundary.
- **Blnk** — one ledger for the app, `owner_id` in balance metadata.

One root-cause fix worth naming: `requireAdminDb()` returns the ordinary
connection in a single-tenant build instead of throwing. It is asked for by
webhook inboxes, MFA, payment reconcilers — everything that runs before a request
context exists — and in a build with no RLS the plain connection already IS the
unconfined one. That is 27 call sites across tools that did not each need a
branch, and `auth-mfa` and `integrations` were both about to throw at runtime on
a missing `ADMIN_DATABASE_URL` that SiAPP no longer sets.

The gate: every one of the 128 tool templates is rendered both ways on every test
run, and fails if it does not parse or if the single-tenant render still says
"tenant". It caught eleven files, including `{{/if}}}` parsing as a triple-stache
and four tools nobody had flagged.

## Compliance

`si compliance` reports 109 requirements. Of those, **26 are missing and are
code** — these are the buildable ones, roughly in order of how much a public
tender weighs them:

- **MFA, password strength policy, device management** (4.4, 4.5, 4.7)
- **Data-subject rights** — access, rectification, erasure, request handling
  (6.1.6–6.1.8), a **breach register** (6.1.9), a **retention policy** and
  **data classification** (6.1.2, 6.1.5)
- **Key management and rotation** (5.5, 5.6) — keys are environment variables
  today; a KMS or Vault is the step
- **Merkle sealing and audit export** (7.3.4, 7.3.5) — the hash chain exists;
  periodic sealing and a probative export do not
- **Verified backups** (8.10) — backups are scheduled and a restore has never
  been tested, which means they are unverified, not verified
- **ABAC** (4.3) — `si add openfga` is most of it
- **`/metrics`, tracing, SLO thresholds** (14.2, 14.3, 10.1)
- **Circuit breakers, DLQ routing, cache-stampede protection** (11.9, 9.3.6, 13.7)
- **SAST** (3.1.10) — lint and typecheck are not SAST

**23 are organisational and no command will ever satisfy them**: continuity
plans, RPO/RTO targets, penetration tests, entitlement recertification, hosting
location, SOC, and the contractual clauses on sovereignty and data ownership.
The report says so on every run rather than quietly counting them as done.

One number worth reading twice: an RPO of 15 minutes is a contractual target in
this class of tender, and the platform takes **one backup a day**. That is not a
gap in the report — it is a gap in the system.

## Verification

- **`scripts/boot.sh` is the gate that matters, and it is not in CI yet.** It
  builds with `nest build` and starts BOTH the API and the worker. Seven defects
  survived `tsc --noEmit` plus 110 green unit tests and died the first time
  anything was actually started — a tsconfig that could not emit, four DI wiring
  gaps, and two constructors that took the process down over an unconfigured
  optional tool. Wire it into `.github/workflows/` next; it needs docker.
- **Tool images are checked; tool CONTAINERS are not.** `scripts/verify-images.sh`
  resolves all 28 against their registries — it found eight wrong on its first
  run, including one whose Docker Hub org was not the project's. What it cannot
  tell you is whether a container actually starts with the env the fragment
  gives it. Bringing 33 containers up needs more memory than this machine has.
- **`blnk` jumped 0.10.4 -> 0.15.3 and `n8n` 1.x -> 2.37.4** as part of that fix,
  because the pinned tags had never existed. Both are large version jumps and
  their env variables were not re-read against the new releases — check
  `BLNK_DATA_SOURCE_DNS` and the n8n v2 config before trusting those two.
- **Keycloak went DOWN, 27.0 -> 26.7.** 27.0 was pinned before it was published.
- **The Kafka profile is unbooted.** `boot.sh` runs the `mono` profile, where
  events dispatch in-process. Whether an unreachable Kafka takes the worker down
  the way an unreachable Temporal did is untested — the same class of bug, the
  same place.

## Data

- **A scaffolded service repo ships no `k8s/` manifests.** `si service add`
  writes an Argo `Application` pointing at `k8s` in the service's own repo, and
  the SiSAAS template does not create that directory — so a `nestjs` service
  syncs to nothing until someone writes its Deployment. Tool services are
  complete; services you write are not.
- **Moving an existing service between shared and dedicated is not a migration.**
  Regenerating the manifests points it at a new, empty cluster. Dump and restore
  first, or the service comes up against a database with no tables.
- **Nothing checks that a dedicated cluster's storage class exists.** The
  generated manifest hardcodes `local-path`, which is what k3s ships; on any
  other cluster the PVC stays Pending with no obvious cause.

## Workflows

- **Dunning is still a daily cron, not a workflow.** It is the obvious next
  candidate — a workflow per subscription with real `sleep()` between steps
  replaces scanning every row and recomputing where each one is from
  `daysOverdue`. Left alone because the cron is forty lines and works; move it
  when the scan cost or a human-timed step justifies the second moving part.
- **`EventEmitterModule.forRoot()` is registered and unused.** Zero `@OnEvent`
  listeners, zero `.emit()` calls — domain events go through the outbox instead.
  It is there for application code that wants in-process pub/sub; delete it if
  nothing takes it up.
- **Nothing signals `emailVerified` yet.** `TemporalEventHandlers.confirmEmailVerified`
  is the seam; whatever confirms an address must call it. The workflow correctly
  treats a signal arriving after the window as an ordinary miss rather than an
  error.
- **One task queue per service, defaulted from the service name.** Two services
  sharing a queue means one picking up the other's workflow tasks and failing to
  find the code — nothing checks for that yet.

## Payments

- **JoonaPay's checkout-URL field name is not pinned by the published docs**,
  which say only "redirect the customer to the checkout URL". `readCheckoutUrl`
  reads the plausible names and, finding none, throws while listing the fields
  that did arrive — rather than redirecting the customer to `undefined`. Confirm
  the real name against a live sandbox response and narrow it.
- **JoonaPay payouts are not wired.** The client carries the `Idempotency-Key`
  handling they need (a 409 is a guard, not a failure; a retry must reuse the
  key), but nothing calls `POST /payouts`. Payouts are outbound transfers, not
  refunds, so no application flow currently wants one.
- **Each provider keeps its own payments table.** `kpay_payments` and
  `joonapay_payments` are parallel rather than one table with a `provider`
  column, because each stores provider-specific detail the other has no field
  for. If a third provider lands, converge them — three parallel tables is one
  too many.

## Events

- **Billing events carry `billingEmail` and `tenantName`.** That is what lets a
  notification service in another process send mail without a synchronous call
  into identity on every message. The cost is real: an email address now sits in
  a Kafka topic. Set finite retention on `<brand>.billing.v1` and keep it off any
  compacted topic.
- **A service's aggregates must be listed when it is added**
  (`si service add billing --aggregates billing,payment`). The Debezium router
  emits `<service>.<aggregatetype>.v1` for whatever the outbox contains, so an
  aggregate with no declared `KafkaTopic` is a message nobody receives once
  auto-creation is off. `allTopics()` in `@<brand>/events` is the authoritative
  list — nothing yet checks the two against each other.
- **`webhook_deliveries` grows forever.** The outbox has a 7-day prune; this
  table does not, deliberately — it is the record used to argue with a vendor
  about what they actually sent. Add retention when the volume justifies it.
- **11 of 13 webhook-capable tools still have unverified presets.** Only
  `documenso` and `livekit` reach Kafka today. The bridge works; the per-tool
  header and encoding for blnk, calcom, directus, grafana-stack, medusa, minio,
  n8n, novu, tusd, unleash and zitadel each need confirming against current
  vendor docs before they can be switched on.
- **Two webhook sources are verified and enabled; the rest are not.** Documenso
  and LiveKit were checked against their own docs and have tests. Medusa, tusd
  and n8n stay commented with plausible-not-confirmed headers — confirm each
  against its current documentation before enabling. A wrong header fails closed
  (401), which is safe and looks exactly like an outage.
- **Nothing relays OUR events out to a tool.** n8n and Novu can both consume from
  Kafka directly, which is why no relay exists; if a tool needs a webhook push
  instead, that is a consumer that forwards, and it is not written.

## Tools

- **browser-use has no deployable shape.** It is a Python library, a CLI and a
  STDIO MCP server; the HTTP API is the hosted cloud product. `si add
  browser-use` gives you the pinned container in the dev stack and nothing to
  import, because there is nothing importable from TypeScript. `si service add
  --from browser-use` correctly refuses.
  Running a task from the API in production means a Kubernetes Job, which the
  control plane does not generate yet — it emits Deployments. Until then, the
  invocation is `docker compose exec` in development.
- **Pointing browser-use at tenant data sends page content to an LLM.** That is
  a processor relationship and a decision to take deliberately, not a default.
