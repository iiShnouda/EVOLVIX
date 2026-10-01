# Evolvix — Wholesale Accounting Platform

(Code name SKB: folders, packages and namespaces keep it.)

An adaptive, bilingual (Arabic / English) wholesale accounting application delivered across
**every device with the best‑fit technology for each**, all talking to **your own database
on your company server**.

> **Status:** Foundation + first vertical slice (auth · security · dashboard · sales).
> Built to grow module‑by‑module without re‑architecting.

---

## One server, best‑fit client per device

All clients share **one server** (the "brain") — data, security rules, roles, and business
logic live there once. Each client is a fast, native‑feeling view on top.

| Surface | Technology | Distribution | Status |
| --- | --- | --- | --- |
| **Server (brain)** | **C# · ASP.NET Core 10 · PostgreSQL** (`apps/api`) | Windows Service (→ Linux later) | ✅ Built & tested |
| **Website + iPhone/iPad** | React **PWA** (TypeScript) | Browser · Safari “Add to Home Screen” (no App Store) | ✅ Built & tested |
| **Windows** | **C# / .NET 10 · WPF** (`apps/windows`) | Native `.exe` / installer | ✅ Foundation built |
| **Android** | **Kotlin · Jetpack Compose** | Private APK (no Play Store) | ⏭️ Planned |

> The C# server (`apps/api`) is the single backend. See `apps/api/README.md` for Windows
> Service hosting, static IP/DNS, local TLS, connection pooling, and the Linux upgrade path.

The iPhone/iPad target stays a PWA on purpose: it installs **privately, free, with no App
Store**, which a native iOS app cannot do.

## Security model (the top priority)

- **Server‑authoritative. Zero business data at rest on devices.** If a device is not
  connected to the company server, it shows a "connect to server" screen and displays
  **nothing** — no cached records, no ledgers. Only the app *code* is cached (so it launches
  fast); business data never is.
- **Encrypted sessions**: passwords hashed with **PBKDF2** (ASP.NET Core `PasswordHasher`);
  short‑lived signed access tokens (JWT) + opaque **refresh tokens stored hashed** in the DB;
  refresh material encrypted at rest (**AES‑256‑GCM**). Every session is server‑side and
  **revocable**.
- **Access control**: role‑based (RBAC) + **branch scoping** enforced on the server for
  every request (deny‑by‑default) — never trusted from the client.
- **Full audit trail**: who did what, when, from which device/IP — recorded server‑side.
- **Live presence**: a real‑time channel (SignalR) tracks who is online right now — the
  foundation for the future **owner/CEO view** (who's connected and what they're doing).
- Transport hardening: strict CORS allow‑list, rate limiting, HTTPS‑ready (local TLS cert).

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| **Server** | **C# · ASP.NET Core 10 · EF Core · PostgreSQL** | Standard, robust, secure; same language as the Windows client; Windows Service now, Linux later |
| Website + iPhone/iPad | **React 19 · Vite · Tailwind v4** (PWA) | Installs privately on iOS with no App Store; one codebase for web + phones |
| Client data (web) | **TanStack Query** + **Zustand** | In‑memory server cache + UI state; no business data persisted offline |
| Windows | **C# · .NET 10 · WPF** (MVVM) | Native desktop client, best fit for the back‑office |
| Android | **Kotlin · Jetpack Compose** (planned) | Native phone client, private APK |
| Realtime | **SignalR** | Presence + future live activity feed |

## Repository layout

```
skb/
├─ apps/
│  ├─ api/            # C# / ASP.NET Core 10 server — canonical backend (EF Core + PostgreSQL)
│  ├─ web/            # React PWA: design system, adaptive shell, screens (web + iPhone/iPad)
│  └─ windows/        # C# / WPF native desktop client (SKB.Core + SKB.App)
├─ packages/
│  └─ shared/         # TS domain types, AR/EN dictionary, zod schemas, roles — used by the web app
├─ docker-compose.yml # PostgreSQL for local development
└─ .env.example       # Postgres + web config; copy to .env
```

## Quick start (development)

```bash
# Prereqs: .NET 10 SDK, Node 22+, pnpm 10+, PostgreSQL (or `pnpm db:up` for Docker)
cp .env.example .env

# 1) Server (migrates + seeds on first run)
cd apps/api/src/SKB.Api && dotnet run          # listens on http://localhost:5080

# 2) Web (in another terminal)
pnpm install && pnpm dev                        # http://localhost:5173
```

Open http://localhost:5173 and sign in with the seeded owner account
(`owner@skb.local` / `ChangeMe!Owner123`).

## Deploying to the company server

The server runs as a **Windows Service** (and later Linux `systemd`), behind a **static IP +
internal DNS name** with a **local TLS certificate** and **connection pooling**. Full,
step‑by‑step instructions are in **`apps/api/README.md`**. The Windows desktop client build
lives in **`apps/windows/README.md`**. See `CLAUDE.md` for architecture notes.
