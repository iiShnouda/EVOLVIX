# API checks

End-to-end checks that call a running SKB server. They create their own data (names carry a
random tag), so they run on a fresh database or on a copy of a real one. Never point them at the
live company server.

| Script | What it checks |
|---|---|
| `catalog.test.mjs` | Units, price levels, prices and their permissions, size × color models, invoices and returns in cartons, reports by model, and a concurrency race (DOMAIN.md step 3). |
| `charges.test.mjs` | Invoice charges (discount chain, VAT, additions), bonus lines, sales reps, their permissions, exact returns, supplier discounts in the average cost. |
| `staff.test.mjs` | Staff & permissions: people, roles, per-person grants/revokes, and the safety rules (no self-escalation, owners protected, no self-lockout). |
| `translate.test.mjs` | AI translation of units, price levels, models, sizes and colors, and variant names following their model. Needs the stand-in AI server below. |
| `invariants.mjs` | Database invariants: stock = Σ balances = Σ movements, one base unit per item, line quantities and totals, returns never exceeding their line. Needs `npm i pg`. |
| `fakeai.mjs` | A stand-in OpenAI-compatible server on :5099 that "translates" by prefixing the text. |

## Running

```bash
# 1. a server on a throwaway database (Development settings, high rate limits)
ASPNETCORE_ENVIRONMENT=Development ConnectionStrings__Default="Host=localhost;Port=5432;Database=skb_check;Username=skb;Password=..." \
  RateLimit__UserPerMinute=100000 ASPNETCORE_URLS=http://localhost:5090 dotnet run --project apps/api/src/SKB.Api

# 2. the checks (Node 22)
BASE=http://localhost:5090/api node scripts/checks/catalog.test.mjs
PGURL=postgres://skb:...@localhost:5432/skb_check node scripts/checks/invariants.mjs

# translation: start the stand-in AI, then a server with Translation__ApiKey=test
#   Translation__BaseUrl=http://localhost:5099/v1 Translation__PollSeconds=5
node scripts/checks/fakeai.mjs &
BASE=http://localhost:5090/api node scripts/checks/translate.test.mjs
```

The seeded demo users are used: `owner@skb.local` (Owner), `mona@skb.local` (Accountant),
`karim@skb.local` (Sales) and `sara@skb.local` (Inventory).
