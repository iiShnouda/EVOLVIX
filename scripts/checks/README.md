# API checks

End-to-end checks that call a running SKB server. They create their own data (names carry a
random tag), so they run on a fresh database or on a copy of a real one. Never point them at the
live company server.

| Script | What it checks |
|---|---|
| `catalog.test.mjs` | Units, price levels, prices and their permissions, size × color models, invoices and returns in cartons, reports by model, and a concurrency race (DOMAIN.md step 3). |
| `charges.test.mjs` | Invoice charges (discount chain, VAT, additions), bonus lines, sales reps, their permissions, exact returns, supplier discounts in the average cost. |
| `delivery.test.mjs` | Parties add/edit/close, the delivery method on a sale, own deliveries, parcels with cash on delivery, refused parcels (returns), carrier settlements, permissions, branch scoping and races (DOMAIN.md step 4b). |
| `ledger.test.mjs` | Chart of accounts, the entry every document posts (line by line), account and party statements, trial balance, manual entries and reversal, the period lock and permissions (DOMAIN.md step 6). |
| `statements.test.mjs` | Income statement and balance sheet from the ledger (and how a sale, purchase and expense move them), monthly sales, top customers / suppliers, item movement and dead stock, permissions (DOMAIN.md step 8). |
| `notes.test.mjs` | Cheques & promissory notes: receive / issue with invoices, deposit portfolios, collect, pay, bounce, endorse, cancel — each step's balances, money and journal entry — permissions, scoping and a race (DOMAIN.md step 7). |
| `money.test.mjs` | Money accounts, receipts and payments with allocation, expenses, transfers, cancelling, paid-now / refunds / settlements through accounts, the no-negative rule, permissions, branch scoping and races (DOMAIN.md step 5). |
| `staff.test.mjs` | Staff & permissions: people, roles, per-person grants/revokes, and the safety rules (no self-escalation, owners protected, no self-lockout). |
| `admin.test.mjs` | Company profile, the activity log, aging of debts (every bucket with `PGURL`), the year-end close (entry, statements, lock, race) and permissions. **Run it last:** a closed year stays closed, so its close checks run once per database. |
| `payroll.test.mjs` | Payroll & attendance: shifts, employees, attendance (typed and from a fingerprint export) with late / overtime, bonuses, deductions, advances, the month's payroll to the piastre, its journal entry, recovery, locks after posting, paying, a race and permissions. Runs in its own new branch. |
| `quotes.test.mjs` | Price quotations: priced like invoices but moving nothing, turned into invoices (prices held while valid, stock checked, once even in a race), expiry (with `PGURL`), cancelling, permissions, audit; sales performance by person and branch. |
| `system.test.mjs` | Who's online over the real SignalR hub (sign-in required, several windows, screen names cleaned, only permitted people told) and backups: permissions, the encrypted download, automatic backups in the server folder (with `Backup__Folder`, `Backup__Keep=2`), audit. |
| `restore-check.mjs` | After `SKB.Api backup` + `SKB.Api restore` into a new database: every table's rows match the original (`PGURL` vs `PGURL_RESTORED`). |
| `invariants.mjs` | Database invariants: stock = Σ balances = Σ movements, one base unit per item, line quantities and totals, returns never exceeding their line. Needs `npm i pg`. |

## Running

```bash
# 1. a server on a throwaway database (Development settings, high rate limits)
ASPNETCORE_ENVIRONMENT=Development ConnectionStrings__Default="Host=localhost;Port=5432;Database=skb_check;Username=skb;Password=..." \
  RateLimit__UserPerMinute=100000 ASPNETCORE_URLS=http://localhost:5090 dotnet run --project apps/api/src/SKB.Api

# 2. the checks (Node 22)
BASE=http://localhost:5090/api node scripts/checks/catalog.test.mjs
PGURL=postgres://skb:...@localhost:5432/skb_check node scripts/checks/invariants.mjs

```

The seeded demo users are used: `owner@skb.local` (Owner), `mona@skb.local` (Accountant),
`karim@skb.local` (Sales) and `sara@skb.local` (Inventory).
