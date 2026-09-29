/**
 * VitalX API. Runs on Cloudflare Workers, but everything here is plain
 * Request-in, Response-out, so it is tested in Node without deploying.
 *
 * What it is for:
 *   - holds the API keys, so the app ships with none and users add nothing
 *   - caches food lookups, so the free USDA limit stops mattering
 *   - reads photos (food and nutrition labels) on the app's behalf
 *   - rate-limits photo reading, so one phone cannot drain the free quota
 *
 * It stores nothing about people: no accounts, no photos, no meal logs.
 * A photo is passed to the AI service and forgotten.
 *
 * Endpoints:
 *   GET  /health
 *   GET  /foods/search?q=paneer
 *   GET  /foods/barcode/8901058000019
 *   POST /vision/food    { image: <base64>, mime?: "image/jpeg" }
 *   POST /vision/label   { image: <base64>, mime?: "image/jpeg" }
 */

import { lookupBarcode, searchFoods } from '../../src/lib/foodApi';
import {
  FOOD_PHOTO_PROMPT,
  LABEL_PHOTO_PROMPT,
  callVision,
  extractJson,
  parseFoodPhoto,
  parseLabel,
  visionReady,
} from '../../src/lib/vision';

export interface Env {
  /** Optional shared secret the app sends. A speed bump, not real security: see README. */
  APP_TOKEN?: string;
  USDA_API_KEY?: string;
  VISION_BASE_URL?: string;
  VISION_API_KEY?: string;
  VISION_MODEL?: string;
  VISION_DAILY_PER_DEVICE?: string;
  VISION_DAILY_GLOBAL?: string;
}

export interface Cache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface Counters {
  /** Add one and return the new total. The counter expires after ttlSeconds. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export interface Deps {
  cache: Cache;
  counters: Counters;
  now: () => number;
}

const DAY = 86400;
/** Base64 characters. About 4.5 MB of image. */
const MAX_IMAGE_B64 = 6_000_000;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

const fail = (status: number, error: string) => json({ error }, status);

function positiveInt(v: string | undefined, fallback: number): number {
  const n = parseInt(v ?? '', 10);
  return isFinite(n) && n > 0 ? n : fallback;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function visionConfig(env: Env) {
  return {
    baseUrl: env.VISION_BASE_URL ?? '',
    apiKey: env.VISION_API_KEY ?? '',
    model: env.VISION_MODEL ?? '',
  };
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Health carries no secrets, only whether each feature is switched on.
  if (req.method === 'GET' && path === '/health') {
    return json({
      ok: true,
      service: 'vitalx-api',
      photoReading: visionReady(visionConfig(env)),
      usdaKey: !!env.USDA_API_KEY,
      tokenRequired: !!env.APP_TOKEN,
    });
  }

  if (env.APP_TOKEN && !safeEqual(req.headers.get('X-App-Token') ?? '', env.APP_TOKEN)) {
    return fail(401, 'Missing or wrong app token.');
  }

  try {
    if (req.method === 'GET' && path === '/foods/search') return await search(url, env, deps);

    const bc = path.match(/^\/foods\/barcode\/(\d+)$/);
    if (req.method === 'GET' && bc) return await barcode(bc[1], deps);

    if (req.method === 'POST' && (path === '/vision/food' || path === '/vision/label')) {
      return await vision(req, env, deps, path === '/vision/food' ? 'food' : 'label');
    }

    return fail(404, 'Not found.');
  } catch (e) {
    console.error('unhandled', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'Something went wrong on the server.');
  }
}

// ---------------------------------------------------------------------------

async function search(url: URL, env: Env, deps: Deps): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < 1 || q.length > 80) return fail(400, 'Search text must be 1 to 80 characters.');

  const key = `s:${q.toLowerCase()}`;
  const hit = await deps.cache.get(key);
  if (hit) return new Response(hit, { status: 200, headers: { ...JSON_HEADERS, 'X-Cache': 'hit' } });

