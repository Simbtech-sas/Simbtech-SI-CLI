# @simbkit/events

The contract between services. Every topic name and every payload shape is
declared here once, and every service repo depends on this package.

Because it is TypeScript, a producer that changes a payload breaks its consumers
at **compile time** — which is the whole reason this is a package rather than an
Avro schema in a registry.

## Adding an event

```ts
export const WidgetArchived = defineEvent({
  service: 'simbkit',
  aggregate: 'widget',
  type: 'WidgetArchived',
  version: 1,
  schema: z.object({ id: z.string().uuid(), reason: z.string() }),
});
```

Then register it in `EVENTS` at the bottom of `src/index.ts`.

## Rules

- **Never change a payload in place.** Add fields as optional, or bump `version`
  and publish to a new topic. Consumers deploy on their own schedule; an
  in-place required-field change breaks whoever is behind.
- **`aggregate` is the routing key.** It must match `aggregatetype` in the
  producer's `outbox_events` row — that is what Debezium reads to pick the topic.
- **Publish once this package is versioned and released.** Services pin a range;
  a breaking change is a major bump.
