/**
 * Food entry tests: unit conversion, ingredient text, database responses,
 * label and photo reading.
 *
 * The response fixtures are written from the public schemas of USDA
 * FoodData Central and Open Food Facts. They prove the parsers are correct
 * against that shape and cannot crash on a different one; they do not prove
 * the live services still answer that way, which only a device can.
 *
 * Run with:  npm test
 */

import { FOOD_UNITS, gramsPerMl, isApproximate, nextUnit, toGrams } from '../src/lib/foodUnits';
import { parseIngredientLine, parseIngredientText } from '../src/lib/ingredients';
import {
  bestMatch,
  parseOffProduct,
  parseOffSearch,
  parseUsdaSearch,
  rankCandidates,
  zeroCalorieFood,
  FoodCandidate,
} from '../src/lib/foodApi';
import {
  extractJson,
  parseFoodPhoto,
  parseLabel,
  visionReady,
} from '../src/lib/vision';
import { candidateToLogged, macrosFor, manualToLogged } from '../src/lib/mealLog';
import {
  buildRecipe,
  candidateFromIngredient,
  ingredientFromCandidate,
  recipeToLoggedFood,
  recipeTotals,
} from '../src/lib/recipes';

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
const near = (a: number, b: number, tol = 0.11) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
console.log('\n-- units --');
check('grams stay grams', toGrams(100, 'g') === 100);
check('kilograms convert', toGrams(0.25, 'kg') === 250);
check('10 ml of oil is 9.2 g', toGrams(10, 'ml', 'oil') === 9.2, `${toGrams(10, 'ml', 'oil')}`);
check('10 ml of plain water is 10 g', toGrams(10, 'ml', 'water') === 10);
check('1 tbsp of ghee is about 13.8 g', toGrams(1, 'tbsp', 'ghee') === 13.8);
check('1 tsp of salt is 6 g', toGrams(1, 'tsp', 'salt') === 6);
check('1 cup of milk is about 247 g', near(toGrams(1, 'cup', 'milk'), 247.2, 0.2));
check('1 litre of water is 1000 g', toGrams(1, 'l', 'water') === 1000);
check('spice powders are light', gramsPerMl('turmeric powder') < 1);
check('unknown foods default to water density', gramsPerMl('mystery') === 1);
check('zero amount is 0 g, not NaN', toGrams(0, 'g') === 0);
check('negative amount is 0 g', toGrams(-5, 'g') === 0);
check('NaN amount is 0 g', toGrams(NaN, 'g') === 0);
check('half-typed field is 0 g', toGrams(parseFloat(''), 'ml', 'oil') === 0);
check('weights are exact', !isApproximate('g', 'paneer') && !isApproximate('kg', 'rice'));
check('spoon measures are approximate', isApproximate('tsp', 'salt') && isApproximate('cup', 'flour'));
check('ml of oil is approximate, ml of water is not', isApproximate('ml', 'oil') && !isApproximate('ml', 'water'));
check('unit button cycles through every unit', new Set(FOOD_UNITS.map((u) => nextUnit(u))).size === FOOD_UNITS.length);
check('unit cycle wraps around', nextUnit(FOOD_UNITS[FOOD_UNITS.length - 1]) === FOOD_UNITS[0]);

// ---------------------------------------------------------------------------
console.log('\n-- ingredient text --');
const meal = parseIngredientText('100g paneer, 10 ml oil, 50g tomato, onion, salt');
check('five ingredients', meal.length === 5, `${meal.length}`);
check('100g paneer', meal[0].name === 'paneer' && meal[0].amount === 100 && meal[0].unit === 'g');
check('10 ml oil', meal[1].name === 'oil' && meal[1].amount === 10 && meal[1].unit === 'ml');
check('50g tomato', meal[2].name === 'tomato' && meal[2].amount === 50);
check('onion with no amount keeps a row but no number', meal[3].name === 'onion' && meal[3].amount === null);
check('salt with no amount keeps a row', meal[4].name === 'salt' && meal[4].amount === null);
check('the parser never invents an amount', meal.filter((m) => m.amount === null).every((m) => m.unit === null));

