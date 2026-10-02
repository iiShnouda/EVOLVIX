# SKB — Developer & architecture notes

Guidance for anyone (human or AI) working in this repo.

**Start with [`PROJECT_MAP.md`](PROJECT_MAP.md)**: every page and what it does, which file holds
what (web, server, shared), the endpoints, the dev setup and how to run the tests. Update it when
you add a page, controller, entity or test suite.

## Product in one line

**Evolvix** (owner decision 2026-10-01; the code keeps its old name SKB in folders, packages,
namespaces, the exe/APK file names and registry keys, so installed copies update in place). The
name shown to people comes from `app.name`; the mark is `apps/web/public/icon.svg` and the
`Logo` component (`apps/web/src/components/Logo.tsx`) draws the same thing. A company using it adds
its own name and logo (Settings; `CompanyMark`/`CompanyName`), shown beside the Evolvix mark, which
never changes. Each person can pick a look theme (`/themes`, `skins.css`).

Bilingual (AR/EN) wholesale accounting app, delivered as web + installable apps on
iPhone/Android/Windows, all talking to a self‑hosted company server. Security is the
first‑class concern.

## Non‑negotiable rules

1. **No business data persisted on the client.** Never cache API _data_ in
   localStorage/IndexedDB/service worker. Only UI preferences (locale, theme) and the
   app _shell assets_ may be cached. Disconnected = show the offline gate, render no data.
2. **Server is the only source of truth.** All authorization (role + branch) is enforced
   server‑side. The client UI hides things for UX, but the server must independently deny.
3. **Every mutation is audited.** Write through the audit layer; don't bypass it.
4. **Money is exact.** Store monetary amounts as integer **minor units** (e.g. piastres/
   cents) in the DB — never floats. Format for display only at the edge.
5. **Bilingual by construction.** No user‑facing string is hard‑coded in a component; it
   comes from `@skb/shared` i18n keys. Layout must work in both LTR and RTL.
6. **Types are shared where they can be.** The web/PWA shares TypeScript domain shapes via
   `@skb/shared`, and the C# server (`apps/api`) mirrors the same JSON contract. When an
   endpoint's shape changes, update both in lockstep.
7. **One UI, installed per device (owner decision 2026-09-29).** The web app is the only UI.
   - **Android:** a real app, `apps/android` (Java WebView shell, APK).
   - **Windows:** a real app, `apps/windows/src/SKB.Desktop` (WinForms + WebView2 on .NET
     Framework 4.8, self-installing per user).
   - **iPhone/iPad:** the website added to the home screen (no App Store).
   - The shells open the company server's web app. Its address is changeable (cloud or office
     server), so **a server deploy updates every device**.
   - Rebuild a shell only when the shell changes, and put its files in
     `apps/web/public/downloads/`.
   - The older WPF client (`SKB.App`/`SKB.Core`) is superseded: don't extend it.
8. **Names are one field, kept as typed (owner decision 2026-09-29).** Anything people name
   (branches, warehouses, categories, units, price levels, sizes/colors, models, items, and new
   entities like them) has a single `Name` (`INamed`), typed in Arabic or English and shown the
   same on both screen languages. **Nothing is translated** — no AI, no second-language field.
   - Clean input with `Loc.Clean`, map with `Loc.Name(entity)` (it only localizes system rows such
     as the "in transit" warehouse). Forms use the one-field `NameFields`.
   - Only the app's own texts are bilingual: they come from `@skb/shared` i18n (rule 5).

9. **Every action has its own permission (owner decision 2026-09-29).** A new feature adds its
   own `resource:action` permission(s) in `Roles.cs` + `@skb/shared` `roles.ts`, enforces them on
   the server, and hides the matching UI. Roles only bundle permissions. Prices are a separate
   permission from items; changing an invoice price or level needs one too.

10. **Days are the company's, not UTC's.** Store instants in UTC, but any "today", day or month
    boundary, or report period goes through `CompanyClock` on the server (`Today`, `StartOf`,
    `Days`, `DayOf`; `AppDbContext.LocalTime` to group in SQL) and `companyToday` / `addDays` from
    `@skb/shared` on the client. Never `DateTime.UtcNow.Date` or `toISOString().slice(0, 10)`.
    The zone is a company setting (Africa/Cairo by default).

11. **Scope every query by the person's access.** Each person has branches (and optionally only
    some warehouses and money accounts). On the server, filter with `.InBranches(User, x => x.BranchId)`,
    `WarehouseService.Visible(User)` and `MoneyService.Visible(User)`; new documents go to
    `Access.Work(User)` (the working branch the app sends as `X-Branch`). Never compare with the
    person's own branch claim directly.

## Layout (one server, best‑fit client per device)

- `apps/api` — **C# / ASP.NET Core 10** server (canonical backend). EF Core + Npgsql
  (PostgreSQL), JWT auth + PBKDF2, per‑permission authorization, audit, SignalR presence.
  Controllers: `auth`, `dashboard`, `sales`, `purchases`, `products`, `parties`, `delivery`,
  `reports`, `settings`, `audit`, `presence`, `health` (and catalog, inventory, staff, …). This is the source of truth all clients call.
- `apps/web` — React **PWA** (also the iPhone/iPad + website surface). `src/design/` tokens,
  `src/shell/` adaptive navigation, `src/pages/` screens, `src/lib/` api client + query
  hooks, `src/i18n/` runtime.
- `apps/windows/src/SKB.Desktop` — the Windows app (WebView2 shell; see its README). `SKB.App`/`SKB.Core` are the superseded WPF client.
- `apps/android` — the Android app (WebView shell; see its README; the signing key never goes in git).
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
3. Add types + i18n keys in `@skb/shared`.
4. Add the page under `apps/web/src/pages/` using the list/detail templates + a query hook.
5. Register it in the shared navigation model so it appears in every device's shell.

## Commands

- Server: `cd apps/api/src/SKB.Api && dotnet run` (migrates + seeds on startup). Migrations:
  `dotnet ef migrations add <Name>`.
- Web: root `package.json` scripts — `pnpm dev`, `pnpm build`, `pnpm typecheck`,
  `pnpm db:up|down` (PostgreSQL via Docker), `pnpm format`.
- Windows: open `apps/windows/SKB.sln` in Visual Studio.
