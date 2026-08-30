-- Runs ONCE on first cluster initialisation (postgres image entrypoint).
-- Connected as the POSTGRES_USER ("simbkit") against POSTGRES_DB ("simbkit").
--
-- si:when-begin multi-tenant
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
-- si:when-end
-- si:when-begin single-tenant
-- Creates the runtime application role. It is intentionally NOT a superuser, and
-- it owns nothing: a compromised API cannot DROP or ALTER the tables it reads.
--
-- The API connects as `simbkit_app`. Schema migrations run as `simbkit_owner`,
-- which owns every table; tables it creates are auto-granted to `simbkit_app` via
-- the ALTER DEFAULT PRIVILEGES statements below.
--
-- `simbkit_owner` is deliberately NOT the POSTGRES_USER superuser either. Keeping
-- migrations off the superuser is the same instinct: the smallest role that can
-- do the job.
-- si:when-end

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

-- si:when-begin multi-tenant
-- Super-admin connection role: BYPASSRLS for cross-tenant platform queries
-- (tenant directory, KPIs). Still NOT a superuser. Used ONLY by the admin realm.
-- There is no equivalent in a single-tenant build: with no RLS to bypass, the
-- runtime role already sees everything a super-admin would.
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
-- si:when-end

-- ── Migration / owner role ────────────────────────────────────────────────────
-- Owns every table. NOSUPERUSER and NOBYPASSRLS so that FORCE ROW LEVEL SECURITY -- si:when multi-tenant
-- genuinely applies to it: without a tenant context this role reads nothing. -- si:when multi-tenant
-- Owns every table. NOSUPERUSER: it creates the schema, nothing more. -- si:when single-tenant
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
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simbkit_app, simbkit_admin; -- si:when multi-tenant
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simbkit_app; -- si:when single-tenant

ALTER DEFAULT PRIVILEGES FOR ROLE simbkit_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO simbkit_app, simbkit_admin; -- si:when multi-tenant
  GRANT USAGE, SELECT ON SEQUENCES TO simbkit_app; -- si:when single-tenant
