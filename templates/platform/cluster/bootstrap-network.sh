#!/usr/bin/env bash
#
# Prepares every node and builds the WireGuard full mesh the cluster runs over.
#
# Idempotent and fleet-wide by design: re-running after adding a node is how the
# existing peers learn about it. That does briefly restart wg-quick everywhere —
# the control plane warns about it before it runs.
#
#   ./cluster/bootstrap-network.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_inventory
assert_inventory_aligned

HOSTS_BLOCK="$(render_etc_hosts)"

log "phase 1/3 — packages, hostname, keys"
declare -A PUBKEYS
while read -r ip name wg; do
  log "  $name ($ip)"
  remote "$ip" bash -s <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard-tools ufw iproute2 iputils-ping curl ca-certificates >/dev/null
hostnamectl set-hostname '$name'

umask 077
[ -f /etc/wireguard/privatekey ] || wg genkey > /etc/wireguard/privatekey
wg pubkey < /etc/wireguard/privatekey > /etc/wireguard/publickey

# Replace the managed block; leave everything else in /etc/hosts alone.
sed -i '/# simbkit-cluster\$/d;/# managed by simbkit-platform/d' /etc/hosts
cat >> /etc/hosts <<'HOSTS'
$HOSTS_BLOCK
HOSTS
REMOTE
  PUBKEYS["$wg"]="$(remote "$ip" cat /etc/wireguard/publickey | tr -d '\r\n')"
done < <(all_nodes)

log "phase 2/3 — WireGuard full mesh"
while read -r ip name wg; do
  peers=""
  while read -r peer_ip peer_name peer_wg; do
    [ "$peer_wg" = "$wg" ] && continue
    peers+="
[Peer]
# $peer_name
PublicKey = ${PUBKEYS[$peer_wg]}
AllowedIPs = ${peer_wg}/32
Endpoint = ${peer_ip}:${SIMBKIT_WG_PORT}
PersistentKeepalive = 25
"
  done < <(all_nodes)

  remote "$ip" bash -s <<REMOTE
set -euo pipefail
umask 077
cat > /etc/wireguard/wg0.conf <<'CONF'
[Interface]
Address = ${wg}/24
ListenPort = ${SIMBKIT_WG_PORT}
PrivateKey = __PRIVATE_KEY__
${peers}
CONF
# Substituted in place so the private key never crosses the wire.
sed -i "s|__PRIVATE_KEY__|\$(cat /etc/wireguard/privatekey)|" /etc/wireguard/wg0.conf
systemctl enable wg-quick@wg0 >/dev/null 2>&1 || true
systemctl restart wg-quick@wg0
REMOTE
done < <(all_nodes)

log "phase 3/3 — firewall"
while read -r ip name wg; do
  remote "$ip" bash -s <<REMOTE
set -euo pipefail
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow ${SIMBKIT_WG_PORT}/udp >/dev/null
# Everything else is reachable only over the encrypted mesh — the Kubernetes API
# and the kubelet are never exposed to the public interface.
ufw allow in on wg0 >/dev/null
ufw --force enable >/dev/null
REMOTE
done < <(all_nodes)

log "verifying mesh"
while read -r ip name wg; do
  while read -r _pip _pname peer_wg; do
    [ "$peer_wg" = "$wg" ] && continue
    remote "$ip" ping -c1 -W3 "$peer_wg" >/dev/null \
      || die "$name cannot reach $peer_wg over the mesh"
  done < <(all_nodes)
done < <(all_nodes)

log "mesh is up across $(all_nodes | wc -l) node(s)"
