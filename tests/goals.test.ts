/**
 * Weight-goal, custom-deficit, recipe and thumbnail tests.
 *
 * The goal maths decides how many calories a person is told to eat, so the
 * safety behaviour (floor, pace warnings, underweight guard) is tested as
 * carefully as the arithmetic.
 *
 * Run with:  npm test
 */

import {
  adjustmentFor,
  assessWeightGoal,
  bmiAfterLoss,
  computeNutritionPlan,
  deficitForGoal,
} from '../src/lib/nutrition';
import {
  buildRecipe,
  copyName,
  findRecipeByName,
  ingredientFromFood,
  perServing,
  recipeToLoggedFood,
  recipeTotals,
  searchRecipes,
  upsertRecipe,
} from '../src/lib/recipes';
import { EXERCISES, EXERCISE_BY_ID } from '../src/data/exercises';
import { REGIONS, highlightsFor, sideFor } from '../src/data/muscleMap';
import { MUSCLE_LABELS, MuscleGroup } from '../src/types/training';
import { FoodItem, Profile, Recipe } from '../src/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const base: Profile = {
  age: 28,
  sex: 'male',
  weightKg: 80,
  heightCm: 178,
  activityLevel: 'moderate',
  unitSystem: 'metric',
  bmrFormula: 'mifflin',
  goal: 'cut_recomp',
  cutTier: 'moderate',
  sessionsPerWeek: 4,
  averageSessionMinutes: 60,
  createdAt: 0,
};
const codes = (p: Profile) => computeNutritionPlan(p).warnings.map((w) => w.code);

// ---------------------------------------------------------------------------
console.log('\n-- weight goal maths --');
check('8 kg over 16 weeks needs 550 kcal a day', deficitForGoal(8, 16) === 550, `${deficitForGoal(8, 16)}`);
const ok = assessWeightGoal(80, 8, 16);
check('8 kg / 16 wk is valid and ok', ok.valid && ok.level === 'ok');
check('weekly loss is 0.5 kg', ok.weeklyLossKg === 0.5);
check('weekly loss is 0.63% of bodyweight', ok.weeklyLossPct === 0.63, `${ok.weeklyLossPct}`);
check('8 kg in 8 weeks is aggressive', assessWeightGoal(80, 8, 8).level === 'fast');
check('10 kg in 4 weeks is too fast', assessWeightGoal(80, 10, 4).level === 'too_fast');
check('safer weeks keeps pace at or under 1%', assessWeightGoal(80, 10, 4).saferWeeks === 13);
check('zero loss is not a goal', !assessWeightGoal(80, 0, 12).valid);
check('zero weeks is not a goal', !assessWeightGoal(80, 5, 0).valid);
check('NaN is not a goal', !assessWeightGoal(80, NaN, 12).valid && !assessWeightGoal(NaN, 5, 12).valid);
check('losing more than you weigh is not a goal', !assessWeightGoal(80, 80, 12).valid);
check('invalid goal reports zero deficit, not NaN', assessWeightGoal(80, 0, 12).dailyDeficitKcal === 0);
check('bmi after loss', bmiAfterLoss(60, 170, 12) === 16.6, `${bmiAfterLoss(60, 170, 12)}`);
check('bmi with no height is null', bmiAfterLoss(60, 0, 5) === null);

// ---------------------------------------------------------------------------
console.log('\n-- deficit modes --');
check('older profile with no mode still uses its tier', adjustmentFor(base) === -600);
check('target mode uses the goal deficit', adjustmentFor({ ...base, deficitMode: 'target', targetLossKg: 8, targetWeeks: 16 }) === -550);
check('target mode with bad inputs falls back to the tier', adjustmentFor({ ...base, deficitMode: 'target', targetLossKg: 0, targetWeeks: 12 }) === -600);
check('target mode with missing inputs falls back to the tier', adjustmentFor({ ...base, deficitMode: 'target' }) === -600);
check('custom mode uses the typed deficit', adjustmentFor({ ...base, deficitMode: 'custom', customDeficitKcal: 450 }) === -450);
check('custom mode rounds', adjustmentFor({ ...base, deficitMode: 'custom', customDeficitKcal: 449.6 }) === -450);
check('custom mode with zero falls back', adjustmentFor({ ...base, deficitMode: 'custom', customDeficitKcal: 0 }) === -600);
check('custom mode with a negative falls back', adjustmentFor({ ...base, deficitMode: 'custom', customDeficitKcal: -300 }) === -600);
check('custom mode with NaN falls back', adjustmentFor({ ...base, deficitMode: 'custom', customDeficitKcal: NaN }) === -600);
check('fat-loss goal honours target mode too', adjustmentFor({ ...base, goal: 'cut_fat_only', deficitMode: 'target', targetLossKg: 8, targetWeeks: 16 }) === -550);
check('bulk ignores a leftover deficit mode', adjustmentFor({ ...base, goal: 'bulk', bulkTier: 'moderate', deficitMode: 'custom', customDeficitKcal: 500 }) === 550);
check('maintain ignores a leftover deficit mode', adjustmentFor({ ...base, goal: 'maintain_recomp', deficitMode: 'custom', customDeficitKcal: 500 }) === 0);

