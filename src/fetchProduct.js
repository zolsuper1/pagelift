// Server-side product fetch. Shopify -> /products/<handle>.json, anything else -> HTML extraction.
// Guards against SSRF: only http(s), public IPs only (checked on every redirect hop), size + time limits.
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (compatible; CatalogEngineBot/1.0)';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(u) {
  const url = new URL(u);
  if (!['http:', 'https:'].includes(url.protocol)) throw new UserError('The address must start with http or https');
  if (url.port && !['80', '443'].includes(url.port)) throw new UserError('Unsupported address');
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new UserError("We couldn't find that site. Check the address.");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UserError('Unsupported address');
  return url;
}

export class UserError extends Error {}

async function safeFetch(u, accept) {
  let url = await assertPublicUrl(u);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { reader.cancel(); break; }
        chunks.push(value);
      }
    }
    return { status: res.status, url: url.toString(), text: Buffer.concat(chunks).toString('utf8'), type: res.headers.get('content-type') || '' };
  }
  throw new UserError('Too many redirects');
}

const stripHtml = (s = '') => String(s)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);

function fromShopifyJson(j, url) {
  const p = j.product;
  return {
    platform: 'shopify',
    url,
    handle: p.handle,
    title: p.title,
    description: clip(stripHtml(p.body_html), 6000),
    vendor: p.vendor || undefined,
    product_type: p.product_type || undefined,
    tags: p.tags || undefined,
    price: p.variants?.[0]?.price,
    options: (p.options || []).map((o) => ({ name: o.name, values: o.values })),
    variants: (p.variants || []).slice(0, 30).map((v) => ({ title: v.title, price: v.price, sku: v.sku || undefined })),
    images: (p.images || []).slice(0, 10).map((i) => ({ src: i.src, current_alt: i.alt || '' })),
  };
}

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag?.match(/content=["']([^"']*)["']/i)?.[1];
}

function findJsonLdProduct(html) {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    let data;
    try { data = JSON.parse(raw.trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      if (Array.isArray(n)) { stack.push(...n); continue; }
      const t = n['@type'];
      if (t === 'Product' || (Array.isArray(t) && t.includes('Product')) || t === 'ProductGroup') return n;
      if (n['@graph']) stack.push(n['@graph']);
    }
  }
  return null;
}

function fromHtml(html, url) {
  const ld = findJsonLdProduct(html);
  const offers = ld ? [].concat(ld.offers || []).flatMap((o) => o.offers || o) : [];
  const ldImages = ld ? [].concat(ld.image || []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean) : [];
  const variants = ld?.hasVariant ? [].concat(ld.hasVariant).slice(0, 30).map((v) => ({
    title: v.name, sku: v.sku, price: [].concat(v.offers || [])[0]?.price,
  })) : undefined;

  const title = ld?.name || meta(html, 'og:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = stripHtml(ld?.description) || meta(html, 'og:description') || meta(html, 'description') || '';

  // Fallback: WooCommerce / generic description containers
  let body = '';
  const m = html.match(/<div[^>]+(?:woocommerce-product-details__short-description|product-description|product__description|description)[^>]*>([\s\S]{0,20000}?)<\/div>/i);
  if (m) body = stripHtml(m[1]);

  const images = [...new Set([...ldImages, meta(html, 'og:image')].filter(Boolean))].slice(0, 10)
    .map((src) => ({ src: new URL(src, url).toString(), current_alt: '' }));

  return {
    platform: 'html',
    url,
    title: clip(stripHtml(title), 300),
    description: clip([description, body].filter(Boolean).join('\n\n'), 6000),
    brand: typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name,
    sku: ld?.sku,
    price: offers[0]?.price ?? meta(html, 'product:price:amount'),
    currency: offers[0]?.priceCurrency ?? meta(html, 'product:price:currency'),
    variants,
    images,
  };
}

export async function fetchProduct(rawUrl) {
  let url;
  try { url = new URL(rawUrl.trim()); } catch { throw new UserError("That doesn't look like a valid address"); }

  // Shopify: try /products/<handle>.json first
  const m = url.pathname.match(/\/products\/([^/?#.]+)/);
  if (m) {
    const jsonUrl = `${url.origin}/products/${m[1]}.json`;
    try {
      const r = await safeFetch(jsonUrl, 'application/json');
      if (r.status === 200 && r.type.includes('json')) {
        const j = JSON.parse(r.text);
        if (j?.product?.title) return fromShopifyJson(j, url.toString());
      }
    } catch (e) {
      if (e instanceof UserError) throw e;
    }
  }

  const r = await safeFetch(url.toString(), 'text/html');
  if (r.status === 404) throw new UserError("That product page doesn't exist anymore. Check the link, or paste the text by hand.");
  if (r.status !== 200) throw new UserError(`The site returned an error (${r.status}). Try pasting the text by hand.`);
  // Stores often redirect a removed product to the home page or a collection. Don't write copy for the wrong page.
  if (m && !/\/products\//.test(new URL(r.url).pathname)) {
    throw new UserError("That product link now redirects to another page, so the product may have been removed. Check the link, or paste the text by hand.");
  }
  const p = fromHtml(r.text, r.url);
  if (!p.title || (!p.description && !p.images.length)) {
    throw new UserError("We couldn't read a product from this page. Try pasting the text by hand.");
  }
  return p;
}

export function manualProduct({ title, description }) {
  title = String(title || '').trim().slice(0, 300);
  description = String(description || '').trim().slice(0, 6000);
  if (!title) throw new UserError('The title is missing');
  return { platform: 'manual', title, description, images: [] };
}
