#!/usr/bin/env bash
#
# Scaffolds every flavor from the local templates and checks each one is at least
# structurally sound. This is the test that catches a template broken by an edit
# that never touched TypeScript.
#
# It deliberately does NOT install dependencies — that is minutes per flavor and
# belongs in CI (.github/workflows/templates.yml), not in a pre-release check.
# Hence --skip-install: chosen features are still wired in, only the package
# manager is skipped. Without the flag this scaffolds 47,000 files per flavor.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ROOT="$PWD"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FLAVORS=(sisaas simice sibile-rn sibile-flutter sibile-capacitor sical platform)
fail=0

for flavor in "${FLAVORS[@]}"; do
  out="$WORK/$flavor"
  if ! SI_TEMPLATE_DIR="$ROOT/templates" node "$ROOT/packages/si/dist/index.js" \
       new "$out" -f "$flavor" -b smoke -y --skip-install >/dev/null 2>&1; then
    echo "  FAIL $flavor: scaffold failed"; fail=1; continue
  fi

  # The template brand must not survive anywhere, in content or in a path.
  if grep -rqi 'simbkit' "$out" 2>/dev/null; then
    echo "  FAIL $flavor: template brand survived rebranding"; fail=1; continue
  fi
  if [ ! -f "$out/.si/template.json" ]; then
    echo "  FAIL $flavor: no .si/template.json"; fail=1; continue
  fi
  if [ ! -f "$out/README.md" ]; then
    echo "  FAIL $flavor: no README"; fail=1; continue
  fi

  # A flavor that ships a security gate must pass it as scaffolded. A gate that
  # only passes after hand-editing is not a gate.
  if [ -f "$out/scripts/verify-security.sh" ]; then
    if ! (cd "$out" && bash scripts/verify-security.sh >/dev/null 2>&1); then
      echo "  FAIL $flavor: verify-security fails on a freshly scaffolded project"; fail=1; continue
    fi
    echo "  ok   $flavor ($(find "$out" -type f | wc -l) files, security ok)"
  else
    echo "  ok   $flavor ($(find "$out" -type f | wc -l) files)"
  fi
done

[ "$fail" -eq 0 ] || { echo "smoke test FAILED"; exit 1; }
echo "all flavors scaffold cleanly"
echo
echo "NOTE: this checks STRUCTURE only. It does not build and does not start"
echo "      anything — run scripts/boot.sh for that, which is the gate that"
echo "      catches a project that type-checks and cannot run."
