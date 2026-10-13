// Where the storefront reads its data from (the Cloudflare R2 bucket the company server publishes to).
//
// Leave `base` empty ("") when this site is served FROM the same bucket (the simplest setup: the
// server publishes catalog.json + images into the bucket and you put index.html there too, then
// point your domain at the bucket). Then catalog.json and images sit next to this page.
//
// Set `base` to the bucket's public URL (e.g. "https://shop.yourdomain.com" or the r2.dev URL) when
// this page is hosted elsewhere — for example on Cloudflare Pages reading from R2. In that case add
// a CORS rule on the bucket that allows GET from this site's domain. See CLOUDFLARE-STOREFRONT.md.
//
// `title` is a fallback shown before the catalogue loads; the real company name comes from the data.
window.KM = {
  base: '',
  title: 'KM Collection',
};
