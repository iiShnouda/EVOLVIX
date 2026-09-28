# SKB — Developer & architecture notes

Guidance for anyone (human or AI) working in this repo.

## Product in one line

Bilingual (AR/EN) wholesale accounting app, delivered as web + installable apps on
iPhone/Android/Windows, all talking to a self‑hosted company server. Security is the
first‑class concern.

## Non‑negotiable rules

1. **No business data persisted on the client.** Never cache API *data* in
   localStorage/IndexedDB/service worker. Only UI preferences (locale, theme) and the
   app *shell assets* may be cached. Disconnected = show the offline gate, render no data.
2. **Server is the only source of truth.** All authorization (role + branch) is enforced
   server‑side. The client UI hides things for UX, but the server must independently deny.
3. **Every mutation is audited.** Write through the audit layer; don't bypass it.
4. **Money is exact.** Store monetary amounts as integer **minor units** (e.g. piastres/
   cents) in the DB — never floats. Format for display only at the edge.
5. **Bilingual by construction.** No user‑facing string is hard‑coded in a component; it
   comes from `@skb/shared` i18n keys. Layout must work in both LTR and RTL.
6. **Types are shared where they can be.** The web/PWA shares TypeScript domain shapes via
   `@skb/shared`. The C# server (`apps/api`) and Windows app (`apps/windows`) mirror the
   same JSON contract in their own model classes. When an endpoint's shape changes, update
   all three in lockstep.

## Layout (one server, best‑fit client per device)

- `apps/api` — **C# / ASP.NET Core 10** server (canonical backend). EF Core + Npgsql
  (PostgreSQL), JWT auth + PBKDF2, per‑permission authorization, audit, SignalR presence.
  Controllers: `auth`, `dashboard`, `sales`, `parties`, `presence`, `health`. This is the
  source of truth all clients call.
- `apps/web` — React **PWA** (also the iPhone/iPad + website surface). `src/design/` tokens,
  `src/shell/` adaptive navigation, `src/pages/` screens, `src/lib/` api client + query
  hooks, `src/i18n/` runtime.
- `apps/windows` — **C# / WPF** native desktop client (`SKB.Core` + `SKB.App`).
- `packages/shared` (`@skb/shared`) — TypeScript types, AR/EN dictionary, zod schemas,
  roles/permissions, nav model, money/locale helpers — consumed by the web app.

## Adaptive device strategy

One React tree. A `useDeviceClass()` hook maps viewport + pointer + platform hints to a
device class (`phone` | `tablet` | `desktop`, refined to iOS/Android/iPad where it changes
controls). The shell picks: phone → bottom tab bar + sheets; tablet → nav rail + master‑
detail; desktop → full sidebar + dense tables. Pages are written once and consume shared
list/detail templates that render device‑appropriately.

## Adding a new module (the growth path)

1. Add the EF Core entity/entities in `apps/api` + an EF migration
   (`dotnet ef migrations add <Name>`).
2. Add the controller + DTOs behind `[Authorize(Policy = Permissions.…)]`, with branch
   scoping and audit where it mutates.
3. Add types + i18n keys in `@skb/shared` (and mirror the DTO in the Windows app's models).
4. Add the page under `apps/web/src/pages/` using the list/detail templates + a query hook.
5. Register it in the shared navigation model so it appears in every device's shell.

## Commands

- Server: `cd apps/api/src/SKB.Api && dotnet run` (migrates + seeds on startup). Migrations:
  `dotnet ef migrations add <Name>`.
- Web: root `package.json` scripts — `pnpm dev`, `pnpm build`, `pnpm typecheck`,
  `pnpm db:up|down` (PostgreSQL via Docker), `pnpm format`.
- Windows: open `apps/windows/SKB.sln` in Visual Studio.
