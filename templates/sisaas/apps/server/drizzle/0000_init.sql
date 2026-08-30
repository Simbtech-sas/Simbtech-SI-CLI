-- Core schema, present in EVERY service regardless of profile.
--
-- Run as the OWNER role (MIGRATION_DATABASE_URL) — which is `simbkit_owner`, NOT
-- the superuser. Superusers bypass Row-Level Security unconditionally, so
-- migrating as one would make the FORCE below decorative.
--
-- Every tenant-scoped table gets ENABLE *and* FORCE row level security plus a
-- `tenant_isolation` policy. Consequence to know: a later data migration that
-- touches a tenant-scoped table must set the GUC first, e.g.
--     SELECT set_config('app.tenant_id', '<uuid>', false);
-- or operate per-tenant in a loop. That friction is the point.

CREATE TYPE "tenant_status" AS ENUM('trialing', 'active', 'suspended');--> statement-breakpoint

-- Source of truth in the identity service; a local projection everywhere else,
-- kept current by consuming tenant events. Either way it is real enough for a
-- feature table to hold a foreign key to it.
-- si:when-begin multi-tenant
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'trialing' NOT NULL,
	"custom_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "tenants_slug_idx" ON "tenants" ("slug");--> statement-breakpoint
-- si:when-end

-- ── Audit log ─────────────────────────────────────────────────────────────────
-- Append-only and tamper-evident. Each service records what it did; a
-- cross-service trail is assembled from the events, not from a shared table
-- nobody owns.
--
-- `seq` orders the chain — a timestamp is ambiguous the moment two entries land
-- in the same millisecond. `hash` chains each row to the one before it, so
-- altering any row breaks every hash after it.
--
-- Write-ahead: a sensitive operation writes `intent` before it runs and
-- `committed`/`failed` after. An intent with no outcome is evidence of a crash
-- or a rollback — which a log written only on success cannot give you.
CREATE TYPE "audit_phase" AS ENUM('intent', 'committed', 'failed', 'event');--> statement-breakpoint

CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
	"tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL, -- si:when multi-tenant
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"phase" "audit_phase" DEFAULT 'event' NOT NULL,
	"correlation_id" uuid,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" ("tenant_id", "seq");--> statement-breakpoint -- si:when multi-tenant
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" ("correlation_id");--> statement-breakpoint

-- Append-only, enforced. Without this the table is append-only by convention,
-- and a hash chain nobody can verify against an unaltered row proves nothing.
-- The trigger stops even the table owner; only a superuser could disable it,
-- and that is an act that leaves its own trace.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING HINT = 'Corrections are new entries, never edits to old ones.';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();--> statement-breakpoint

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();--> statement-breakpoint

-- Belt and braces: the runtime role cannot even attempt a mutation.
REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simbkit_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM simbkit_app;
    GRANT SELECT, INSERT ON TABLE "audit_log" TO simbkit_app;
    GRANT USAGE, SELECT ON SEQUENCE "audit_log_seq_seq" TO simbkit_app;
  END IF;
END
$$;--> statement-breakpoint

-- ── Transactional outbox ──────────────────────────────────────────────────────
-- Column names are Debezium EventRouter defaults; do not rename them. Written in
-- the same transaction as the domain change it announces. Not RLS-scoped:
-- platform events carry no tenant, and only Debezium ever reads this table.
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregatetype" text NOT NULL,
	"aggregateid" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"tenant_id" uuid, -- si:when multi-tenant
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Set by the in-process dispatcher in a single deployable; untouched in a
	-- microservice deployment, where Debezium tails the WAL instead. Present in
	-- both so splitting apart later is an infrastructure change, not a migration.
	"dispatched_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "outbox_events_created_idx" ON "outbox_events" ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_undispatched_idx" ON "outbox_events" ("created_at") WHERE "dispatched_at" IS NULL;--> statement-breakpoint

-- Consumer-side idempotency. Kafka delivery is at-least-once, so a redelivery
-- must be a no-op rather than a second application of the side effect.
CREATE TABLE "processed_events" (
	"event_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id", "consumer")
);--> statement-breakpoint
CREATE INDEX "processed_events_at_idx" ON "processed_events" ("processed_at");--> statement-breakpoint

-- ── Request idempotency ───────────────────────────────────────────────────────
-- A client that times out and retries a POST would otherwise create the charge
-- twice, and could not tell — it never saw the first response. The unique index
-- is the mechanism: the first request wins the insert, every retry loses it and
-- reads the winner's stored response.
CREATE TYPE "idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint

CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid, -- si:when multi-tenant
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	-- Same key with a different body is a client bug. Replaying the old response
	-- for it would hide a real mistake, so it is rejected instead.
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
-- Scoped by tenant: a key from one tenant can never collide with another's.
CREATE UNIQUE INDEX "idempotency_tenant_key" ON "idempotency_keys" ("tenant_id", "key", "method", "path");--> statement-breakpoint -- si:when multi-tenant
CREATE UNIQUE INDEX "idempotency_key" ON "idempotency_keys" ("key", "method", "path");--> statement-breakpoint -- si:when single-tenant
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" ("expires_at");--> statement-breakpoint

-- ── Change data capture ───────────────────────────────────────────────────────
-- Debezium tails the WAL for exactly one table. A publication scoped to
-- outbox_events means no other table's changes ever leave this database.
CREATE PUBLICATION "simbkit_outbox" FOR TABLE "outbox_events";--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simbkit_dbz') THEN
    GRANT SELECT ON TABLE "outbox_events" TO simbkit_dbz;
  END IF;
END
$$;
