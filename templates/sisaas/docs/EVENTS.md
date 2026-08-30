# Events

How this service talks to other services. The rule in one line:

> **A service never calls `producer.send()`.** It writes an outbox row in the same
> transaction as the domain change, and Debezium publishes.

## Why

If you write the row and then publish, a crash between the two leaves the change
made and unannounced. If you publish and then write, a crash leaves an event for
something that never happened. Neither is fixable with retries. The outbox makes
"it happened" and "it was announced" the same commit.

## Producing

<!-- si:when-begin multi-tenant -->
```ts
// application/widgets.service.ts
return this.db.runInTenantContext(tenantId, async (tx) => {
  const widget = await this.repo.create(tx, tenantId, input);
  await this.outbox.publish(tx, WidgetCreated, {
    aggregateId: widget.id,
    tenantId,
    payload: { id: widget.id, name: widget.name, quantity: widget.quantity },
  });
  return widget;
});
```
<!-- si:when-end -->
<!-- si:when-begin single-tenant -->
```ts
// application/widgets.service.ts
return this.db.transaction(async (tx) => {
  const widget = await this.repo.create(tx, input);
  await this.outbox.publish(tx, WidgetCreated, {
    aggregateId: widget.id,
    payload: { id: widget.id, name: widget.name, quantity: widget.quantity },
  });
  return widget;
});
```
<!-- si:when-end -->

`publish` validates against the contract in `@simbkit/events` before the row is
written, so a malformed payload fails here rather than in a consumer.

Kafka being down cannot fail this — it is a table insert. Debezium catches up
when the broker returns.

## Consuming

Register in a module's `onModuleInit`:

<!-- si:when-begin multi-tenant -->
```ts
this.registry.on(TenantProvisioned, 'seed-starter-widget', async (event, tx) => {
  await this.repo.create(tx, event.payload.tenantId, { ... });
});
```
<!-- si:when-end -->
<!-- si:when-begin single-tenant -->
```ts
this.registry.on(UserRegistered, 'seed-starter-widget', async (event, tx) => {
  await this.repo.create(tx, { ... });
});
```
<!-- si:when-end -->

The handler runs **inside** the transaction that claims the event, so its writes
and the `processed_events` row commit together.

Three properties that are not optional:

- **Idempotent.** Kafka is at-least-once; every consumer will see duplicates. The
  claim is an `INSERT … ON CONFLICT DO NOTHING` on `processed_events`
  `(event_id, consumer)`. A redelivery inserts nothing and the handler is skipped.
- **Retried, then parked.** Three attempts with backoff, then the message goes to
  `<topic>.dlq` with the failure reason in a header. A poison message that stays
  on the partition blocks everything behind it forever.
- **Contract-checked.** A payload that fails its schema goes straight to the DLQ —
  no retry will make it valid.

## Where it runs

The consumer starts in the **worker**, not the API (`EventsModule.forRoot({
consume })`). Event handling is background work; an API restart should not drop a
half-handled event. Publishing works in both.

A feature module must be imported in `worker.module.ts` as well as
`app.module.ts`, or its handlers never register.

## Topics

`<service>.<aggregate>.v<version>`, derived in `@simbkit/events` — never typed by
hand. The producer's `aggregatetype` column is what Debezium routes on, so it must
equal the contract's `aggregate`.

Payloads are versioned by topic. **Never change one in place**: add optional
fields, or bump the version and publish to a new topic. Consumers deploy on their
own schedule.

## Local development

`pnpm infra:up` starts Redpanda (Kafka API), the Redpanda console on
<http://localhost:8080>, and Debezium Server already wired to the outbox. Publish
something, then watch it arrive in the console.

Without `KAFKA_BROKERS` set, the consumer simply does not start — the normal state
when you are only working on HTTP endpoints.

## Configuration coupling to know about

The Debezium `EventRouter` settings in `infra/docker-compose.yml` and the header
names in `modules/events/application/event-consumer.service.ts` are two halves of
one contract (`id`, `eventType`, `tenantId`). Change one, change the other. In the
cluster those settings come from the platform repo instead.
