# Architecture reference

The scaffolded app is a single-organisation web app monorepo. This is the tour:
the layers, where the security boundary actually is, how a request flows, and how
to add a feature.

It is the SiSAAS template with tenancy composed out — same DDD layering, same
outbox, same audit chain, same worker. What is gone is the tenant column, the RLS
policies, the memberships table and the subdomain routing.

## Single deployable or microservices

`si new -f siapp -p <profile>` decides what this project is:

| Profile | Contains | Events | Use for |
|---|---|---|---|
| `mono` | everything, plus the web app | in-process | one deployable — **start here** |
| `identity` | users; **issues** tokens | Kafka | the one service that owns who a user is |
| `service` | verifies tokens, no user records | Kafka | every other service |

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
own repos. Not one publisher or subscriber is rewritten.

The rule the split enforces: **exactly one service issues tokens.** Everything
else imports `modules/auth` (verification only, no database) rather than
`modules/iam`. A service that could mint its own tokens would be a second answer
to "who is this user", and two answers diverge.

Granular permissions travel **in** the token. A guard that looked them up in a
database would only work inside identity; every other service would need a
synchronous call to identity on every request. The cost is staleness — revoking
a permission takes effect on the next refresh (15 min). Anything that must revoke
instantly is not a permission, it is a check against live state.

Profiles are subtractions from the full template — declared in
`.si/template.json`, applied by deleting paths and pruning lines marked
`// si:when <names>`. One project that CI builds as a whole, rather than variant
files that drift.

## Monorepo

```
apps/server   NestJS + Fastify API and a separate BullMQ worker process
apps/web      Next.js (App Router) web app
packages/config  shared tsconfig base (@brand/config)
infra/        docker-compose (postgres, redis, minio, mailpit) + Postgres role init
```

pnpm workspaces + Turborepo. Root scripts: `pnpm dev|build|lint|typecheck|test`
fan out via Turbo; `pnpm infra:up|down|logs|reset` drive docker-compose.

## Where the boundary is

**In the application, not the database.** This is the one thing to internalise if
you have used the multi-tenant flavour: there is no RLS policy behind your
queries. A missing `@UseGuards(AccessGuard)` on a controller is a public
endpoint, and nothing downstream will catch it for you.

Two Postgres roles remain (`infra/postgres/initdb/01-init.sql`), and they still
earn their keep:

- `brand_app` — the runtime role, `DATABASE_URL`. Owns no table, so a compromised
  API cannot `DROP` or `ALTER` one.
- `brand` (owner) — runs migrations, owns the schema. `MIGRATION_DATABASE_URL`.

Keep them split. It is the cheapest blast-radius reduction available, and it costs
one extra connection string.

### Authorization

`role` lives on the user row (`owner` / `admin` / `member`), with a `permissions`
JSON column for per-user overrides. The **first account to register becomes
`owner`**; every later one starts as `member`. Both travel in the access token, so
`RolesGuard` and `PermissionsGuard` work without a database read.

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
methods accept a transaction rather than opening their own, so a service can
write a row and its outbox event in ONE unit of work. Roll back and neither
happened. This is why `producer.send()` appears nowhere in the codebase — see
`docs/EVENTS.md`.

CQRS is available per module but is not the default: `si scaffold <Entity> -m <m>`
emits a plain service, `--cqrs` emits command/query handlers. Both use the same
domain, repository, DTO and controller layers, so the two shapes coexist.

`widgets/` is the reference feature module. `iam/` is the auth module. Cross-cutting
infra modules: `redis` (cache), `realtime` (Socket.IO), `media` (storage),
`audit` (tamper-evident log), `jobs` (BullMQ example).

## Request flow (a guarded endpoint)

1. Fastify receives the request; global middleware (helmet, compress, rate-limit,
   CORS, cookie) runs (`main.ts`).
2. `JwtAccessGuard` verifies the `Bearer` access token and attaches the
   `AccessTokenPayload` principal (`sub`, `email`, `role`) to the request.
3. `RolesGuard` / `PermissionsGuard` (optional) check role / granular permission.
4. The controller reads `@CurrentPrincipal()` and calls the service.
5. `ZodValidationPipe` (global) has already validated the body against the DTO.
6. The service opens `db.transaction(…)` and calls the repository with that
   transaction. A write also publishes to the outbox in the same transaction.

Step 2 is load-bearing. Whatever a route needs to know about the caller comes from
the **verified token, never the request body**.

## Auth

`iam` module. `POST /auth/register` creates a user — the first one as `owner`,
decided under an advisory lock so two simultaneous first registrations cannot both
win it. `login`/`refresh`/`logout`/`me`/`profile`/`password`. Access tokens are
stateless JWTs (15 min); refresh tokens are opaque, hashed at rest (sha256),
stored in `refresh_tokens`, and **rotated on every use** — a revoked-but-presented
token is treated as theft and revokes the whole family. The refresh token lives in
an httpOnly cookie scoped to `/auth`. Passwords use argon2id.

`refresh` re-reads the role from the user row rather than carrying it in the
refresh token, so a demotion takes effect within 15 minutes rather than at the
next login.

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

Next.js App Router. `lib/api.ts` is the fetch client: base URL from env,
bearer-token attach, refresh-on-401. Route groups (`(dashboard)`) hold authed
areas. Tailwind v4, theme-aware.

## Adding a feature (recipe)

1. **Schema**: copy `schema/widgets.ts` → `schema/<feature>.ts`, rename the table
   and columns. Re-export it from `schema/index.ts`.
2. **Migration**: add `drizzle/000N_<feature>.sql` — `CREATE TABLE` and its
   indexes. Numbered, hand-written.
3. **Module**: copy `modules/widgets/` → `modules/<feature>/`, rename classes.
   Keep the boundary: service opens the transaction, repository takes it.
4. **Events** (if anything else cares): add contracts to `packages/events`, then
   `outbox.publish(tx, …)` in the service's write paths.
5. **Register**: add `<Feature>Module` to `app.module.ts` — and to
   `worker.module.ts` too if it registers event handlers, or they never run.
6. **Guard it.** Nothing else will. Then apply the migration and run
   `pnpm --filter @simbkit/server typecheck`.

Or let the generator do 1-3 and 5: `si scaffold <Feature> -m <feature>`.

## Going multi-tenant later

It is a migration, not a flag. Every table needs a `tenant_id`, a backfill, a
foreign key and an RLS policy; every repository call needs a tenant context; the
identity layer needs a `memberships` junction and the role moves onto it. Scaffold
a SiSAAS app and read the diff before deciding — it is real work, and knowing the
size of it now is worth more than a switch that pretends otherwise.

## Dropping what you don't need

Don't need realtime / jobs / storage? Delete the module and its line in
`app.module.ts` (and the dep). The architecture is layered so each cross-cutting
concern is one module + one import.
