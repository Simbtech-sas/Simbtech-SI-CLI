#!/usr/bin/env bash
# Proves tenant isolation actually holds, against a real Postgres.
#
# These are not unit tests of application code — they bypass the app entirely and
# interrogate the database, because the database is the isolation boundary. If
# someone drops FORCE from a migration, or migrates as a superuser, or widens the
# CDC grant, exactly one of these fails.
#
#   pnpm infra:up && pnpm db:migrate && pnpm verify:rls
set -euo pipefail

CONTAINER="${PG_CONTAINER:-simbkit-dev-postgres-1}"
DB="${POSTGRES_DB:-simbkit}"
A=11111111-1111-1111-1111-111111111111
B=22222222-2222-2222-2222-222222222222
FAILED=0

q() { # q <role> <password> <sql>
  docker exec -e PGPASSWORD="$2" -i "$CONTAINER" \
    psql -U "$1" -h 127.0.0.1 -d "$DB" -tAX -c "$3" 2>&1 | grep -v '^SET$' | tr -d '\n'
}

chk() { # chk <name> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf '  \033[32mPASS\033[0m  %-40s %s\n' "$1" "$2"
  else
    printf '  \033[31mFAIL\033[0m  %-40s got=[%s] want=[%s]\n' "$1" "$2" "$3"
    FAILED=1
  fi
}

echo "Seeding two tenants…"
q simbkit_owner simbkit_owner_dev_pwd "
  delete from widgets; delete from tenants where id in ('$A','$B');
  insert into tenants (id,slug,name) values ('$A','alpha','Alpha'),('$B','beta','Beta');
  set app.tenant_id='$A'; insert into widgets(tenant_id,name) values ('$A','alpha-widget');
  set app.tenant_id='$B'; insert into widgets(tenant_id,name) values ('$B','beta-widget');" >/dev/null

echo
echo "TENANT ISOLATION"
chk "app role, no tenant context" \
  "$(q simbkit_app simbkit_app_dev_pwd 'select count(*) from widgets')" "0"
chk "app role, tenant alpha" \
  "$(q simbkit_app simbkit_app_dev_pwd "set app.tenant_id='$A'; select string_agg(name,',') from widgets")" "alpha-widget"
chk "app role, tenant beta" \
  "$(q simbkit_app simbkit_app_dev_pwd "set app.tenant_id='$B'; select string_agg(name,',') from widgets")" "beta-widget"
# The FORCE tests. These pass only because the owner is NOT a superuser —
# superusers bypass RLS unconditionally and no policy can constrain them.
chk "owner, no context [FORCE]" \
  "$(q simbkit_owner simbkit_owner_dev_pwd 'select count(*) from widgets')" "0"
chk "owner, tenant alpha [FORCE]" \
  "$(q simbkit_owner simbkit_owner_dev_pwd "set app.tenant_id='$A'; select string_agg(name,',') from widgets")" "alpha-widget"
chk "owner is not a superuser" \
  "$(q simbkit simbkit_dev_pwd "select rolsuper from pg_roles where rolname='simbkit_owner'")" "f"
chk "admin realm sees across tenants" \
  "$(q simbkit_admin simbkit_admin_dev_pwd 'select count(*) from widgets')" "2"
chk "cross-tenant INSERT rejected" \
  "$(q simbkit_app simbkit_app_dev_pwd "set app.tenant_id='$A'; insert into widgets(tenant_id,name) values('$B','sneaky')" | grep -oE 'row-level security policy')" \
  "row-level security policy"

echo
echo "CDC LEAST PRIVILEGE"
chk "dbz reads outbox_events" \
  "$(q simbkit simbkit_dev_pwd "select has_table_privilege('simbkit_dbz','outbox_events','SELECT')")" "t"
chk "dbz cannot read widgets" \
  "$(q simbkit simbkit_dev_pwd "select has_table_privilege('simbkit_dbz','widgets','SELECT')")" "f"
# Only the identity profile has a users table; a service must never grow one.
if [ "$(q simbkit simbkit_dev_pwd "select to_regclass('public.users') is not null")" = "t" ]; then
  chk "dbz cannot read users" \
    "$(q simbkit simbkit_dev_pwd "select has_table_privilege('simbkit_dbz','users','SELECT')")" "f"
else
  printf '  \033[32mPASS\033[0m  %-40s %s\n' "no identity tables (service profile)" "correct"
fi
chk "publication scoped to outbox" \
  "$(q simbkit simbkit_dev_pwd "select string_agg(tablename,',') from pg_publication_tables where pubname='simbkit_outbox'")" \
  "outbox_events"

echo
if [ "$FAILED" = "0" ]; then echo "  tenant isolation verified"; else echo "  ISOLATION IS BROKEN — do not deploy"; exit 1; fi
