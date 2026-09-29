# SKB — API Server (C# / ASP.NET Core 10 / PostgreSQL)

The production server ("the brain"). All clients — web/PWA, Windows, Android — talk to this.
Built the **standard enterprise .NET way**: ASP.NET Core Web API, EF Core + Npgsql,
JWT auth, per-permission authorization, SignalR presence, connection pooling, and
**Windows Service** hosting (with a clean path to **Linux/systemd** later).

- **.NET 10 (LTS)** — chosen over .NET 9 (which is short-term support) for a production server.
- **PostgreSQL** via EF Core (Npgsql), with **EF context pooling + Npgsql connection pooling**.
- Same REST contract as before, so every existing client keeps working unchanged.

## Requirements

- **.NET 10 SDK** (`dotnet --version` → 10.x)
- **PostgreSQL 16** reachable from the server

## Run (development)

```bash
cd apps/api/src/SKB.Api
dotnet run                       # uses appsettings.Development.json → database "skb_net"
```
The server migrates the schema and seeds demo data on first run, then listens (default
`http://localhost:5080` when `ASPNETCORE_URLS` is set, else `:5000`). Sign in with
`owner@skb.local` / `ChangeMe!Owner123`.

EF migrations:
```bash
dotnet tool install --global dotnet-ef      # once
dotnet ef migrations add <Name>             # after changing entities
dotnet ef database update                   # (the app also migrates on startup)
```

## Configuration (`appsettings.json` / environment variables)

| Setting | Purpose |
| --- | --- |
| `ConnectionStrings:Default` | PostgreSQL connection string (see pooling below) |
| `Jwt:AccessSecret` | HMAC key for access tokens — **set a long random value in production** |
| `Security:SessionEncryptionKey` | 64 hex chars (32 bytes) — AES‑256‑GCM key for sessions at rest |
| `Cookie:Secure` | `true` when served over HTTPS |
| `Cors:Origins` | exact client URLs allowed (no wildcards) |

Never commit real production secrets. Use environment variables or a non‑committed
`appsettings.Production.json`. Example env override:
`ConnectionStrings__Default`, `Jwt__AccessSecret`, `Security__SessionEncryptionKey`.

## 1) Database connection pooling

Set in the connection string; Npgsql pools connections and EF pools `DbContext` instances
(`AddDbContextPool`):
```
Host=DBHOST;Port=5432;Database=skb;Username=skb;Password=***;Pooling=true;Minimum Pool Size=2;Maximum Pool Size=50
```

## 2) Internal static IP & DNS

- Give the server PC a **static LAN IP** (router DHCP reservation, or a static NIC config).
- Add an **internal DNS name** (e.g. `skb.company.local`) pointing at that IP, on your
  router/AD DNS or each client's `hosts` file. Clients then use a stable name that survives
  IP changes: set the clients' API URL to `https://skb.company.local:5443`.

## 3) Local SSL/TLS certificate (encrypted transport)

For an internal server, issue a certificate for `skb.company.local`:

- **Dev/testing:** `dotnet dev-certs https --trust` (localhost only), or **mkcert**:
  `mkcert skb.company.local` → gives a `.pem` pair trusted on machines with the mkcert root.
- **Company‑wide:** issue from your internal CA (e.g. AD Certificate Services) and export a
  PFX. Then configure Kestrel:

```jsonc
// appsettings.Production.json
{
  "UseHttpsRedirection": true,
  "Kestrel": {
    "Endpoints": {
      "Https": { "Url": "https://0.0.0.0:5443", "Certificate": { "Path": "certs/skb.pfx", "Password": "***" } }
    }
  }
}
```
Set `Cookie:Secure = true` once on HTTPS.

## 4) Windows Service hosting

The app already calls `UseWindowsService()`, so it runs as a service with no code change.

```powershell
# Publish a self-contained build
dotnet publish src\SKB.Api -c Release -r win-x64 --self-contained true -o C:\SKB\api

# Register + start the Windows Service
sc.exe create "SKB API" binPath= "C:\SKB\api\SKB.Api.exe" start= auto
sc.exe description "SKB API" "SKB wholesale accounting server"
sc.exe start "SKB API"
```
Set production config via machine environment variables or
`C:\SKB\api\appsettings.Production.json`, and set `ASPNETCORE_ENVIRONMENT=Production`.

## 5) Upgrading to a Linux server later (no rewrite)

The exact same code runs on Linux. Instead of a Windows Service, host with **systemd**:

```ini
# /etc/systemd/system/skb-api.service
[Unit]
Description=SKB API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/skb/api
ExecStart=/usr/bin/dotnet /opt/skb/api/SKB.Api.dll
Environment=ASPNETCORE_ENVIRONMENT=Production
Restart=always
User=skb

[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now skb-api`. PostgreSQL and the certificate work identically;
only the hosting wrapper differs.

## Endpoints (unchanged contract)

`POST /api/auth/login · POST /api/auth/refresh · POST /api/auth/logout · GET /api/auth/me`,
`GET /api/health`, `GET /api/dashboard`, `GET /api/sales/invoices[/{id}]`,
`GET /api/parties[/{id}]`, `GET /api/presence`, and the SignalR hub at `/hubs/presence`.

## Presence transport

This server exposes **SignalR** at `/hubs/presence`. The web app (`src/lib/presence.ts`) speaks
its JSON protocol directly over a WebSocket, with no client library:
- Each window reports its screen and, while in use, that it's still there.
- People with `presence:view` are only told that something changed. They read the list from
  `GET /api/presence`.

## Backups

`dotnet SKB.Api.dll backup <file>` and `dotnet SKB.Api.dll restore <file>` run instead of the
web server, against the configured database. The passphrase comes from `SKB_BACKUP_PASSPHRASE`,
or is typed. A restore only goes into a new, empty database.

Daily automatic backups use:
- `Backup__Folder` (turns them on)
- `Backup__Hour` (default 2)
- `Backup__Keep` (default 14)
- `Backup__Passphrase` (encrypts them)

See `COMPANY-SERVER.md`.
