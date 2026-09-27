# SKB — Wholesale Accounting Platform

An adaptive, bilingual (Arabic / English) wholesale accounting application delivered as
**one product across every device**: a web app that also installs on iPhone, Android, and
Windows — all talking to **your own database on your company server**.

> **Status:** Foundation + first vertical slice (auth · security · dashboard · sales).
> Built to grow module‑by‑module without re‑architecting.

---

## The "Facebook model" — one codebase, every surface

| Surface | How it's delivered | Store needed? |
| --- | --- | --- |
| **Website** | The React PWA served by any browser | — |
| **iPhone / iPad** | Open in Safari → **Add to Home Screen** (installs full‑screen, own icon) | ❌ No App Store |
| **Android** | Install the PWA, or sideload a **private APK** (built via Capacitor) | ❌ No Play Store |
| **Windows** | Run the **setup / `.exe`** (built via Tauri) | ❌ No store |

All surfaces are the *same* React app pointing at the same company server.

## Security model (the top priority)

- **Server‑authoritative. Zero business data at rest on devices.** If a device is not
  connected to the company server, it shows a "connect to server" screen and displays
  **nothing** — no cached records, no ledgers. Only the app *code* is cached (so it launches
  fast); business data never is.
- **Encrypted sessions**: passwords hashed with **argon2id**; short‑lived signed access
  tokens (JWT) + opaque **refresh tokens stored hashed** in the DB; refresh material
  encrypted at rest (AES‑256‑GCM). Every session is server‑side and **revocable**.
- **Access control**: role‑based (RBAC) + **branch scoping** enforced on the server for
  every request — never trusted from the client.
- **Full audit trail**: who did what, when, from which device/IP — recorded server‑side.
- **Live presence**: a WebSocket channel tracks who is online right now. This is the
  foundation for the future **owner/CEO view** (who's connected and what they're doing).
- Transport hardening: Helmet headers, strict CORS allow‑list, rate limiting, and
  request validation on every endpoint.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript** everywhere | One language front‑to‑back → shared types, faster growth |
| Frontend | **React 19 + Vite + Tailwind v4** (PWA) | Installable on all devices from one codebase |
| Client data | **TanStack Query** + **Zustand** | Server state cache + UI state; no data persisted offline |
| Backend | **NestJS** | Structured, security‑first (guards/interceptors/gateways), grows cleanly |
| Database | **PostgreSQL** via **Prisma** | ACID‑safe for money; self‑host now, move to cloud later unchanged |
| Realtime | **Socket.IO** (NestJS gateway) | Presence + future live activity feed |
| Desktop pkg | **Tauri** | Tiny, secure `.exe`/installer for Windows |
| Mobile pkg | **Capacitor** (optional APK) + PWA install | Private distribution, no stores |

## Repository layout

```
skb/
├─ packages/
│  └─ shared/         # Domain types, AR/EN dictionary, zod schemas, roles — used by web + server
├─ apps/
│  ├─ server/         # NestJS API: auth, RBAC, audit, presence, business modules (Prisma/Postgres)
│  ├─ web/            # React PWA: design system, adaptive shell, screens
│  └─ desktop/        # Tauri wrapper for the Windows build (added when packaging)
├─ docker-compose.yml # PostgreSQL (same engine you'll run on the company server)
└─ .env.example       # All configuration; copy to .env
```

## Quick start (development)

```bash
# 0. Prereqs: Node 22+, pnpm 10+, Docker (for Postgres)
cp .env.example .env          # then edit secrets

pnpm install                  # install all workspaces
pnpm db:up                    # start PostgreSQL in Docker
pnpm db:migrate               # create the schema
pnpm db:seed                  # demo branches/staff/products/invoices + owner account

pnpm dev                      # runs API (:3000) and web (:5173) together
```

Then open http://localhost:5173 and sign in with the seeded owner account
(`SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from your `.env`).

## Deploying to the company server (overview)

1. Install Docker (or a native PostgreSQL 16) on the server PC.
2. Set `.env` with a strong DB password and freshly generated secrets.
3. `pnpm db:up && pnpm db:migrate && pnpm db:seed`, then run the API server.
4. Build the web app (`pnpm --filter @skb/web build`) and serve it (the API can serve it,
   or use any static host on the LAN).
5. Point client devices at the server's LAN address (`VITE_API_URL`). Later, expose it over
   the internet (HTTPS strongly recommended) — no code changes required.

See `CLAUDE.md` for developer/architecture notes.
