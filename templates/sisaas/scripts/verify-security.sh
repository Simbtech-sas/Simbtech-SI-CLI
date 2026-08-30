#!/usr/bin/env bash
#
# Static security checks that fail the build.
#
# These are the invariants a code review reliably misses: one unpinned JWT
# verifier, one committed secret, one route that forgot its guard. Each check
# exists because its absence is exploitable, not because it looks thorough.
#
#   pnpm verify:security
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SRC="apps/server/src"
fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

# Comments describe intent; only code is a vulnerability. Strips //, /*, /** and
# continuation-* lines, so a comment saying "never use X" is not a report of X.
code() { grep -rn --include='*.ts' "$1" "$SRC" | grep -vE ':[0-9]+:[[:space:]]*(//|/\*|\*)'; }

echo "JWT"
verifiers=$(code 'verifyAsync' | wc -l)
pinned=$(grep -rn --include='*.ts' -A6 'verifyAsync' "$SRC" | grep -c 'algorithms:')
if [ "$verifiers" -gt 0 ] && [ "$pinned" -ge "$verifiers" ]; then
  pass "all $verifiers verifier(s) pin an algorithm"
else
  bad "$verifiers verifier(s), only $pinned pin an algorithm — an unpinned one accepts alg:none"
fi
if code "algorithm: JWT_ALGORITHM" >/dev/null; then
  pass "signer pins the same algorithm"
else
  bad "the signer does not pin an algorithm"
fi
if code "issuer:" >/dev/null; then pass "issuer is validated"; else bad "no issuer validation"; fi

echo "Secrets"
if grep -qE 'min\(32\)' "$SRC/config/env.schema.ts"; then
  pass "secrets must be >= 32 chars"
else
  bad "env schema allows a short secret"
fi
# A real .env with dev placeholders is a production incident waiting to happen.
if [ -f apps/server/.env ] && grep -qE '^(JWT_[A-Z_]+|ENCRYPTION_KEY)=.*change_me' apps/server/.env; then
  if [ "${NODE_ENV:-development}" = production ]; then
    bad "apps/server/.env still holds dev placeholder secrets"
  else
    pass "dev placeholders present (development only)"
  fi
else
  pass "no placeholder secrets in .env"
fi
if git ls-files --error-unmatch apps/server/.env >/dev/null 2>&1; then
  bad "apps/server/.env is committed to git"
else
  pass ".env is not tracked by git"
fi

echo "Crypto"
if code "aes-256-gcm" >/dev/null; then
  pass "authenticated encryption (GCM)"
else
  bad "no authenticated cipher found"
fi
# CBC without a MAC is how padding-oracle attacks happen.
if code "aes-256-cbc\|createCipher(" >/dev/null; then
  bad "unauthenticated or deprecated cipher in use"
else
  pass "no unauthenticated cipher"
fi
if code "timingSafeEqual" >/dev/null; then
  pass "constant-time comparison available"
else
  bad "no constant-time comparison — === on a secret leaks it through timing"
fi
if code "Math.random()" >/dev/null; then
  bad "Math.random() is used — never for anything security-relevant"
else
  pass "no Math.random()"
fi

echo "HTTP"
for control in fastifyHelmet fastifyRateLimit enableCors bodyLimit; do
  if grep -q "$control" "$SRC/main.ts"; then pass "$control configured"; else bad "$control missing from main.ts"; fi
done
if grep -q 'LoginThrottleGuard' "$SRC/modules/iam/interface/auth.controller.ts" 2>/dev/null; then
  pass "credential endpoints are throttled"
elif [ ! -d "$SRC/modules/iam" ]; then
  pass "no credential endpoints in this profile"
else
  bad "auth controller has no login throttle — the global limiter allows 300 guesses/min"
fi

# si:when-begin multi-tenant
echo "Tenancy"
if grep -q 'FORCE ROW LEVEL SECURITY' apps/server/drizzle/*.sql; then
  pass "RLS is forced (see verify:rls for the live proof)"
else
  bad "no FORCE ROW LEVEL SECURITY in any migration"
fi
if code "req.body.*tenantId\|body.tenantId" >/dev/null; then
  bad "a tenant id is read from a request body — it must come from the verified token"
else
  pass "tenant id never read from a request body"
fi
# si:when-end

# si:when-begin single-tenant
# There is no RLS here, so the guard on the controller is the entire boundary.
# That makes an unguarded controller the equivalent of a missing policy, and it
# is the thing worth failing the build over.
echo "Access control"
unguarded=""
for c in $(find apps/server/src/modules -name '*.controller.ts' 2>/dev/null); do
  grep -q '@UseGuards' "$c" || grep -q '@Public' "$c" || unguarded="$unguarded $c"
done
if [ -n "$unguarded" ]; then
  bad "controller with no @UseGuards:$unguarded"
else
  pass "every controller declares a guard"
fi
if code "req.body.*userId\|body.userId" >/dev/null; then
  bad "a user id is read from a request body — it must come from the verified token"
else
  pass "identity never read from a request body"
fi
# si:when-end

echo
if [ "$fail" -eq 0 ]; then echo "  security checks passed"; else echo "  SECURITY CHECKS FAILED"; exit 1; fi
