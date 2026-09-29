/**
 * Online food databases.
 *
 *   USDA FoodData Central  - generic foods (tomato, paneer-like cheeses, oil)
 *   Open Food Facts        - packaged products and barcodes
 *
 * Everything the app shows comes from one of these, or from the user typing it
 * in. There is no built-in food list.
 *
 * The parsers are pure and defensive: an unexpected response shape yields an
 * empty result, never a crash, and the screen falls back to manual entry.
 * Only the fetch wrappers touch the network.
 */

export type FoodSource = 'usda' | 'off' | 'label' | 'manual' | 'recipe';

/** A food with nutrition per 100 g, whatever its origin. */
export interface FoodCandidate {
  id: string;
  name: string;
  brand?: string;
  source: FoodSource;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fibrePer100?: number;
  sugarPer100?: number;
  /** Grams in one labelled serving, when the source says. */
  servingGrams?: number;
}

export const SOURCE_LABEL: Record<FoodSource, string> = {
  usda: 'USDA',
  off: 'Open Food Facts',
  label: 'From label',
  manual: 'Typed in',
  recipe: 'Saved recipe',
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// USDA FoodData Central
// ---------------------------------------------------------------------------

interface Nutrients {
  kcal: number | null;
  protein: number;
  carbs: number;
  fat: number;
  fibre?: number;
  sugar?: number;
}

function usdaNutrients(list: unknown): Nutrients {
  let kcal: number | null = null;
  let atwater: number | null = null;
  const out: Nutrients = { kcal: null, protein: 0, carbs: 0, fat: 0 };
  if (!Array.isArray(list)) return out;

  for (const n of list as any[]) {
    const id = String(n?.nutrientId ?? n?.nutrient?.id ?? '');
    const number = String(n?.nutrientNumber ?? n?.nutrient?.number ?? '');
    const unit = String(n?.unitName ?? n?.nutrient?.unitName ?? '').toUpperCase();
    const v = num(n?.value ?? n?.amount);
    if (v === null) continue;

    if ((id === '1008' || number === '208') && unit !== 'KJ') kcal = v;
    else if (id === '2047' || id === '2048' || number === '957' || number === '958') atwater = v;
    else if (id === '1003' || number === '203') out.protein = v;
    else if (id === '1004' || number === '204') out.fat = v;
    else if (id === '1005' || number === '205') out.carbs = v;
    else if (id === '1079' || number === '291') out.fibre = v;
    else if (id === '2000' || number.startsWith('269')) out.sugar = v;
  }
  out.kcal = kcal ?? atwater;
  return out;
}

/** Tidy USDA's shouting-comma descriptions: "Tomatoes, red, ripe, raw" stays readable. */
function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}

