/**
 * The guard every protected route uses, backed by an external OIDC provider.
 * Swapped in over `access.guard.ts` when auth is Keycloak or ZITADEL.
 */
export { OidcAccessGuard as AccessGuard } from './oidc-access.guard';
