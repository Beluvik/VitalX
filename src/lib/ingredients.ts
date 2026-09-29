/**
 * Turn what someone types about a meal into a list of ingredients.
 *
 *   "100g paneer, 10 ml oil, 50g tomato, onion, salt"
 *
 * becomes five rows. Anything without an amount ("onion", "salt") still gets a
 * row, with the amount left empty for the user to fill in: guessing "1 onion"
 * would silently put a made-up number into their calories.
 *
 * Pure functions, no React, no I/O.
 */

import { FoodUnit } from './foodUnits';

export interface ParsedIngredient {
  name: string;
  /** null when the text gave no amount. */
  amount: number | null;
  /** null when the text gave no unit, e.g. "2 eggs". */
  unit: FoodUnit | null;
  raw: string;
}

const UNIT_WORDS: Record<string, FoodUnit> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', mls: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
};

const FILLER = new Set(['etc', 'etc.', 'and', 'some', 'a', 'little', 'pinch']);

function parseAmount(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (t.includes('/')) {
    const [a, b] = t.split('/').map((x) => parseFloat(x.trim()));
    return isFinite(a) && isFinite(b) && b !== 0 ? a / b : null;
  }
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}

export function parseIngredientLine(line: string): ParsedIngredient | null {
  const raw = line.trim();
  if (!raw) return null;

  // amount, then an optional attached or spaced unit, then the name.
  const m = raw.match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)?\s*([a-zA-Z]+)?\s*(?:of\s+)?(.*)$/);
  if (!m) return null;

  const amountText = m[1];
  const word = m[2];
  const rest = m[3];

  let unit: FoodUnit | null = null;
  let name: string;

  if (amountText && word && UNIT_WORDS[word.toLowerCase()]) {
    unit = UNIT_WORDS[word.toLowerCase()];
    name = rest;
  } else if (!amountText && word && UNIT_WORDS[word.toLowerCase()] && rest) {
    // "cup rice": a unit with no number means one of them.
    unit = UNIT_WORDS[word.toLowerCase()];
    name = rest;
  } else {
    // The "unit" was really the first word of the name.
    name = `${word ?? ''} ${rest}`;
  }

  name = name.replace(/\s+/g, ' ').replace(/^of\s+/i, '').trim().toLowerCase();
  if (!name || FILLER.has(name)) return null;

  let amount = parseAmount(amountText ?? '');
  if (amount === null && unit !== null) amount = 1;
  if (amount !== null && amount <= 0) amount = null;

  return { name, amount, unit, raw };
}

export function parseIngredientText(text: string): ParsedIngredient[] {
  return text
    .split(/\s*[,;\n]\s*/)
    .map(parseIngredientLine)
    .filter((x): x is ParsedIngredient => x !== null);
}
