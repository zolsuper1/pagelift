# Design brief: Pagelift landing page (Hebrew, RTL)

Build the front end of **Pagelift**, a Hebrew landing page for a service that rewrites product pages for small Israeli online stores using AI. Follow this brief exactly. Where it gives a hex value, font, size or copy, use it as written.

## 1. Product context (so the design makes sense)

- Audience: solo owners of Shopify and WooCommerce stores in Israel (fashion, jewelry, cosmetics, home decor, pet products).
- Mechanism: the visitor pastes a link to one of their product pages, sees a free partial preview (new title + first sentence of the intro), and pays to unlock the full result.
- Tone of all copy: direct, factual, Hebrew, no superlatives, no emojis.

## 2. Visual direction

**70s retro-futurist space.** Think vintage NASA posters and 1970s sci-fi paperbacks: a deep indigo night sky, a striped sunset planet with a ring, warm star-white text, rounded pill buttons. Fun and warm, never neon-cyberpunk, never cold or corporate.

Spend the boldness in two places only: the hero planet and the sunset at the bottom of the page. Everything else stays calm and readable.

## 3. Language and direction

- `<html lang="he" dir="rtl">`. All layout is right-to-left and right-aligned.
- URL and email inputs: `direction: ltr; text-align: right;` and the placeholder `direction: rtl`.
- The English logo stays left-to-right inside the RTL header.

## 4. Color tokens (use exactly; all text pairs pass WCAG AA)

| Token | Hex | Use |
|---|---|---|
| bg | `#17123b` | page background (deep indigo) |
| surface | `#221a52` | cards, panels, table |
| surface-2 | `#2c2366` | raised areas, table header, featured row |
| border | `#3d3380` | 1.5px panel borders, dashed row dividers |
| border-input | `#8f84d6` | input borders, ghost-button outline |
| text | `#fff1dc` | main text (warm star white) |
| text-muted | `#bdb3e6` | secondary text |
| accent | `#ffb547` | the ONE action color (amber): primary buttons, prices, links |
| on-accent | `#17123b` | text on amber |
| orange | `#ff7a2f` | sunset stripe, button bottom shadow |
| pink | `#ff4f7b` | sunset stripe, strike-through line |
| violet | `#9b4dff` | sunset stripe |
| teal | `#3fd6c6` | sunset stripe, small kicker text, "recommended" badge, character counters |
| danger | `#ff8a8a` | errors |
| success | `#5ee3a8` | success states |

The stripe colors (orange, pink, violet, teal) appear only on the planet, the logo, the sunset, and the heading underlines. Don't use them as general UI colors.

## 5. Typography

Load from Google Fonts: `Assistant:wght@400;600;700`, `Suez One`, `Bungee`.

- **Hebrew headings (h1, h2, prices, plan names, step numbers):** Suez One (one weight only; set `font-synthesis: none` so the browser never fakes bold).
- **Body, buttons, labels, inputs:** Assistant. Body 18px, line-height 1.6. Buttons 18px / 700.
- **Logo wordmark:** Bungee.
- The ₪ sign in Suez One looks like the letters ש״ח, so wrap it in a span set in Assistant 700 at 0.62em.
- No ALL-CAPS labels, no eyebrow labels above every heading, no `→` arrows on buttons.

## 6. Logo

A ringed planet mark plus the wordmark **PAGELIFT**:

- **Mark:** a circle filled amber `#ffb547`, with horizontal stripes across its lower half (from top to bottom: orange, pink, violet, teal, each thinner than the last, like a retro sunset). A cream `#fff1dc` ring circles it, tilted about -14°, passing behind the planet at the top and in front at the bottom. A small 4-point cream star sits top-right. On a dark indigo circular background for favicon use.
- **Wordmark:** "PAGELIFT" in Bungee, filled with a vertical gradient amber → orange → pink.
- **Under the wordmark:** three rounded "speed lines" stacked, each shorter than the one above: amber (full width), orange (80%), pink (60%).
- Header size: mark 40px, wordmark 26px (22px on mobile).

