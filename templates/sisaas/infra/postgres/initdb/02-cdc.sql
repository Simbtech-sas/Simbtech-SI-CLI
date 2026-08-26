-- Change-data-capture role for Debezium.
--
-- Debezium reads the write-ahead log, not the tables, so it needs REPLICATION.
-- It is NOT a superuser and gets SELECT only on the outbox — it can see events
-- the service published, nothing else. The publication itself is created by
-- migration 0000_init.sql, because it must reference a table that exists.
--
-- In production the platform provisions this role with a generated password;
-- this file only exists so `pnpm infra:up` gives a working CDC pipeline locally.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simbkit_dbz') THEN
    CREATE ROLE simbkit_dbz
      LOGIN
      REPLICATION
      PASSWORD 'simbkit_dbz_dev_pwd'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO simbkit_dbz;

-- Deliberately NO default privileges for this role. It gets SELECT on exactly
-- one table, granted by name in the migration. A blanket
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES` would hand the CDC role
-- read access to every future feature table — which is the opposite of the point.
