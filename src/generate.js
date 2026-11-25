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

const SYSTEM_PROMPT = `You are a senior e-commerce copywriter who writes natural, clear American English for small online stores in the US.
From the product data you receive, write:
(1) a title of up to 60 characters that includes the main search term;
(2) an intro of 2–3 sentences about the benefit to the shopper and a real use;
(3) 3–5 spec bullets;
(4) a meta description of up to 155 characters;
(5) alt text for every image;
(6) up to 3 questions about missing information shoppers look for (for example volume, size or material).
Mandatory rules:
- Never invent a spec, size, material, origin, ingredient or price that is not in the data. Keep units as they appear in the data.
- No health or medical claims, even if they appear in the source.
- No empty superlatives ("the best", "perfect", "premium quality").
- If the source text is in another language, write the output in American English anyway.
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

function userText(product) {
  const n = product.images?.length || 0;
  return `Product data (JSON):\n${JSON.stringify(product, null, 2)}\n\n` +
    `Number of images: ${n}. Return exactly ${n} entries in alts, in image order.`;
}

async function callOpenAICompatible(name, p, product) {
  if (!p.key || !p.base || !p.model) throw new SkipProvider(`${name}: not configured`);
  if (used(name) >= p.dailyLimit) throw new SkipProvider(`${name}: daily budget reached`);
  bump(name);
  const r = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userText(product) }],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 2500,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${name} HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '';
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

let anthropic;
async function callAnthropic(product) {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) throw new SkipProvider('anthropic: not configured');
  anthropic ??= new Anthropic({ maxRetries: 2, timeout: 120_000 });
  const response = await anthropic.beta.messages.create({
    model: config.anthropicModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: userText(product) }],
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
      const raw = name === 'anthropic'
        ? await callAnthropic(product)
        : OPENAI_COMPAT[name] ? await callOpenAICompatible(name, OPENAI_COMPAT[name], product) : null;
      if (!raw) throw new SkipProvider(`${name}: unknown provider`);
      const out = normalize(validate(raw), imageCount);
      return { ...out, provider: name };
    } catch (e) {
      errors.push(e.message);
      if (!(e instanceof SkipProvider)) console.warn(`[generate] ${e.message} → trying next provider`);
    }
  }
  throw new Error(`no provider could generate: ${errors.join(' | ')}`);
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
    return { name, configured, usedToday: used(name), dailyLimit: p?.dailyLimit ?? null, model: name === 'anthropic' ? config.anthropicModel : p?.model };
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
