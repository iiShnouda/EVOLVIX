#!/usr/bin/env bash
# Evolvix company server — only Tailscale may reach it.
#
#   cd EVOLVIX && sudo bash scripts/lock-to-tailscale.sh          # lock
#   sudo bash scripts/lock-to-tailscale.sh --undo                  # open the office network again
#
# After locking:
#   - Nothing on the office network or the internet can connect to this machine: not the app, not
#     SSH, not anything else.
#   - Devices signed in to your Tailscale network reach the app (and SSH) as before, including
#     through the advertised route http://192.168.100.63:8080.
#   - The only port opened to the outside is Tailscale's own (41641/udp).
#
# Docker publishes ports around ufw's normal rules, so the app's port is closed in Docker's own
# DOCKER-USER chain too: only connections arriving over Tailscale get through to the containers.
set -euo pipefail

cd "$(dirname "$0")/.."
RULES=/etc/ufw/after.rules
BEGIN='# BEGIN evolvix-tailscale-only'
END='# END evolvix-tailscale-only'
PORT=$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true); PORT=${PORT:-8080}

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash scripts/lock-to-tailscale.sh"; exit 1; fi
command -v ufw >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq ufw >/dev/null; }

remove_block() {
  [ -f "$RULES" ] && sed -i "/^$BEGIN\$/,/^$END\$/d" "$RULES"
  # Rules loaded earlier stay in the running chain until it is emptied.
  iptables -F DOCKER-USER 2>/dev/null || true
}

if [ "${1:-}" = "--undo" ]; then
  remove_block
  ufw allow OpenSSH >/dev/null
  ufw allow "${PORT}/tcp" >/dev/null
  ufw reload >/dev/null
  systemctl restart docker
  echo "Unlocked: the office network reaches the app (port ${PORT}) and SSH again."
  exit 0
fi

# ---- Checks: Tailscale must be up, and this session must not be cut off ------------------------
command -v tailscale >/dev/null 2>&1 || { echo "Install Tailscale first (see COMPANY-SERVER.md)."; exit 1; }
TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
[ -n "$TS_IP" ] || { echo "Tailscale isn't connected: run sudo tailscale up first."; exit 1; }
if [ -n "${SSH_CONNECTION:-}" ]; then
  client=${SSH_CONNECTION%% *}
  case "$client" in
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*|fd7a:115c:a1e0:*) ;;
    *)
      echo "You are connected over the office network ($client): locking would cut this session."
      echo "Connect over Tailscale instead (ssh <user>@${TS_IP}) or run this at the Pi itself."
      exit 1 ;;
  esac
fi

echo "After this, ONLY devices signed in to your Tailscale network can reach this server."
echo "Office PCs and phones need the Tailscale app running too."
read -r -p "Type LOCK to continue: " answer
[ "$answer" = "LOCK" ] || { echo "Nothing was changed."; exit 1; }

# ---- 1. The machine itself: deny everything in, except over Tailscale ---------------------------
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 >/dev/null
ufw allow 41641/udp >/dev/null          # Tailscale's own port: faster direct connections

# ---- 2. Docker's published ports: only connections arriving over Tailscale ----------------------
remove_block
cat >> "$RULES" <<EOF
$BEGIN
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -i tailscale0 -j RETURN
-A DOCKER-USER -i lo -j RETURN
-A DOCKER-USER -i docker0 -j RETURN
-A DOCKER-USER -i br-+ -j RETURN
-A DOCKER-USER -j DROP
COMMIT
$END
EOF

ufw --force enable >/dev/null
ufw reload >/dev/null
systemctl restart docker      # its containers come back on their own (restart: unless-stopped)

echo
echo "Locked. Open from a device with Tailscale on: http://192.168.100.63:${PORT} or http://${TS_IP}:${PORT}"
echo "SSH now works only over Tailscale: ssh <user>@${TS_IP}"
echo "To undo: sudo bash scripts/lock-to-tailscale.sh --undo"
ufw status verbose
