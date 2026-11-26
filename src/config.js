// All configuration comes from environment variables (see .env.example).
const env = process.env;

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// Test payments hand out the paid result for free, so they must be switched on explicitly (local .env only).
const mockAllowed = env.ALLOW_MOCK_PAYMENTS === '1' && env.NODE_ENV !== 'production';
// An unset or placeholder address would silently swallow leads: treat it as "no contact yet".
const contact = (env.CONTACT_URL || '').trim();
const contactUrl = /@(example\.com|yourdomain\.com)/i.test(contact) ? '' : contact;

export const config = {
  mockAllowed,
  // Can a visitor actually pay right now?
  get checkoutOpen() {
    const p = this.paymentProvider;
    if (p === 'mock') return this.mockAllowed;
    if (p === 'stripe') return Boolean(this.stripe.secretKey && this.stripe.webhookSecret);
    if (p === 'cardcom') return Boolean(this.cardcom.terminal && this.cardcom.apiName);
    if (p === 'payplus') return Boolean(this.payplus.apiKey && this.payplus.secretKey && this.payplus.pageUid);
    return false;
  },
  // Without SMTP, mail is only printed to the console: don't tell a real visitor it was sent.
  get emailOn() { return Boolean(this.smtp.host) || this.mockAllowed; },
  port: num(env.PORT, 3000),
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  isProd: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH || './data/app.db',

  // AI
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  aiMock: env.AI_MOCK === '1', // local testing without an API key

  // Free previews
  previewsPerDay: num(env.PREVIEWS_PER_DAY, 3),
  turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
  turnstileSecret: env.TURNSTILE_SECRET_KEY || '',

  // Payments: mock | stripe (cardcom | payplus remain for Israeli merchants)
  paymentProvider: (env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
  currency: (env.CURRENCY || 'usd').toLowerCase(),
  mockSecret: env.MOCK_PAYMENT_SECRET || 'dev-only-mock-secret',
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },
  cardcom: {
    terminal: env.CARDCOM_TERMINAL || '',
    apiName: env.CARDCOM_API_NAME || '',
    apiPassword: env.CARDCOM_API_PASSWORD || '',
    baseUrl: env.CARDCOM_BASE_URL || 'https://secure.cardcom.solutions/api/v11',
  },
  payplus: {
    apiKey: env.PAYPLUS_API_KEY || '',
    secretKey: env.PAYPLUS_SECRET_KEY || '',
    pageUid: env.PAYPLUS_PAYMENT_PAGE_UID || '',
    baseUrl: env.PAYPLUS_BASE_URL || 'https://restapidev.payplus.co.il/api/v1.0',
  },

  // Email (SMTP). Empty host = print emails to the console.
  smtp: {
    host: env.SMTP_HOST || '',
    port: num(env.SMTP_PORT, 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Pagelift <no-reply@example.com>',
  },

  adminPassword: env.ADMIN_PASSWORD || '',
  // Where "Talk to us" on the monthly plan goes: a mailto: or a booking link (Calendly, Cal.com…)
  contactUrl,
};

// Prices live on the server only. Amounts in the smallest currency unit (cents).
// These are starting suggestions for the US market: change them here.
export const PLANS = {
  single:  { label: 'Single product', amount: 1900,  quota: 1 },
  pilot:   { label: 'Pilot – up to 20 products', amount: 14900, quota: 20 },
  catalog: { label: 'Catalog – up to 100 products', amount: 44900, quota: 100 },
};
export const MONTHLY_FROM = 249; // shown on the page only; sold by conversation
