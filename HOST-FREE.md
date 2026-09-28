# Put SKB online for FREE — no credit card

The app is now **one service**: the C# server also serves the website, so the whole thing
is a single URL. Two free routes below — pick one.

> Your database can be **Neon** (free, no card) or a local PostgreSQL. Either works.

---

## Option A — Cloudflare Tunnel (from your PC) · truly free, no card, no account

Best when you'll keep a PC on (your company‑server plan anyway). Your PC runs the app;
Cloudflare gives it a public HTTPS link with DDoS protection.

1. **Run the app** (one command — builds the site into the server and starts it):
   ```powershell
   powershell -File scripts\run-online.ps1
   ```
   It serves everything on `http://localhost:5080`.
   *(Needs PostgreSQL running — either local, or set the Neon connection string in
   `apps/api/src/SKB.Api/appsettings.Development.json`.)*

2. **Install cloudflared** (free): download from
   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   (the Windows `.exe`).

3. **Expose it** — in a second terminal:
   ```powershell
   cloudflared tunnel --url http://localhost:5080
   ```
   It prints a public link like `https://something.trycloudflare.com`. **That's your app
   online** — open it, sign in with `owner@skb.local` / `ChangeMe!Owner123`. Share the link
   with staff.

   *(The quick link changes each run. For a fixed link, make a free Cloudflare account and a
   “named tunnel” — still no card.)*

---

## Option B — Render (hosted, no PC needed) · free tier, but asks for a card to verify

Now a **single** service (the container builds the web + API together), so it's simpler.

1. **Database:** create a free Neon PostgreSQL at https://neon.tech, copy its **`.NET`**
   connection string.
2. **Deploy:** https://render.com → **New ▸ Blueprint** → connect the `SKB` repo. Render
   reads `render.yaml` and creates one service **skb**. Fill the prompts:
   - `ConnectionStrings__Default` → the Neon string
   - `Security__SessionEncryptionKey` → run `openssl rand -hex 32` and paste it
   - `Seed__OwnerPassword` → a strong password
3. **Apply.** Open `https://skb.onrender.com`, sign in. (First load after idle is slow while
   the free service wakes.)

*(If you don't want to give a card at all, use Option A, or a no‑card host like Hugging Face
Spaces / Oracle Always Free — Option A is by far the simplest.)*

---

## Security (either option)
HTTPS everywhere, plus the app's built‑in JWT auth, PBKDF2 password hashing, encrypted
sessions, role/branch access control, rate limiting, and a login wall (no data without an
account). For extra DDoS/WAF, Cloudflare (Option A) already provides it; on Render you can
put free Cloudflare in front too.
