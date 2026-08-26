/**
 * JWT verification parameters. Shared so every verifier agrees — a single
 * unpinned call site is enough to undo the others.
 */

/**
 * The ONLY algorithm accepted, on signing and on verification.
 *
 * Without an explicit allowlist, a verifier accepts whatever the token's own
 * header asks for. That is the algorithm-confusion family: `alg: none` strips
 * the signature entirely, and `alg` swapped between HMAC and RSA lets a public
 * key be used as an HMAC secret. Pinning is the fix, and it must be pinned at
 * every call site — the token decides otherwise.
 */
export const JWT_ALGORITHM = 'HS256' as const;

/**
 * Who minted the token. Only the identity service ever does.
 *
 * Verifying `iss` means a token from some other system that happens to share a
 * secret — a staging environment, a vendor, a copied config — is rejected rather
 * than honoured.
 */
export const JWT_ISSUER = 'simbkit-identity';

/** Access-token lifetime. Short, because revocation is refresh-time. */
export const ACCESS_TOKEN_TTL = '15m';