// ---------------------------------------------------------------------------
console.log('\n-- goal warnings --');
const sane = { ...base, deficitMode: 'target' as const, targetLossKg: 8, targetWeeks: 16 };
check('a sensible goal raises no pace warning', !codes(sane).includes('goal_too_fast'));
check('a sensible goal raises no slower-than-asked warning', !codes(sane).includes('goal_slower_than_asked'));

const fast = { ...base, deficitMode: 'target' as const, targetLossKg: 8, targetWeeks: 8 };
const fastWarn = computeNutritionPlan(fast).warnings.find((w) => w.code === 'goal_too_fast');
check('1.25% a week warns', !!fastWarn && fastWarn.severity === 'warning');

const crazy = { ...base, deficitMode: 'target' as const, targetLossKg: 10, targetWeeks: 4 };
const crazyPlan = computeNutritionPlan(crazy);
const crazyWarn = crazyPlan.warnings.find((w) => w.code === 'goal_too_fast');
check('3% a week is a danger', !!crazyWarn && crazyWarn.severity === 'danger');
check('an impossible date is floored for safety', crazyPlan.targetCalories === 1500, `${crazyPlan.targetCalories}`);
check('the floor warning still appears', crazyPlan.warnings.some((w) => w.code === 'below_safe_floor'));
check('and the real timeline is explained', crazyPlan.warnings.some((w) => w.code === 'goal_slower_than_asked'));
const slower = crazyPlan.warnings.find((w) => w.code === 'goal_slower_than_asked');
check('the timeline warning names a longer time than asked', !!slower && /about \d+ weeks/.test(slower.body) && !/about 4 weeks/.test(slower.body), slower?.body);

const tiny = { ...base, weightKg: 60, heightCm: 170, deficitMode: 'target' as const, targetLossKg: 12, targetWeeks: 40 };
check('a target into underweight BMI warns', codes(tiny).includes('goal_underweight'));
check('a healthy end weight does not', !codes(sane).includes('goal_underweight'));

check('a 25%+ custom deficit warns', codes({ ...base, deficitMode: 'custom', customDeficitKcal: 750 }).includes('custom_deficit_large'));
check('a modest custom deficit does not', !codes({ ...base, deficitMode: 'custom', customDeficitKcal: 400 }).includes('custom_deficit_large'));
const giant = computeNutritionPlan({ ...base, deficitMode: 'custom', customDeficitKcal: 3000 });
check('an absurd custom deficit is floored', giant.targetCalories === 1500);
check('and says so', giant.warnings.some((w) => w.code === 'below_safe_floor'));
check('a female floor is 1200', computeNutritionPlan({ ...base, sex: 'female', deficitMode: 'custom', customDeficitKcal: 3000 }).targetCalories === 1200);

// No combination of inputs may ever produce a NaN target.
let allFinite = true;
for (const loss of [0, -1, 0.5, 5, 40, 200, NaN]) {
  for (const weeks of [0, 1, 6, 52, NaN]) {
    const p = computeNutritionPlan({ ...base, deficitMode: 'target', targetLossKg: loss, targetWeeks: weeks });
    if (![p.targetCalories, p.proteinG, p.fatG, p.carbsG].every((n) => Number.isFinite(n))) allFinite = false;
  }
}
check('no target/weeks combination yields NaN', allFinite);

