#!/bin/bash
# One-time host setup for Connect on an Oracle Always Free Micro (1 GB RAM).
# Run from this directory, after filling in .env:
#   sudo ./setup-host.sh                    # keeps anything already installed
#   sudo REMOVE_COOLIFY=1 ./setup-host.sh   # also removes Coolify (frees ~500 MB)
#
# Oracle has TWO firewalls; both must allow the ports:
#   1. VCN Security List (Console -> Networking -> VCN -> subnet -> Security
#      List -> Add Ingress Rules, source 0.0.0.0/0) for:
#        TCP 80, 443, 3478
#        UDP 3478, 49152-49999
#   2. The instance's own iptables (Oracle's Ubuntu image ships it locked down
#      to SSH only). This script opens it.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
cd "$(dirname "$0")"
[ -f .env ] || { echo "copy .env.example to .env and fill it in first"; exit 1; }
set -a; . ./.env; set +a

if ! command -v docker >/dev/null; then
  echo "== installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

if [ "${REMOVE_COOLIFY:-0}" = 1 ]; then
  echo "== removing Coolify (its containers, volumes, network and /data/coolify)"
  ids=$(docker ps -aq --filter name=coolify)
  [ -z "$ids" ] || docker rm -f $ids
  docker volume ls -q --filter name=coolify | xargs -r docker volume rm
  docker network rm coolify 2>/dev/null || true
  rm -rf /data/coolify
  echo "   Left over (apps Coolify deployed have random names, remove by hand):"
  docker ps -a --format '   {{.Names}}  {{.Image}}'
fi

if ss -ltn '( sport = :80 or sport = :443 )' | grep -q LISTEN; then
  echo "!! something already listens on 80/443 (Coolify's proxy? nginx?):"
  ss -ltnp '( sport = :80 or sport = :443 )'
  echo "!! Caddy can't start until it's stopped."
fi

echo "== 2 GB swap (1 GB RAM is tight while building the backend image)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-connect.conf

echo "== iptables (inserted above Oracle's catch-all REJECT)"
apt-get install -y -q iptables-persistent >/dev/null
open() { # open <proto> <port or a:b>
  iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null && return
  local pos
  pos=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
  iptables -I INPUT "${pos:-1}" -p "$1" --dport "$2" -j ACCEPT
}
for p in 80 443 3478; do open tcp $p; done
for p in 3478 49152:49999; do open udp $p; done
netfilter-persistent save

if [ -n "${DUCKDNS_TOKEN:-}" ]; then
  echo "== cron: keep the DuckDNS name on this instance's IP (every 5 min)"
  DOMAIN=${API_DOMAIN%.duckdns.org}
  cat > /etc/cron.d/connect-duckdns <<EOF
*/5 * * * * root curl -fsS "https://www.duckdns.org/update?domains=${DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" -o /dev/null
EOF
  chmod 0600 /etc/cron.d/connect-duckdns # contains the DuckDNS token
  curl -fsS "https://www.duckdns.org/update?domains=${DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" && echo " <- DuckDNS"
else
  echo "== no DUCKDNS_TOKEN: $API_DOMAIN must be an A record to this instance's public IP"
fi

echo "== nightly database backup to /var/backups/connect (kept 14 days)"
cat > /usr/local/bin/connect-backup <<'EOF'
#!/bin/bash
set -euo pipefail
dir=/var/backups/connect
mkdir -p "$dir"
f="$dir/connect-$(date +%F).sql.gz"
docker exec connect-db pg_dump -U connect connect | gzip > "$f.tmp"
mv "$f.tmp" "$f"
find "$dir" -name 'connect-*.sql.gz' -mtime +14 -delete
EOF
chmod 0755 /usr/local/bin/connect-backup
echo '30 3 * * * root /usr/local/bin/connect-backup' > /etc/cron.d/connect-backup

echo "== keep-alive: hold CPU at ~25% so Oracle doesn't stop the instance as idle"
# Oracle may stop Always Free instances whose 95th-percentile CPU (and network)
# stays under 20% for 7 days. This burns ~25% of the instance at nice 19, so the
# app always gets the CPU first. Cron starts a ~55 s run every minute; flock
# stops runs from overlapping.
cat > /usr/local/bin/connect-keepalive <<'EOF'
#!/bin/bash
busy=$(awk -v n="$(nproc)" 'BEGIN { d = 0.25 * n; if (d > 0.9) d = 0.9; printf "%.2f", d }')
idle=$(awk -v b="$busy" 'BEGIN { printf "%.2f", 1 - b }')
end=$((SECONDS + ${KEEPALIVE_SECONDS:-55}))
while [ $SECONDS -lt $end ]; do
  timeout "$busy" sh -c 'while :; do :; done'
  sleep "$idle"
done
EOF
chmod 0755 /usr/local/bin/connect-keepalive
echo '* * * * * root flock -n /run/connect-keepalive.lock nice -n 19 /usr/local/bin/connect-keepalive' > /etc/cron.d/connect-keepalive

echo
echo "Done. Next: sudo docker compose up -d --build"
