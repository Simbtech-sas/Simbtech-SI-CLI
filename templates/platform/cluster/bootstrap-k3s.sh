#!/usr/bin/env bash
#
# Installs k3s on the control plane and joins every worker over the WireGuard
# mesh. Guarded, so re-running only touches nodes that are not yet members.
#
#   ./cluster/bootstrap-k3s.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_inventory
assert_inventory_aligned

CP_IP="$SIMBKIT_CONTROL_PLANE_IP"
CP_WG="$SIMBKIT_CONTROL_PLANE_WG_IP"

log "control plane: $SIMBKIT_CONTROL_PLANE_NAME"
remote "$CP_IP" bash -s <<REMOTE
set -euo pipefail
if systemctl is-active --quiet k3s; then
  echo "    already a server, leaving it alone"
  exit 0
fi
curl -sfL https://get.k3s.io | \
  INSTALL_K3S_VERSION='${SIMBKIT_K3S_VERSION}' \
  INSTALL_K3S_EXEC="server \
    --node-name ${SIMBKIT_CONTROL_PLANE_NAME} \
    --node-ip ${CP_WG} \
    --advertise-address ${CP_WG} \
    --flannel-iface ${SIMBKIT_K3S_FLANNEL_IFACE} \
    --write-kubeconfig-mode=0600 \
    --tls-san ${CP_IP} --tls-san ${CP_WG}" sh -
REMOTE

TOKEN="$(remote "$CP_IP" cat /var/lib/rancher/k3s/server/node-token | tr -d '\r\n')"
[ -n "$TOKEN" ] || die "could not read the node token from the control plane"

read -ra IPS <<<"${SIMBKIT_WORKER_IPS:-}"
read -ra NAMES <<<"${SIMBKIT_WORKER_NAMES:-}"
read -ra WGS <<<"${SIMBKIT_WORKER_WG_IPS:-}"

for i in "${!IPS[@]}"; do
  log "worker: ${NAMES[$i]}"
  remote "${IPS[$i]}" bash -s <<REMOTE
set -euo pipefail
if systemctl is-active --quiet k3s-agent; then
  echo "    already joined, leaving it alone"
  exit 0
fi
curl -sfL https://get.k3s.io | \
  INSTALL_K3S_VERSION='${SIMBKIT_K3S_VERSION}' \
  K3S_URL='https://${CP_WG}:6443' \
  K3S_TOKEN='${TOKEN}' \
  INSTALL_K3S_EXEC="agent \
    --node-name ${NAMES[$i]} \
    --node-ip ${WGS[$i]} \
    --flannel-iface ${SIMBKIT_K3S_FLANNEL_IFACE}" sh -
REMOTE
done

log "fetching kubeconfig"
mkdir -p "$SCRIPT_DIR/bootstrap"
remote "$CP_IP" cat /etc/rancher/k3s/k3s.yaml \
  | sed "s|127.0.0.1|${CP_IP}|" > "$SCRIPT_DIR/bootstrap/kubeconfig.yaml"
chmod 600 "$SCRIPT_DIR/bootstrap/kubeconfig.yaml"

log "done — KUBECONFIG=$SCRIPT_DIR/bootstrap/kubeconfig.yaml kubectl get nodes"