Exact SVG to use for the full logo:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 120" role="img" aria-label="Pagelift">
  <defs>
    <clipPath id="p"><circle cx="60" cy="60" r="34"/></clipPath>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb547"/><stop offset=".55" stop-color="#ff7a2f"/><stop offset="1" stop-color="#ff4f7b"/>
    </linearGradient>
  </defs>
  <path d="M14 70 C 14 52, 106 38, 106 50" fill="none" stroke="#fff1dc" stroke-width="5" stroke-linecap="round" transform="rotate(-14 60 60)"/>
  <g clip-path="url(#p)">
    <rect x="20" y="20" width="80" height="80" fill="#ffb547"/>
    <rect x="20" y="58" width="80" height="9" fill="#ff7a2f"/>
    <rect x="20" y="71" width="80" height="8" fill="#ff4f7b"/>
    <rect x="20" y="83" width="80" height="7" fill="#9b4dff"/>
    <rect x="20" y="94" width="80" height="6" fill="#3fd6c6"/>
  </g>
  <path d="M106 50 C 106 68, 14 82, 14 70" fill="none" stroke="#fff1dc" stroke-width="5" stroke-linecap="round" transform="rotate(-14 60 60)"/>
  <path d="M92 20 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#fff1dc"/>
  <text x="130" y="76" font-family="Bungee, 'Arial Black', sans-serif" font-size="54" fill="url(#sun)">PAGELIFT</text>
  <rect x="132" y="90" width="320" height="4" rx="2" fill="#ffb547"/>
  <rect x="132" y="98" width="256" height="4" rx="2" fill="#ff7a2f"/>
  <rect x="132" y="106" width="192" height="4" rx="2" fill="#ff4f7b"/>
</svg>
```

## 7. Global background

A fixed starfield behind the whole page, made only with CSS (several layers of tiny 1–2px radial-gradient dots in cream, lavender and one amber, at different tile sizes so the pattern doesn't repeat visibly), over a soft radial glow of `#2c2366` at the top center fading to `#17123b`. No images, no stock photos, no photos of people.

## 8. Shapes and components

- **Radii:** panels and cards 28px, inputs 16px, buttons fully round (999px).
- **Primary button:** amber background, indigo text, Assistant 700, height 52px, padding 0 26px, with a solid **4px orange shadow under it** (`box-shadow: 0 4px 0 #ff7a2f`) for a chunky retro feel. Hover: lighter amber `#ffc56e`. Pressed: moves down 1px.
- **Ghost button:** transparent, cream text, 1.5px inset outline in `#8f84d6`.
- **Panels:** `surface` background, 1.5px `border` outline, no generic grey drop shadows.
- **Row dividers:** 1px dashed `border`.
- **Section headings (h2):** Suez One, 40–60px, with a small "speed lines" underline below: three 4px bars (amber, orange, pink) stacked with 1px gaps, 120px wide.
- **Focus:** visible 2px amber outline on every interactive element.

## 9. Page structure, top to bottom

### Header (sticky)
Translucent indigo (`rgba(23,18,59,.82)` + backdrop blur), 70px tall, bottom border. Right side: the logo. Left side: links "איך זה עובד", "מחירים", "שאלות" and an amber pill button "לנסות על מוצר שלכם" (on screens under 480px, shorten it to "לנסות" and hide the other links).

### Hero
Two columns on desktop (text on the right, specimen card on the left), one column on mobile.

