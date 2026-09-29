/**
 * Amounts and units for building meals by hand ("10 ml oil", "2 tbsp curd").
 *
 * Nutrition databases quote everything per 100 g, so every amount is converted
 * to grams first. Weights convert exactly. Volumes are approximate, because a
 * spoon of salt and a spoon of oil weigh very different amounts, so volumes
 * use a rough density picked from the food's name.
 *
 * Pure functions, no React, no I/O.
 */

export type FoodUnit = 'g' | 'kg' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup';

/** Order shown when the user taps the unit button. */
export const FOOD_UNITS: FoodUnit[] = ['g', 'ml', 'tbsp', 'tsp', 'cup', 'kg', 'l'];

const ML_PER_UNIT: Partial<Record<FoodUnit, number>> = {
  ml: 1,
  l: 1000,
  tsp: 5,
  tbsp: 15,
  cup: 240,
};

/** Grams per millilitre, by what the food is. First match wins. */
const DENSITIES: { test: RegExp; gPerMl: number }[] = [
  { test: /\b(oil|ghee|butter)\b/i, gPerMl: 0.92 },
  { test: /\b(milk|curd|yogh?urt|dahi|buttermilk|lassi|cream)\b/i, gPerMl: 1.03 },
  { test: /\b(honey|syrup|jaggery)\b/i, gPerMl: 1.4 },
  { test: /\bsalt\b/i, gPerMl: 1.2 },
  { test: /\bsugar\b/i, gPerMl: 0.85 },
  { test: /\b(flour|atta|maida|besan|semolina|suji|rava)\b/i, gPerMl: 0.55 },
  {
    test: /\b(masala|powder|turmeric|haldi|chilli|chili|cumin|jeera|pepper|spice|coriander|paprika)\b/i,
    gPerMl: 0.5,
  },
];

export function isVolume(unit: FoodUnit): boolean {
  return unit === 'ml' || unit === 'l' || unit === 'tsp' || unit === 'tbsp' || unit === 'cup';
}

export function gramsPerMl(foodName: string): number {
  for (const d of DENSITIES) if (d.test.test(foodName)) return d.gPerMl;
  return 1;
}

/**
 * Convert an amount to grams. Returns 0 for anything unusable, never NaN, so
 * a half-typed field cannot poison a meal's totals.
 */
export function toGrams(amount: number, unit: FoodUnit, foodName = ''): number {
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return 0;
  let g: number;
  if (unit === 'g') g = amount;
  else if (unit === 'kg') g = amount * 1000;
  else g = amount * (ML_PER_UNIT[unit] ?? 1) * gramsPerMl(foodName);
  return Math.round(g * 10) / 10;
}

/** True when the conversion to grams is a rough estimate, so the UI can say so. */
export function isApproximate(unit: FoodUnit, foodName = ''): boolean {
  if (unit === 'g' || unit === 'kg') return false;
  // Water-like liquids in ml or litres are effectively exact.
  return !(unit === 'ml' || unit === 'l') || gramsPerMl(foodName) !== 1;
}

/** Cycle to the next unit, for the tap-to-change button. */
export function nextUnit(unit: FoodUnit): FoodUnit {
  const i = FOOD_UNITS.indexOf(unit);
  return FOOD_UNITS[(i + 1) % FOOD_UNITS.length];
}
