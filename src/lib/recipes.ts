/**
 * Saved recipes. Pure functions, no React, no I/O.
 *
 * A recipe is a named list of foods with gram amounts. Totals are always
 * computed from the ingredients rather than stored, so editing an ingredient
 * can never leave stale numbers behind.
 */

import { FoodItem, LoggedFood, Recipe, RecipeIngredient } from '../types';
import type { FoodCandidate } from './foodApi';

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function ingredientFromFood(food: FoodItem, grams: number): RecipeIngredient {
  return {
    foodId: food.id,
    name: food.name,
    grams: Math.round(grams),
    kcalPer100: food.kcalPer100,
    proteinPer100: food.proteinPer100,
    carbsPer100: food.carbsPer100,
    fatPer100: food.fatPer100,
  };
}

export function ingredientFromCandidate(
  c: FoodCandidate,
  grams: number,
  amount?: number,
  unit?: string
): RecipeIngredient {
  return {
    foodId: c.id,
    name: c.name,
    grams: Math.round(grams * 10) / 10,
    amount,
    unit,
    kcalPer100: c.kcalPer100,
    proteinPer100: c.proteinPer100,
    carbsPer100: c.carbsPer100,
    fatPer100: c.fatPer100,
  };
}

/** Rebuild a database-style food from a saved ingredient, so editing needs no network. */
export function candidateFromIngredient(i: RecipeIngredient): FoodCandidate {
  return {
    id: i.foodId,
    name: i.name,
    source: 'recipe',
    kcalPer100: i.kcalPer100,
    proteinPer100: i.proteinPer100,
    carbsPer100: i.carbsPer100,
    fatPer100: i.fatPer100,
  };
}

export function ingredientMacros(i: RecipeIngredient): Macros {
  const f = i.grams / 100;
  return {
    kcal: i.kcalPer100 * f,
    protein: i.proteinPer100 * f,
    carbs: i.carbsPer100 * f,
    fat: i.fatPer100 * f,
  };
}

/** Macros for the whole recipe. */
export function recipeTotals(ingredients: RecipeIngredient[]): Macros & { grams: number } {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, grams: 0 };
  for (const i of ingredients) {
    const m = ingredientMacros(i);
    t.kcal += m.kcal;
    t.protein += m.protein;
    t.carbs += m.carbs;
    t.fat += m.fat;
    t.grams += i.grams;
  }
  return {
    kcal: Math.round(t.kcal),
    protein: round1(t.protein),
    carbs: round1(t.carbs),
    fat: round1(t.fat),
    grams: Math.round(t.grams),
  };
}

/** Macros for one serving of the recipe. */
export function perServing(recipe: Pick<Recipe, 'ingredients' | 'servings'>): Macros {
  const t = recipeTotals(recipe.ingredients);
  const n = recipe.servings > 0 ? recipe.servings : 1;
  return {
    kcal: Math.round(t.kcal / n),
    protein: round1(t.protein / n),
    carbs: round1(t.carbs / n),
    fat: round1(t.fat / n),
  };
}

/**
 * Turn `servings` eaten of a recipe into one food-log entry, so recipes flow
 * through the same daily totals as any other food.
 */
export function recipeToLoggedFood(
  recipe: Recipe,
  servingsEaten: number,
  id: string,
  now: number
): LoggedFood {
  const t = recipeTotals(recipe.ingredients);
  const n = recipe.servings > 0 ? recipe.servings : 1;
  const share = servingsEaten / n;
  const label = servingsEaten === 1 ? '' : ` (${servingsEaten} servings)`;
  return {
    id,
    foodId: `recipe:${recipe.id}`,
    name: `${recipe.name}${label}`,
    grams: Math.round(t.grams * share),
    protein: round1(t.protein * share),
    carbs: round1(t.carbs * share),
    fat: round1(t.fat * share),
    kcal: Math.round(t.kcal * share),
    loggedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Names and duplicates
// ---------------------------------------------------------------------------

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The saved recipe with this name, ignoring case and stray spaces. */
export function findRecipeByName(recipes: Recipe[], name: string): Recipe | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  return recipes.find((r) => normalizeName(r.name) === n);
}

/** "Dal" -> "Dal (2)" -> "Dal (3)", skipping names already taken. */
export function copyName(recipes: Recipe[], name: string): string {
  const base = name.trim().replace(/\s+/g, ' ');
  let n = 2;
  while (findRecipeByName(recipes, `${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function searchRecipes(recipes: Recipe[], query: string): Recipe[] {
  const q = normalizeName(query);
  const list = [...recipes].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!q) return list;
  return list.filter((r) => normalizeName(r.name).includes(q));
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export type BuildResult = { ok: true; recipe: Recipe } | { ok: false; error: string };

export function buildRecipe(input: {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  servings: number;
  now: number;
  createdAt?: number;
}): BuildResult {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the recipe a name.' };
  if (input.ingredients.length === 0) return { ok: false, error: 'Add at least one food.' };
  if (input.ingredients.some((i) => !isFinite(i.grams) || i.grams <= 0)) {
    return { ok: false, error: 'Every food needs an amount above zero.' };
  }
  if (!isFinite(input.servings) || input.servings <= 0) {
    return { ok: false, error: 'Servings must be above zero.' };
  }
  return {
    ok: true,
    recipe: {
      id: input.id,
      name,
      ingredients: input.ingredients,
      servings: input.servings,
      createdAt: input.createdAt ?? input.now,
      updatedAt: input.now,
    },
  };
}

/** Insert or replace by id, keeping the list free of duplicates. */
export function upsertRecipe(recipes: Recipe[], recipe: Recipe): Recipe[] {
  return recipes.some((r) => r.id === recipe.id)
    ? recipes.map((r) => (r.id === recipe.id ? recipe : r))
    : [...recipes, recipe];
}
