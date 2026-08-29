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
# Uses pnpm, not npm: only pnpm rewrites the workspace protocol on publish.
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

  # Attempt, then read the outcome. `npm view` as a pre-check is unreliable
  # right after a publish — the registry takes a moment to serve the new
  # version, and a stale 404 made this script try to republish and abort the
  # whole run on the very package that had just succeeded.
  #
  # "cannot publish over the previously published versions" IS the success
  # state for a re-run, so it is treated as one.
  log=$(mktemp)
  # `pnpm publish`, NOT `npm publish`. Only pnpm rewrites `workspace:*` into the
  # real version. Publishing with npm shipped 0.1.0 with `workspace:*` in the
  # manifest, and every install of it failed with EUNSUPPORTEDPROTOCOL.
  if ( cd "packages/$pkg" && pnpm publish --access public --no-git-checks ) >"$log" 2>&1; then
    echo "  + $name@$version published"
  elif grep -q "cannot publish over" "$log"; then
    echo "  = $name@$version already published"
  else
    echo "  ! $name@$version FAILED"
    grep -vE "^npm notice" "$log" | tail -4 | sed 's/^/      /'
    rm -f "$log"
    exit 1
  fi
  rm -f "$log"
done

echo
echo "Verifying what the registry actually has:"
for pkg in core tools nest si; do
  name=$(node -p "require('./packages/$pkg/package.json').name")
  printf '  %-20s %s\n' "$name" "$(npm view "$name" version 2>/dev/null || echo 'NOT PUBLISHED')"
done
