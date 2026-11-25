// Payment provider adapters. Choose with PAYMENT_PROVIDER = mock | cardcom | payplus.
//
// Every adapter exposes:
//   createCheckout(order) -> { redirectUrl, providerRef }
//   verifyWebhook(rawBody: Buffer, headers) -> { orderId, txnId, amountAgorot }  (throws if not verified)
//
// The order is marked paid ONLY after verifyWebhook succeeds (never on the browser redirect).
// IMPORTANT: the Cardcom and PayPlus adapters follow their public API docs but have not been run
// against a live sandbox here. Test each one with your terminal / sandbox keys before going live.
import crypto from 'node:crypto';
import { config } from './config.js';

const shekels = (agorot) => Number((agorot / 100).toFixed(2));
const toAgorot = (v) => Math.round(Number(v) * 100);
const urls = (order) => ({
  success: `${config.baseUrl}/thanks/${order.access_token}`,
  failure: `${config.baseUrl}/?payment=failed`,
  webhook: `${config.baseUrl}/webhooks/payment`,
});

// ---------- Mock (local development only) ----------
const mock = {
  async createCheckout(order) {
    if (config.isProd) throw new Error('mock payments are disabled in production');
    return { redirectUrl: `${config.baseUrl}/mock-pay/${order.id}`, providerRef: `mock_${order.id}` };
  },
  sign(body) {
    return crypto.createHmac('sha256', config.mockSecret).update(body).digest('hex');
  },
  async verifyWebhook(raw, headers) {
    if (config.isProd) throw new Error('mock payments are disabled in production');
    const sig = String(headers['x-mock-signature'] || '');
    const expected = this.sign(raw);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new Error('bad mock signature');
    }
    const b = JSON.parse(raw.toString('utf8'));
    return { orderId: b.order_id, txnId: b.txn_id, amountAgorot: b.amount_agorot };
  },
};

