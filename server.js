import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, PLANS } from './src/config.js';
import { db, tx, track } from './src/db.js';
import { fetchProduct, manualProduct, UserError } from './src/fetchProduct.js';
import { generateCopy, firstSentence, providerStatus } from './src/generate.js';
import { payments, mockPayments } from './src/payments.js';
import { sendMail } from './src/email.js';
import { shopifyCsv, productsFromCsv } from './src/csv.js';
import { kickBatchWorker } from './src/batch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, 'public');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

const id = (n = 12) => crypto.randomBytes(n).toString('base64url');
const today = () => new Date().toISOString().slice(0, 10);
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 200;

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// ---------- Webhook (raw body, before JSON parser) ----------
app.post('/webhooks/payment', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  let v;
  try {
    v = await payments.verifyWebhook(req.body, req.headers);
  } catch (e) {
    console.warn('webhook rejected:', e.message);
    return res.status(400).send('rejected');
  }
  if (!v) return res.status(200).send('ignored'); // verified, but not a completed payment (e.g. other Stripe event types)
  try {
    const result = markPaid(v, req.body.toString('utf8'));
    res.status(200).send(result);
  } catch (e) {
    console.error('webhook processing error', e);
    res.status(500).send('error');
  }
});

function markPaid({ orderId, txnId, amountAgorot }, raw) {
  const outcome = tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error(`unknown order ${orderId}`);
    if (amountAgorot !== order.amount_agorot) throw new Error(`amount mismatch on ${orderId}: ${amountAgorot} != ${order.amount_agorot}`);
    const ins = db.prepare(`INSERT OR IGNORE INTO payments (order_id, provider, provider_txn_id, amount_agorot, raw)
      VALUES (?, ?, ?, ?, ?)`).run(orderId, config.paymentProvider, txnId, amountAgorot, raw.slice(0, 20000));
    if (!ins.changes) return { duplicate: true };          // same transaction already processed
    if (order.status !== 'pending') return { duplicate: true };
    db.prepare(`UPDATE orders SET status = 'paid', paid_at = datetime('now'),
      batch_status = CASE WHEN plan = 'single' THEN NULL ELSE 'awaiting_upload' END WHERE id = ?`).run(orderId);
    if (order.generation_id) db.prepare(`UPDATE generations SET status = 'paid', email = ?, order_id = ? WHERE id = ?`)
      .run(order.email, orderId, order.generation_id);
    return { order };
  });
  if (outcome.duplicate) return 'duplicate';

  const o = outcome.order;
  track('payment_completed', o.id, { plan: o.plan, amount: o.amount_agorot });
  const link = `${config.baseUrl}/r/${o.access_token}`;
  const lines = o.plan === 'single'
    ? ['Hi,', 'Your payment went through. Your full product page is ready, including a file to import into Shopify.', "Here's the permanent link to your result. Keep it:"]
    : ['Hi,', `Your payment for the "${PLANS[o.plan].label}" package went through.`, "Use the link below to upload your products CSV. We'll email you when processing is done."];
  sendMail(o.email, 'Payment received – Pagelift', lines, link).catch((e) => console.error('mail failed', e.message));
  return 'ok';
}

app.use(express.json({ limit: '100kb' }));

// ---------- Public config ----------
app.get('/api/config', (req, res) => {
  res.json({
    turnstileSiteKey: config.turnstileSiteKey,
    contactUrl: config.contactUrl,
    currency: config.currency,
    plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { label: p.label, price: p.amount / 100, quota: p.quota }])),
  });
});

// ---------- Tracking (client side only sends page_view) ----------
app.post('/api/event', (req, res) => {
  const name = req.body?.name;
  // Only these client events are accepted; payments and previews are tracked on the server.
  if (['page_view', 'sample_view', 'compare_used', 'founding_click'].includes(name)) track(name, null, { path: String(req.body.path || '/').slice(0, 100) });
  res.status(204).end();
});

// ---------- Turnstile ----------
async function verifyTurnstile(token, ip) {
  if (!config.turnstileSecret) {
    if (config.isProd) return false;
    return true; // dev without keys
  }
  if (!token) return false;
  const body = new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: ip });
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

