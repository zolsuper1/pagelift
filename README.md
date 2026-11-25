# Pagelift

אתר נחיתה + שרת לשכתוב דפי מוצר בעברית עם Claude. Node 22.5+, Express, SQLite מובנה (`node:sqlite`).

## הרצה מקומית

```
npm install
cp .env.example .env      # AI_MOCK=1 לבדיקה בלי מפתח API, PAYMENT_PROVIDER=mock
npm start                 # http://localhost:3000
```

- ניהול: `/admin` (משתמש כלשהו + `ADMIN_PASSWORD`)
- תשלום mock: דף בדיקה ששולח webhook חתום לשרת, כמו ספק אמיתי. כבוי ב-production.
- בלי `SMTP_HOST` המיילים מודפסים לקונסול.

## לפני עלייה לאוויר

1. `ANTHROPIC_API_KEY`, `AI_MOCK=0`.
2. מפתחות Turnstile אמיתיים (המפתחות ב-.env.example הם מפתחות הבדיקה הציבוריים של Cloudflare).
3. `PAYMENT_PROVIDER=cardcom` או `payplus` עם המפתחות. **את המתאמים ב-`src/payments.js` צריך לבדוק מול סביבת ה-sandbox של הספק**: הם נכתבו לפי התיעוד הציבורי ולא הורצו מול הספק. כתובת ה-webhook: `BASE_URL/webhooks/payment`.
4. SMTP, `ADMIN_PASSWORD`, `WHATSAPP_NUMBER`, `BASE_URL`, `NODE_ENV=production`, `TRUST_PROXY=1` מאחורי proxy.
5. למלא את כל ה-`[למלא]` בדפים המשפטיים (`scripts/make-legal.mjs`, ואז `node scripts/make-legal.mjs`), ולהעביר לבדיקת עו״ד.
6. להחליף את דוגמת לפני/אחרי ב-`public/index.html` בדוגמה אמיתית.

## איך זה בנוי

| קובץ | מה עושה |
|---|---|
| `server.js` | כל הנתיבים: preview, checkout, webhook, תוצאה, העלאת CSV, ניהול |
| `src/fetchProduct.js` | Shopify `.json`, או חילוץ מ-HTML (JSON-LD, og, WooCommerce). חסימת SSRF |
| `src/generate.js` | קריאה ל-Claude עם פרומפט הכתיבה ו-JSON schema. `AI_MOCK` לבדיקות |
| `src/payments.js` | mock / Cardcom / PayPlus. סטטוס paid רק אחרי webhook מאומת |
| `src/batch.js` | עיבוד חבילות 20/100 ברקע, ממשיך אחרי ריסטארט, מייל בסיום |
| `src/csv.js` | קריאת ייצוא Shopify/WooCommerce, כתיבת CSV לייבוא ל-Shopify |
| `replica/design/tokens.json` | טוקני העיצוב (נבדקו לניגודיות WCAG AA) |

## הגנות

- לפני תשלום השרת שולח לדפדפן רק כותרת ומשפט פתיחה. שאר השדות מוצגים כפסים ריקים.
- 3 תצוגות ביום לכל IP (ולכל אימייל אם נשלח), Turnstile לפני כל יצירה.
- webhook: אימות חתימה (PayPlus / mock) או שליפה חוזרת מהספק (Cardcom), בדיקת סכום מול ההזמנה, ומפתח ייחודי על מזהה העסקה נגד עיבוד כפול.
- הגבלת מוצרים בקובץ לפי החבילה שנקנתה.

## Generation engine (free first)

Generation runs through a provider chain, set by `AI_PROVIDERS` in `.env` (default `groq,gemini,anthropic`).
Each provider with a key is tried in order; a rate limit, error, invalid output or its daily budget moves on to the next.
If all fail, the visitor gets a clear "at capacity" message and their free preview is not used up.

1. **Groq (free, recommended first):** create a key at console.groq.com (no card) and set `GROQ_API_KEY`. Default model `openai/gpt-oss-120b`, about 1,000 requests/day on the free plan.
2. **Gemini (free, backup):** key from aistudio.google.com, `GEMINI_API_KEY`. The free daily quota is small (~20/day reported), so it is a backup only.
3. **Claude (paid, optional):** `ANTHROPIC_API_KEY`. Cents per product page.
4. **Anything else OpenAI-compatible** (OpenRouter, Cloudflare Workers AI): `OPENAI_COMPAT_*` and add `custom` to `AI_PROVIDERS`.

Set `AI_MOCK=0` once a key is in. `/admin` shows each engine, whether its key is set, and today's usage.
Free tiers change without notice and carry no uptime promise: keep at least two in the chain, and a paid one at the end before real traffic.
