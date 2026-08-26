/** Membership roles, highest privilege first. Keep in sync with the DB enum. */
export type Role = 'owner' | 'admin' | 'member';

/**
 * Decoded access-token claims, attached to the request by JwtAccessGuard.
 *
 * `permissions` travels IN the token on purpose. A guard that had to look the
 * membership up in a database would only work inside the service that owns the
 * identity tables — every other service would need a call to identity on every
 * request, which is a synchronous dependency on the hot path and a second point
 * of failure for the whole estate.
 *
 * The cost is staleness: revoking a permission takes effect when the access
 * token next refreshes (15 minutes). If something must revoke instantly, it is
 * not a permission — it is a check against live state in the owning service.
 */
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  /** Granted permission keys. Absent means none beyond the role. */
  permissions?: string[];
}

/** Request-context metadata carried into session/refresh-token records. */
export interface AuthSessionMeta {
  ip?: string;
  userAgent?: string | null;
}
