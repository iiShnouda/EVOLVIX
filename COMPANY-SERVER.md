# Run SKB entirely on your own company server (data stays in your building)

This is the most private, most secure setup: the **app and the database run on one machine
you own**, the data is saved on that machine's disk, and nothing leaves your building. It
works fully **offline on your local network (LAN)** — no cloud, no Neon.

## What you need
- A PC/server that stays on (Windows, Linux, or Mac) — **not** a personal laptop ideally.
- **Docker Desktop** (Windows/Mac) or Docker Engine (Linux). That's it.

## Steps
```bash
# 1. Get the code on the server
git clone https://github.com/iiShnouda/SKB.git
cd SKB

# 2. Set secrets
cp .env.example .env
#   Edit .env and set strong values for:
#     POSTGRES_PASSWORD, JWT_ACCESS_SECRET (openssl rand -base64 48),
#     SESSION_ENCRYPTION_KEY (openssl rand -hex 32), SEED_OWNER_PASSWORD

# 3. Start EVERYTHING (database + app) on this machine
docker compose --profile full up -d --build
```

That one command:
- starts **PostgreSQL** with its data in a persistent volume on this server (`skb-db-data`),
- builds and starts the **app** (website + API in one container),
- the app creates its tables and demo data on first run.

Open **http://localhost:8080** on the server, or **http://<server-ip>:8080** from any other
PC/phone on the same office network. Sign in with `owner@skb.local` + your `SEED_OWNER_PASSWORD`.

## Where the data lives
Everything is in the Docker volume **`skb-db-data`** on this server's disk — in your building,
under your control. Nothing is sent to any cloud.

## Back it up (important for accounting data)
```bash
# One-off backup to a file:
docker exec skb-db pg_dump -U skb skb > skb-backup-$(date +%F).sql
# Restore:
cat skb-backup-YYYY-MM-DD.sql | docker exec -i skb-db psql -U skb -d skb
```
Copy the backup file to a safe place (external drive / another machine) on a schedule.

## Make it reachable by a stable name (optional)
- Give the server a **static LAN IP** (router DHCP reservation).
- Add an internal DNS name like `skb.company.local` → that IP, so staff use a stable address.
- For HTTPS on the LAN, add a local TLS certificate (see `apps/api/README.md`).

## Going online later (without exposing this machine directly)
When you want staff to reach it from outside the office, put **Cloudflare Tunnel** in front so
the server's real address stays hidden and Cloudflare handles HTTPS + DDoS — the machine is
never directly exposed to the internet.

## Updating to a new version
```bash
git pull
docker compose --profile full up -d --build
```
Your data in `skb-db-data` is preserved across updates.
