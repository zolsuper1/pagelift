// Product-copy generation through a provider chain.
//
// AI_PROVIDERS sets the order, e.g. "groq,gemini,anthropic". Each provider with a key is tried in turn;
// a rate limit (429), server error, timeout, daily budget hit or invalid output moves on to the next.
//   groq      – free tier, OpenAI-compatible API, open models (default openai/gpt-oss-120b)
//   gemini    – free tier via Google's OpenAI-compatible endpoint (small daily quota; good as backup)
//   custom    – any other OpenAI-compatible endpoint (OpenRouter, Cloudflare Workers AI, a local model…)
//   anthropic – Claude via the official SDK (paid, optional last resort)
// AI_MOCK=1 skips all of them and returns fixed test copy.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const SYSTEM_PROMPT = `You rewrite product pages for small US online stores. Your copy must be clearly more useful to a shopper than the store's current copy: easier to find in search, quicker to understand, and strictly true.

Use only facts stated in the product data. If a fact is not written there, it does not exist.

title (max 60 characters)
- Start from what a shopper would type: the product type in plain words (use product_type, tags and the description to find it), plus the one or two facts that set this item apart: material, key feature, size or color.
- Keep the product's own name if it has one. Never swap a specific fact for a vaguer one.
- Always keep who it is for when the data says so (men's, kids, dogs and cats): shoppers search by it.
- If the current title is already clear, improve it by adding a missing search term or distinguishing fact, not by reshuffling words.
- Remove hype, years, "gift for her" style keyword stuffing, repeated words and secondary color or sole codes in parentheses.

intro (2-3 short sentences)
- Sentence 1 says what the product is and its strongest concrete facts. It must be worth reading on its own.
- Sentence 2-3 explain what those facts mean in everyday use, without adding abilities the data does not state.
- Do not open with Experience, Enjoy, Discover, Step into, Elevate, Introducing, Meet, Give, Stay, Treat, Whether.

bullets (3-5)
- One fact each, most decision-relevant first, "Label: detail" form where natural. Nothing that is only filler.

meta (120-155 characters): product type, two concrete facts, no call-to-action cliches.

alts: you cannot see the images. For each, write only what the data supports: product name and color or material. Do not describe angles, scenes, people or lighting. Vary only with facts you have.

missing_info (up to 3): the questions a shopper would ask before buying THIS kind of product that the data does not answer.

Never
- invent or convert specs, sizes, materials, origins, ingredients, uses or performance claims (no "durable", "clean burn", "steady flame", "fills the room", "heavy rain", "all-day", "for workouts" unless stated);
- repeat store merchandising tags (limited edition, collection or campaign names, internal codes): use tags only to work out what the product is;
- mention prices, discounts, stock or shipping;
- make health, mood or medical claims (relaxing, calming, stress, sleep, soothing, healing, pain), even if the source does;
- use empty praise (perfect, premium, ultimate, best, cozy comfort, effortless, must-have).
Write natural American English, even if the source is in another language.
Return JSON only, with the keys title, intro, bullets[], meta, alts[], missing_info[].`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    meta: { type: 'string' },
    alts: { type: 'array', items: { type: 'string' } },
    missing_info: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'intro', 'bullets', 'meta', 'alts', 'missing_info'],
  additionalProperties: false,
};

const env = process.env;
const OPENAI_COMPAT = {
  groq: { base: 'https://api.groq.com/openai/v1', key: env.GROQ_API_KEY, model: env.GROQ_MODEL || 'openai/gpt-oss-120b', dailyLimit: Number(env.GROQ_DAILY_LIMIT || 900) },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-flash-latest', dailyLimit: Number(env.GEMINI_DAILY_LIMIT || 18) },
  custom: { base: (env.OPENAI_COMPAT_BASE_URL || '').replace(/\/$/, ''), key: env.OPENAI_COMPAT_API_KEY, model: env.OPENAI_COMPAT_MODEL, dailyLimit: Number(env.OPENAI_COMPAT_DAILY_LIMIT || 1e9) },
};
const ORDER = (env.AI_PROVIDERS || 'groq,gemini,anthropic').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Per-provider daily counters (in memory) so the chain moves on before a free quota hard-fails.
const usage = new Map();
const today = () => new Date().toISOString().slice(0, 10);
const used = (name) => usage.get(`${today()}:${name}`) || 0;
const bump = (name) => usage.set(`${today()}:${name}`, used(name) + 1);

class SkipProvider extends Error {}
// Last failure per provider, kept to a short category so it is safe to show on /api/health.
const lastError = new Map();
const category = (msg) => { const m = String(msg).match(/HTTP (\d{3})/); return m ? `HTTP ${m[1]}` : /invalid output/.test(msg) ? 'invalid output' : /abort|timeout/i.test(msg) ? 'timeout' : /JSON/.test(msg) ? 'bad JSON' : 'error'; };

export function factsFor(product) {
  const clip = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) : v);
  return {
    title: product.title,
    description: clip(product.description, 2500) || undefined,
    brand: product.vendor || product.brand || undefined,
    product_type: product.product_type || undefined,
    tags: Array.isArray(product.tags) ? product.tags.slice(0, 15) : clip(product.tags, 300) || undefined,
    options: product.options?.length ? product.options.map((o) => ({ name: o.name, values: (o.values || []).slice(0, 20) })) : undefined,
    variants: !product.options?.length && product.variants?.length ? product.variants.slice(0, 12).map((v) => v.title) : undefined,
    current_image_alts: product.images?.map((i) => i.current_alt).filter(Boolean).slice(0, 10),
  };
}

function userText(product) {
  const n = product.images?.length || 0;
  return `Product data (JSON):\n${JSON.stringify(factsFor(product))}\n\n` +
    `Number of images: ${n}. Return exactly ${n} entries in alts, in image order.`;
}

// Mechanical checks on the model's output. Anything found is sent back once for correction.
const HEALTH = /\b(relax\w*|calm\w*|unwind\w*|stress|anxiety|sooth\w*|heal(s|ing)?|therap\w*|pain relief|better sleep|helps? you sleep)\b/i;
const HYPE = /\b(perfect\w*|premium|ultimate|the best|best quality|must[- ]have|effortless\w*|game[- ]changer|hot sale)\b/i;
const OPENER = /^(experience|enjoy|discover|step into|elevate|introducing|meet|give|stay|treat|whether)\b/i;
export function problemsIn(o, product) {
  const out = [];
  const len = (v) => [...String(v || '')].length;
  const text = [o.title, o.intro, ...(o.bullets || []), o.meta, ...(o.alts || [])].join(' \n ');
  if (len(o.title) > 60) out.push(`title is ${len(o.title)} characters; it must be 60 or fewer`);
  if (len(o.meta) > 155) out.push(`meta is ${len(o.meta)} characters; it must be 155 or fewer`);
  if (OPENER.test(String(o.intro || '').trim())) out.push('intro starts with a stock opener; start with what the product is');
  const health = text.match(HEALTH);
  if (health) out.push(`remove the health or mood claim "${health[0]}"`);
  const hype = text.match(HYPE);
  if (hype) out.push(`remove the empty praise "${hype[0]}"`);
  if (/[$€£₪]\s?\d/.test(text)) out.push('remove all prices');
  const known = JSON.stringify(factsFor(product)).replace(/(\d),(\d)/g, '$1$2');
  const invented = [...new Set(text.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) || [])].filter((n) => !known.includes(n));
  if (invented.length) out.push(`these numbers are not in the product data, remove them: ${invented.join(', ')}`);
  return out;
}
const repairText = (problems) => `Fix these problems and return the full corrected JSON, changing nothing else:\n- ${problems.join('\n- ')}`;

async function callOpenAICompatible(name, p, product, followUp = []) {
  if (!p.key || !p.base || !p.model) throw new SkipProvider(`${name}: not configured`);
  if (used(name) >= p.dailyLimit) throw new SkipProvider(`${name}: daily budget reached`);
  bump(name);
  const send = () => fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userText(product) }, ...followUp],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 4000,
      // gpt-oss spends part of the token budget thinking; keep that short so the JSON always fits.
      ...(/gpt-oss/.test(p.model) ? { reasoning_effort: 'low' } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  let r = await send();
  if (!r.ok) {
    let body = await r.text().catch(() => '');
    // An empty or malformed JSON reply is random: one more try usually succeeds.
    if (r.status === 400 && /json_validate_failed/.test(body)) {
      bump(name);
      r = await send();
      body = r.ok ? '' : await r.text().catch(() => '');
    }
    if (!r.ok) throw new Error(`${name} HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '';
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

let anthropic;
async function callAnthropic(product, followUp = []) {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) throw new SkipProvider('anthropic: not configured');
  anthropic ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const response = await anthropic.beta.messages.create({
    model: config.anthropicModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: userText(product) }, ...followUp],
  });
  if (response.stop_reason === 'refusal') throw new Error(`anthropic refusal: ${response.stop_details?.category ?? 'unknown'}`);
  if (response.stop_reason === 'max_tokens') throw new Error('anthropic output truncated');
  return JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

