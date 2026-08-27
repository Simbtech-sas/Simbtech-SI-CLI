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
  (cd "packages/$p" && npm version "$VERSION" --no-git-tag-version >/dev/null)
  echo "  packages/$p -> $VERSION"
done

echo "==> publish"
for p in "${PACKAGES[@]}"; do
  # pnpm rewrites workspace:* to the real version on publish; npm does not.
  (cd "packages/$p" && pnpm publish --no-git-checks --access restricted)
  echo "  published packages/$p"
done

echo "==> tag"
git add -A
git commit -m "release: v$VERSION"
git tag "v$VERSION"
echo
echo "done. Push with: git push && git push --tags"
echo "Templates are fetched by tag, so push the tag or \`si new\` still serves the old ones."