// ---------- Cardcom (API v11, LowProfile) ----------
// Webhook is not trusted by itself: we re-fetch the deal from Cardcom with GetLpResult.
const cardcom = {
  async call(path, body) {
    const r = await fetch(`${config.cardcom.baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j.ResponseCode !== 0) throw new Error(`cardcom ${path}: ${j.ResponseCode} ${j.Description || ''}`);
    return j;
  },
  async createCheckout(order) {
    const u = urls(order);
    const j = await this.call('LowProfile/Create', {
      TerminalNumber: Number(config.cardcom.terminal),
      ApiName: config.cardcom.apiName,
      Amount: shekels(order.amount_agorot),
      ReturnValue: order.id,
      SuccessRedirectUrl: u.success,
      FailedRedirectUrl: u.failure,
      WebHookUrl: u.webhook,
      Language: 'he',
      ISOCoinId: 1,
      ProductName: order.plan_label,
      UIDefinition: { CardOwnerEmailValue: order.email },
    });
    return { redirectUrl: j.Url, providerRef: j.LowProfileId };
  },
  async verifyWebhook(raw) {
    const b = JSON.parse(raw.toString('utf8'));
    const lpId = b.LowProfileId;
    if (!lpId) throw new Error('cardcom webhook without LowProfileId');
    const j = await this.call('LowProfile/GetLpResult', {
      TerminalNumber: Number(config.cardcom.terminal),
      ApiName: config.cardcom.apiName,
      LowProfileId: lpId,
    });
    const t = j.TranzactionInfo;
    if (!t || t.ResponseCode !== 0) throw new Error('cardcom transaction not approved');
    return { orderId: j.ReturnValue, txnId: String(t.TranzactionId), amountAgorot: toAgorot(t.Amount) };
  },
};

// ---------- PayPlus ----------
// Callback is verified by the HMAC-SHA256 `hash` header (base64, secret key over the raw body),
// then the amount and status are checked against our order.
const payplus = {
  headers() {
    return {
      'content-type': 'application/json',
      'api-key': config.payplus.apiKey,
      'secret-key': config.payplus.secretKey,
      authorization: JSON.stringify({ api_key: config.payplus.apiKey, secret_key: config.payplus.secretKey }),
    };
  },
  async createCheckout(order) {
    const u = urls(order);
    const r = await fetch(`${config.payplus.baseUrl}/PaymentPages/generateLink`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        payment_page_uid: config.payplus.pageUid,
        charge_method: 1,
        amount: shekels(order.amount_agorot),
        currency_code: 'ILS',
        language_code: 'he',
        more_info: order.id,
        refURL_success: u.success,
        refURL_failure: u.failure,
        refURL_callback: u.webhook,
        customer: { email: order.email },
        items: [{ name: order.plan_label, quantity: 1, price: shekels(order.amount_agorot) }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j?.results?.status !== 'success') throw new Error(`payplus generateLink: ${JSON.stringify(j?.results)}`);
    return { redirectUrl: j.data.payment_page_link, providerRef: j.data.page_request_uid };
  },
  async verifyWebhook(raw, headers) {
    const hash = String(headers.hash || '');
    const expected = crypto.createHmac('sha256', config.payplus.secretKey).update(raw).digest('base64');
    if (!hash || hash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) {
      throw new Error('bad payplus hash');
    }
    const b = JSON.parse(raw.toString('utf8'));
    const t = b.transaction || b;
    if (String(t.status_code) !== '000') throw new Error('payplus transaction not approved');
    return { orderId: t.more_info, txnId: String(t.uid || t.transaction_uid), amountAgorot: toAgorot(t.amount) };
  },
};

// ---------- Stripe (Checkout Sessions) ----------
// Webhook is verified with the Stripe-Signature header (HMAC-SHA256 of "t.rawBody" with the endpoint secret,
// 5-minute tolerance), then amount and status are checked. Only checkout.session.completed with
// payment_status "paid" marks an order paid; other event types return null and are acknowledged.
const stripe = {
  async createCheckout(order) {
    const u = urls(order);
    const form = new URLSearchParams({
      mode: 'payment',
      client_reference_id: order.id,
      customer_email: order.email,
      success_url: u.success,
      cancel_url: u.failure,
      'metadata[order_id]': order.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': config.currency,
      'line_items[0][price_data][unit_amount]': String(order.amount_agorot),
      'line_items[0][price_data][product_data][name]': `Pagelift – ${order.plan_label}`,
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.stripe.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`stripe checkout: ${j?.error?.message || r.status}`);
    return { redirectUrl: j.url, providerRef: j.id };
  },
  async verifyWebhook(raw, headers) {
    const sig = String(headers['stripe-signature'] || '');
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2));
    const t = Number(parts.t);
    if (!t || !parts.v1) throw new Error('missing stripe signature');
    if (Math.abs(Date.now() / 1000 - t) > 300) throw new Error('stripe signature too old');
    const expected = crypto.createHmac('sha256', config.stripe.webhookSecret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    const v1s = sig.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
    const ok = v1s.some((v) => v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
    if (!ok) throw new Error('bad stripe signature');
    const event = JSON.parse(raw.toString('utf8'));
    if (event.type !== 'checkout.session.completed') return null;
    const s = event.data.object;
    if (s.payment_status !== 'paid') return null;
    if (String(s.currency).toLowerCase() !== config.currency) throw new Error(`currency mismatch: ${s.currency}`);
    return { orderId: s.client_reference_id || s.metadata?.order_id, txnId: String(s.payment_intent || s.id), amountAgorot: Number(s.amount_total) };
  },
};

const adapters = { mock, stripe, cardcom, payplus };
export const payments = adapters[config.paymentProvider];
if (!payments) throw new Error(`Unknown PAYMENT_PROVIDER: ${config.paymentProvider}`);
export const mockPayments = mock;
