/**
 * How the app gets food data and photo readings.
 *
 * With a backend configured, everything goes through it: the keys stay on the
 * server, lookups are cached, and users set nothing up. If the backend is
 * unreachable the app falls back to asking the databases directly, so a
 * server outage never takes the food log down.
 *
 * Responses from the backend are checked before use: a server that changes,
 * or something answering on the wrong address, must not be able to put junk
 * into a person's calorie log.
 */

import {
  FoodCandidate,
  SearchOutcome,
  lookupBarcode as lookupBarcodeDirect,
  searchFoods as searchFoodsDirect,
} from './foodApi';
import {
  FOOD_PHOTO_PROMPT,
  LABEL_PHOTO_PROMPT,
  LabelReading,
  PhotoFood,
  VisionConfig,
  callVision,
  extractJson,
  parseFoodPhoto,
  parseLabel,
  visionReady,
} from './vision';

export interface ApiSettings {
  backendUrl: string;
  appToken: string;
  deviceId: string;
  usdaKey: string;
  visionBaseUrl: string;
  visionKey: string;
  visionModel: string;
}

export function backendReady(s: Pick<ApiSettings, 'backendUrl'>): boolean {
  return /^https?:\/\/\S+$/i.test(s.backendUrl.trim());
}

export function directVision(s: ApiSettings): VisionConfig {
  return { baseUrl: s.visionBaseUrl, apiKey: s.visionKey, model: s.visionModel };
}

/** True when a photo can be read at all: via the backend, or the user's own key. */
export function photoAvailable(s: ApiSettings): boolean {
  return backendReady(s) || visionReady(directVision(s));
}

// ---------------------------------------------------------------------------
// Checking what the backend sends
// ---------------------------------------------------------------------------

const isNum = (n: unknown): n is number => typeof n === 'number' && isFinite(n);

/** Keep only well-formed foods. Anything else is dropped, never repaired. */
export function sanitizeCandidate(c: any): FoodCandidate | null {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.name !== 'string' || !c.name.trim()) return null;
  if (!isNum(c.kcalPer100) || c.kcalPer100 < 0 || c.kcalPer100 > 1000) return null;
  const macro = (n: unknown) => (isNum(n) && n >= 0 && n <= 100 ? n : 0);
  const source = ['usda', 'off', 'label', 'manual', 'recipe'].includes(c.source) ? c.source : 'off';
  return {
    id: typeof c.id === 'string' && c.id ? c.id : `srv:${c.name}`,
    name: c.name.trim().slice(0, 90),
    brand: typeof c.brand === 'string' ? c.brand.slice(0, 60) : undefined,
    source,
    kcalPer100: c.kcalPer100,
    proteinPer100: macro(c.proteinPer100),
    carbsPer100: macro(c.carbsPer100),
    fatPer100: macro(c.fatPer100),
    fibrePer100: isNum(c.fibrePer100) && c.fibrePer100 >= 0 ? c.fibrePer100 : undefined,
    sugarPer100: isNum(c.sugarPer100) && c.sugarPer100 >= 0 ? c.sugarPer100 : undefined,
    servingGrams: isNum(c.servingGrams) && c.servingGrams > 0 && c.servingGrams < 5000 ? c.servingGrams : undefined,
  };
}

export function sanitizeSearch(json: any): SearchOutcome | null {
  if (!json || !Array.isArray(json.results)) return null;
  return {
    results: json.results.map(sanitizeCandidate).filter((x: FoodCandidate | null): x is FoodCandidate => x !== null),
    notes: Array.isArray(json.notes) ? json.notes.filter((n: unknown) => typeof n === 'string').slice(0, 3) : [],
  };
}

export function sanitizeReading(json: any): LabelReading | null {
  const r = json?.reading;
  const candidate = sanitizeCandidate(r?.candidate);
  if (!candidate) return null;
  return { candidate: { ...candidate, source: 'label' }, basisNote: typeof r.basisNote === 'string' ? r.basisNote : '' };
}

// ---------------------------------------------------------------------------
// Talking to the backend
// ---------------------------------------------------------------------------

