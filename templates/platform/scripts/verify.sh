#!/usr/bin/env bash
#
# Everything that can be checked without a cluster. Run it in CI: a broken
# manifest discovered by Argo at 2am is a manifest that should have failed here.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
step() { printf '\n== %s\n' "$1"; }

step "bash syntax"
for f in cluster/*.sh scripts/*.sh; do
  bash -n "$f" && echo "  ok  $f" || { echo "  FAIL $f"; fail=1; }
done

step "shellcheck"
if command -v shellcheck >/dev/null; then
  shellcheck -S warning cluster/*.sh scripts/*.sh && echo "  clean" || fail=1
else
  echo "  skipped (not installed)"
fi

step "YAML parses"
python3 - <<'PY' || fail=1
import glob, sys, yaml
bad = 0
for f in sorted(glob.glob('gitops/**/*.yaml', recursive=True)):
    try:
        docs = [d for d in yaml.safe_load_all(open(f)) if d]
        for d in docs:
            if 'kind' not in d:
                print(f'  FAIL {f}: a document has no kind'); bad = 1
        print(f'  ok  {f} ({len(docs)} doc)')
    except Exception as e:
        print(f'  FAIL {f}: {e}'); bad = 1
sys.exit(bad)
PY

step "no plaintext credentials committed"
# Two live passwords were committed in the repo this pattern came from. Secrets
# are generated in-cluster or read from a secretKeyRef — never written here.
if grep -rInE '(password|secret|token|api[_-]?key)\s*:\s*["'"'"']?[A-Za-z0-9+/]{12,}' \
     gitops/ cluster/ --include='*.yaml' --include='*.env' 2>/dev/null | grep -v 'secretKeyRef' ; then
  echo "  FAIL a credential looks committed"; fail=1
else
  echo "  clean"
fi

step "control plane"
npm --prefix apps/control-plane run --silent typecheck && echo "  typecheck ok" || fail=1
npm --prefix apps/control-plane test --silent 2>&1 | tail -3 || fail=1

printf '\n'
if [ "$fail" -eq 0 ]; then echo "platform verified"; else echo "VERIFICATION FAILED"; exit 1; fi
