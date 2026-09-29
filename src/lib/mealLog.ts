/**
 * Turn a food and an amount into the entry stored in the day's log.
 * Pure, so the arithmetic behind every "Add to today" button is tested once.
 */

import type { LoggedFood } from '../types';
import type { FoodCandidate } from './foodApi';

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Nutrition for `grams` of a per-100 g food. Never NaN. */
export function macrosFor(c: Pick<FoodCandidate, 'kcalPer100' | 'proteinPer100' | 'carbsPer100' | 'fatPer100'>, grams: number): Macros {
  const g = isFinite(grams) && grams > 0 ? grams : 0;
  const f = g / 100;
  return {
    kcal: Math.round(c.kcalPer100 * f),
    protein: r1(c.proteinPer100 * f),
    carbs: r1(c.carbsPer100 * f),
    fat: r1(c.fatPer100 * f),
  };
}

export function candidateToLogged(
  c: FoodCandidate,
  grams: number,
  id: string,
  now: number,
  nameOverride?: string
): LoggedFood {
  const m = macrosFor(c, grams);
  return {
    id,
    foodId: c.id,
    name: nameOverride?.trim() || c.name,
    grams: Math.round(grams),
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
    kcal: m.kcal,
    loggedAt: now,
  };
}

/** A food typed in by hand: the numbers are for the amount eaten, not per 100 g. */
export function manualToLogged(
  input: { name: string; kcal: number; protein: number; carbs: number; fat: number; grams?: number },
  id: string,
  now: number
): LoggedFood | null {
  const name = input.name.trim();
  if (!name) return null;
  if (!isFinite(input.kcal) || input.kcal < 0) return null;
  const ok = (n: number) => (isFinite(n) && n > 0 ? n : 0);
  return {
    id,
    foodId: 'manual',
    name,
    grams: Math.round(ok(input.grams ?? 0)),
    protein: r1(ok(input.protein)),
    carbs: r1(ok(input.carbs)),
    fat: r1(ok(input.fat)),
    kcal: Math.round(input.kcal),
    loggedAt: now,
  };
}