// ---------- Preview ----------
app.post('/api/preview', async (req, res) => {
  const ip = req.ip;
  const { url, manual, turnstileToken } = req.body || {};
  const email = emailOk(req.body?.email) ? req.body.email.toLowerCase() : null;

  if (!(await verifyTurnstile(turnstileToken, ip))) return res.status(403).json({ error: 'The security check failed. Refresh the page and try again.' });

  const day = today();
  const byIp = db.prepare('SELECT COUNT(*) AS n FROM preview_log WHERE ip = ? AND day = ?').get(ip, day).n;
  const byEmail = email ? db.prepare('SELECT COUNT(*) AS n FROM preview_log WHERE email = ? AND day = ?').get(email, day).n : 0;
  if (byIp >= config.previewsPerDay || byEmail >= config.previewsPerDay) {
    return res.status(429).json({ error: `You've used your ${config.previewsPerDay} free previews for today. Come back tomorrow, or buy the full page.` });
  }

  let product;
  try {
    product = manual ? manualProduct(manual) : await fetchProduct(String(url || ''));
  } catch (e) {
    if (e instanceof UserError) return res.status(422).json({ error: e.message, manual: true });
    console.error('fetch failed', e.message);
    return res.status(422).json({ error: "We couldn't read that page. Try pasting the text by hand.", manual: true });
  }

  let result;
  try {
    result = await generateCopy(product);
  } catch (e) {
    console.error('generation failed', e.message);
    // A failed generation does not use up one of the visitor's free previews.
    return res.status(503).json({ error: "We're at capacity for free previews right now. Your free tries weren't used. Try again in a few minutes." });
  }
  // Count the free preview only once it actually succeeded.
  db.prepare('INSERT INTO preview_log (ip, email, day) VALUES (?, ?, ?)').run(ip, email, day);

  const genId = id(9);
  db.prepare(`INSERT INTO generations (id, status, source_url, source_kind, source_json, result_json, ip, email)
    VALUES (?, 'locked', ?, ?, ?, ?, ?, ?)`)
    .run(genId, product.url || null, product.platform, JSON.stringify(product), JSON.stringify(result), ip, email);
  track('preview_created', genId, { kind: product.platform });

  // Only the title and the first sentence of the intro leave the server before payment.
  // "source" is the store's own current copy (already public on their site), shown as the "before".
  const len = (s) => [...String(s || '')].length;
  res.json({
    id: genId,
    preview: { title: result.title, intro_first: firstSentence(result.intro) },
    locked: { bullets: result.bullets.length, alts: result.alts.length, missing_info: result.missing_info.length },
    source: {
      title: product.title,
      description: String(product.description || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      image: product.images?.[0]?.src || null,
      imageCount: product.images?.length || 0,
    },
    // Checks the shopper-facing result passes, computed from the full result without revealing it.
    checks: [
      { label: 'Title under 60 characters', ok: len(result.title) <= 60, detail: `${len(product.title)} → ${len(result.title)}` },
      { label: 'Meta description under 155 characters', ok: len(result.meta) > 0 && len(result.meta) <= 155, detail: `${len(result.meta)} characters` },
      // Only meaningful when the page has images; with none, a "0 of 0" pass would mislead.
      ...(product.images?.length ? [{ label: 'Alt text for every image', ok: result.alts.length === product.images.length, detail: `${result.alts.length} of ${product.images.length}` }] : []),
      { label: 'Spec bullets', ok: result.bullets.length >= 3, detail: `${result.bullets.length}` },
    ],
  });
});

// ---------- Checkout ----------
app.post('/api/checkout', async (req, res) => {
  const { plan, generationId } = req.body || {};
  const email = String(req.body?.email || '').trim().toLowerCase();
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: 'Unknown plan' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Invalid email address' });

  if (plan === 'single') {
    const g = db.prepare('SELECT id, status FROM generations WHERE id = ?').get(String(generationId || ''));
    if (!g) return res.status(400).json({ error: 'Create a preview first' });
    if (g.status === 'paid') {
      const o = db.prepare(`SELECT access_token FROM orders WHERE generation_id = ? AND status = 'paid'`).get(g.id);
      if (o) return res.json({ redirectUrl: `/r/${o.access_token}` });
    }
  }

  const order = {
    id: 'ord_' + id(9), plan, plan_label: p.label, amount_agorot: p.amount, quota: p.quota, email,
    generation_id: plan === 'single' ? generationId : null, access_token: id(24),
  };
  try {
    const { redirectUrl, providerRef } = await payments.createCheckout(order);
    db.prepare(`INSERT INTO orders (id, plan, amount_agorot, quota, email, generation_id, access_token, provider, provider_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(order.id, plan, p.amount, p.quota, email, order.generation_id, order.access_token, config.paymentProvider, providerRef);
    track('checkout_click', order.id, { plan });
    res.json({ redirectUrl });
  } catch (e) {
    console.error('checkout failed', e);
    res.status(502).json({ error: "We couldn't open the payment page. Try again." });
  }
});

// ---------- Mock payment page (dev only) ----------
if (config.paymentProvider === 'mock' && !config.isProd) {
  app.get('/mock-pay/:orderId', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!o) return res.status(404).send('not found');
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Test payment page</title><body style="font-family:Arial;max-width:420px;margin:60px auto;padding:20px">
<h2>Test payment page (mock)</h2><p>Order ${o.id}<br>Amount: $${(o.amount_agorot / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}<br>${o.email}</p>
<form method="post"><button style="padding:12px 20px;font-size:16px">Confirm test payment</button></form>
<p style="color:#666">The button sends a signed webhook to the server, just like a real card processor.</p></body></html>`);
  });
  app.post('/mock-pay/:orderId', async (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!o) return res.status(404).send('not found');
    const body = JSON.stringify({ order_id: o.id, txn_id: 'txn_' + id(6), amount_agorot: o.amount_agorot });
    await fetch(`http://127.0.0.1:${config.port}/webhooks/payment`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': mockPayments.sign(body) }, body,
    });
    res.redirect(303, `/r/${o.access_token}`);
  });
}

