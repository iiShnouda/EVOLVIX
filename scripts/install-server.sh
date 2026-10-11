#!/usr/bin/env bash
# Evolvix company server — one-command install on Ubuntu (22.04 / 24.04, x86-64 or ARM64 / Raspberry Pi).
#
#   cd EVOLVIX && sudo bash scripts/install-server.sh              # app + database + offline assistant
#   sudo bash scripts/install-server.sh --no-assistant              # app + database only
#   sudo bash scripts/install-server.sh --admin 192.168.100.20      # SSH only from this device
#        (repeat --admin for more; your own SSH device is added by itself; --tailscale-only: the app
#         only over Tailscale; --no-firewall: leave the firewall alone. See scripts/firewall.sh.)
#
# Run it again any time to update: it keeps your .env (secrets, passwords) and your data.
# Installs Docker if needed, makes strong secrets the first time, builds and starts everything,
# opens the app's port on the firewall, sets up updates from the app (the owner's updates page,
# scripts/update-server.sh) and prints the address staff use.
set -euo pipefail

cd "$(dirname "$0")/.."
ASSISTANT=true
FIREWALL=true
FIREWALL_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-assistant) ASSISTANT=false ;;
    --no-firewall) FIREWALL=false ;;
    --tailscale-only) FIREWALL_ARGS+=(--tailscale-only) ;;
    --admin) [ $# -ge 2 ] || { echo "--admin needs an IP address"; exit 1; }; FIREWALL_ARGS+=(--admin "$2"); shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash scripts/install-server.sh"; exit 1; fi
if [ ! -f docker-compose.yml ]; then echo "Run this from the project folder (where docker-compose.yml is)."; exit 1; fi

# ---- 1. Docker ---------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl openssl >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin is missing (apt-get install docker-compose-plugin)."; exit 1; }

# ---- 2. Secrets (first time only) --------------------------------------------------------------
NEW_ENV=false
if [ ! -f .env ]; then
  say "Making strong secrets in .env"
  cp .env.example .env
  NEW_ENV=true
  rnd() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  OWNER_PASSWORD="Ev$(rnd 14)!9"
  BACKUP_PASS="$(rnd 32)"
  set_env() { sed -i "s|^$1=.*|$1=$2|" .env; }
  set_env POSTGRES_PASSWORD "$(rnd 32)"
  set_env JWT_ACCESS_SECRET "$(openssl rand -base64 48 | tr -d '\n/+=')"
  set_env SESSION_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env SEED_OWNER_PASSWORD "$OWNER_PASSWORD"
  set_env BACKUP_PASSPHRASE "$BACKUP_PASS"
  chmod 600 .env
fi

# ---- 3. The assistant, sized to the machine ----------------------------------------------------
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
if [ "$ASSISTANT" = false ]; then
  sed -i "s|^ASSISTANT_ENABLED=.*|ASSISTANT_ENABLED=false|" .env
elif [ "$MEM_GB" -lt 12 ]; then
  say "Only ${MEM_GB} GB of memory: using the lighter assistant model"
  sed -i "s|^ASSISTANT_MODEL=.*|ASSISTANT_MODEL=qwen2.5:1.5b-instruct|" .env
  if grep -q '^SPEECH_MODEL=' .env; then sed -i "s|^SPEECH_MODEL=.*|SPEECH_MODEL=base|" .env; else echo 'SPEECH_MODEL=base' >> .env; fi
fi

# ---- 4. Build and start ------------------------------------------------------------------------
# The app and its database first, so a problem with the assistant's parts never holds the app back.
say "Building and starting the app (the first time takes a while)"
docker compose --profile full up -d --build --remove-orphans db app
if ! grep -q '^ASSISTANT_ENABLED=false' .env; then
  say "Building and starting the assistant, its hearing and its voice"
  docker compose --profile full up -d --build assistant assistant-models speech voice \
    || echo "!! The assistant's parts didn't start (the app works without them): docker compose --profile full logs voice speech assistant"
fi

PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2); PORT=${PORT:-8080}
say "Waiting for the app to answer"
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || { echo "The app didn't start: docker compose logs app"; exit 1; }
VERSION=$(grep -m1 '"version"' apps/api/src/SKB.Api/release-notes.json | cut -d'"' -f4)
echo "Evolvix ${VERSION} is running."

