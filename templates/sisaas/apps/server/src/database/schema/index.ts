// Barrel for every table. Drizzle needs one place that re-exports all schema so
// the query client and drizzle-kit see the whole model.
//
// `identity.ts` is removed by the `service` profile — a service that is not the
// identity service holds no user records.
export * from './tenants';
export * from './identity'; // si:when auth-builtin
export * from './audit';
export * from './events';
export * from './idempotency';
export * from './widgets';
// si:schema
