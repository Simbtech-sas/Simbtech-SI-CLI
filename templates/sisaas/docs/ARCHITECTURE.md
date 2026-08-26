# Architecture reference

The scaffolded app is a multi-tenant SaaS monorepo. This is the tour: the layers,
the golden rule, how a request flows, and how to add a feature.

## Single deployable or microservices

`si new -f sisaas -p <profile>` decides what this project is:

| Profile | Contains | Events | Use for |
|---|---|---|---|
| `mono` | everything, plus the web app | in-process | one deployable — **start here** |
| `identity` | users, tenants, memberships; **issues** tokens | Kafka | the one service that owns who a user is |
| `service` | verifies tokens, no user records, local tenant projection | Kafka | every other service |

### Splitting later costs nothing

`OutboxService.publish()` and every handler are **identical** in all three. Only
the delivery changes:

- `mono` — a poller claims outbox rows (`FOR UPDATE SKIP LOCKED`) and calls the
  handlers directly. No Kafka, no Debezium, no broker to operate. The dev stack
  starts five containers instead of eight.
- `identity` / `service` — Debezium tails the WAL and publishes; each service
  consumes what it subscribed to.

Polling a durable table rather than an in-memory emitter, deliberately: a handler
must not run for a transaction that rolled back, and it must still run if the
process dies between the commit and the delivery. Only a row gives both — and it
is the same row Debezium reads once you split.

So the migration is: change the transport, deploy Kafka, move modules into their
own repos. Not one publisher or subscriber is rewritten. Starting as a single
deployable is a real starting point, not a decision you pay for twice.

The rule the split enforces: **exactly one service issues tokens.** Everything
else imports `modules/auth` (verification only, no database) rather than
`modules/iam`. A service that could mint its own tokens would be a second answer
to "who is this user", and two answers diverge.

Granular permissions travel **in** the token. A guard that looked them up in a
database would only work inside identity; every other service would need a
synchronous call to identity on every request. The cost is staleness — revoking
a permission takes effect on the next refresh (15 min). Anything that must revoke
instantly is not a permission, it is a check against live state.

`tenants` exists in every profile: the source of truth in identity, a local
projection elsewhere fed by tenant events (`modules/tenancy`). That is what lets
a feature table hold a real foreign key to it without a cross-service join.

Profiles are subtractions from the full template — declared in
`.si/template.json`, applied by deleting paths and pruning lines marked
`// si:profile <names>`. One project that CI builds as a whole, rather than
variant files that drift.

## Monorepo

```
apps/server   NestJS + Fastify API and a separate BullMQ worker process
apps/web      Next.js (App Router) web app
packages/config  shared tsconfig base (@brand/config)
infra/        docker-compose (postgres, redis, minio, mailpit) + Postgres role init
```

pnpm workspaces + Turborepo. Root scripts: `pnpm dev|build|lint|typecheck|test`
fan out via Turbo; `pnpm infra:up|down|logs|reset` drive docker-compose.

## The golden rule: tenant isolation via Postgres RLS

The database — not application code — is the isolation boundary.

- **Three Postgres roles** (`infra/postgres/initdb/01-init.sql`):
  - `brand_app` — the runtime role. `NOSUPERUSER`, **`NOBYPASSRLS`**, so RLS
    genuinely constrains it. `DATABASE_URL` uses this.
  - `brand` (owner) — runs migrations, creates tables + policies.
    `MIGRATION_DATABASE_URL`.
  - `brand_admin` — `BYPASSRLS` for the cross-tenant super-admin realm.
    `ADMIN_DATABASE_URL` (optional).
- **Every tenant-scoped table** has a `tenant_id` column (FK to `tenants`,
  `ON DELETE CASCADE`), `ENABLE ROW LEVEL SECURITY`, **`FORCE ROW LEVEL
  SECURITY`**, and a `tenant_isolation` policy:
  ```sql
  ALTER TABLE t ENABLE ROW LEVEL SECURITY;
  ALTER TABLE t FORCE  ROW LEVEL SECURITY;   -- applies to the table OWNER too
  CREATE POLICY tenant_isolation ON t
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  ```
  `FORCE` is not optional. Without it the policy does not apply to the table's
  owner, so migrations — and anything else connecting as the owner — see every
  tenant's rows. The cost: a later data migration touching a tenant-scoped table
  must `SELECT set_config('app.tenant_id', '<uuid>', false)` first, or loop per
  tenant. That friction is the point.
- **`DatabaseService.runInTenantContext(tenantId, fn)`** opens a transaction, sets
  the `app.tenant_id` GUC with `set_config(..., true)` (transaction-local, so a
  pooled connection can never leak context to the next request), and runs `fn`.
  All feature reads/writes go through it — the code never adds a manual
  `where tenant_id = …` for isolation; the policy does it.

**Not RLS-scoped:** the identity layer (`users`, `tenants`, `memberships`,
`refresh_tokens`), `audit_log`, and `outbox_events`. Login must resolve a user's
memberships across tenants before any tenant context exists, so these use the raw
`db` connection and are guarded in code by the auth layer. Scoping `memberships`
would either break login or force every deployment to keep a `BYPASSRLS` pool
open for it — a larger blast radius than the junction table it protects.
`audit_log` and `outbox_events` carry a nullable `tenant_id` because
platform-level records belong to no tenant.

