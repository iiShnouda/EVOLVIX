# Run SKB entirely on your own company server (data stays in your building)

This is the most private, most secure setup: the **app and the database run on one machine
you own**, the data is saved on that machine's disk, and nothing leaves your building. It
works fully **offline on your local network (LAN)** — no cloud, no Neon.

## What you need
- A PC/server that stays on (Windows, Linux, or Mac) — **not** a personal laptop ideally.
- **Docker Desktop** (Windows/Mac) or Docker Engine (Linux). That's it.

### How big a machine (measured 2026-10-01)
A load test with 10 people working at a normal pace (lists, searches, prices, saving invoices,
statements, the dashboard, the work-in-progress autosave every 3 s) used about a third of one CPU
core and ~330 MB of memory for the app. 30 people working non-stop with no pauses (≈210 requests a
second, 1,100+ invoices a minute) used under 2 cores and ~470 MB.

| People working at once | CPU | Memory (app + database + OS) | Disk |
|---|---|---|---|
| up to 15 | 2 cores | 4 GB | 128 GB SSD |
| 15–40 | 4 cores | 8 GB | 256 GB SSD |
| 40+ or several branches over the internet | 4–8 cores | 16 GB | 512 GB SSD |

- **No graphics card is needed**: the server draws nothing; screens are drawn on each device.
- **An SSD matters more than a faster CPU** (the database writes on every save).
- Keep backups on a different disk or machine (see Backups below).

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

## The offline assistant (AI on this server)
The same command also starts the company's own AI models (**Ollama**) in the `skb-assistant`
container and downloads two models once (`assistant-models`, a few GB): one to answer questions
and one to read photos of supplier invoices and cheques. After that it works with **no internet**,
and nothing is sent outside the building.

- Only the app can reach it (no port is opened on the server or the office network).
- People need the **ai:chat** permission to ask it and **ai:scan** to read photos; it only looks up
  what that person may see, and never changes anything by itself.
- Extra machine needed for it: **8 GB more memory** and ~12 GB of disk for the default models
  (`qwen2.5:7b-instruct`, `qwen2.5vl:7b`). A graphics card makes answers much faster but is not
  required. On a smaller machine set `ASSISTANT_MODEL=qwen2.5:3b-instruct` and
  `ASSISTANT_VISION_MODEL=qwen2.5vl:3b` in `.env`; set `ASSISTANT_ENABLED=false` to turn it off.
- Check it in the app: **Assistant** page (it says when the models aren't ready yet).
- Update the models later: `docker compose --profile full run --rm assistant-models`.

## Where the data lives
Everything is in the Docker volume **`skb-db-data`** on this server's disk — in your building,
under your control. Nothing is sent to any cloud.

## Backups (important for accounting data)
**Automatic:** every day at 2:00 (server time), the app writes a backup into the `backups` folder
next to `docker-compose.yml`, and keeps the newest 14.
- Set `BACKUP_PASSPHRASE` in `.env` so they're encrypted (recommended). Keep the passphrase
  somewhere safe: without it a backup can't be opened, by anyone.
- The time, how many to keep and the folder are `BACKUP_HOUR`, `BACKUP_KEEP` and `BACKUP_DIR`.
- **Copy the `backups` folder to an external drive or another machine regularly.** A backup on
  the same disk doesn't survive that disk failing.

**One click:** the owner opens **Settings → Backups** and downloads a backup now, encrypted with a
passphrase they choose. The same card lists the automatic backups and downloads them.

**Restore** (always into a new, empty database; the current one is left alone):
```bash
docker compose --profile full stop app
docker exec skb-db createdb -U skb skb_restored
docker compose --profile full run --rm \
  -e ConnectionStrings__Default="Host=db;Port=5432;Database=skb_restored;Username=skb;Password=<POSTGRES_PASSWORD>" \
  -e SKB_BACKUP_PASSPHRASE='<the passphrase>' \
  app restore /backups/skb-20260930-020000.skbak
# Then set POSTGRES_DB=skb_restored in .env and start the app again:
docker compose --profile full up -d
```
- The restore checks every row and link. It refuses a wrong passphrase, a damaged file, or a
  database that isn't empty.
- It then brings the data up to the app's version. Everyone signs in again afterwards.
- Leave out `SKB_BACKUP_PASSPHRASE` to type it instead (it isn't shown).
- `app backup /backups/<name>.skbak` makes a backup from the command line the same way.

(A plain `docker exec skb-db pg_dump -U skb skb > skb.sql` still works too, as a second copy.)

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
