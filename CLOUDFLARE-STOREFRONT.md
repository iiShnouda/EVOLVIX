# Public storefront on Cloudflare (the KM Collection site)

This is how the office shows its products to the public — a catalogue page anyone can open — **without
ever exposing the company server to the internet**.

## How it stays safe

The company server **pushes** a copy of the catalogue outward and **accepts nothing back**:

```
 company server  ──(outbound HTTPS only)──►  Cloudflare R2 bucket  ◄──reads──  public catalogue site
 (on your PC/Pi,                              (catalog.json + photos)           (Cloudflare Pages)
  behind the firewall)
```

- The server opens **no inbound port** for this. It only makes outgoing HTTPS requests to Cloudflare,
  exactly like it already downloads updates. The public site talks to Cloudflare, **never to your
  server**, so the site cannot be used to reach or attack it.
- What leaves the building is **scrubbed**: each product's **name, department, colours, sizes, whether
  it is in stock, and its photo** — and nothing else. **No price, no cost, no stock count, no supplier,
  no customer, no invoice** is ever published. "In stock" is a yes/no badge; the number is never shown.
- Publishing is **owner-only** (`settings:manage`) and **automatic**: add or change a product and the
  new catalogue is pushed within a few seconds.

## What you need

- A free **Cloudflare** account.
- A **domain** (optional but nice — e.g. `shop.kmcollection.com`). You can buy one through Cloudflare
  (~$9/year) or point one you already own. You can also start with the free `*.pages.dev` address and
  add the domain later.

Cost: **R2's free tier is 10 GB of storage with no egress fees**, and **Pages is free**. A small
clothing catalogue costs nothing to host. This is the cheapest reliable option.

---

## Step 1 — Create the R2 bucket (holds the catalogue + photos)

1. In the Cloudflare dashboard open **R2** → **Create bucket**. Name it e.g. `km-storefront`.
2. Open the bucket → **Settings** → **Public access**:
   - Quickest: under **R2.dev subdomain** click **Allow Access**. You get a public URL like
     `https://pub-xxxxxxxx.r2.dev`. Good for getting started (it is rate-limited).
   - Recommended for production: under **Custom Domains** add e.g. `shop.kmcollection.com`. That
     becomes the public URL and is not rate-limited.
   - Note this **public URL** — it is your `STOREFRONT_PUBLIC_BASE_URL`.

## Step 2 — Create an API token for the server (write-only to this one bucket)

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write**. Scope it to **just the `km-storefront` bucket**.
3. Create it and copy the **Access Key ID** and **Secret Access Key** (the secret is shown once).
4. On the same page note the **S3 API endpoint** for your account — it looks like
   `https://<your-account-id>.r2.cloudflarestorage.com`. That is your `STOREFRONT_R2_ENDPOINT`.

## Step 3 — Give the server the five values

On the company server, set these in your `.env` (see `.env.example`):

```ini
STOREFRONT_R2_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
STOREFRONT_R2_BUCKET=km-storefront
STOREFRONT_R2_ACCESS_KEY_ID=<access key id from step 2>
STOREFRONT_R2_SECRET_KEY=<secret access key from step 2>
STOREFRONT_PUBLIC_BASE_URL=https://shop.kmcollection.com   # or the pub-xxxx.r2.dev URL
```

Keep `STOREFRONT_R2_SECRET_KEY` secret (it can write to the bucket). It never leaves the server.

Restart the app so it picks them up:

```bash
docker compose --profile full up -d
```

The server publishes the catalogue once on start, then again automatically whenever a product
changes. The owner can check it under the app (storefront status shows "on", where it publishes, and
when it last published) or `POST /api/storefront/publish` to push immediately.

## Step 4 — Put the site on Cloudflare Pages

The ready-made site is in the repo under **`storefront/`** (`index.html` + `config.js`). It is
read-only: it fetches `catalog.json` and the photos from the bucket and shows the cards. It is
bilingual (Arabic/English) and works on phones and computers.

1. Edit **`storefront/config.js`** and set `base` to your bucket's public URL from step 1:
   ```js
   window.KM = { base: 'https://shop.kmcollection.com', title: 'KM Collection' };
   ```
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets** (or connect
   the repository). Upload the contents of the `storefront/` folder. Deploy.
3. Add a **CORS rule** on the bucket so the site may read it from its own address:
   R2 → your bucket → **Settings** → **CORS policy** → add:
   ```json
   [
     {
       "AllowedOrigins": ["https://<your-pages-site>.pages.dev", "https://shop.kmcollection.com"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. (Optional) In the Pages project → **Custom domains**, add e.g. `kmcollection.com` so the site has a
   clean address.

### Simpler alternative — one bucket, no CORS

If you would rather not run a separate Pages project, upload `storefront/index.html` and
`storefront/config.js` **into the R2 bucket itself** (leave `base` as `''` in config.js — the data is
then right next to the page, same origin, so no CORS rule is needed) and attach your custom domain to
the bucket. Note: an R2 custom domain does not automatically serve `index.html` for a bare `/`, so link
people to `…/index.html`, or add a small Cloudflare redirect rule from `/` to `/index.html`.

## Step 5 — Check it

1. Open the site. You should see the catalogue (it says "no products yet" only if the shop is empty).
2. In the app, add a product or change one (name, colour, size, photo, or sell the last piece so it
   goes out of stock). Within a few seconds the site shows the change on refresh.

That's it. From now on the catalogue keeps itself up to date.

---

## How "realtime" works

A change to a product or its photo marks the catalogue dirty. A short pause (about 3 seconds) batches a
burst of edits into one push, then the scrubbed `catalog.json` and any **changed** photos are uploaded
(unchanged photos are skipped). The server also refreshes in-stock / out-of-stock every few minutes in
case stock moved without a product edit.

## Turning it off

Blank the five `STOREFRONT_*` values in `.env` and restart. The server stops publishing; the storefront
status shows "off". The site keeps showing whatever was last published until you remove the bucket.

## Security recap

- Outbound HTTPS only; **no inbound path to the company server**.
- Only the scrubbed catalogue leaves — names, departments, colours, sizes, in-stock-or-not and photos.
  Never a price, cost, stock count, supplier or customer.
- The R2 token is **write-only to one bucket**; keep the secret on the server.
- Publishing and the catalogue endpoint are **owner-only** inside the app.