`apps/server/src/database/schema/widgets.ts` + `drizzle/0000_init.sql` show a
tenant-scoped table with its policy.

## Server module layout (DDD)

Each module is a folder under `src/modules/<name>/` with four layers:

```
domain/          types, pure logic, no framework/IO
application/     services — orchestration, the unit of work, event handlers
infrastructure/  repositories, adapters (DB, S3, external APIs)
interface/       controllers, DTOs (zod via nestjs-zod), guards, decorators
<name>.module.ts wires it together
```

**The service owns the transaction; the repository takes one.** Repository
methods accept a `TenantTx` rather than opening their own transaction, so a
service can write a row and its outbox event in ONE unit of work. Roll back and
neither happened. This is why `producer.send()` appears nowhere in the codebase —
see `docs/EVENTS.md`.

CQRS is available per module but is not the default: `si scaffold <Entity> -m <m>`
emits a plain service, `--cqrs` emits command/query handlers. Both use the same
domain, repository, DTO and controller layers, so the two shapes coexist.

`widgets/` is the reference feature module. `iam/` is the auth module. Cross-cutting
infra modules: `redis` (cache), `realtime` (Socket.IO), `media` (storage),
`audit` (tamper-evident log), `jobs` (BullMQ example).

## Request flow (a guarded tenant-scoped endpoint)

1. Fastify receives the request; global middleware (helmet, compress, rate-limit,
   CORS, cookie) runs (`main.ts`).
2. `JwtAccessGuard` verifies the `Bearer` access token and attaches the
   `AccessTokenPayload` principal (`sub`, `email`, `tenantId`, `membershipId`,
   `role`) to the request.
3. `RolesGuard` / `PermissionsGuard` (optional) check role / granular permission.
4. The controller reads `@CurrentPrincipal()` — the `tenantId` comes from the
   **verified token, never the request body** — and calls the service.
5. `ZodValidationPipe` (global) has already validated the body against the DTO.
6. The service opens `runInTenantContext(tenantId, …)` and calls the repository
   with that transaction. RLS confines every query inside it to that tenant. A
   write also publishes to the outbox in the same transaction.

## Auth

`iam` module. `POST /auth/register` creates tenant + owner user + membership
atomically. `login`/`refresh`/`logout`/`me`/`profile`/`password`. Access tokens
are stateless JWTs (15 min); refresh tokens are opaque, hashed at rest (sha256),
stored in `refresh_tokens`, and **rotated on every use** — a revoked-but-presented
token is treated as theft and revokes the whole family. The refresh token lives in
an httpOnly cookie scoped to `/auth`. Passwords use argon2id.

## Jobs & the worker process

`BullModule.forRootAsync` (shared Redis connection) in `app.module.ts`. Queues are
registered per module (`jobs/jobs.module.ts`). Producers enqueue; `@Processor`
classes consume. The consumers run in a **separate process** (`worker.main.ts` →
`WorkerModule`, `pnpm worker`) so API restarts never drop in-flight jobs. Scheduled
tasks use `@nestjs/schedule` (`@Cron`).

## Config

`env.schema.ts` validates all env with zod at boot (fail fast). Never read
`process.env` outside it — add a var there, expose it through `AppConfigService`,
inject that. Optional infra degrades gracefully: no `REDIS_URL` → cache no-ops,
single-node sockets; no S3 creds → in-memory storage stub; no SMTP → mailer no-op.

## Web

Next.js App Router. `middleware.ts` is the tenant-routing layer: it maps
`{slug}.brand.local` → the tenant storefront route and role subdomains (e.g.
`app.` → `/dashboard`), and resolves custom domains against the API. `lib/api.ts`
is the fetch client: base URL from env, bearer-token attach, refresh-on-401.
Route groups (`(dashboard)`) hold authed areas. Tailwind v4, theme-aware.

## Adding a feature (recipe)

1. **Schema**: copy `schema/widgets.ts` → `schema/<feature>.ts`, rename the table
   and columns. Re-export it from `schema/index.ts`.
2. **Migration**: add `drizzle/000N_<feature>.sql` — `CREATE TABLE`, then
   `ENABLE` + `FORCE ROW LEVEL SECURITY` + the `tenant_isolation` policy (copy the
   widgets block). Numbered, hand-written.
3. **Module**: copy `modules/widgets/` → `modules/<feature>/`, rename classes.
   Keep the boundary: service opens `runInTenantContext`, repository takes the tx.
4. **Events** (if anything else cares): add contracts to `packages/events`, then
   `outbox.publish(tx, …)` in the service's write paths.
5. **Register**: add `<Feature>Module` to `app.module.ts` — and to
   `worker.module.ts` too if it registers event handlers, or they never run.
6. Apply the migration, then `pnpm --filter @simbkit/server typecheck`.

Or let the generator do 1-3 and 5: `si scaffold <Feature> -m <feature> --tenant-scoped`.

For a non-tenant-scoped or platform-level table, skip the RLS policy and use the
raw `db` / `requireAdminDb()` connection instead — but that is the exception.

## Dropping what you don't need

Single-tenant app? Remove `tenant_id` + RLS from feature tables and call the repo
without `runInTenantContext`; keep the identity layer. Don't need realtime / jobs /
storage? Delete the module and its line in `app.module.ts` (and the dep). The
architecture is layered so each cross-cutting concern is one module + one import.
