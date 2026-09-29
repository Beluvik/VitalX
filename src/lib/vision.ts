/**
 * Reading photos: a nutrition-facts label, or a plate of food.
 *
 * The model only READS or NAMES what it sees. It is never trusted for calories
 * on a plate: the food it names is looked up in the nutrition database, and
 * the user confirms or corrects the amount. For a label, the numbers come
 * straight from the printed label and are shown for confirmation before they
 * are logged.
 *
 * Works with any OpenAI-compatible endpoint that accepts images (Google's
 * Gemini compatibility endpoint, OpenRouter, and others). The user supplies
 * their own key, which is stored on their phone only.
 *
 * Parsers are pure and tested. Only callVision touches the network.
 */

import type { FoodCandidate } from './foodApi';

export interface VisionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function visionReady(c: Partial<VisionConfig> | null | undefined): c is VisionConfig {
  return !!c && !!c.baseUrl?.trim() && !!c.apiKey?.trim() && !!c.model?.trim();
}

export const FOOD_PHOTO_PROMPT =
  'Identify every distinct food or drink item visible in this photo. ' +
  'Reply with JSON only, no other text, in exactly this shape: ' +
  '{"items":[{"name":"apple","grams":150}]}. ' +
  'Use simple, generic English food names that a nutrition database would list, such as ' +
  '"apple", "cooked white rice" or "boiled egg". "grams" is your best estimate of the edible weight shown. ' +
  'If the photo contains no food, reply {"items":[]}.';

export const LABEL_PHOTO_PROMPT =
  'This is a photo of the nutrition facts label on a packaged food. Read the printed numbers and reply with ' +
  'JSON only, no other text, in exactly this shape: ' +
  '{"name":"product name if visible, else null","basis":"per100g" or "per100ml" or "perServing",' +
  '"servingGrams":number or null,"kcal":number,"protein":number,"carbs":number,"fat":number,' +
  '"fibre":number or null,"sugar":number or null}. ' +
  'Use only numbers that are printed on the label. If a value is not readable, use null. Never estimate. ' +
  'Prefer the "per 100 g" column when the label has both.';

/** Pull a JSON object out of a model reply, tolerating code fences and chatter. */
export function extractJson(text: unknown): any | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.\-]/g, '')) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface PhotoFood {
  name: string;
  /** null when the model gave no usable estimate: the user fills it in. */
  grams: number | null;
}

export function parseFoodPhoto(obj: any): PhotoFood[] {
  const items = obj?.items;
  if (!Array.isArray(items)) return [];
  const out: PhotoFood[] = [];
  for (const it of items) {
    const name = typeof it?.name === 'string' ? it.name.trim().toLowerCase() : '';
    if (!name) continue;
    const g = num(it?.grams);
    out.push({ name, grams: g !== null && g > 0 ? Math.min(2000, Math.round(g)) : null });
  }
  return out.slice(0, 8);
}

export interface LabelReading {
  candidate: FoodCandidate;
  /** Plain-language line explaining what the numbers refer to. */
  basisNote: string;
}

/** Convert a label reading to per-100 g. Returns null when calories are unreadable. */
export function parseLabel(obj: any, fallbackName = 'Packaged food'): LabelReading | null {
  if (!obj || typeof obj !== 'object') return null;
  const kcal = num(obj.kcal);
  if (kcal === null || kcal < 0) return null;

  const protein = num(obj.protein) ?? 0;
  const carbs = num(obj.carbs) ?? 0;
  const fat = num(obj.fat) ?? 0;
  const fibre = num(obj.fibre);
  const sugar = num(obj.sugar);
  const serving = num(obj.servingGrams);
  const basis = String(obj.basis ?? '').toLowerCase();
  const name = typeof obj.name === 'string' && obj.name.trim() && obj.name.toLowerCase() !== 'null' ? obj.name.trim() : fallbackName;

  let scale = 1;
  let servingGrams: number | undefined;
  let basisNote: string;

  if (basis === 'perserving') {
    if (serving !== null && serving > 0) {
      scale = 100 / serving;
      servingGrams = serving;
      basisNote = `The label lists one serving of ${Math.round(serving)} g, so the values were converted to per 100 g.`;
    } else {
      // No serving weight printed: treat one serving as the unit. The confirm
      // screen adds "1 serving" as 100 units, so the numbers stay the label's.
      servingGrams = 100;
      basisNote = 'The label lists values per serving and no serving weight, so 100 below means one serving.';
    }
  } else {
    basisNote = 'Values are per 100 g or 100 ml as printed on the label.';
    if (serving !== null && serving > 0) servingGrams = serving;
  }

  const s = (v: number) => r1(v * scale);
  return {
    candidate: {
      id: `label:${name.toLowerCase()}`,
      name,
      source: 'label',
      kcalPer100: s(kcal),
      proteinPer100: s(protein),
      carbsPer100: s(carbs),
      fatPer100: s(fat),
      fibrePer100: fibre !== null ? s(fibre) : undefined,
      sugarPer100: sugar !== null ? s(sugar) : undefined,
      servingGrams,
    },
    basisNote,
  };
}

/** Send one image and a prompt; return the model's text reply. */
export async function callVision(
  cfg: VisionConfig,
  base64: string,
  prompt: string,
  mime = 'image/jpeg',
  timeoutMs = 45000
): Promise<string> {
  const url = `${cfg.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
      body: JSON.stringify({
        model: cfg.model.trim(),
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) throw new Error('The API key was rejected. Check it in Setup.');
    if (res.status === 404) throw new Error('The model or address was not found. Check both in Setup.');
    if (res.status === 429) throw new Error('The photo service is busy or out of free requests. Try again shortly.');
    if (!res.ok) throw new Error(`The photo service returned an error (${res.status}).`);
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    // Some providers return content as a list of parts.
    if (Array.isArray(content)) return content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    throw new Error('The photo service sent back nothing readable.');
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('The photo service took too long. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
