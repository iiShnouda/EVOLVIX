# Deploy SKB online for free (Render + Neon)

This puts the app online with **free hosting and automatic HTTPS**, in ~15 minutes, no
credit card. Free tiers are great for **testing/demo** — for real accounting data long‑term,
move to a paid tier or your company server (free API sleeps after ~15 min idle → slow first
request; free databases are not for production data).

**Stack:** Render (API container + web static site) + Neon (free PostgreSQL) + built‑in TLS.

---

## Step 1 — Free PostgreSQL on Neon

1. Sign up at **https://neon.tech** (free, GitHub login).
2. Create a project (pick a region near you). It gives you a **connection string**.
3. In the connection dialog choose the **`.NET`** format so it looks like:
   ```
   Host=ep-xxxx.eu-central-1.aws.neon.tech;Database=neondb;Username=neondb_owner;Password=********;SSL Mode=Require;Trust Server Certificate=true
   ```
   Copy that whole string — it's your `ConnectionStrings__Default`.

## Step 2 — Generate a session key

Run this once (Git Bash / PowerShell with OpenSSL, or any tool) and keep the output:
```bash
openssl rand -hex 32        # 64 hex characters → Security__SessionEncryptionKey
```

## Step 3 — Deploy on Render

1. Sign up at **https://render.com** (free, GitHub login) and give it access to the `SKB` repo.
2. **New ▸ Blueprint** → pick the `SKB` repo. Render reads `render.yaml` and shows two
   services: **skb-api** and **skb-web**.
3. Render will ask for the values marked "sync: false". Your service URLs are predictable
   (`https://skb-api.onrender.com` and `https://skb-web.onrender.com`), so you can fill both
   up front:

   **skb-api**
   | Variable | Value |
   | --- | --- |
   | `ConnectionStrings__Default` | the Neon `.NET` string from Step 1 |
   | `Security__SessionEncryptionKey` | the 64‑hex value from Step 2 |
   | `Cors__Origins__0` | `https://skb-web.onrender.com` |
   | `Seed__OwnerPassword` | a strong owner password you choose |

   **skb-web**
   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://skb-api.onrender.com` |

4. Click **Apply**. Render builds the C# API image and the web app. On first boot the API
   **creates the tables and seeds demo data** in your Neon database automatically.

## Step 4 — Open it

- Web app: **https://skb-web.onrender.com**
- Sign in: `owner@skb.local` / the `Seed__OwnerPassword` you set.
- (The first request after idle takes ~30–60s on the free tier while the API wakes up.)

Point the Windows desktop app or phones at the API too by setting their server URL to
`https://skb-api.onrender.com`.

---

## Security notes

Already in place: HTTPS everywhere (Render), JWT auth, PBKDF2 password hashing, encrypted
sessions, role/branch access control, rate limiting, strict CORS, a login wall (no data
without an account).

To harden further (optional, still free):
- **Cloudflare (free)** in front of the web/API for **DDoS protection + WAF** and to hide the
  origin. Point a domain at Cloudflare → Render.
- Keep all secrets in Render's env vars (never in code). Rotate `Jwt__AccessSecret` /
  `Security__SessionEncryptionKey` if ever exposed.

## Moving off free later

- Neon/Render both have cheap paid tiers (no sleep, persistent data), or
- Deploy the same Docker image to your **company Windows server** / a small VPS — no code
  change (see `apps/api/README.md`).