// Reject output that would embarrass a store owner: missing fields, empty copy, wrong types.
function validate(o) {
  const ok = o && typeof o.title === 'string' && o.title.trim() && typeof o.intro === 'string' && o.intro.trim()
    && Array.isArray(o.bullets) && o.bullets.length && typeof o.meta === 'string' && Array.isArray(o.alts) && Array.isArray(o.missing_info);
  if (!ok) throw new Error('invalid output shape');
  return o;
}

export async function generateCopy(product) {
  const imageCount = product.images?.length || 0;
  if (config.aiMock) return { ...normalize(mockResult(product), imageCount), provider: 'mock' };

  const errors = [];
  for (const name of ORDER) {
    try {
      const call = (followUp) => (name === 'anthropic'
        ? callAnthropic(product, followUp)
        : callOpenAICompatible(name, OPENAI_COMPAT[name], product, followUp));
      if (name !== 'anthropic' && !OPENAI_COMPAT[name]) throw new SkipProvider(`${name}: unknown provider`);
      let out = normalize(validate(await call([])), imageCount);
      const problems = problemsIn(out, product);
      if (problems.length) {
        // One correction pass. If it fails (rate limit, bad JSON) the first draft is still usable.
        try {
          const fixed = normalize(validate(await call([{ role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: repairText(problems) }])), imageCount);
          if (problemsIn(fixed, product).length < problems.length) out = fixed;
        } catch (e) { console.warn(`[generate] correction pass failed: ${e.message.slice(0, 120)}`); }
      }
      lastError.delete(name);
      return { ...out, title: fit(out.title, 60), meta: fit(out.meta, 155), provider: name };
    } catch (e) {
      errors.push(e.message);
      if (!(e instanceof SkipProvider)) lastError.set(name, { kind: category(e.message), at: new Date().toISOString() });
      if (!(e instanceof SkipProvider)) console.warn(`[generate] ${e.message} → trying next provider`);
    }
  }
  throw new Error(`no provider could generate: ${errors.join(' | ')}`);
}

