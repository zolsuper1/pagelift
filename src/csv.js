// Minimal RFC 4180 CSV parse / write, plus Shopify import export.

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function slugify(s) {
  return String(s || 'product').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'product';
}

export function bodyHtml(r) {
  const parts = [`<p>${escHtml(r.intro)}</p>`];
  if (r.bullets?.length) parts.push(`<ul>${r.bullets.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>`);
  return parts.join('\n');
}

// Shopify product CSV. Import with "Overwrite products with matching handles" to update existing products.
// One row per image so each image gets its alt text; the first row carries the product fields.
export function shopifyCsv(items) {
  const header = ['Handle', 'Title', 'Body (HTML)', 'SEO Title', 'SEO Description', 'Image Src', 'Image Position', 'Image Alt Text'];
  const rows = [header];
  for (const { source, result } of items) {
    const handle = source.handle || slugify(source.title);
    const imgs = source.images || [];
    rows.push([handle, result.title, bodyHtml(result), result.title, result.meta,
      imgs[0]?.src || '', imgs[0] ? 1 : '', imgs[0] ? result.alts[0] || '' : '']);
    for (let i = 1; i < imgs.length; i++) {
      rows.push([handle, '', '', '', '', imgs[i].src, i + 1, result.alts[i] || '']);
    }
  }
  return toCsv(rows);
}

// Accepts a Shopify product export or a WooCommerce export (or any CSV with title/description columns).
export function productsFromCsv(text) {
  const rows = parseCsv(text);
  const pick = (r, ...keys) => {
    for (const k of keys) {
      const found = Object.keys(r).find((h) => h.toLowerCase() === k.toLowerCase());
      if (found && r[found]?.trim()) return r[found].trim();
    }
    return '';
  };
  const byKey = new Map();
  for (const r of rows) {
    const handle = pick(r, 'Handle', 'Slug', 'ID', 'SKU');
    const title = pick(r, 'Title', 'Name', 'שם', 'כותרת');
    const description = pick(r, 'Body (HTML)', 'Description', 'Short description', 'תיאור');
    const image = pick(r, 'Image Src', 'Images');
    const key = handle || title;
    if (!key) continue;
    if (!byKey.has(key)) {
      if (!title) continue; // Shopify extra image rows have no title; skip if product not seen yet
      byKey.set(key, {
        platform: 'csv', handle: handle || slugify(title), title,
        description: description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000),
        price: pick(r, 'Variant Price', 'Regular price', 'Price'),
        vendor: pick(r, 'Vendor') || undefined,
        product_type: pick(r, 'Type', 'Categories') || undefined,
        images: [],
      });
    }
    const p = byKey.get(key);
    for (const src of image.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (p.images.length < 10 && !p.images.some((i) => i.src === src)) p.images.push({ src, current_alt: '' });
    }
  }
  return [...byKey.values()];
}