check('spaced unit', parseIngredientLine('250 g rice')?.unit === 'g');
check('"of" is dropped', parseIngredientLine('100 g of paneer')?.name === 'paneer');
check('gms and gm', parseIngredientLine('3 gms salt')?.unit === 'g' && parseIngredientLine('3 gm salt')?.unit === 'g');
check('words for units', parseIngredientLine('2 tablespoons oil')?.unit === 'tbsp' && parseIngredientLine('1 teaspoon sugar')?.unit === 'tsp');
check('litres', parseIngredientLine('1 litre milk')?.unit === 'l');
check('decimals', parseIngredientLine('0.5 kg onions')?.amount === 0.5);
check('fractions', parseIngredientLine('1/2 cup dal')?.amount === 0.5);
check('a unit with no number means one', parseIngredientLine('cup rice')?.amount === 1 && parseIngredientLine('cup rice')?.unit === 'cup');
check('"2 eggs" has an amount but no unit', (() => { const e = parseIngredientLine('2 eggs'); return !!e && e.amount === 2 && e.unit === null && e.name === 'eggs'; })());
check('"1 large onion" keeps "large onion" as the name', parseIngredientLine('1 large onion')?.name === 'large onion');
check('"l" inside a word is not a unit', parseIngredientLine('2 lemons')?.name === 'lemons');
check('names are lower-cased', parseIngredientLine('100g Paneer')?.name === 'paneer');
check('etc is dropped', parseIngredientText('100g paneer, etc').length === 1);
check('newlines separate ingredients', parseIngredientText('100g paneer\n50g tomato').length === 2);
check('semicolons separate ingredients', parseIngredientText('100g paneer; 50g tomato').length === 2);
check('empty text gives no ingredients', parseIngredientText('   ').length === 0 && parseIngredientText(',,,').length === 0);
check('zero amount is treated as missing', parseIngredientLine('0 g salt')?.amount === null);

// ---------------------------------------------------------------------------
console.log('\n-- USDA responses --');
const usdaJson = {
  foods: [
    {
      fdcId: 170457,
      description: 'Tomatoes, red, ripe, raw',
      foodNutrients: [
        { nutrientId: 1008, nutrientNumber: '208', unitName: 'KCAL', value: 18 },
        { nutrientId: 1003, nutrientNumber: '203', unitName: 'G', value: 0.88 },
        { nutrientId: 1004, nutrientNumber: '204', unitName: 'G', value: 0.2 },
        { nutrientId: 1005, nutrientNumber: '205', unitName: 'G', value: 3.92 },
        { nutrientId: 1079, nutrientNumber: '291', unitName: 'G', value: 1.2 },
        { nutrientId: 2000, nutrientNumber: '269.3', unitName: 'G', value: 2.63 },
        { nutrientId: 1062, nutrientNumber: '268', unitName: 'kJ', value: 75 },
      ],
    },
    {
      fdcId: 1,
      description: 'Oil, olive',
      foodNutrients: [
        { nutrientId: 2047, unitName: 'KCAL', value: 884 },
        { nutrientId: 1004, unitName: 'G', value: 100 },
      ],
    },
    { fdcId: 2, description: 'Broken entry with no energy', foodNutrients: [{ nutrientId: 1003, value: 5 }] },
    { fdcId: 3, foodNutrients: [] },
  ],
};
const usda = parseUsdaSearch(usdaJson);
check('entries without energy or name are dropped', usda.length === 2, `${usda.length}`);
check('tomato energy', usda[0].kcalPer100 === 18);
check('tomato macros', usda[0].proteinPer100 === 0.9 && usda[0].carbsPer100 === 3.9 && usda[0].fatPer100 === 0.2);
check('tomato fibre and sugar', usda[0].fibrePer100 === 1.2 && usda[0].sugarPer100 === 2.6);
check('kJ is never mistaken for kcal', usda[0].kcalPer100 !== 75);
check('Atwater energy is used when kcal is absent', usda[1].kcalPer100 === 884 && usda[1].fatPer100 === 100);
check('usda source tag', usda.every((f) => f.source === 'usda'));
check('garbage responses give nothing, not a crash', parseUsdaSearch(null).length === 0 && parseUsdaSearch({}).length === 0 && parseUsdaSearch({ foods: 'x' }).length === 0 && parseUsdaSearch(undefined).length === 0);
check('nutrient values as strings still parse', parseUsdaSearch({ foods: [{ description: 'X', foodNutrients: [{ nutrientId: '1008', unitName: 'KCAL', value: '52' }] }] })[0]?.kcalPer100 === 52);

