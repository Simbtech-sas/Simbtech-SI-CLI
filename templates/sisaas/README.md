# Simbkit

<!-- si:when-begin multi-tenant -->
A multi-tenant SaaS monorepo skeleton: NestJS + Fastify API, Next.js web, Postgres
with Row-Level Security, Redis/BullMQ, S3-compatible storage. The business logic
is yours to add — the architecture is already here.
<!-- si:when-end -->
<!-- si:when-begin single-tenant -->
A web app monorepo skeleton: NestJS + Fastify API, Next.js web, Postgres,
Redis/BullMQ, S3-compatible storage. The business logic is yours to add — the
architecture is already here.
<!-- si:when-end -->

## Stack

| Layer | Tech |
|-------|------|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 11 on Fastify, DDD module layout |
| DB | Postgres 17 + Drizzle ORM, **RLS tenant isolation** | <!-- si:when multi-tenant -->
| DB | Postgres 17 + Drizzle ORM | <!-- si:when single-tenant -->
| Cache/Jobs | Redis + BullMQ (separate worker process) |
| Realtime | Socket.IO (+ Redis adapter for multi-node) |
| Storage | S3 / MinIO (in-memory stub when unset) |
| Web | Next.js (App Router), Tailwind v4 |
| Auth | JWT access + rotating refresh cookie, argon2 |

## Quick start

```bash
pnpm install
si start dev      # containers, migrations, API, worker and web — one command
```

`si start dev` picks free host ports, so a second project (or anything else
already on 5434) does not collide, and it prints where everything ended up.

By hand, if you would rather:

```bash
cp apps/server/.env.example apps/server/.env      # edit JWT secrets etc.
pnpm infra:up                                     # postgres, redis, minio, mailpit
pnpm --filter @simbkit/server db:migrate          # apply drizzle/0000_init.sql
pnpm dev                                          # API :8080, web :3100
pnpm --filter @simbkit/server worker:dev          # NOT optional: event delivery
```

The worker is where event delivery and background jobs run. Without it the
outbox fills and no handler ever fires — the app looks fine until you check
whether anything actually happened. `si start dev` starts it for you; `pnpm dev`
does not.

## Layout

```
apps/
  server/   NestJS API + background worker
  web/      Next.js app
packages/
  config/   shared tsconfig base
infra/      docker-compose + Postgres RLS role init <!-- si:when multi-tenant -->
infra/      docker-compose + Postgres role init <!-- si:when single-tenant -->
```

## Adding a feature

Copy the `widgets` module (`apps/server/src/modules/widgets/`) and its schema
(`apps/server/src/database/schema/widgets.ts`). It is the reference for the
domain / application / infrastructure / interface layering and the RLS <!-- si:when multi-tenant -->
tenant-context pattern. See `docs/ARCHITECTURE.md` for the full tour. <!-- si:when multi-tenant -->
domain / application / infrastructure / interface layering. See <!-- si:when single-tenant -->
`docs/ARCHITECTURE.md` for the full tour. <!-- si:when single-tenant -->