export function fit(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max + 1).join('');
  // Prefer ending on a full sentence, otherwise on a whole word without dangling joiners.
  const sentence = cut.slice(0, max).match(/^[\s\S]*[.!?](?=\s|$)/)?.[0];
  if (sentence && sentence.length >= max * 0.6) return sentence;
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/(\s+(and|with|in|for|of|a|the))+$/i, '').replace(/[\s,;:–—-]+$/, '');
}

function normalize(o, imageCount) {
  const s = (v) => String(v ?? '').trim();
  return {
    title: s(o.title),
    intro: s(o.intro),
    bullets: (o.bullets || []).map(s).filter(Boolean).slice(0, 5),
    meta: s(o.meta),
    alts: (o.alts || []).map(s).slice(0, imageCount),
    missing_info: (o.missing_info || []).map(s).filter(Boolean).slice(0, 3),
  };
}

// First sentence only: what the free preview may reveal.
export function firstSentence(text) {
  const m = String(text).match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : String(text).split('\n')[0]).trim();
}

export function providerStatus() {
  return ORDER.map((name) => {
    const p = OPENAI_COMPAT[name];
    const configured = name === 'anthropic' ? Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) : Boolean(p?.key && p?.base && p?.model);
    return { name, configured, usedToday: used(name), dailyLimit: p?.dailyLimit ?? null, model: name === 'anthropic' ? config.anthropicModel : p?.model, lastError: lastError.get(name) || null };
  });
}

function mockResult(p) {
  const n = p.images?.length || 0;
  return {
    title: `${p.title} – test version`.slice(0, 60),
    intro: `This is test copy from AI_MOCK mode. In production, a real intro about the product's benefit goes here. The third sentence stays locked until payment.`,
    bullets: ['First spec bullet', 'Second spec bullet', 'Third spec bullet'],
    meta: `Test meta description for ${p.title}`.slice(0, 155),
    alts: Array.from({ length: n }, (_, i) => `Product image ${i + 1}`),
    missing_info: ['What is it made of?', 'What are the dimensions?'],
  };
}
