#!/usr/bin/env bash
# Evolvix company server — who may reach this machine (run by install-server.sh; run again any time).
#
#   sudo bash scripts/firewall.sh --admin 192.168.100.20 --admin 100.101.102.103
#       The app: from the office network and over Tailscale.
#       SSH: only from the admin devices given (their office IP and/or Tailscale IP).
#   sudo bash scripts/firewall.sh --tailscale-only --admin 100.101.102.103
#       The app only over Tailscale; the office network reaches nothing.
#   sudo bash scripts/firewall.sh --undo           # no firewall at all (not recommended)
#
# Everything else coming in is refused. Tailscale's own port (41641/udp) stays open. The database
# and the assistant have no published port at all. The device you are connected from over SSH is
# always added as an admin, so running this never cuts your own session.
#
# Docker publishes ports around ufw's normal rules, so the app's port is also limited in Docker's
# own DOCKER-USER chain (rules kept in /etc/ufw/after.rules, so they come back after a restart).
set -euo pipefail

cd "$(dirname "$0")/.."
RULES=/etc/ufw/after.rules
BEGIN='# BEGIN evolvix-firewall'
END='# END evolvix-firewall'
PORT=$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true); PORT=${PORT:-8080}

MODE=office
ADMINS=()
YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    --admin) [ $# -ge 2 ] || { echo "--admin needs an IP address"; exit 1; }; ADMINS+=("$2"); shift ;;
    --tailscale-only) MODE=tailscale ;;
    --undo) MODE=off ;;
    --yes) YES=true ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash scripts/firewall.sh"; exit 1; fi
command -v ufw >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq ufw >/dev/null; }

remove_block() {
  if [ -f "$RULES" ]; then
    sed -i "/^$BEGIN\$/,/^$END\$/d" "$RULES"
    sed -i '/^# BEGIN evolvix-tailscale-only$/,/^# END evolvix-tailscale-only$/d' "$RULES"
  fi
  iptables -F DOCKER-USER 2>/dev/null || true
}

if [ "$MODE" = off ]; then
  remove_block
  ufw --force disable >/dev/null
  systemctl restart docker
  echo "Firewall off: every port is reachable from the office network."
  exit 0
fi

# ---- Who is the admin ---------------------------------------------------------------------------
# Everyone connected over SSH right now (sudo hides SSH_CONNECTION, so ask the system).
if [ -n "${SSH_CONNECTION:-}" ]; then ADMINS+=("${SSH_CONNECTION%% *}"); fi
while read -r peer; do
  [ -n "$peer" ] && ADMINS+=("$peer")
done < <(ss -Htn state established '( sport = :22 )' 2>/dev/null | awk '{print $NF}' \
           | sed -E 's/:[0-9]+$//; s/^\[//; s/\]$//; s/^::ffff://; s/%.*$//')
for ip in "${ADMINS[@]}"; do
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ || "$ip" == *:* ]] || { echo "Not an IP address: $ip"; exit 1; }
done
mapfile -t ADMINS < <(printf '%s\n' "${ADMINS[@]}" | sort -u | sed '/^$/d')

# The office network this machine is on (e.g. 192.168.100.0/24).
IFACE=$(ip route show default 2>/dev/null | awk '{print $5; exit}')
LAN=$(ip -o -f inet route show dev "$IFACE" scope link proto kernel 2>/dev/null | awk '{print $1; exit}')
[ -n "$LAN" ] || { echo "Can't tell this machine's office network."; exit 1; }

echo "App (port ${PORT}): $([ "$MODE" = office ] && echo "office network ${LAN} + Tailscale" || echo "Tailscale only")"
if [ ${#ADMINS[@]} -gt 0 ]; then
  echo "SSH: only from ${ADMINS[*]}"
else
  echo "SSH: nobody from the network (no --admin given and not connected over SSH): only at the machine itself."
fi
if [ "$YES" != true ]; then
  read -r -p "Apply? (y/N) " answer
  [ "$answer" = y ] || [ "$answer" = Y ] || { echo "Nothing was changed."; exit 1; }
fi

# ---- 1. The machine itself ----------------------------------------------------------------------
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 41641/udp comment 'Tailscale' >/dev/null
for ip in "${ADMINS[@]}"; do ufw allow from "$ip" to any port 22 proto tcp comment 'SSH admin' >/dev/null; done
ufw allow in on tailscale0 to any port "$PORT" proto tcp comment 'Evolvix over Tailscale' >/dev/null
[ "$MODE" = office ] && ufw allow from "$LAN" to any port "$PORT" proto tcp comment 'Evolvix office' >/dev/null

# ---- 2. Docker's published ports: the app only, only from the allowed places ------------------
remove_block
{
  echo "$BEGIN"
  echo '*filter'
  echo ':DOCKER-USER - [0:0]'
  echo '-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN'
  echo '-A DOCKER-USER -i lo -j RETURN'
  echo '-A DOCKER-USER -i docker0 -j RETURN'
  echo '-A DOCKER-USER -i br-+ -j RETURN'
  echo "-A DOCKER-USER -i tailscale0 -p tcp -m conntrack --ctorigdstport ${PORT} -j RETURN"
  [ "$MODE" = office ] && echo "-A DOCKER-USER -s ${LAN} -p tcp -m conntrack --ctorigdstport ${PORT} -j RETURN"
  echo '-A DOCKER-USER -j DROP'
  echo 'COMMIT'
  echo "$END"
} >> "$RULES"

ufw --force enable >/dev/null
ufw reload >/dev/null
# Docker re-reads its chains; the containers come back on their own (restart: unless-stopped).
systemctl restart docker 2>/dev/null || true

echo
ufw status numbered
echo "To change it, run this again (e.g. with another --admin). Give admin devices a fixed office IP on the router."