// ---------------------------------------------------------------------------
console.log('\n-- Open Food Facts responses --');
const offProduct = {
  status: 1,
  product: {
    code: '8901058000019',
    product_name: 'Maggi 2-minute Noodles',
    brands: 'Nestle, Maggi',
    serving_quantity: 70,
    nutriments: {
      'energy-kcal_100g': 427,
      proteins_100g: 9.5,
      carbohydrates_100g: 60.9,
      fat_100g: 16.4,
      fiber_100g: 3,
      sugars_100g: 2.1,
    },
  },
};
const p = parseOffProduct(offProduct);
check('barcode product parses', !!p && p.name === 'Maggi 2-minute Noodles');
check('barcode macros', !!p && p.kcalPer100 === 427 && p.proteinPer100 === 9.5 && p.carbsPer100 === 60.9 && p.fatPer100 === 16.4);
check('brand is the first listed', p?.brand === 'Nestle');
check('serving size is kept', p?.servingGrams === 70);
check('off source tag', p?.source === 'off');
check('unknown barcode gives null', parseOffProduct({ status: 0, status_verbose: 'product not found' }) === null && parseOffProduct(null) === null);
check('kJ-only products are converted to kcal', (() => { const q = parseOffProduct({ status: 1, product: { product_name: 'X', nutriments: { energy_100g: 1000 } } }); return !!q && near(q.kcalPer100, 239, 0.6); })());
check('products without calories are rejected', parseOffProduct({ status: 1, product: { product_name: 'X', nutriments: { proteins_100g: 5 } } }) === null);
check('products without a name are rejected', parseOffProduct({ status: 1, product: { nutriments: { 'energy-kcal_100g': 100 } } }) === null);
check('missing macros default to 0', (() => { const q = parseOffProduct({ status: 1, product: { product_name: 'X', nutriments: { 'energy-kcal_100g': 100 } } }); return !!q && q.proteinPer100 === 0 && q.fatPer100 === 0; })());
const offSearch = parseOffSearch({ products: [offProduct.product, { product_name: 'No nutrition' }, null, { product_name: 'Ok', nutriments: { 'energy-kcal_100g': '250' } }] });
check('search keeps only usable products', offSearch.length === 2, `${offSearch.length}`);
check('search survives garbage', parseOffSearch(null).length === 0 && parseOffSearch({}).length === 0 && parseOffSearch({ products: 5 }).length === 0);

// ---------------------------------------------------------------------------
console.log('\n-- ranking --');
const mk = (name: string, source: 'usda' | 'off' = 'usda'): FoodCandidate => ({ id: name + source, name, source, kcalPer100: 100, proteinPer100: 0, carbsPer100: 0, fatPer100: 0 });
const ranked = rankCandidates('paneer', [mk('Cheese spread with paneer flavour', 'off'), mk('Paneer', 'off'), mk('Cheese, paneer style', 'usda'), mk('Paneer tikka masala', 'off')]);
check('exact name comes first', ranked[0].name === 'Paneer');
check('starts-with beats contains', ranked[1].name === 'Paneer tikka masala');
check('best match is the top of the ranking', bestMatch('paneer', [mk('Cheese spread with paneer flavour', 'off'), mk('Paneer', 'off')])?.name === 'Paneer');
check('nothing to match gives null', bestMatch('x', []) === null);
check('generic usda beats a brand on a tie', rankCandidates('oil', [mk('Oil', 'off'), mk('Oil', 'usda')])[0].source === 'usda');
check('regex characters in a query are safe', (() => { try { rankCandidates('a+(b', [mk('a+(b thing')]); return true; } catch { return false; } })());
check('salt and water are zero calorie', zeroCalorieFood('salt')?.kcalPer100 === 0 && zeroCalorieFood('Water')?.kcalPer100 === 0);
check('real foods are not zero calorie', zeroCalorieFood('paneer') === null && zeroCalorieFood('salted butter') === null);

// ---------------------------------------------------------------------------
console.log('\n-- photo and label reading --');
check('json in a code fence is extracted', extractJson('```json\n{"items":[{"name":"apple","grams":150}]}\n```')?.items?.length === 1);
check('json with chatter around it is extracted', extractJson('Sure! Here you go: {"items":[]} Hope that helps.')?.items?.length === 0);
check('non-json gives null', extractJson('I cannot tell') === null && extractJson('') === null && extractJson(null) === null && extractJson(42) === null);
check('broken json gives null', extractJson('{"items": [') === null);

