// Generates the legal page templates in public/legal/. Fill every [TO FILL] before launch.
// These are drafts to adapt, not legal advice: have them reviewed for your business.
import { writeFileSync, mkdirSync } from 'node:fs';

const T = (s) => `<span class="todo">[TO FILL: ${s}]</span>`;
const pages = {
  terms: ['Terms of use', `
<p>Last updated: ${T('date')}</p>
<h2>The service</h2><p>Pagelift (the "Service") rewrites product page copy from the information you provide, using AI tools. The Service is operated by ${T('business name')}.</p>
<h2>What you agree to</h2><p>You confirm that you have the right to use the content of the product page you paste, and that it is a page from your own store or one you are authorized to work on.</p>
<h2>The result</h2><p>The copy is written only from the data provided. You are responsible for checking it is accurate before publishing, especially sizes, materials, prices and legal compliance (including consumer protection and advertising law).</p>
<h2>Rights</h2><p>Once paid, the rights to the copy written for you belong to you.</p>
<h2>Free previews</h2><p>Up to ${T('3')} previews a day. We may limit unusual usage.</p>
<h2>Payment and refunds</h2><p>Payment is made on Stripe's secure checkout page. See the <a href="/legal/refunds">refund policy</a>.</p>
<h2>Limitation of liability</h2><p>${T('liability wording, for legal review')}</p>
<h2>Governing law</h2><p>${T('state whose law governs, e.g. Delaware, and venue')}</p>`],
  privacy: ['Privacy policy', `
<p>Last updated: ${T('date')}</p>
<h2>What we collect</h2><ul>
<li>The address of the page you paste and the product content read from it, or the text you paste.</li>
<li>Your email address, when you buy.</li>
<li>Your IP address, to limit free previews and prevent abuse.</li>
<li>Basic usage events (page view, preview created, checkout click, payment), with no third-party tracking cookies.</li></ul>
<h2>Payment details</h2><p>Card details are entered on Stripe's checkout page. They never pass through us and are not stored by us.</p>
<h2>Sub-processors</h2><ul><li>Anthropic (Claude API): processing product content to write the copy.</li><li>Cloudflare Turnstile: checking you're not a bot.</li><li>Stripe: payments.</li><li>${T('email provider')}, ${T('hosting')}.</li></ul>
<h2>Retention</h2><p>${T('how long results and order details are kept')}</p>
<h2>Your rights</h2><p>You can ask to see, correct or delete your data by writing to ${T('email')}. ${T('CCPA/CPRA notice for California residents, if it applies to you')}</p>`],
  refunds: ['Refund policy', `
<p>Last updated: ${T('date')}</p>
<p>Not happy with the result? Write to ${T('email')} with your order number and we'll refund the full amount to the payment method you used, no questions asked.</p>
<h2>Timing</h2><p>You can ask for a refund within ${T('number of days')} of purchase. Refunds are processed within ${T('number of business days')}.</p>
<h2>Packages</h2><p>${T('whether 20/100-product package refunds are full or pro rata to products processed')}</p>
<h2>Chargebacks</h2><p>${T('ask us first and we will refund; chargeback handling wording, for legal review')}</p>`],
  business: ['Company details', `
<ul>
<li>Company name: ${T('legal name')}</li>
<li>Entity type and state: ${T('e.g. LLC, Delaware')}</li>
<li>Address: ${T('address')}</li>
<li>Email: ${T('email')}</li>
<li>Phone: ${T('number')}</li>
</ul>`],
};

const page = (title, html) => `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – Pagelift</title>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Permanent+Marker&family=Kalam:wght@700&family=Suez+One&display=swap" rel="stylesheet">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css"></head><body>
<header class="site-header"><div class="wrap"><a class="logo" href="/"><img class="logo-img" src="/brand/logo.svg" alt="Pagelift" width="208" height="58"></a></div></header>
<main class="wrap legal"><h1>${title}</h1>${html}</main>
<footer class="site-footer"><div class="wrap"><nav aria-label="Legal">
<a href="/legal/terms">Terms of use</a><a href="/legal/privacy">Privacy policy</a><a href="/legal/refunds">Refund policy</a><a href="/legal/business">Company details</a>
</nav></div></footer></body></html>
`;

mkdirSync('public/legal', { recursive: true });
for (const [slug, [title, html]] of Object.entries(pages)) writeFileSync(`public/legal/${slug}.html`, page(title, html));
writeFileSync('public/404.html', page('Page not found', '<p><a href="/">Back to the home page</a></p>'));
console.log('legal pages written');