  const out = await searchFoods(q, { usdaKey: env.USDA_API_KEY, limit: 10 });
  const body = JSON.stringify(out);

  // Only a complete, non-empty answer is worth keeping. Caching a partial
  // result would hide a database that came back a minute later.
  if (out.results.length > 0 && out.notes.length === 0) await deps.cache.put(key, body, 7 * DAY);

  return new Response(body, { status: 200, headers: { ...JSON_HEADERS, 'X-Cache': 'miss' } });
}

async function barcode(code: string, deps: Deps): Promise<Response> {
  if (code.length < 6 || code.length > 14) return fail(400, 'A barcode has 6 to 14 digits.');

  const key = `b:${code}`;
  const hit = await deps.cache.get(key);
  if (hit) return new Response(hit, { status: 200, headers: { ...JSON_HEADERS, 'X-Cache': 'hit' } });

  let candidate;
  try {
    candidate = await lookupBarcode(code);
  } catch {
    return fail(502, 'The food database could not be reached. Try again in a moment.');
  }

  const body = JSON.stringify(candidate ? { found: true, candidate } : { found: false });
  // A miss is cached briefly: products get added to the database over time.
  await deps.cache.put(key, body, candidate ? 30 * DAY : DAY);
  return new Response(body, { status: 200, headers: { ...JSON_HEADERS, 'X-Cache': 'miss' } });
}

async function vision(req: Request, env: Env, deps: Deps, kind: 'food' | 'label'): Promise<Response> {
  const cfg = visionConfig(env);
  if (!visionReady(cfg)) return fail(503, 'Photo reading is not set up on the server yet.');

  const declared = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (declared > MAX_IMAGE_B64 + 1000) return fail(413, 'That photo is too large. Try again.');

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with an "image" field.');
  }

  const image = typeof body?.image === 'string' ? body.image.replace(/^data:[^,]+,/, '').trim() : '';
  if (!image) return fail(400, 'Send JSON with an "image" field.');
  if (image.length > MAX_IMAGE_B64) return fail(413, 'That photo is too large. Try again.');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(image)) return fail(400, 'The image must be base64 text.');

  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(body?.mime) ? body.mime : 'image/jpeg';

  // Limits count attempts, not successes, so retrying a failing photo cannot
  // be used to hammer the provider.
  const deviceHeader = req.headers.get('X-Device-Id') ?? '';
  const who = /^[A-Za-z0-9_-]{8,64}$/.test(deviceHeader) ? deviceHeader : req.headers.get('CF-Connecting-IP') || 'anon';
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  const perDevice = positiveInt(env.VISION_DAILY_PER_DEVICE, 30);
  const global = positiveInt(env.VISION_DAILY_GLOBAL, 800);

  if ((await deps.counters.incr(`v:d:${day}:${who}`, 2 * DAY)) > perDevice) {
    return fail(429, 'Daily photo limit reached on this phone. Try again tomorrow, or enter the food manually.');
  }
  if ((await deps.counters.incr(`v:g:${day}`, 2 * DAY)) > global) {
    return fail(429, 'Photo reading has reached its daily limit. Try again tomorrow, or enter the food manually.');
  }

  let reply: string;
  try {
    reply = await callVision(cfg, image, kind === 'food' ? FOOD_PHOTO_PROMPT : LABEL_PHOTO_PROMPT, mime);
  } catch (e) {
    // Provider messages are written for the person who owns the key, so they
    // are logged here and never sent to the app.
    console.error('vision provider error', e instanceof Error ? e.message : 'unknown');
    return fail(502, 'Photo reading is unavailable right now. Try again, or enter the food manually.');
  }

  const parsed = extractJson(reply);
  if (kind === 'food') return json({ items: parseFoodPhoto(parsed) });

  const reading = parseLabel(parsed);
  if (!reading) return fail(422, 'The calories on the label could not be read. Fill the frame with the label and try again.');
  return json({ reading });
}