// ---------------------------------------------------------------------------
console.log('\n-- recipes --');
const dal: FoodItem = {
  id: 'dal', name: 'Dal', kcalPer100: 100, proteinPer100: 8, carbsPer100: 15, fatPer100: 1,
  fibrePer100: 4, sugarPer100: 1, category: 'protein',
};
const rice: FoodItem = {
  id: 'rice', name: 'Rice', kcalPer100: 130, proteinPer100: 2.5, carbsPer100: 28, fatPer100: 0.3,
  fibrePer100: 0.4, sugarPer100: 0, category: 'carb',
};
const ings = [ingredientFromFood(dal, 200), ingredientFromFood(rice, 150)];
const t = recipeTotals(ings);
check('totals sum the ingredients', t.kcal === 395 && t.grams === 350, JSON.stringify(t));
check('protein total', t.protein === 19.8, `${t.protein}`);
const rec: Recipe = { id: 'r1', name: 'Dal rice', ingredients: ings, servings: 2, createdAt: 1, updatedAt: 1 };
check('per serving halves it', perServing(rec).kcal === 198, `${perServing(rec).kcal}`);
check('zero servings does not divide by zero', Number.isFinite(perServing({ ...rec, servings: 0 }).kcal));
const one = recipeToLoggedFood(rec, 1, 'x', 5);
check('one serving logs half the recipe', one.kcal === 198 && one.grams === 175, JSON.stringify(one));
check('one serving keeps a plain name', one.name === 'Dal rice');
const two = recipeToLoggedFood(rec, 2, 'x', 5);
check('two servings logs the whole recipe', two.kcal === 395 && two.name === 'Dal rice (2 servings)');
check('half a serving logs a quarter', recipeToLoggedFood(rec, 0.5, 'x', 5).kcal === 99);
check('logged recipe points back at its recipe', one.foodId === 'recipe:r1');
check('editing an ingredient changes the totals', recipeTotals([{ ...ings[0], grams: 400 }, ings[1]]).kcal === 595);

check('name lookup ignores case and spacing', findRecipeByName([rec], '  DAL   rice ')?.id === 'r1');
check('empty name finds nothing', findRecipeByName([rec], '   ') === undefined);
check('copy name numbers from 2', copyName([rec], 'Dal rice') === 'Dal rice (2)');
check('copy name skips taken numbers', copyName([rec, { ...rec, id: 'r2', name: 'Dal rice (2)' }], 'Dal rice') === 'Dal rice (3)');
check('search filters by name', searchRecipes([rec, { ...rec, id: 'r3', name: 'Oats' }], 'oat').length === 1);
check('search with no query lists all, newest first', searchRecipes([rec, { ...rec, id: 'r3', name: 'Oats', updatedAt: 9 }], '')[0].id === 'r3');

const ok1 = buildRecipe({ id: 'n', name: '  Dal   rice ', ingredients: ings, servings: 2, now: 50 });
check('a valid recipe builds and tidies its name', ok1.ok && ok1.recipe.name === 'Dal rice');
check('no name is rejected', !buildRecipe({ id: 'n', name: ' ', ingredients: ings, servings: 1, now: 1 }).ok);
check('no ingredients is rejected', !buildRecipe({ id: 'n', name: 'x', ingredients: [], servings: 1, now: 1 }).ok);
check('zero-gram ingredient is rejected', !buildRecipe({ id: 'n', name: 'x', ingredients: [{ ...ings[0], grams: 0 }], servings: 1, now: 1 }).ok);
check('zero servings is rejected', !buildRecipe({ id: 'n', name: 'x', ingredients: ings, servings: 0, now: 1 }).ok);
check('NaN servings is rejected', !buildRecipe({ id: 'n', name: 'x', ingredients: ings, servings: NaN, now: 1 }).ok);
const kept = buildRecipe({ id: 'r1', name: 'Dal rice', ingredients: ings, servings: 2, now: 99, createdAt: 1 });
check('editing keeps the original created time', kept.ok && kept.recipe.createdAt === 1 && kept.recipe.updatedAt === 99);
check('upsert replaces by id, never duplicates', upsertRecipe([rec], { ...rec, name: 'New' }).length === 1 && upsertRecipe([rec], { ...rec, name: 'New' })[0].name === 'New');
check('upsert adds a new id', upsertRecipe([rec], { ...rec, id: 'r9' }).length === 2);

// ---------------------------------------------------------------------------
console.log('\n-- exercise thumbnails --');
const groups = Object.keys(MUSCLE_LABELS) as MuscleGroup[];
check('every muscle group has a region on some side', groups.every((g) => !!REGIONS.front[g] || !!REGIONS.back[g]), groups.filter((g) => !REGIONS.front[g] && !REGIONS.back[g]).join());
const blank = EXERCISES.filter((e) => highlightsFor(e).items.length === 0).map((e) => e.name);
check('every exercise highlights at least one muscle', blank.length === 0, blank.join(', '));
check('bench press shows the front', sideFor(EXERCISE_BY_ID['bench-press']) === 'front');
const backEx = EXERCISES.find((e) => e.muscles[0]?.group === 'lats' || e.muscles[0]?.group === 'back');
check('a lat exercise shows the back', !!backEx && sideFor(backEx) === 'back', backEx?.name);
const main = highlightsFor(EXERCISE_BY_ID['bench-press']).items;
check('the main mover is the brightest', main[0].group === 'chest' && main[0].opacity === 1);
check('minor movers are dimmer', main.slice(1).every((h) => h.opacity < 1));

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