// ---------- Result / order ----------
function orderByToken(token) {
  return db.prepare('SELECT * FROM orders WHERE access_token = ?').get(String(token));
}

app.get('/api/order/:token', (req, res) => {
  const o = orderByToken(req.params.token);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const base = { status: o.status, plan: o.plan, planLabel: PLANS[o.plan].label, quota: o.quota, email: o.email };
  if (o.status !== 'paid') return res.json(base); // nothing locked leaves the server

  if (o.plan === 'single') {
    const g = db.prepare('SELECT * FROM generations WHERE id = ?').get(o.generation_id);
    const source = JSON.parse(g.source_json);
    return res.json({ ...base, result: JSON.parse(g.result_json), source: { title: source.title, url: source.url, images: source.images || [] } });
  }
  const counts = db.prepare(`SELECT COUNT(*) AS total, SUM(status='done') AS done, SUM(status='failed') AS failed
    FROM batch_items WHERE order_id = ?`).get(o.id);
  const items = db.prepare(`SELECT handle, source_json, result_json, status FROM batch_items WHERE order_id = ? ORDER BY row_index`).all(o.id)
    .map((i) => ({ handle: i.handle, title: JSON.parse(i.source_json).title, status: i.status, result: i.result_json ? JSON.parse(i.result_json) : null }));
  res.json({ ...base, batchStatus: o.batch_status, batchNote: o.batch_note, counts, items });
});

