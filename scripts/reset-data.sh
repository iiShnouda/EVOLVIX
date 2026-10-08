#!/usr/bin/env bash
# Evolvix company server — wipe ALL business data and start clean.
#
#   cd EVOLVIX && sudo bash scripts/reset-data.sh
#
# A copy of the current database is saved first to backups/before-reset-<time>.sql.gz (readable
# only by root). The database is then deleted and made again empty: the owner (SEED_OWNER_EMAIL /
# SEED_OWNER_PASSWORD from .env), one branch, its warehouse and the main cash box. The assistant's
# downloaded models and the .env secrets are kept.
set -euo pipefail

cd "$(dirname "$0")/.."
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash scripts/reset-data.sh"; exit 1; fi
if [ ! -f .env ]; then echo "No .env here: run this from the project folder on the server."; exit 1; fi

echo "This deletes EVERY invoice, item, customer, supplier, account and staff member on this server."
read -r -p "Type DELETE to continue: " answer
[ "$answer" = "DELETE" ] || { echo "Nothing was changed."; exit 1; }

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }

# A demo flag left on would refill the empty database with sample data.
if grep -q '^SEED_DEMO=' .env; then sed -i 's|^SEED_DEMO=.*|SEED_DEMO=false|' .env; else echo 'SEED_DEMO=false' >> .env; fi

mkdir -p backups
if docker ps --format '{{.Names}}' | grep -qx skb-db; then
  say "Saving a copy of the current data"
  file="backups/before-reset-$(date +%Y%m%d-%H%M%S).sql.gz"
  docker exec skb-db pg_dump -U "$(env_get POSTGRES_USER || echo skb)" "$(env_get POSTGRES_DB || echo skb)" | gzip > "$file"
  chmod 600 "$file"
  echo "Saved: $file"
fi

say "Deleting the database"
docker compose stop app db
docker compose rm -f app db
docker volume rm skb-db-data

say "Starting clean"
if grep -q '^ASSISTANT_ENABLED=false' .env; then
  docker compose --profile full up -d --build db app
else
  docker compose --profile full up -d --build
fi
PORT=$(env_get APP_PORT); PORT=${PORT:-8080}
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || { echo "The app didn't start: docker compose logs app"; exit 1; }

say "Done: the server is empty"
echo "Sign in as $(env_get SEED_OWNER_EMAIL) with the owner password from .env (SEED_OWNER_PASSWORD)."
echo "Then set the company name, branches, warehouses and staff in Settings."
