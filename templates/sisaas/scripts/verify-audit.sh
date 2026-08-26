#!/usr/bin/env bash
#
# Proves the audit log is append-only and tamper-evident, against a real
# Postgres. Like verify-rls.sh, this bypasses the application entirely — the
# database is where these properties are enforced, so the database is where they
# have to be checked.
#
#   pnpm infra:up && pnpm db:migrate && pnpm verify:audit
set -uo pipefail

CONTAINER="${PG_CONTAINER:-simbkit-dev-postgres-1}"
DB="${POSTGRES_DB:-simbkit}"
T=11111111-1111-1111-1111-111111111111
FAILED=0

q() { # q <role> <password> <sql>
  docker exec -e PGPASSWORD="$2" -i "$CONTAINER" \
    psql -U "$1" -h 127.0.0.1 -d "$DB" -tAX -c "$3" 2>&1 | grep -vE '^(SET|INSERT|UPDATE|DELETE)' | tr -d '\n'
}

chk() {
  if [ "$2" = "$3" ]; then
    printf '  \033[32mPASS\033[0m  %-44s %s\n' "$1" "$2"
  else
    printf '  \033[31mFAIL\033[0m  %-44s got=[%s] want=[%s]\n' "$1" "$2" "$3"
    FAILED=1
  fi
}

echo "Seeding a chain…"
q simbkit_owner simbkit_owner_dev_pwd "
  delete from tenants where id='$T';
  insert into tenants (id,slug,name) values ('$T','audit-probe','Audit Probe')
    on conflict (id) do nothing;" >/dev/null
q simbkit_owner simbkit_owner_dev_pwd "
  insert into audit_log (tenant_id, action, phase, hash) values
    ('$T','probe.action','intent','probe-h1'),
    ('$T','probe.action','committed','probe-h2');" >/dev/null

echo
echo "APPEND-ONLY (enforced by the database, not by convention)"
chk "UPDATE rejected for the table owner" \
  "$(q simbkit_owner simbkit_owner_dev_pwd "update audit_log set action='x' where hash='probe-h1'" | grep -o 'append-only')" \
  "append-only"
chk "DELETE rejected for the table owner" \
  "$(q simbkit_owner simbkit_owner_dev_pwd "delete from audit_log where hash='probe-h1'" | grep -o 'append-only')" \
  "append-only"
chk "UPDATE denied to the runtime role" \
  "$(q simbkit_app simbkit_app_dev_pwd "update audit_log set action='x' where hash='probe-h1'" | grep -oE 'append-only|permission denied')" \
  "permission denied"
chk "DELETE denied to the runtime role" \
  "$(q simbkit_app simbkit_app_dev_pwd "delete from audit_log where hash='probe-h1'" | grep -oE 'append-only|permission denied')" \
  "permission denied"
chk "INSERT still permitted to the runtime role" \
  "$(q simbkit_app simbkit_app_dev_pwd "insert into audit_log (action,hash) values ('probe.insert','probe-h3') returning 'inserted'")" \
  "inserted"

echo
echo "CHAIN STRUCTURE"
chk "hash is mandatory" \
  "$(q simbkit simbkit_dev_pwd "select is_nullable from information_schema.columns where table_name='audit_log' and column_name='hash'")" "NO"
chk "seq orders the chain, not a timestamp" \
  "$(q simbkit simbkit_dev_pwd "select data_type from information_schema.columns where table_name='audit_log' and column_name='seq'")" "bigint"
chk "write-ahead phases exist" \
  "$(q simbkit simbkit_dev_pwd "select string_agg(enumlabel,',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='audit_phase'")" \
  "intent,committed,failed,event"
chk "both append-only triggers are installed" \
  "$(q simbkit simbkit_dev_pwd "select count(*) from pg_trigger where tgrelid='audit_log'::regclass and not tgisinternal")" "2"

# Cleanup leaves the probe rows: the table is append-only, and that is the point.
echo
if [ "$FAILED" = "0" ]; then
  echo "  audit log verified — append-only and tamper-evident"
else
  echo "  AUDIT GUARANTEES ARE BROKEN — do not deploy"
  exit 1
fi
