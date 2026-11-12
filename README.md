# Evolvix — wholesale accounting

(Code name **SKB**: folders, packages and namespaces keep it, so installed copies update in place.)

A bilingual (Arabic / English) wholesale accounting system: sales, purchases, returns, stock in
several branches and warehouses, customers and suppliers, cash boxes and banks, cheques, a full
ledger, payroll, reports and analytics. One server holds everything; every device opens the same
app.

## How it is built

| Part                                                  | Technology                                                  | Where                          |
| ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| **Server** (data, rules, security)                    | C# · ASP.NET Core 10 · EF Core · PostgreSQL · SignalR       | `apps/api`                     |
| **The app** (every screen)                            | React 19 · TypeScript · Vite · Tailwind v4 · TanStack Query | `apps/web`                     |
| **Shared contract** (types, AR/EN texts, permissions) | TypeScript                                                  | `packages/shared`              |
| **Windows app**                                       | WinForms + WebView2 shell (.NET Framework 4.8)              | `apps/windows/src/SKB.Desktop` |
| **Android app**                                       | Java WebView shell (APK)                                    | `apps/android`                 |
| **iPhone / iPad**                                     | the website added to the home screen                        | —                              |
| **Offline assistant's voice**                         | Python service beside the server                            | `apps/voice`                   |
| **Public catalogue page**                             | static page published outward                               | `storefront`                   |

The Windows and Android apps are thin shells that open the company server's web app, so **updating
the server updates every device**. A shell is rebuilt only when the shell itself changes; its files
live in `apps/web/public/downloads/`.

## Security, in short

- **The server decides everything.** Each action has its own permission, checked on the server;
  each person sees only their branches, departments, warehouses and cash boxes.
- **No business data is kept on devices.** Without the server the app shows a "connect" screen.
- Passwords are hashed (PBKDF2); sign-ins are short-lived tokens plus refresh tokens stored hashed,
  one phone and one computer per account, revocable; changing someone's access applies at once.
- Every change is written to the activity log. Backups are encrypted with your passphrase.
- Secrets (`.env`, production settings, the Android signing key, the licence private key, backups)
  are never committed: see `.gitignore`. The values in `.env.example` and
  `appsettings.Development.json` are placeholders for development only.

## Run it for development

```bash
# needs: .NET 10 SDK, Node 22+, pnpm 10+, PostgreSQL 16 (or `pnpm db:up` with Docker)
cp .env.example .env
cd apps/api/src/SKB.Api && dotnet run        # server on http://localhost:5080 (migrates + seeds)
pnpm install && pnpm dev                     # app on http://localhost:5173
```

Sign in with the seeded owner (`owner@skb.local` / `ChangeMe!Owner123` — development only).
Checks: `pnpm typecheck`, `pnpm lint`, and the end-to-end suites in `scripts/checks/`.

## Where to read more

| File                         | What it holds                                                        |
| ---------------------------- | -------------------------------------------------------------------- |
| `PROJECT_MAP.md`             | Every page, file, endpoint and test suite — start here               |
| `CLAUDE.md`                  | The rules that must hold (security, money, permissions, days, names) |
| `DOMAIN.md`                  | The business model and what each document posts                      |
| `COMPANY-SERVER.md`          | Installing and updating the company's own server                     |
| `HOST-FREE.md`               | Running it on a cloud host                                           |
| `CLOUDFLARE-STOREFRONT.md`   | Publishing the public catalogue                                      |
| `PROGRESS.md` / `ROADMAP.md` | What was built and why; the old system's feature list                |
| `apps/*/README.md`           | Each app's own notes                                                 |