const foods = parseFoodPhoto({ items: [{ name: ' Apple ', grams: 150 }, { name: 'rice', grams: '120' }, { name: 'mystery', grams: 'lots' }, { name: '', grams: 5 }, { grams: 5 }, { name: 'boiled egg', grams: -3 }] });
check('valid names kept, blanks dropped', foods.length === 4, `${foods.length}`);
check('names are tidied', foods[0].name === 'apple');
check('numeric strings are read', foods[1].grams === 120);
check('unusable amounts become null for the user to fill', foods[2].grams === null && foods[3].grams === null);
check('absurd amounts are capped', parseFoodPhoto({ items: [{ name: 'rice', grams: 99999 }] })[0].grams === 2000);
check('empty or wrong-shaped replies give nothing', parseFoodPhoto({ items: [] }).length === 0 && parseFoodPhoto(null).length === 0 && parseFoodPhoto({ items: 'x' }).length === 0);
check('at most eight items', parseFoodPhoto({ items: Array.from({ length: 20 }, (_, i) => ({ name: `f${i}`, grams: 10 })) }).length === 8);

const per100 = parseLabel({ name: 'Granola', basis: 'per100g', kcal: 450, protein: 10, carbs: 60, fat: 18, fibre: 7, sugar: 20 });
check('per-100 g label is used as printed', !!per100 && per100.candidate.kcalPer100 === 450 && per100.candidate.proteinPer100 === 10);
check('label fibre and sugar are kept', per100?.candidate.fibrePer100 === 7 && per100?.candidate.sugarPer100 === 20);
check('label source tag', per100?.candidate.source === 'label');
const perServing = parseLabel({ name: 'Bar', basis: 'perServing', servingGrams: 40, kcal: 180, protein: 8, carbs: 20, fat: 8 });
check('per-serving label converts to per 100 g', !!perServing && perServing.candidate.kcalPer100 === 450 && perServing.candidate.proteinPer100 === 20);
check('the serving weight is remembered', perServing?.candidate.servingGrams === 40);
check('the conversion is explained to the user', !!perServing && perServing.basisNote.includes('40'));
const noWeight = parseLabel({ basis: 'perServing', kcal: 200, protein: 5, carbs: 30, fat: 6 });
check('per-serving with no weight keeps the label numbers', !!noWeight && noWeight.candidate.kcalPer100 === 200 && noWeight.candidate.servingGrams === 100);
check('a missing name falls back', noWeight?.candidate.name === 'Packaged food' && parseLabel({ name: 'null', kcal: 5 })?.candidate.name === 'Packaged food');
check('a label with no readable calories is rejected', parseLabel({ basis: 'per100g', protein: 5 }) === null && parseLabel({ kcal: null }) === null);
check('garbage labels are rejected', parseLabel(null) === null && parseLabel('text') === null);
check('numbers with units still parse', parseLabel({ basis: 'per100g', kcal: '250 kcal', protein: '8 g', carbs: '30g', fat: '9.5 g' })?.candidate.kcalPer100 === 250);
check('unreadable secondary values become 0, not NaN', (() => { const l = parseLabel({ basis: 'per100g', kcal: 100, protein: null, carbs: 'n/a', fat: undefined }); return !!l && l.candidate.proteinPer100 === 0 && l.candidate.carbsPer100 === 0 && l.candidate.fatPer100 === 0; })());

check('vision is not ready without all three settings', !visionReady(null) && !visionReady({ baseUrl: 'x', apiKey: '', model: 'm' }) && !visionReady({ baseUrl: 'x', apiKey: 'k', model: ' ' }));
check('vision is ready with all three', visionReady({ baseUrl: 'https://x', apiKey: 'k', model: 'm' }));

// ---------------------------------------------------------------------------
console.log('\n-- the paneer example, end to end --');
const db: Record<string, FoodCandidate> = {
  paneer: { id: 'off:p', name: 'Paneer', source: 'off', kcalPer100: 265, proteinPer100: 18, carbsPer100: 3.5, fatPer100: 20 },
  oil: { id: 'usda:o', name: 'Oil, vegetable', source: 'usda', kcalPer100: 884, proteinPer100: 0, carbsPer100: 0, fatPer100: 100 },
  tomato: { id: 'usda:t', name: 'Tomatoes, raw', source: 'usda', kcalPer100: 18, proteinPer100: 0.9, carbsPer100: 3.9, fatPer100: 0.2 },
};
const typed = parseIngredientText('100g paneer, 10 ml oil, 50g tomato, salt');
const ingredients = typed
  .map((t) => {
    const c = db[t.name] ?? zeroCalorieFood(t.name);
    if (!c) return null;
    const grams = t.amount !== null && t.unit !== null ? toGrams(t.amount, t.unit, t.name) : 100 * 0; // salt has no amount here
    return ingredientFromCandidate(c, grams, t.amount ?? undefined, t.unit ?? undefined);
  })
  .filter((x): x is NonNullable<typeof x> => x !== null);
