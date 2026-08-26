# Simbkit — Local Infrastructure

Dockerized dev dependencies. The apps themselves run on the host via `pnpm dev`
(hot reload); only the backing services live here.

## Prerequisites

- Docker Desktop / Docker Engine + Compose v2

## Start / stop (from repo root)

```bash
docker compose -f infra/docker-compose.yml up -d     # start core stack
docker compose -f infra/docker-compose.yml down      # stop
docker compose -f infra/docker-compose.yml logs -f   # tail logs
docker compose -f infra/docker-compose.yml down -v   # stop AND wipe volumes (destroys all local data)
```

Credentials default to dev values. To override, copy `infra/.env.example` → `infra/.env`.

## Service map

| Service      | Host port(s) | URL / DSN                                                                               |
| ------------ | ------------ | -------------------------------------------------------------------------------------- |
| Postgres     | 5434 (host)  | `postgresql://simbkit_app:…@localhost:5434/simbkit` (override host port via `POSTGRES_HOST_PORT`) |
| Redis        | 6379         | `redis://:simbkit_dev_pwd@localhost:6379`                                                |
| MinIO API    | 9000         | http://localhost:9000                                                                  |
| MinIO Console | 9001        | http://localhost:9001 (user/pass: `simbkit` / `simbkit_dev_pwd`)                          |
| Mailpit SMTP | 1025         | smtp://localhost:1025                                                                   |
| Mailpit UI   | 8025         | http://localhost:8025                                                                   |

## How the app connects

The server uses three Postgres roles, each with its own connection string:

```bash
# Runtime role — non-superuser, RLS-constrained. Used by the API for all tenant traffic.
DATABASE_URL=postgresql://simbkit_app:simbkit_app_dev_pwd@localhost:5434/simbkit

# Owner role — runs schema migrations (owns the tables, grants to simbkit_app).
MIGRATION_DATABASE_URL=postgresql://simbkit:simbkit_dev_pwd@localhost:5434/simbkit

# Super-admin role — BYPASSRLS for cross-tenant platform queries. Admin realm only.
ADMIN_DATABASE_URL=postgresql://simbkit_admin:simbkit_admin_dev_pwd@localhost:5434/simbkit
```

## Notes

- **Postgres roles:** `simbkit` (owner, runs migrations), `simbkit_app` (runtime,
  non-superuser, **RLS-constrained**), and `simbkit_admin` (super-admin, BYPASSRLS,
  non-superuser). See `postgres/initdb/01-init.sql`.
- **Buckets:** `simbkit` (anonymous download) and `simbkit-private` (private),
  created automatically by the `minio-setup` one-shot container.
- **Image tags** use moving versions for first-run convenience. Pin exact
  versions/digests before production.
