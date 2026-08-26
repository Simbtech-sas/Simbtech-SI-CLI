#!/usr/bin/env bash
#
# For a no-network app, "can it reach anything" IS the security question, and the
# offline verifier answers it against the built bundle. This wrapper exists so
# every flavor exposes the same command.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -d dist ]; then
  echo "  no build to inspect — run \`npm run build\` (it runs this check itself)"
  exit 0
fi
node scripts/verify-offline.mjs
