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
# opens the app's port on the firewall, and prints the address staff use.
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
fi

# ---- 4. Build and start ------------------------------------------------------------------------
say "Building and starting (the first time takes a while)"
if grep -q '^ASSISTANT_ENABLED=false' .env; then
  docker compose --profile full up -d --build db app
else
  docker compose --profile full up -d --build
fi

PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2); PORT=${PORT:-8080}
say "Waiting for the app to answer"
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || { echo "The app didn't start: docker compose logs app"; exit 1; }

# ---- 5. Firewall: the app from the office + Tailscale, SSH only from the admin -------------------
if [ "$FIREWALL" = true ]; then
  say "Firewall"
  bash scripts/firewall.sh --yes "${FIREWALL_ARGS[@]}"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
    sleep 2
  done
fi

# ---- 6. How to reach it ------------------------------------------------------------------------
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
