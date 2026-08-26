-- Runs ONCE on first cluster initialisation (postgres image entrypoint).
-- Connected as the POSTGRES_USER ("simbkit") against POSTGRES_DB ("simbkit").
--
-- Creates the runtime application role. It is intentionally NOT a superuser and
-- NOT BYPASSRLS, so Postgres Row-Level Security genuinely constrains it — this is
-- the bottom layer of tenant isolation.
--
-- The API connects as `simbkit_app`. Schema migrations run as `simbkit_owner`,
-- which owns every table; tables it creates are auto-granted to `simbkit_app` via
-- the ALTER DEFAULT PRIVILEGES statements below. RLS policies are created by the
-- migrations.
--
-- `simbkit_owner` is deliberately NOT the POSTGRES_USER superuser. Superusers
-- bypass Row-Level Security unconditionally — FORCE ROW LEVEL SECURITY cannot
-- constrain them — so migrating as the superuser would make FORCE decorative and
-- leave the owner able to read every tenant's rows. Keep migrations on this role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simbkit_app') THEN
    CREATE ROLE simbkit_app
      LOGIN
      PASSWORD 'simbkit_app_dev_pwd'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO simbkit_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simbkit_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO simbkit_app;

-- Super-admin connection role: BYPASSRLS for cross-tenant platform queries
-- (tenant directory, KPIs). Still NOT a superuser. Used ONLY by the admin realm.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simbkit_admin') THEN
    CREATE ROLE simbkit_admin
      LOGIN
      PASSWORD 'simbkit_admin_dev_pwd'
      NOSUPERUSER
      BYPASSRLS
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO simbkit_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simbkit_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO simbkit_admin;

-- ── Migration / owner role ────────────────────────────────────────────────────
-- Owns every table. NOSUPERUSER and NOBYPASSRLS so that FORCE ROW LEVEL SECURITY
-- genuinely applies to it: without a tenant context this role reads nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simbkit_owner') THEN
    CREATE ROLE simbkit_owner
      LOGIN
      PASSWORD 'simbkit_owner_dev_pwd'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

-- Needs CREATE on the schema to make tables, and on the database to create the
-- CDC publication. Postgres 15+ removed the implicit PUBLIC create grant.
GRANT USAGE, CREATE ON SCHEMA public TO simbkit_owner;
GRANT CREATE ON DATABASE simbkit TO simbkit_owner;

-- Default privileges are per-creating-role. The grants above were issued by the
-- bootstrap superuser and therefore only cover objects IT creates; migrations run
-- as simbkit_owner, so its future objects need their own defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE simbkit_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simbkit_app, simbkit_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE simbkit_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO simbkit_app, simbkit_admin;
