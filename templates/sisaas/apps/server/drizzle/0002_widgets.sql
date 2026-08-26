-- Example tenant-scoped feature table. Copy this shape for your own: a
-- tenant_id with a real foreign key, ENABLE + FORCE RLS, and the policy.

CREATE TABLE "widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE, -- si:when multi-tenant
	"name" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "widgets_tenant_idx" ON "widgets" ("tenant_id");--> statement-breakpoint -- si:when multi-tenant

-- si:when-begin multi-tenant
ALTER TABLE "widgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "widgets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "widgets"
	USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- si:when-end
