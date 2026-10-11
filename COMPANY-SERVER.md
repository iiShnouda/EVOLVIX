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

## Quick install (Ubuntu 22.04 / 24.04, PC or Raspberry Pi)
```bash
git clone https://github.com/iiShnouda/EVOLVIX.git && cd EVOLVIX
sudo bash scripts/install-server.sh --admin <your PC's IP>   # add --no-assistant to skip the AI models
```
It installs Docker, makes strong secrets in `.env` (shown once: the owner password and the backup
passphrase — write them down), builds and starts everything, sets the firewall (see Firewall below), and prints
the address (`http://<server-ip>:8080`). Run the same command again to update; data and `.env` stay.

The company starts empty: the owner, one branch, its warehouse and the main cash box.

To wipe every piece of data and start clean again (a copy is saved in `backups/` first):
```bash
git pull && sudo bash scripts/reset-data.sh
```

## Steps (by hand)
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
  required. On a smaller machine set `ASSISTANT_MODEL=qwen2.5:1.5b-instruct` in `.env` (Apache 2.0);
  don't use the 3b versions of Qwen 2.5 (their licence forbids commercial use). Set
  `ASSISTANT_ENABLED=false` to turn the assistant off.
- Check it in the app: **Assistant** page (it says when the models aren't ready yet).
- Update the models later: `docker compose --profile full run --rm assistant-models`.

**Talking with it by voice.** The assistant answers in the app's language (Arabic or English), and
one can talk with it like with a person: it listens, answers briefly and says the answer aloud, then
listens again. Two more containers do this on this machine, with no internet after the first start:
- `skb-speech` (Whisper, MIT licence; `SPEECH_MODEL=small` in `.env`, `base` on smaller machines)
  writes out what was said; the recording is not kept.
- `skb-voice` (Piper, GPL-3.0, its own container; `VOICE_AR` / `VOICE_EN` in `.env`) reads the
  answer aloud in an Arabic or an English voice, the same on every device; downloads ~130 MB of
  voices once.

The microphone works:
- **Windows app** and **Android app (1.4 or newer):** on the office address as it is.
- **iPhone and browsers:** only on a secure address: use the HTTPS address Tailscale gives the
  server (`sudo tailscale serve --bg 8080`, then `https://<server-name>.<tailnet>.ts.net`).

## The owner's server monitor
**Server monitor** in the app (the owner alone) works on any server (a Raspberry Pi, a PC, a cloud
machine): the processor, memory, disk and temperature, and **what each part uses**: the app, the
database, the assistant, its hearing (speech) and its voice, plus the system and everything else. It
reads the machine's control groups read-only (each container is in its own `evolvix-<part>.slice`,
see docker-compose.yml). On a Raspberry Pi the memory per part shows after one restart: the installer
turns memory accounting on (`cgroup_enable=memory` in `/boot/firmware/cmdline.txt`). It shows figures
only: there is deliberately no command line in the app. To run commands, use SSH from your own
device (see Firewall below), which the firewall allows only from the admin devices.

## On a Raspberry Pi 5 (16 GB)
Everything runs on it as is (all the images are built for ARM64): use **64-bit Raspberry Pi OS**,
install Docker, then the same `docker compose --profile full up -d --build`.
- **Put the system and the data on an NVMe SSD** (M.2 HAT), not the SD card: the database writes
  on every save and SD cards wear out and lose data.
- An **active cooler** and the official 27 W power supply; a small **UPS** so a power cut doesn't
  stop it mid-write.
- The app and database are comfortable there for a shop's staff (about 10–15 people at once).
- The assistant runs on the Pi's CPU, so it is **slow**: a few words a second for answers, and
  reading a photo can take a minute or more. Use `ASSISTANT_MODEL=qwen2.5:1.5b-instruct` for faster
  answers, keep `qwen2.5vl:7b` for photos, or set `ASSISTANT_ENABLED=false`.
- Backups to a USB disk or another machine, as below.

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

## Reaching it from outside the office (Tailscale, no domain, no open ports)
Tailscale joins the server and each person's devices into one private, encrypted network. Nothing
is opened on the router, and no domain is needed.

On the server (once):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --advertise-routes=192.168.100.63/32   # this server's own LAN address
```
Then in the Tailscale admin page:
1. Open the server's **Edit route settings** and approve the route.
2. Turn off **key expiry** for the server only.

On each phone or PC: install Tailscale and sign in to the same account. The apps keep using
`http://192.168.100.63:8080` in the office and outside it alike.

## Firewall (set by the installer)
`install-server.sh` runs `scripts/firewall.sh`. After it, only these get in:
- **The app (port 8080):** from the office network and over Tailscale.
- **SSH:** only from the admin devices. Pass each one with `--admin <IP>` (its office IP and/or its
  Tailscale IP); the device you are connected from over SSH is added by itself.
- **Tailscale's own port** (41641/udp).

Everything else is refused, and the database and the assistant have no open port at all. Docker's
published ports skip ufw's normal rules, so the script also limits them in Docker's `DOCKER-USER` chain.

```bash
sudo bash scripts/firewall.sh --admin 192.168.100.20 --admin 100.101.102.103   # change it any time
sudo bash scripts/firewall.sh --tailscale-only --admin 100.101.102.103          # the app only over Tailscale
```
Give admin devices a fixed IP on the router. If you use Tailscale SSH (`tailscale up --ssh`), limit
it to your devices in the Tailscale access rules, because it doesn't pass through this firewall.

Lock it down:
- Turn on **two-step sign-in** on the Tailscale account.
- Turn on **Device approval**.
- Use access rules so staff devices reach port 8080 only.

## Updating to a new version
**From the app (the owner alone):** **Updates** in the menu says whether a new version is out and what
it brings and fixes; **Update now** updates the server, and **Check for updates** looks again (it also
looks once a day by itself). A backup is made first, the new version is built while the current one
keeps working, and the app pauses for a moment while it restarts; every device then loads the new
version by itself.

How: the app can't run anything on the server. It only leaves the word `check` or `update` in
`/var/lib/evolvix/updates`, and the server's own updater (`scripts/update-server.sh`, started by the
systemd units `evolvix-update.path` and `evolvix-update-check.timer` that the installer sets up) does
the work and writes back how it went. Its log stays on the server: `/var/log/evolvix-update.log`.
What a version brings comes from `apps/api/src/SKB.Api/release-notes.json`.

The first time (a server installed before updates came to the app), set the updater up once:
```bash
cd EVOLVIX && git pull && sudo bash scripts/install-server.sh --no-firewall
```
**By hand**, any time:
```bash
sudo bash scripts/update-server.sh update      # or: git pull && sudo docker compose --profile full up -d --build
```
Your data in `skb-db-data` is preserved across updates.
