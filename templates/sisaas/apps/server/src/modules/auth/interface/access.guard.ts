/**
 * The guard every protected route uses.
 *
 * Aliased so controllers never name a provider: swapping the built-in identity
 * for Keycloak replaces this one file, not every controller in the codebase.
 *
 * This is the built-in default. Choosing an external provider swaps in
 * `variants/access.guard.oidc.ts` — a two-line file, because two mutually
 * exclusive exports of one name cannot coexist in a template that must compile
 * before any choice is applied.
 */
export { JwtAccessGuard as AccessGuard } from './jwt-access.guard';