- Small kicker in teal, Assistant 600: "כתיבת דפי מוצר לחנויות Shopify ו-WooCommerce"
- **H1**, three lines, each on its own line: "דף מוצר שמוכר," / "בעברית טבעית," / "תוך דקה". Suez One, 46–80px (responsive clamp), line-height 1.04. **Each line is filled with the logo's sunset gradient** (amber at top → orange → pink at bottom, via `background-clip: text`), plus a hard retro drop shadow in deep violet (`filter: drop-shadow(0 5px 0 #2c2366)`) and a soft dark glow. It must be bold and eye-catching but comfortable to read: no multi-color stacked neon shadows.
- Lede (muted, 20px): "מדביקים קישור למוצר ומקבלים כותרת שמופיעה בחיפוש, פתיח, תבליטי מפרט, מטא-תיאור ו-alt לתמונות. לא מרוצים? החזר מלא."
- **The main input:** one large pill-shaped field with a cream `#fff1dc` background and indigo text, a soft amber glow ring around it, and inside it on the left a dark indigo pill button "תראו לי את הגרסה החדשה". Placeholder: "הדביקו קישור למוצר מהחנות שלכם". On mobile, the input and button stack and the button goes full width.
- Under the input: a link-style button "או הדביקו את הטקסט ידנית" (opens a panel with two fields: "כותרת המוצר הנוכחית" and a textarea "התיאור הקיים") and muted text "3 תצוגות מקדימות חינם ביום, בלי הרשמה".
- **Specimen card (left column):** a "mission console" panel showing what the product does. Top bar: three small round lights (pink, amber, teal) and muted text "דוגמה להמחשה". Then three rows separated by dashed lines:
  1. Label "כותרת" with a teal counter "39/60". Below it the supplier's old English title "Women Fashion Hoop Earrings Gold Plated 2024 New" in muted text with a **pink strike-through**, then the new title in amber, Suez One 24px: "עגילי חישוק מצופי זהב לנשים, קוטר 3 ס״מ".
  2. Label "פתיח": "חישוק דק שמתאים גם ליום עבודה וגם לערב. נסגר בקליק ונשאר במקום כל היום."
  3. Label "מידע שחסר בדף": "מה עובי הציפוי? האם מתאים לאוזניים רגישות?"
