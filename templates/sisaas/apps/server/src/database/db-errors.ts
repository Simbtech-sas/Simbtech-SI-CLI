/**
 * True if the error (or any error in its `cause` chain) is a Postgres
 * unique-violation (SQLSTATE 23505). Drizzle wraps driver errors, so the
 * original `code` may be nested under `.cause`.
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur = e as { code?: unknown; cause?: unknown } | null | undefined;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur.code === '23505') return true;
    cur = cur.cause as { code?: unknown; cause?: unknown } | null | undefined;
  }
  return false;
}
