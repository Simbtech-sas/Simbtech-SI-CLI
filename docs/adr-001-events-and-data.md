# ADR-001 — Inter-service events (Kafka) and shared database-as-a-service

Status: accepted · 2026-08-28

## Context

The backend is one repo per service. Services must communicate, and they must
store data. The reference infrastructure (`MYDERMALIFE/platform`) already runs
Strimzi Kafka, Debezium, and an installed-but-unused CloudNativePG operator,
while every API still gets its own in-tree Postgres `StatefulSet` — 13 of them.

## Decision 1 — services communicate by events, published through an outbox

**Services never call `producer.send()`.** A service writes its domain change and
an `outbox_events` row in the *same* transaction; Debezium's EventRouter tails the
WAL and publishes to Kafka. This is the only way to get atomicity between "the
thing happened" and "the event was announced" without distributed transactions.

Three pieces, all generated:

1. **`@<brand>/events`** — one small published package, depended on by every
   service repo. Holds topic names, a Zod schema per event type, and the derived
   TypeScript types. Adding an event is a PR to one repo; consumers get a compile
   error when a producer changes a payload.

   Chosen over Avro + a schema registry: the whole estate is TypeScript, so a
   typed package gives compile-time *and* runtime checking with one dependency
   and no registry to operate. Revisit if a non-TS service ever joins.

2. **Producing** — `OutboxService.publish(tx, event)` validates against the
   contract schema and inserts into `outbox_events`
   (`id, aggregatetype, aggregateid, type, payload jsonb, created_at`) — the
   column names Debezium's EventRouter expects. `si scaffold <Entity>` emits the
   publish call in the generated create/update/delete commands.

3. **Consuming** — a `KafkaConsumerModule` (kafkajs) with a handler registry.
   **Consumption is idempotent by construction:** a `processed_events`
   table keyed `(event_id, consumer_group)` with a unique constraint; a redelivery
   hits the constraint, is acked, and does nothing. Debezium is at-least-once, so
   this is not optional. Failures retry with backoff, then go to a per-consumer
   DLQ topic rather than blocking the partition.

## Decision 2 — one Postgres cluster as a service, one database per service

A single **CloudNativePG `Cluster`** in a `data` namespace, exposed cluster-wide
as `<cluster>-rw.data.svc.cluster.local:5432` (plus `-ro` for read replicas).
Configured with `wal_level=logical` so Debezium can tail it.

**Each service owns its own database and role inside that cluster.**
`si service add <name>` provisions the database, an owner role, and a `<name>-db`
Secret (via the secret-bootstrap Job idiom, never plaintext in git).

This replaces 13 hand-rolled StatefulSets with one operator that handles failover,
backups to S3/MinIO, and PITR — and it finishes the CNPG migration the reference
platform started and left unused.

### What this deliberately is not

Not a single shared schema that every service reads and writes. That couples
deployments, makes any migration a cross-team negotiation, and removes the
autonomy that having one repo per service exists to provide. "DB as a service"
here means *one managed cluster, many isolated databases* — services reach each
other's data through events, not through each other's tables.

Postgres RLS tenant isolation is unchanged and still applies inside each
service's own database.

### A superuser owner makes FORCE decorative

`FORCE ROW LEVEL SECURITY` makes a policy apply to the table's owner — but
**nothing** constrains a superuser, FORCE included. The SAAS-skill template ran
migrations as `POSTGRES_USER`, which the Postgres image creates as a superuser, so
adding FORCE alone would have shipped a security property that does not hold and a
doc claiming it does.

The template therefore creates a separate `<brand>_owner` role — `NOSUPERUSER`,
`NOBYPASSRLS` — that owns every table and runs every migration.
`MIGRATION_DATABASE_URL` points at it. `scripts/verify-rls.sh` asserts
`rolsuper = false` for that role alongside the isolation checks, so the
arrangement cannot silently regress.

## Consequences

- The platform flavor ships: Strimzi + a `Kafka` CR, a CNPG `Cluster` CR, and
  per-service `KafkaTopic` + Debezium Server Deployment.
- The SiSAAS backend template gains an `events` module (outbox + consumer +
  `processed_events`) and an `outbox_events` migration.
- `si service add <name>` generates, in one command: the service repo from the
  backend template, its database and role in the shared cluster, the ArgoCD
  `Application`, the `KafkaTopic`, and the Debezium Server deployment.
- Single point of failure moves from 13 single-instance StatefulSets to one
  replicated cluster — strictly better, but it must be replicated (`instances: 3`)
  and backed up, not run as `instances: 1`.
