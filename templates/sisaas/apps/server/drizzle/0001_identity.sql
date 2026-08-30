-- IDENTITY SERVICE ONLY. Removed by the `service` profile.
--
-- These tables are the single source of truth for who a user is. A second
-- service holding its own copy is two answers to the same question, and they
-- diverge the first time one of them is written to.
--
-- Not RLS-scoped: login must resolve a user's memberships ACROSS tenants before -- si:when multi-tenant
-- any tenant context exists. The auth layer guards them in code instead. -- si:when multi-tenant
-- Not RLS-scoped, because nothing here is: there is one organisation. The auth -- si:when single-tenant
-- layer is what guards these tables. -- si:when single-tenant

CREATE TYPE "membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint -- si:when multi-tenant
CREATE TYPE "user_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint -- si:when single-tenant
CREATE TYPE "user_status" AS ENUM('active', 'disabled');--> statement-breakpoint

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL UNIQUE,
	"password_hash" text,
	"name" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	-- si:when-begin single-tenant
	-- No memberships table, so the role and its overrides live on the user.
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	-- si:when-end
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- si:when-begin multi-tenant
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"role" "membership_role" NOT NULL,
	-- Granted permissions. Copied into the access token at login, so every other
	-- service can authorise without reading this table.
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user" UNIQUE("tenant_id", "user_id")
);--> statement-breakpoint
-- si:when-end

CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE, -- si:when multi-tenant
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_hash" text,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" ("token_hash");
