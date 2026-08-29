#!/usr/bin/env bash
#
# Publish the four packages, in dependency order.
#
# Order matters: si-core first, because si-tools and si-nest depend on it and
# si depends on all three. Publishing the dependent first leaves a version on
# the registry that cannot install.
#
# Your npm account has 2FA on "auth-and-writes", so every publish needs a code:
#
#   scripts/publish.sh 123456        one code, reused for all four
#
# A code lasts 30 seconds and npm accepts the same one within its window; if the
# fourth publish fails on an expired code, re-run with a fresh one — the ones
# that already went out are skipped.
#
# To avoid typing a code at all, create a granular access token with
# "Bypass 2FA" at npmjs.com/settings/~/tokens and export NPM_TOKEN.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OTP="${1:-}"
ARGS=(--access public)
[ -n "$OTP" ] && ARGS+=(--otp "$OTP")

pnpm build

for pkg in core tools nest si; do
  name=$(node -p "require('./packages/$pkg/package.json').name")
  version=$(node -p "require('./packages/$pkg/package.json').version")

  # Already on the registry at this version? Nothing to do. Re-running after a
  # partial failure must not error on the ones that succeeded.
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "  = $name@$version already published"
    continue
  fi

  echo "  → publishing $name@$version"
  ( cd "packages/$pkg" && npm publish "${ARGS[@]}" )
done

echo
echo "Verifying what the registry actually has:"
for pkg in core tools nest si; do
  name=$(node -p "require('./packages/$pkg/package.json').name")
  printf '  %-20s %s\n' "$name" "$(npm view "$name" version 2>/dev/null || echo 'NOT PUBLISHED')"
done