app.get('/api/order/:token/csv', (req, res) => {
  const o = orderByToken(req.params.token);
  if (!o || o.status !== 'paid') return res.status(404).send('not found');
  let items;
  if (o.plan === 'single') {
    const g = db.prepare('SELECT * FROM generations WHERE id = ?').get(o.generation_id);
    items = [{ source: JSON.parse(g.source_json), result: JSON.parse(g.result_json) }];
  } else {
    items = db.prepare(`SELECT source_json, result_json FROM batch_items WHERE order_id = ? AND status = 'done' ORDER BY row_index`).all(o.id)
      .map((i) => ({ source: JSON.parse(i.source_json), result: JSON.parse(i.result_json) }));
  }
  res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="shopify-import-${o.id}.csv"` });
  res.send(shopifyCsv(items));
});

app.post('/api/order/:token/upload', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
  const o = orderByToken(req.params.token);
  if (!o || o.status !== 'paid' || o.plan === 'single') return res.status(404).json({ error: 'Not found' });
  if (o.batch_status !== 'awaiting_upload') return res.status(409).json({ error: 'The file was already uploaded' });
  let products;
  try { products = productsFromCsv(String(req.body || '')); } catch { products = []; }
  if (!products.length) return res.status(400).json({ error: "We didn't find any products in the file. Make sure it's a products CSV export from Shopify or WooCommerce." });
  if (products.length > o.quota) {
    return res.status(400).json({ error: `The file has ${products.length} products and your package covers up to ${o.quota}. Remove some products from the file and try again.` });
  }
  tx(() => {
    const ins = db.prepare('INSERT INTO batch_items (order_id, row_index, handle, source_json) VALUES (?, ?, ?, ?)');
    products.forEach((p, i) => ins.run(o.id, i, p.handle, JSON.stringify(p)));
    db.prepare(`UPDATE orders SET batch_status = 'processing' WHERE id = ?`).run(o.id);
  });
  kickBatchWorker();
  res.json({ ok: true, count: products.length });
});

app.get('/r/:token', (req, res) => res.sendFile(join(PUB, 'result.html')));

// ---------- Admin ----------
function adminAuth(req, res, next) {
  if (!config.adminPassword) return res.status(503).send('ADMIN_PASSWORD is not set');
  const [scheme, b64] = String(req.headers.authorization || '').split(' ');
  const pass = scheme === 'Basic' ? Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':') : '';
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"').status(401).send('auth required');
}
app.get('/admin', adminAuth, (req, res) => res.sendFile(join(PUB, 'admin.html')));
app.get('/admin/api/data', adminAuth, (req, res) => {
  const funnel = db.prepare(`SELECT name, COUNT(*) AS n FROM events WHERE created_at >= datetime('now', ?) GROUP BY name`)
    .all(`-${Math.min(Number(req.query.days) || 30, 365)} days`);
  res.json({
    providers: providerStatus(),
    funnel: Object.fromEntries(funnel.map((r) => [r.name, r.n])),
    orders: db.prepare(`SELECT o.id, o.plan, o.amount_agorot, o.email, o.status, o.batch_status, o.batch_note, o.created_at, o.paid_at,
        o.access_token, p.provider_txn_id FROM orders o LEFT JOIN payments p ON p.order_id = o.id ORDER BY o.created_at DESC LIMIT 200`).all(),
    generations: db.prepare(`SELECT id, status, source_kind, source_url, email, created_at,
        json_extract(result_json, '$.title') AS title, json_extract(result_json, '$.provider') AS provider FROM generations ORDER BY created_at DESC LIMIT 200`).all(),
  });
});
app.post('/admin/api/refund/:orderId', adminAuth, (req, res) => {
  const r = tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!o || o.status !== 'paid') return null;
    db.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?`).run(o.id);
    db.prepare(`UPDATE payments SET status = 'refunded' WHERE order_id = ?`).run(o.id);
    if (o.generation_id) db.prepare(`UPDATE generations SET status = 'refunded' WHERE id = ?`).run(o.generation_id);
    return o;
  });
  if (!r) return res.status(400).json({ error: 'not refundable' });
  res.json({ ok: true, note: "Marked as refunded. Make the refund itself in the card processor's dashboard." });
});

// ---------- Static ----------
app.use(express.static(PUB, { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
app.use((req, res) => res.status(404).sendFile(join(PUB, '404.html')));

app.listen(config.port, () => {
  console.log(`Pagelift running on ${config.baseUrl} (payments: ${config.paymentProvider}${config.aiMock ? ', AI_MOCK' : ''})`);
  kickBatchWorker();
});