# ---- 5. Updates from the app (the owner's updates page) -----------------------------------------
# The app can only leave the word "check" or "update" in /var/lib/evolvix/updates; systemd runs
# scripts/update-server.sh for it, and once a day to look for a new version.
say "Updates from the app"
REPO=$(pwd)
mkdir -p /var/lib/evolvix/updates
cat > /etc/systemd/system/evolvix-update.service <<UNIT
[Unit]
Description=Evolvix: do the update or check asked for in the app
After=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${REPO}/scripts/update-server.sh request
TimeoutStartSec=2h
UNIT
cat > /etc/systemd/system/evolvix-update.path <<UNIT
[Unit]
Description=Evolvix: watch for update requests from the app

[Path]
PathExists=/var/lib/evolvix/updates/request
Unit=evolvix-update.service

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/evolvix-update-check.service <<UNIT
[Unit]
Description=Evolvix: look for a new version
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${REPO}/scripts/update-server.sh check
UNIT
cat > /etc/systemd/system/evolvix-update-check.timer <<UNIT
[Unit]
Description=Evolvix: look for a new version every day

[Timer]
OnCalendar=daily
RandomizedDelaySec=2h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now evolvix-update.path evolvix-update-check.timer >/dev/null 2>&1
bash scripts/update-server.sh check >/dev/null 2>&1 || echo "Couldn't reach the code's home to look for updates yet (see /var/log/evolvix-update.log)."

# ---- 6. Raspberry Pi: count memory per part, for the server monitor ------------------------------
# Raspberry Pi OS leaves memory accounting off; the monitor then shows each part's processor use
# but not its memory. Turned on here (once; the old boot line is kept beside it), after a restart.
NEED_REBOOT=false
CMDLINE=/boot/firmware/cmdline.txt
if [ -f "$CMDLINE" ] && ! grep -qw memory /sys/fs/cgroup/cgroup.controllers 2>/dev/null \
   && ! grep -q 'cgroup_enable=memory' "$CMDLINE"; then
  cp "$CMDLINE" "$CMDLINE.before-evolvix"
  sed -i '1 s/$/ cgroup_enable=memory cgroup_memory=1/' "$CMDLINE"
  NEED_REBOOT=true
fi

# ---- 7. Firewall: the app from the office + Tailscale, SSH only from the admin -------------------
if [ "$FIREWALL" = true ]; then
  say "Firewall"
  bash scripts/firewall.sh --yes "${FIREWALL_ARGS[@]}"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
    sleep 2
  done
fi

# ---- 8. How to reach it ------------------------------------------------------------------------
say "Ready"
echo "Open from any PC / phone on the office network:"
for ip in $(hostname -I); do
  case "$ip" in *:*) ;; 172.17.*|172.18.*) ;; *) echo "    http://${ip}:${PORT}" ;; esac
done
echo "Windows / Android apps: enter that same address as the server."
if [ "$NEW_ENV" = true ]; then
  echo
  echo "Owner sign-in:      $(grep -E '^SEED_OWNER_EMAIL=' .env | cut -d= -f2)"
  echo "Owner password:     ${OWNER_PASSWORD}"
  echo "Backup passphrase:  ${BACKUP_PASS}"
  echo "Write these two down somewhere safe now (they are also in .env, readable only by root)."
  echo "Change the owner password after the first sign-in."
fi
if ! grep -q '^ASSISTANT_ENABLED=false' .env; then
  echo
  echo "The assistant's models download in the background (a few GB): docker compose logs -f assistant-models"
fi
if [ "$NEED_REBOOT" = true ]; then
  echo
  echo "Restart the server once so the monitor can show each part's memory:  sudo reboot"
fi