- **The planet (the hero's signature element):** a big striped sunset planet (about 540px) rising from the bottom-left corner of the hero, partly behind the specimen card: amber top half with a soft lighter highlight, then horizontal stripes on the lower half in orange, pink, violet and teal separated by thin gaps of the background color. A thin cream ring (about 3px, semi-transparent) crosses it on a -12° tilt. The bottom of the hero cuts the planet, like a horizon. On mobile, show it smaller and faded at 50% opacity, without the ring.

### Free preview result (appears under the hero after submitting)
Two columns: a document panel on the right and a sticky payment panel on the left (stacked on mobile).
- Document panel: label "הכותרת החדשה" + the new title in amber Suez One 30px; label "פתיח" + the first sentence. Below it, the locked fields ("תבליטי מפרט", "מטא-תיאור לגוגל", "טקסט alt לתמונות") are shown **only as striped placeholder bars** (diagonal stripes in two shades of indigo), not blurred text. A lock icon with "שאר הדף נפתח אחרי התשלום".
- Payment panel: `surface-2` background with a 1.5px amber border. Heading "הדף המלא, 49 ש״ח", short text, an email field, an amber button "קבלו את הדף המלא, ₪49", and fine print "התשלום בדף המאובטח של חברת הסליקה. לא מרוצים? החזר מלא."

### "איך זה עובד"
H2 + muted subtitle "בלי התקנה, בלי חיבור לחנות ובלי לתת סיסמה." Three cards in a row (one column on mobile). Each card has a 64px round number badge ("1", "2", "3") in Suez One with a hard offset shadow, in sunset order: 1 amber with an orange shadow, 2 orange with a pink shadow, 3 pink with a violet shadow. Steps:
1. "מדביקים קישור": "קישור לדף מוצר מהחנות. אם החנות לא נתמכת, מדביקים את הכותרת והתיאור ידנית."
2. "רואים תצוגה מקדימה": "הכותרת החדשה ומשפט הפתיחה מופיעים בחינם, כדי שתראו את הכיוון לפני שמשלמים."
3. "משלמים ומקבלים הכול": "כל השדות עם כפתור העתקה, קובץ CSV לייבוא ל-Shopify וקישור קבוע במייל."

### "לפני ואחרי"
Two side-by-side panels. "לפני" has a dashed border and muted text; "אחרי" has a solid amber border, `surface` background and an amber tag. Fill them with bracketed placeholders (I'll replace them with a real example later).

### "חבילות ומחירים"
A real table inside a rounded `surface` panel (header row in `surface-2`, dashed dividers). Columns: חבילה / מה מקבלים / מחיר / action. Prices in amber Suez One 44px.
- מוצר בודד, "דף מוצר אחד מלא, מקישור או מטקסט", ₪49, ghost button "התחילו מתצוגה מקדימה"
- פיילוט (featured row in `surface-2` with a teal "מומלץ להתחלה" badge), "עד 20 מוצרים. מעלים קובץ CSV מהחנות ומקבלים קובץ מוכן לייבוא", ₪490, amber button "רכישת פיילוט"
- קטלוג, "עד 100 מוצרים, באותו תהליך של העלאת CSV", ₪1,490, amber button "רכישת קטלוג"
- מנוי חודשי, "מוצרים חדשים כל חודש, עדכונים לעונות ולמבצעים. מתאימים יחד את ההיקף", ₪790 "לחודש", ghost button "דברו איתי בוואטסאפ" (opens WhatsApp)

On mobile, each row becomes a stacked block: name on the right, price on the left, description below, full-width button.

Under the table: "לא מרוצים מהתוצאה? כותבים לנו ומקבלים החזר מלא."

### "שאלות נפוצות"
Two columns on desktop (heading on the right, list on the left). Each question is a rounded `surface` accordion with the question in Suez One 21px and a round `+` button that rotates 45° when open. Questions: "האם זה נשמע כמו AI?", "מה עם SEO?", "איך מייבאים לחנות?", "מה אם לא אהבתי?".

### Closing band
Centered: H2 "תבדקו על מוצר אחד שלכם", muted "התצוגה המקדימה בחינם ולוקחת פחות מדקה.", amber button "להדביק קישור". **Below the text, a big retro sunset rises from the bottom edge:** a half-visible circle (about 760px) with a vertical amber → orange → pink gradient, sliced by horizontal bands of the background color that get thicker toward the bottom (the classic 70s/80s sunset). It sits below the text, never behind it.

### Footer
Thin top border, muted 15px text. Links: תנאי שימוש, מדיניות פרטיות, מדיניות החזרים, פרטי העוסק. And "© 2026 Pagelift".

## 10. Other pages in the same style
- **Result page:** a header with a teal kicker (plan name) and a big cream H1 "הדף המלא שלכם". Then one rounded `surface` panel per field (title with a 60-character counter, intro, bullets, meta description with a 155-character counter, image alt texts with thumbnails, missing info), each with a ghost "העתקה" button that changes to "הועתק" for 1.5 seconds. On top: an amber button "הורדת CSV לייבוא ל-Shopify".
- **Legal pages and admin page:** same header, background and fonts. Simple and readable.

## 11. Motion (keep it minimal)
- **One** orchestrated moment on load: the planet and its ring rise into place (about 1.1s, ease-out), and the pink strike-through on the specimen's old title fades in after about 0.9s.
- Otherwise, motion only responds to the user: button press, accordion open, copy confirmation.
- No fade-and-slide-in on every section, no parallax, no twinkling loops.
- Respect `prefers-reduced-motion`: turn all animation off.

## 12. Quality bar
- Mobile-first, tested at 375px wide: no horizontal scrolling, nothing wraps awkwardly in the header.
- Contrast: all text at least WCAG AA (the palette above already passes).
- Visible keyboard focus everywhere. Real `<button>` and `<label>` elements. The modal closes on Escape.
- No stock photos, no illustrations of people, no generic SaaS card-and-gradient look.