export function parseUsdaSearch(json: any): FoodCandidate[] {
  const foods = json?.foods;
  if (!Array.isArray(foods)) return [];
  const out: FoodCandidate[] = [];
  for (const f of foods) {
    const name = typeof f?.description === 'string' ? f.description : '';
    if (!name) continue;
    const n = usdaNutrients(f?.foodNutrients);
    if (n.kcal === null) continue;
    out.push({
      id: `usda:${f.fdcId ?? name}`,
      name: tidyName(name),
      brand: typeof f?.brandOwner === 'string' ? f.brandOwner : undefined,
      source: 'usda',
      kcalPer100: r1(n.kcal),
      proteinPer100: r1(n.protein),
      carbsPer100: r1(n.carbs),
      fatPer100: r1(n.fat),
      fibrePer100: n.fibre !== undefined ? r1(n.fibre) : undefined,
      sugarPer100: n.sugar !== undefined ? r1(n.sugar) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

function offToCandidate(p: any): FoodCandidate | null {
  if (!p || typeof p !== 'object') return null;
  const nut = p.nutriments;
  if (!nut || typeof nut !== 'object') return null;

  let kcal = num(nut['energy-kcal_100g']);
  if (kcal === null) {
    const kj = num(nut['energy_100g']) ?? num(nut['energy-kj_100g']);
    if (kj !== null) kcal = kj / 4.184;
  }
  if (kcal === null) return null;

  const name = [p.product_name, p.generic_name].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
  if (!name) return null;

  const serving = num(p.serving_quantity);
  return {
    id: `off:${p.code ?? p._id ?? name}`,
    name: tidyName(name),
    brand: typeof p.brands === 'string' && p.brands.trim() ? p.brands.split(',')[0].trim() : undefined,
    source: 'off',
    kcalPer100: r1(kcal),
    proteinPer100: r1(num(nut['proteins_100g']) ?? 0),
    carbsPer100: r1(num(nut['carbohydrates_100g']) ?? 0),
    fatPer100: r1(num(nut['fat_100g']) ?? 0),
    fibrePer100: num(nut['fiber_100g']) !== null ? r1(num(nut['fiber_100g']) as number) : undefined,
    sugarPer100: num(nut['sugars_100g']) !== null ? r1(num(nut['sugars_100g']) as number) : undefined,
    servingGrams: serving !== null && serving > 0 ? serving : undefined,
  };
}

export function parseOffProduct(json: any): FoodCandidate | null {
  if (!json || json.status === 0) return null;
  return offToCandidate(json.product);
}

export function parseOffSearch(json: any): FoodCandidate[] {
  const list = json?.products;
  if (!Array.isArray(list)) return [];
  return list.map(offToCandidate).filter((x): x is FoodCandidate => x !== null);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function score(query: string, name: string): number {
  const q = query.trim().toLowerCase();
  const n = name.toLowerCase();
  if (!q) return 4;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 2;
  if (n.includes(q)) return 3;
  return 4;
}

/** Best name match first; generic USDA entries ahead of brands on a tie. */
export function rankCandidates(query: string, list: FoodCandidate[]): FoodCandidate[] {
  return [...list].sort((a, b) => {
    const d = score(query, a.name) - score(query, b.name);
    if (d !== 0) return d;
    if (a.source !== b.source) return a.source === 'usda' ? -1 : 1;
    return a.name.length - b.name.length;
  });
}

/** The top result, or null if nothing looks related to the query. */
export function bestMatch(query: string, list: FoodCandidate[]): FoodCandidate | null {
  const ranked = rankCandidates(query, list);
  return ranked.length > 0 ? ranked[0] : null;
}

// ---------------------------------------------------------------------------
// Things that genuinely contain no calories
// ---------------------------------------------------------------------------

const ZERO_CAL = /^(salt|water|ice|rock salt|black salt|sea salt|iodised salt|iodized salt|ice cubes)$/i;

/** Zero-calorie staples that databases handle badly. Not a food list: it only
 *  answers "does this have calories at all?" for a few names. */
export function zeroCalorieFood(name: string): FoodCandidate | null {
  const n = name.trim();
  if (!ZERO_CAL.test(n)) return null;
  return {
    id: `zero:${n.toLowerCase()}`,
    name: n.toLowerCase(),
    source: 'manual',
    kcalPer100: 0,
    proteinPer100: 0,
    carbsPer100: 0,
    fatPer100: 0,
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function getJson(url: string, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'VitalX/1.0 (hackathon project)' },
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new Error('rate-limited');
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchUsda(query: string, apiKey = 'DEMO_KEY', limit = 8): Promise<FoodCandidate[]> {
  const q = encodeURIComponent(query.trim());
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey || 'DEMO_KEY')}` +
    `&query=${q}&pageSize=${limit}&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)`;
  return parseUsdaSearch(await getJson(url));
}

export async function searchOff(query: string, limit = 8): Promise<FoodCandidate[]> {
  const q = encodeURIComponent(query.trim());
  const url =
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1` +
    `&page_size=${limit}&fields=code,product_name,generic_name,brands,nutriments,serving_quantity`;
  return parseOffSearch(await getJson(url));
}

/** Look up a barcode. Returns null when the product is not in the database. */
export async function lookupBarcode(code: string): Promise<FoodCandidate | null> {
  const digits = code.replace(/\D/g, '');
  if (digits.length < 6) return null;
  const url =
    `https://world.openfoodfacts.org/api/v2/product/${digits}.json` +
    `?fields=code,product_name,generic_name,brands,nutriments,serving_quantity`;
  try {
    return parseOffProduct(await getJson(url));
  } catch (e: any) {
    // Open Food Facts answers an unknown barcode with HTTP 404. That means
    // "not in the database", which is a normal result, not a connection problem.
    if (String(e?.message) === 'http 404') return null;
    throw e;
  }
}

export interface SearchOutcome {
  results: FoodCandidate[];
  /** Plain-language notes for the screen, e.g. a database that was busy. */
  notes: string[];
}

/** Search both databases at once. One failing never hides the other's results. */
export async function searchFoods(
  query: string,
  opts: { usdaKey?: string; limit?: number } = {}
): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) return { results: [], notes: [] };

  const [usda, off] = await Promise.allSettled([
    searchUsda(q, opts.usdaKey, opts.limit ?? 8),
    searchOff(q, opts.limit ?? 8),
  ]);

  const notes: string[] = [];
  const all: FoodCandidate[] = [];

  if (usda.status === 'fulfilled') all.push(...usda.value);
  else {
    const rate = String(usda.reason?.message ?? '').includes('rate');
    notes.push(
      rate
        ? 'The USDA database is busy (the free demo key has a low limit). Add your own free key in Setup, or use the other results.'
        : 'The USDA database could not be reached.'
    );
  }
  if (off.status === 'fulfilled') all.push(...off.value);
  else notes.push('Open Food Facts could not be reached.');

  if (usda.status === 'rejected' && off.status === 'rejected') {
    notes.length = 0;
    notes.push('Could not reach the food databases. Check your internet connection, or enter the food manually.');
  }

  return { results: rankCandidates(q, all), notes };
}
