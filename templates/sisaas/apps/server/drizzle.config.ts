import { defineConfig } from 'drizzle-kit';

// drizzle-kit is its OWN process — Nest's ConfigModule never runs, so nothing
// else reads .env here. Without this the URL below silently falls back to one
// with no credentials, Postgres refuses the OS user, and drizzle-kit exits 1
// printing nothing at all. `pnpm db:migrate` simply never worked.
//
// `loadEnvFile` is built into Node (>= 20.12) and does not overwrite variables
// already set, so CI keeps whatever it exported.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env — CI, or a container with real environment variables.
}

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // si:when-begin multi-tenant
    // Migrations run as the OWNER role (creates tables + RLS policies), never as
    // the RLS-constrained runtime role — and never as a superuser, which would
    // bypass the FORCE ROW LEVEL SECURITY the migrations install.
    // si:when-end
    // si:when-begin single-tenant
    // Migrations run as the OWNER role, never as the runtime role: the role the
    // API connects with should not be able to drop the tables it reads.
    // si:when-end
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://localhost:5434/simbkit',
  },
  verbose: true,
  strict: true,
});
