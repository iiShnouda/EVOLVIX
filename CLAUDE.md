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
6. **Types are shared.** Domain shapes live in `@skb/shared` and are imported by both
   `web` and `server`. Change them in one place.

## Workspaces

- `@skb/shared` — types, i18n dictionary, zod schemas, roles/permissions, nav model, money
  helpers, locale helpers. Zero runtime deps beyond `zod`. Built to `dist/` and consumed
  by the other packages.
- `@skb/server` — NestJS. Modules: `auth`, `security` (guards/interceptors), `presence`
  (WS), `audit`, and business modules (`dashboard`, `sales`, `parties`, …). Prisma for DB.
- `@skb/web` — React PWA. `src/design/` tokens, `src/shell/` adaptive navigation,
  `src/pages/` screens, `src/lib/` api client + query hooks, `src/i18n/` runtime.

## Adaptive device strategy

One React tree. A `useDeviceClass()` hook maps viewport + pointer + platform hints to a
device class (`phone` | `tablet` | `desktop`, refined to iOS/Android/iPad where it changes
controls). The shell picks: phone → bottom tab bar + sheets; tablet → nav rail + master‑
detail; desktop → full sidebar + dense tables. Pages are written once and consume shared
list/detail templates that render device‑appropriately.

## Adding a new module (the growth path)

1. Add types + i18n keys + zod schemas in `@skb/shared`.
2. Add the Prisma model(s) + a migration.
3. Add a NestJS module (controller + service) behind the auth/RBAC/audit guards.
4. Add the page under `src/pages/` using the list/detail templates + a query hook.
5. Register it in the shared navigation model so it appears in every device's shell.

## Commands

See root `package.json` scripts: `pnpm dev`, `pnpm build`, `pnpm typecheck`,
`pnpm db:up|migrate|seed|studio`, `pnpm format`.