class BackendError extends Error {
  constructor(message: string, readonly status: number, readonly userFacing: boolean) {
    super(message);
  }
}

async function callBackend(s: ApiSettings, path: string, init: { method?: string; body?: unknown } = {}, timeoutMs = 20000): Promise<any> {
  const base = s.backendUrl.trim().replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (s.appToken.trim()) headers['X-App-Token'] = s.appToken.trim();
    if (s.deviceId) headers['X-Device-Id'] = s.deviceId;

    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // A non-JSON answer is handled below.
    }
    if (!res.ok) {
      const msg = typeof data?.error === 'string' ? data.error : `The server answered with an error (${res.status}).`;
      // 4xx answers are meant to be shown to the person; 5xx mean "try the fallback".
      throw new BackendError(msg, res.status, res.status >= 400 && res.status < 500);
    }
    if (data === null) throw new BackendError('The server sent something unreadable.', res.status, false);
    return data;
  } catch (e: any) {
    if (e instanceof BackendError) throw e;
    if (e?.name === 'AbortError') throw new BackendError('The server took too long.', 0, false);
    throw new BackendError('Could not reach the server.', 0, false);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Food search and barcodes
// ---------------------------------------------------------------------------

export async function searchFoodsVia(s: ApiSettings, query: string, limit = 10): Promise<SearchOutcome> {
  if (backendReady(s)) {
    try {
      const data = await callBackend(s, `/foods/search?q=${encodeURIComponent(query.trim())}`);
      const clean = sanitizeSearch(data);
      if (clean) return clean;
    } catch (e) {
      if (e instanceof BackendError && e.userFacing) return { results: [], notes: [e.message] };
      // Anything else: fall through to asking the databases directly.
    }
  }
  return searchFoodsDirect(query, { usdaKey: s.usdaKey, limit });
}

export async function lookupBarcodeVia(s: ApiSettings, code: string): Promise<FoodCandidate | null> {
  if (backendReady(s)) {
    try {
      const digits = code.replace(/\D/g, '');
      const data = await callBackend(s, `/foods/barcode/${digits}`);
      if (data?.found === false) return null;
      const c = sanitizeCandidate(data?.candidate);
      if (c) return c;
    } catch (e) {
      if (e instanceof BackendError && e.userFacing) throw new Error(e.message);
    }
  }
  return lookupBarcodeDirect(code);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function readFoodPhoto(s: ApiSettings, base64: string): Promise<PhotoFood[]> {
  if (backendReady(s)) {
    try {
      const data = await callBackend(s, '/vision/food', { method: 'POST', body: { image: base64, mime: 'image/jpeg' } }, 60000);
      return parseFoodPhoto({ items: data?.items });
    } catch (e) {
      if (e instanceof BackendError && e.userFacing) throw new Error(e.message);
      if (!visionReady(directVision(s))) {
        throw new Error('Photo reading is unavailable right now. Try again, or enter the food manually.');
      }
    }
  }
  const reply = await callVision(directVision(s), base64, FOOD_PHOTO_PROMPT);
  return parseFoodPhoto(extractJson(reply));
}

/** Returns null when the model answered but no calories could be read. */
export async function readLabelPhoto(s: ApiSettings, base64: string): Promise<LabelReading | null> {
  if (backendReady(s)) {
    try {
      const data = await callBackend(s, '/vision/label', { method: 'POST', body: { image: base64, mime: 'image/jpeg' } }, 60000);
      return sanitizeReading(data);
    } catch (e) {
      // 422 means the label was unreadable, which is a normal outcome, not a failure.
      if (e instanceof BackendError && e.status === 422) return null;
      if (e instanceof BackendError && e.userFacing) throw new Error(e.message);
      if (!visionReady(directVision(s))) {
        throw new Error('Photo reading is unavailable right now. Try again, or enter the food manually.');
      }
    }
  }
  const reply = await callVision(directVision(s), base64, LABEL_PHOTO_PROMPT);
  return parseLabel(extractJson(reply));
}
