#!/usr/bin/env bash
#
# The platform's security surface is what gets committed to this repository.
# Deliberately dependency-free so it runs on a fresh clone, before any install —
# a check you cannot run yet is a check nobody runs.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

echo "Committed credentials"
# The repository this pattern came from had two live passwords and an admin
# password in git. Secrets are generated in-cluster or read from a secretKeyRef.
if grep -rInE '(password|secret|token|api[_-]?key)[[:space:]]*:[[:space:]]*["'"'"']?[A-Za-z0-9+/]{12,}' \
     gitops/ cluster/ --include='*.yaml' --include='*.env' 2>/dev/null \
     | grep -v 'secretKeyRef' | grep -v '\.example:'; then
  bad "something that looks like a credential is committed"
else
  pass "no committed credentials"
fi
if git ls-files 2>/dev/null | grep -qE 'kubeconfig|\.pem$|\.key$|inventory\.env$'; then
  bad "a kubeconfig, key or live inventory is tracked by git"
else
  pass "no kubeconfig, key or live inventory tracked"
fi

echo "Secret generation"
if grep -rq 'tr -dc' gitops/ 2>/dev/null || grep -rq 'db-credentials' apps/control-plane/src 2>/dev/null; then
  pass "credentials are generated in-cluster"
else
  bad "no in-cluster secret generation found"
fi

echo "Network exposure"
# The API server and kubelet must be reachable only over the encrypted mesh.
if grep -q 'ufw allow in on wg0' cluster/bootstrap-network.sh; then
  pass "cluster traffic is confined to the WireGuard mesh"
else
  bad "the mesh-only firewall rule is missing"
fi
if grep -qE 'ufw allow (6443|10250)' cluster/bootstrap-network.sh; then
  bad "the Kubernetes API or kubelet is exposed on the public interface"
else
  pass "API server and kubelet are not publicly exposed"
fi

echo "Data"
if grep -q 'instances: 3' gitops/data/postgres-cluster.yaml 2>/dev/null; then
  pass "the shared database is replicated"
else
  bad "the shared database is single-instance — consolidating concentrates the risk"
fi
if [ -f gitops/data/scheduled-backup.yaml ]; then
  pass "backups are scheduled"
else
  bad "no scheduled backup"
fi

echo
if [ "$fail" -eq 0 ]; then echo "  security checks passed"; else echo "  SECURITY CHECKS FAILED"; exit 1; fi
