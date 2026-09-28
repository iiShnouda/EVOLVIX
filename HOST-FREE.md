# Put SKB online in the CLOUD (your PC never involved)

The app is now **one service** (the C# server also serves the website), so it deploys as a
single container. Your database is free **Neon PostgreSQL** (no card). Pick one host below.

> Reality check: in 2026 the *easy* cloud hosts verify identity with a card but **never
> charge** the free tier ($0). The fully *no‑card* host needs a few extra steps. Both keep
> your PC completely out of it — the server runs on the host's cloud.

---

## Option 1 — Render · easiest · free tier is $0 (asks for a card to verify, never charges)

1. **Database:** create a free project at https://neon.tech → copy its **`.NET`** connection string.
2. **Deploy:** https://render.com → **New ▸ Blueprint** → connect the `SKB` repo. Render reads
   `render.yaml` and makes **one** service. Fill the prompts:
   - `ConnectionStrings__Default` → the Neon string
   - `Security__SessionEncryptionKey` → run `openssl rand -hex 32` (or ask me) and paste it
   - `Seed__OwnerPassword` → a strong password
3. **Apply** → open `https://skb.onrender.com`, sign in. (First load after idle is slow while the free service wakes.)

The card is only ID verification — the free plan costs nothing. If you have any debit/prepaid
card, this is by far the simplest.

---

## Option 2 — Hugging Face Spaces · truly no credit card (email sign‑up)

Runs your container on Hugging Face's cloud. A few more steps, but no card ever.

1. **Database:** free Neon project (as above) → copy the `.NET` connection string.
2. **GitHub read‑only token** (so HF can pull your private repo): GitHub → Settings →
   Developer settings → **Fine‑grained tokens** → new token, **read‑only**, only the `SKB`
   repo. Copy it.
3. **Create the Space:** https://huggingface.co → sign up (email) → **New Space** →
   **Docker** → **Blank** → make it **Public** (the app is still protected by login).
4. **Add two files** to the Space (via its “Files” tab → Add file):
   - `Dockerfile` → paste the contents of `deploy/huggingface/Dockerfile` from this repo.
   - `README.md` → paste the contents of `deploy/huggingface/README.md`.
5. **Add secrets** (Space → Settings → *Variables and secrets*):
   - `GH_TOKEN` → the GitHub token from step 2 (this one must be a **secret**)
   - `ConnectionStrings__Default` → the Neon string
   - `Security__SessionEncryptionKey` → `openssl rand -hex 32`
   - `Cookie__Secure` → `true`
   - `Seed__OwnerPassword` → a strong password
6. The Space builds and starts automatically → open its URL (e.g.
   `https://<you>-skb.hf.space`), sign in. (Free Spaces sleep when idle; first load wakes it.)

---

## Security (either option)
HTTPS is automatic on both hosts. The app adds JWT auth, PBKDF2 password hashing, encrypted
sessions, role/branch access control, rate limiting, and a login wall (no data without an
account). Secrets live in the host's settings, never in the code. For extra DDoS/WAF you can
put **free Cloudflare** in front of either.

## (Only if you ever run your own always‑on server)
`scripts/run-online.ps1` builds the web into the API and runs the whole app on one port, and
`cloudflared tunnel --url http://localhost:5080` would expose it — but that runs on *your*
machine, so use it only on a dedicated company server, not your personal PC.
