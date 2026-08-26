# Simbkit

A multi-tenant SaaS monorepo skeleton: NestJS + Fastify API, Next.js web, Postgres
with Row-Level Security, Redis/BullMQ, S3-compatible storage. The business logic
is yours to add — the architecture is already here.

## Stack

| Layer | Tech |
|-------|------|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 11 on Fastify, DDD module layout |
| DB | Postgres 17 + Drizzle ORM, **RLS tenant isolation** |
| Cache/Jobs | Redis + BullMQ (separate worker process) |
| Realtime | Socket.IO (+ Redis adapter for multi-node) |
| Storage | S3 / MinIO (in-memory stub when unset) |
| Web | Next.js (App Router), Tailwind v4 |
| Auth | JWT access + rotating refresh cookie, argon2 |

## Quick start

```bash
pnpm install
cp apps/server/.env.example apps/server/.env     # edit JWT secrets etc.
pnpm infra:up                                    # postgres, redis, minio, mailpit
pnpm --filter @simbkit/server db:migrate          # apply drizzle/0000_init.sql
pnpm dev                                          # API :8080, web :3100
pnpm --filter @simbkit/server worker:dev          # background job worker (optional)
```

## Layout

```
apps/
  server/   NestJS API + background worker
  web/      Next.js app
packages/
  config/   shared tsconfig base
infra/      docker-compose + Postgres RLS role init
```

## Adding a feature

Copy the `widgets` module (`apps/server/src/modules/widgets/`) and its schema
(`apps/server/src/database/schema/widgets.ts`). It is the reference for the
domain / application / infrastructure / interface layering and the RLS
tenant-context pattern. See `ARCHITECTURE.md` in the scaffold skill for the full
tour.
