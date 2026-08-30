// Barrel for every table. Drizzle needs one place that re-exports all schema so
// the query client and drizzle-kit see the whole model.
//
// `identity.ts` is removed by the `service` profile — a service that is not the
// identity service holds no user records. `tenants.ts` is removed by the
// single-tenant build, and a barrel still re-exporting it is a MODULE_NOT_FOUND
// at boot that the compiler does not catch.
export * from './tenants'; // si:when multi-tenant
export * from './identity'; // si:when auth-builtin
export * from './audit';
export * from './events';
export * from './idempotency';
export * from './widgets';
// si:schema