const totals = recipeTotals(ingredients);
// paneer 265 + oil 9.2 g x 8.84 = 81.3 + tomato 9 + salt 0
check('recipe kcal adds up', totals.kcal === Math.round(265 + 8.84 * 9.2 + 18 * 0.5), `${totals.kcal}`);
check('recipe protein adds up', near(totals.protein, 18 + 0.45, 0.1), `${totals.protein}`);
check('recipe fat adds up', near(totals.fat, 20 + 9.2 + 0.1, 0.1), `${totals.fat}`);
check('salt adds no calories', recipeTotals([ingredients[3]]).kcal === 0);
check('amount and unit are kept for editing', ingredients[1].amount === 10 && ingredients[1].unit === 'ml');
check('a saved ingredient rebuilds a food without the network', candidateFromIngredient(ingredients[0]).kcalPer100 === 265 && candidateFromIngredient(ingredients[0]).source === 'recipe');
// A zero-calorie item typed without an amount (plain "salt") cannot change the
// numbers, so the screen leaves it out rather than blocking the recipe.
check('a recipe with a zero-gram ingredient is refused', !buildRecipe({ id: 'r', name: 'x', ingredients, servings: 2, now: 1 }).ok);
const counted = ingredients.filter((i) => i.grams > 0);
const rb = buildRecipe({ id: 'r', name: 'Paneer curry', ingredients: counted, servings: 2, now: 1 });
check('the recipe builds once amountless salt is left out', rb.ok);
check('leaving salt out changes nothing', recipeTotals(counted).kcal === totals.kcal);
if (rb.ok) {
  const eaten = recipeToLoggedFood(rb.recipe, 1, 'x', 5);
  check('one of two servings logs half the calories', eaten.kcal === Math.round(totals.kcal / 2), `${eaten.kcal} vs ${totals.kcal}`);
  check('the whole recipe logs all of it', recipeToLoggedFood(rb.recipe, 2, 'x', 5).kcal === totals.kcal);
}

// ---------------------------------------------------------------------------
console.log('\n-- logging arithmetic --');
const oats: FoodCandidate = { id: 'usda:oats', name: 'Oats', source: 'usda', kcalPer100: 389, proteinPer100: 16.9, carbsPer100: 66.3, fatPer100: 6.9 };
const m40 = macrosFor(oats, 40);
check('40 g of oats', m40.kcal === 156 && m40.protein === 6.8 && m40.carbs === 26.5 && m40.fat === 2.8, JSON.stringify(m40));
check('zero grams is zero, not NaN', macrosFor(oats, 0).kcal === 0 && macrosFor(oats, NaN).kcal === 0 && macrosFor(oats, -5).kcal === 0);
check('macros scale linearly', macrosFor(oats, 200).kcal === 2 * macrosFor(oats, 100).kcal);
const entry = candidateToLogged(oats, 40, 'lf1', 99);
check('a logged food carries the food and amount', entry.foodId === 'usda:oats' && entry.grams === 40 && entry.kcal === 156 && entry.loggedAt === 99 && entry.id === 'lf1');
check('a name override is used', candidateToLogged(oats, 40, 'x', 1, 'Breakfast oats').name === 'Breakfast oats');
check('a blank override falls back to the food name', candidateToLogged(oats, 40, 'x', 1, '   ').name === 'Oats');
const apple = manualToLogged({ name: ' Apple ', kcal: 95, protein: 0.5, carbs: 25, fat: 0.3, grams: 182 }, 'm1', 5);
check('a typed food keeps the numbers entered', !!apple && apple.kcal === 95 && apple.carbs === 25 && apple.grams === 182 && apple.name === 'Apple');
check('a typed food needs a name', manualToLogged({ name: '  ', kcal: 50, protein: 0, carbs: 0, fat: 0 }, 'm', 1) === null);
check('a typed food needs calories', manualToLogged({ name: 'x', kcal: NaN, protein: 0, carbs: 0, fat: 0 }, 'm', 1) === null && manualToLogged({ name: 'x', kcal: -5, protein: 0, carbs: 0, fat: 0 }, 'm', 1) === null);
check('blank macros become 0, not NaN', (() => { const f = manualToLogged({ name: 'x', kcal: 50, protein: NaN, carbs: NaN, fat: NaN, grams: NaN }, 'm', 1); return !!f && f.protein === 0 && f.carbs === 0 && f.fat === 0 && f.grams === 0; })());
check('zero calories is allowed (water, black coffee)', manualToLogged({ name: 'Black coffee', kcal: 0, protein: 0, carbs: 0, fat: 0 }, 'm', 1)?.kcal === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
