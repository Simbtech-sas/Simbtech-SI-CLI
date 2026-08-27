# shellcheck shell=bash
# Shared helpers. Sourced, never executed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export SCRIPT_DIR REPO_ROOT

# Paths are derived from THIS file's location, never from $PWD. The repo this was
# modelled on computed "$PWD/infra/gitops", which only worked from one directory.
GITOPS="$REPO_ROOT/gitops"
export GITOPS

load_inventory() {
  local file="${1:-$SCRIPT_DIR/inventory.env}"
  [ -f "$file" ] || die "no inventory at $file (copy inventory.env.example, or generate it from the control plane)"
  # shellcheck disable=SC1090
  source "$file"
}

die() {
  echo "error: $*" >&2
  exit 1
}

log() { echo "==> $*"; }

# The three worker lists describe the same nodes positionally. If they ever drift,
# every downstream step silently configures the wrong host.
assert_inventory_aligned() {
  read -ra _ips <<<"${SIMBKIT_WORKER_IPS:-}"
  read -ra _names <<<"${SIMBKIT_WORKER_NAMES:-}"
  read -ra _wgs <<<"${SIMBKIT_WORKER_WG_IPS:-}"
  if [ "${#_ips[@]}" -ne "${#_names[@]}" ] || [ "${#_ips[@]}" -ne "${#_wgs[@]}" ]; then
    die "inventory lists are not the same length: ${#_ips[@]} ips, ${#_names[@]} names, ${#_wgs[@]} wg ips"
  fi
}

# ssh/scp with whichever auth the inventory specifies.
remote() {
  local host="$1"
  shift
  if [ -n "${SIMBKIT_SSH_PASSWORD:-}" ]; then
    command -v sshpass >/dev/null || die "SIMBKIT_SSH_PASSWORD is set but sshpass is not installed"
    sshpass -p "$SIMBKIT_SSH_PASSWORD" ssh -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile=/dev/null "${SIMBKIT_SSH_USER}@${host}" "$@"
  else
    ssh -i "${SIMBKIT_SSH_KEY/#\~/$HOME}" -o StrictHostKeyChecking=accept-new \
      "${SIMBKIT_SSH_USER}@${host}" "$@"
  fi
}

remote_copy() {
  local src="$1" host="$2" dest="$3"
  if [ -n "${SIMBKIT_SSH_PASSWORD:-}" ]; then
    sshpass -p "$SIMBKIT_SSH_PASSWORD" scp -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile=/dev/null "$src" "${SIMBKIT_SSH_USER}@${host}:${dest}"
  else
    scp -i "${SIMBKIT_SSH_KEY/#\~/$HOME}" -o StrictHostKeyChecking=accept-new \
      "$src" "${SIMBKIT_SSH_USER}@${host}:${dest}"
  fi
}

# Every node, as "<public ip> <name> <wg ip>" lines. One source of truth for the
# loops below AND for /etc/hosts, which the reference hardcoded to three entries.
all_nodes() {
  echo "${SIMBKIT_CONTROL_PLANE_IP} ${SIMBKIT_CONTROL_PLANE_NAME} ${SIMBKIT_CONTROL_PLANE_WG_IP}"
  read -ra _ips <<<"${SIMBKIT_WORKER_IPS:-}"
  read -ra _names <<<"${SIMBKIT_WORKER_NAMES:-}"
  read -ra _wgs <<<"${SIMBKIT_WORKER_WG_IPS:-}"
  local i
  for i in "${!_ips[@]}"; do
    echo "${_ips[$i]} ${_names[$i]} ${_wgs[$i]}"
  done
}

# Generated from the inventory, so an N-th node resolves without editing a script.
render_etc_hosts() {
  echo "# managed by simbkit-platform — regenerated on every bootstrap"
  all_nodes | while read -r _ip name wg; do
    echo "$wg $name # simbkit-cluster"
  done
}
