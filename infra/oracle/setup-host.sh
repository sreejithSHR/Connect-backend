#!/bin/bash
# One-time host setup for Connect on the Oracle A1 that already runs Coolify.
# Run from this directory, after filling in .env:   sudo ./setup-host.sh
#
# Oracle has TWO firewalls; both must allow the ports:
#   1. VCN Security List (Console -> Networking -> VCN -> subnet -> Security
#      List -> Add Ingress Rules, source 0.0.0.0/0) for:
#        TCP 80, 443, 3478, 7881
#        UDP 3478, 49152-49999, 50000-60000
#   2. The instance's own iptables (Oracle's Ubuntu image ships it locked down
#      to SSH only). This script opens it.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
cd "$(dirname "$0")"
[ -f .env ] || { echo "copy .env.example to .env and fill it in first"; exit 1; }
set -a; . ./.env; set +a
command -v docker >/dev/null || { echo "docker missing — is Coolify installed?"; exit 1; }
apt-get install -y -q iptables-persistent >/dev/null

echo "== iptables (inserted above Oracle's catch-all REJECT)"
open() { # open <proto> <port or a:b> [source]
  local src=${3:-0.0.0.0/0}
  iptables -C INPUT -p "$1" -s "$src" --dport "$2" -j ACCEPT 2>/dev/null && return
  local pos
  pos=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
  iptables -I INPUT "${pos:-1}" -p "$1" -s "$src" --dport "$2" -j ACCEPT
}
for p in 80 443 3478 7881; do open tcp $p; done
for p in 3478 49152:49999 50000:60000; do open udp $p; done
# Coolify's Traefik (a container) -> LiveKit signaling on the host. Private
# ranges only; 7880 is NOT opened in the VCN Security List.
open tcp 7880 10.0.0.0/8
open tcp 7880 172.16.0.0/12
netfilter-persistent save

echo "== cron: keep the DuckDNS names on this instance's IP (every 5 min)"
DOMAINS=$(printf '%s\n' "$APP_DOMAIN" "$API_DOMAIN" "$LIVE_DOMAIN" | sed 's/\.duckdns\.org$//' | paste -sd, -)
cat > /etc/cron.d/connect-duckdns <<EOF
*/5 * * * * root curl -fsS "https://www.duckdns.org/update?domains=${DOMAINS}&token=${DUCKDNS_TOKEN}&ip=" -o /dev/null
EOF
chmod 0600 /etc/cron.d/connect-duckdns # contains the DuckDNS token
curl -fsS "https://www.duckdns.org/update?domains=${DOMAINS}&token=${DUCKDNS_TOKEN}&ip=" && echo " <- DuckDNS"

echo
echo "Done. Next: docker compose up -d   (then follow README.md for Coolify)"
