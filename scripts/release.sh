#!/usr/bin/env bash
#
# Publish the four packages, in dependency order.
#
# They share a version and must move together: `si` pins its siblings exactly, so
# publishing one without the others produces an install that resolves to a
# version that does not exist.
#
#   ./scripts/release.sh 0.2.0
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "usage: ./scripts/release.sh <version>"; exit 2; }

# Dependency order. si-core has no siblings; si depends on all three.
PACKAGES=(core nest tools si)

echo "==> checks"
pnpm test
pnpm typecheck
pnpm build

echo "==> template smoke test"
./scripts/smoke.sh

echo "==> version $VERSION"
for p in "${PACKAGES[@]}"; do
  # Idempotent: a publish that fails half way leaves the earlier packages already
  # at $VERSION, and `npm version` errors rather than no-opping on a match. Being
  # able to re-run the script is worth more than the strictness.
  current=$(node -p "require('./packages/$p/package.json').version")
  if [ "$current" != "$VERSION" ]; then
    (cd "packages/$p" && npm version "$VERSION" --no-git-tag-version >/dev/null)
  fi
  echo "  packages/$p -> $VERSION"
done

echo "==> publish"
for p in "${PACKAGES[@]}"; do
  # pnpm rewrites workspace:* to the real version on publish; npm does not.
  #
  # No --access flag: each package carries `publishConfig.access` and that is the
  # single place it is declared. Passing `--access restricted` here overrode all
  # four of them and failed with 402 — private packages are a paid npm plan.
  name=$(node -p "require('./packages/$p/package.json').name")
  if npm view "$name@$VERSION" version >/dev/null 2>&1; then
    echo "  packages/$p already at $VERSION on the registry, skipping"
    continue
  fi
  (cd "packages/$p" && pnpm publish --no-git-checks)
  echo "  published packages/$p"
done

echo "==> tag"
git add -A
git commit -m "release: v$VERSION"
git tag "v$VERSION"
echo
echo "done. Push with: git push && git push --tags"
echo "Templates are fetched by tag, so push the tag or \`si new\` still serves the old ones."
