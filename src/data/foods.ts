/**
 * Starter food database. Values are per 100 g, cooked unless the name says
 * otherwise. Sourced from USDA FoodData Central equivalents and standard
 * Indian food composition tables.
 *
 * Weighted toward Indian foods because that is the target user base, with the
 * common Western staples and supplements that gym users reach for.
 *
 * `sugar` is tracked separately from `carbs` so the app can separate simple
 * from complex carbohydrate and make the "why" visible.
 */

import { FoodCategory, FoodItem } from '../types';

type Row = [
  id: string,
  name: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fibre: number,
  sugar: number,
  category: FoodCategory,
  region?: 'indian' | 'global',
  iconKey?: string
];

const rows: Row[] = [
  // --- Indian staples -----------------------------------------------------
  ['rice-white', 'White rice, cooked', 130, 2.7, 28, 0.3, 0.4, 0.1, 'carb', 'indian', 'rice'],
  ['rice-brown', 'Brown rice, cooked', 112, 2.6, 23, 0.9, 1.8, 0.2, 'carb', 'indian', 'rice'],
  ['roti', 'Roti / chapati', 120, 3.5, 22, 1.5, 2.7, 0.3, 'carb', 'indian', 'roti'],
  ['paratha', 'Paratha', 290, 6, 38, 12, 3, 0.4, 'carb', 'indian'],
  ['dahi', 'Curd / dahi', 61, 3.5, 4.5, 3.3, 0, 4.2, 'dairy', 'indian', 'curd'],
  ['paneer', 'Paneer', 265, 18, 3.6, 20, 0, 2.6, 'protein', 'indian', 'paneer'],
  ['dal-toor', 'Toor dal, cooked', 116, 6, 18, 0.5, 4.9, 0.7, 'protein', 'indian', 'dal'],
  ['dal-moong', 'Moong dal, cooked', 104, 6, 15, 0.4, 3.9, 0.5, 'protein', 'indian', 'dal'],
  ['chana', 'Chana / chickpeas, cooked', 164, 8.9, 27, 2.6, 7.6, 4.8, 'protein', 'indian', 'chickpeas'],
  ['rajma', 'Rajma, cooked', 127, 8.9, 22, 0.5, 6.4, 0.4, 'protein', 'indian', 'beans'],
  ['poha', 'Poha', 130, 4, 25, 2, 1, 0, 'carb', 'indian'],
  ['upma', 'Upma', 150, 5, 26, 3, 1.5, 0, 'carb', 'indian'],
  ['idli', 'Idli', 116, 4, 25, 0.4, 1.3, 0, 'carb', 'indian', 'idli'],
  ['dosa', 'Dosa', 180, 4, 30, 6, 1, 0.5, 'carb', 'indian', 'dosa'],
  ['uttapam', 'Uttapam', 145, 4.5, 27, 2, 1.2, 0.5, 'carb', 'indian'],
  ['bhatura', 'Bhatura', 350, 7, 48, 15, 1.5, 0.5, 'carb', 'indian'],
  ['samosa', 'Samosa', 260, 5, 30, 13, 1.5, 1, 'other', 'indian'],
  ['pakora', 'Pakora / bhaji', 240, 5, 28, 12, 2, 1, 'other', 'indian'],
  ['chapati-multigrain', 'Multigrain roti', 130, 5, 23, 1.8, 3.4, 0.4, 'carb', 'indian'],
  ['chana-chaat', 'Chana chaat', 110, 6, 18, 1, 4, 1, 'other', 'indian'],
  ['buttermilk', 'Chhaas / buttermilk', 40, 2, 5, 1.5, 0, 4.5, 'drink', 'indian', 'buttermilk'],
  ['lassi', 'Sweet lassi', 105, 3, 20, 2.2, 0, 18, 'drink', 'indian'],
  ['ghee', 'Ghee', 900, 0, 0, 100, 0, 0, 'fat', 'indian', 'ghee'],
  ['mustard-oil', 'Mustard oil', 900, 0, 0, 100, 0, 0, 'fat', 'indian'],
  ['til-oil', 'Sesame / til oil', 884, 0, 0, 100, 0, 0, 'fat', 'indian'],
  ['coconut-water', 'Coconut water', 19, 0.7, 3.7, 0.2, 1.1, 2.6, 'drink', 'indian', 'coconut'],
  ['amla', 'Amla / Indian gooseberry', 44, 2.6, 9.6, 0.2, 5.5, 0, 'fruit', 'indian', 'amla'],

  // --- Proteins -----------------------------------------------------------
  ['chicken-breast', 'Chicken breast, cooked', 165, 31, 0, 3.6, 0, 0, 'protein', 'global', 'chicken'],
  ['chicken-curry', 'Chicken curry with oil', 180, 18, 5, 11, 1, 1.5, 'protein', 'indian', 'curry'],
  ['tandoori-chicken', 'Tandoori chicken', 160, 26, 2, 5, 0.5, 1, 'protein', 'indian', 'tandoori'],
  ['tikka', 'Chicken tikka', 175, 24, 3, 7, 0.4, 1, 'protein', 'indian'],
  ['egg-whole', 'Egg, whole', 155, 13, 1.1, 11, 0, 1.1, 'protein', 'global', 'egg'],
  ['egg-white', 'Egg white', 52, 10.9, 0.7, 0.2, 0, 0.7, 'protein', 'global', 'eggwhite'],
  ['fish-salmon', 'Salmon', 208, 20, 0, 13, 0, 0, 'protein', 'global', 'fish'],
  ['fish-rohu', 'Rohu / Indian carp', 146, 17, 0, 7, 0, 0, 'protein', 'indian', 'fish'],
  ['tuna', 'Tuna, canned in water', 116, 26, 0, 0.8, 0, 0, 'protein', 'global', 'tuna'],
  ['tofu', 'Tofu', 76, 8, 1.9, 4.8, 0.3, 0.6, 'protein', 'global', 'tofu'],
  ['soya-chunks', 'Soya chunks, dry', 345, 36, 33, 1, 15, 9, 'protein', 'indian', 'soya'],
  ['whey', 'Whey protein scoop', 400, 80, 8, 6, 0, 5, 'supplement', 'global', 'whey'],
  ['creatine', 'Creatine monohydrate, 5 g', 0, 0, 0, 0, 0, 0, 'supplement', 'global'],

  // --- Dairy --------------------------------------------------------------
  ['milk-toned', 'Milk, toned', 58, 3, 4.8, 3, 0, 4.8, 'dairy', 'global', 'milk'],
  ['milk-full', 'Milk, full fat', 61, 3.2, 4.8, 3.3, 0, 4.8, 'dairy', 'global', 'milk'],
  ['greek-yogurt', 'Greek yogurt, plain', 59, 10, 3.6, 0.4, 0, 3.2, 'dairy', 'global', 'yogurt'],
  ['cheese-cheddar', 'Cheddar cheese', 403, 25, 1.3, 33, 0, 0.5, 'dairy', 'global', 'cheese'],
  ['butter', 'Butter', 717, 0.9, 0.1, 81, 0, 0.1, 'fat', 'global', 'butter'],

  // --- Carbs and grains ---------------------------------------------------
  ['oats', 'Oats, dry', 389, 16.9, 66.3, 6.9, 10.6, 1, 'carb', 'global', 'oats'],
  ['brown-bread', 'Brown bread', 247, 13, 41, 3.4, 6, 4, 'carb', 'global', 'bread'],
  ['white-bread', 'White bread', 265, 9, 49, 3.2, 2.7, 5.7, 'carb', 'global', 'bread'],
  ['sweet-potato', 'Sweet potato, boiled', 86, 1.6, 20.1, 0.1, 3, 0, 'carb', 'global', 'sweetpotato'],
  ['potato', 'Potato, boiled', 87, 2, 20, 0.1, 1.8, 0.9, 'carb', 'global', 'potato'],
  ['corn', 'Sweet corn', 96, 3.4, 21, 1.5, 2.7, 6.5, 'carb', 'global', 'corn'],
  ['pasta', 'Pasta, cooked', 158, 5.8, 31, 0.9, 1.8, 0.6, 'carb', 'global', 'pasta'],
  ['quinoa', 'Quinoa, cooked', 120, 4.4, 21, 1.9, 2.8, 0.9, 'carb', 'global', 'quinoa'],
  ['cornflakes', 'Cornflakes', 357, 7.5, 84, 0.4, 3.3, 8.5, 'carb', 'global', 'cornflakes'],

  // --- Fruit --------------------------------------------------------------
  ['banana', 'Banana', 89, 1.1, 22.8, 0.3, 2.6, 12.2, 'fruit', 'global', 'banana'],
  ['apple', 'Apple', 52, 0.3, 13.8, 0.2, 2.4, 10.4, 'fruit', 'global', 'apple'],
  ['orange', 'Orange', 47, 0.9, 11.8, 0.1, 2.4, 9.4, 'fruit', 'global', 'orange'],
  ['grapes', 'Grapes', 69, 0.7, 18.1, 0.2, 0.9, 15.5, 'fruit', 'global', 'grapes'],
  ['watermelon', 'Watermelon', 30, 0.6, 7.6, 0.2, 0.4, 6.2, 'fruit', 'global', 'watermelon'],
  ['mango', 'Mango', 60, 0.8, 15, 0.4, 1.6, 13.7, 'fruit', 'indian', 'mango'],
  ['papaya', 'Papaya', 43, 0.5, 10.8, 0.1, 1.8, 7.8, 'fruit', 'indian', 'papaya'],
  ['guava', 'Guava', 68, 2.6, 14.5, 1, 5.4, 8.9, 'fruit', 'indian', 'guava'],
  ['pineapple', 'Pineapple', 50, 0.5, 13.1, 0.1, 1.4, 9.9, 'fruit', 'global', 'pineapple'],

  // --- Vegetables ---------------------------------------------------------
  ['broccoli', 'Broccoli', 34, 2.8, 6.6, 0.4, 2.6, 1.7, 'vegetable', 'global', 'broccoli'],
  ['spinach', 'Spinach', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 'vegetable', 'global', 'spinach'],
  ['onion', 'Onion', 40, 1.1, 9.3, 0.1, 1.7, 4.2, 'vegetable', 'global', 'onion'],
  ['tomato', 'Tomato', 18, 0.9, 3.9, 0.2, 1.2, 2.6, 'vegetable', 'global', 'tomato'],
  ['carrot', 'Carrot', 41, 0.9, 9.6, 0.2, 2.8, 4.7, 'vegetable', 'global', 'carrot'],
  ['cabbage', 'Cabbage', 25, 1.3, 5.8, 0.1, 2.5, 3.2, 'vegetable', 'global', 'cabbage'],
  ['bhindi', 'Bhindi / okra', 33, 1.9, 7.5, 0.2, 3.2, 2.5, 'vegetable', 'indian', 'bhindi'],
  ['palak-sag', 'Palak saga', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 'vegetable', 'indian'],
  ['capsicum', 'Capsicum', 26, 1, 6, 0.3, 2.1, 4.2, 'vegetable', 'global', 'capsicum'],

  // --- Fats and nuts ------------------------------------------------------
  ['almonds', 'Almonds', 579, 21.2, 21.6, 49.9, 12.5, 4.4, 'fat', 'global', 'almond'],
  ['peanut-butter', 'Peanut butter', 588, 25, 20, 50, 6, 9, 'fat', 'global', 'peanutbutter'],
  ['peanuts', 'Peanuts', 567, 25.8, 16.1, 49.2, 8.5, 4.7, 'fat', 'global', 'peanut'],
  ['walnuts', 'Walnuts', 654, 15.2, 13.7, 65.2, 6.7, 2.6, 'fat', 'global', 'walnut'],
  ['cashews', 'Cashews', 553, 18.2, 30.2, 43.9, 3.3, 5.9, 'fat', 'global', 'cashew'],
  ['olive-oil', 'Olive oil', 884, 0, 0, 100, 0, 0, 'fat', 'global', 'oliveoil'],
  ['chia', 'Chia seeds', 486, 16.5, 42.1, 30.7, 34.4, 0, 'fat', 'global', 'chia'],

  // --- Sweets and drinks --------------------------------------------------
  ['sugar', 'Sugar', 400, 0, 100, 0, 0, 100, 'carb', 'global', 'sugar'],
  ['honey', 'Honey', 304, 0.3, 82.4, 0, 0.2, 82.1, 'carb', 'global', 'honey'],
  ['dark-chocolate', 'Dark chocolate, 70%', 598, 7.8, 45.9, 42.6, 10.9, 24, 'other', 'global', 'chocolate'],
  ['tea', 'Green tea', 1, 0, 0.2, 0, 0, 0, 'drink', 'global', 'tea'],
  ['coffee-black', 'Coffee, black', 2, 0.1, 0, 0, 0, 0, 'drink', 'global', 'coffee'],
  ['coke', 'Cola', 42, 0, 10.6, 0, 0, 10.6, 'drink', 'global', 'coke'],
  ['orange-juice', 'Orange juice', 45, 0.7, 10.4, 0.2, 0.2, 8.4, 'drink', 'global', 'juice'],
  ['protein-bar', 'Protein bar', 350, 30, 40, 8, 8, 5, 'supplement', 'global', 'proteinbar'],
];

export const FOODS: FoodItem[] = rows.map(
  ([id, name, kcal, protein, carbs, fat, fibre, sugar, category, region, iconKey]) => ({
    id,
    name,
    kcalPer100: kcal,
    proteinPer100: protein,
    carbsPer100: carbs,
    fatPer100: fat,
    fibrePer100: fibre,
    sugarPer100: sugar,
    category,
    region,
    iconKey,
    verified: true,
  })
);

export const FOOD_BY_ID: Record<string, FoodItem> = FOODS.reduce((acc, f) => {
  acc[f.id] = f;
  return acc;
}, {} as Record<string, FoodItem>);

/** Simple substring search. Indian foods rank first for this audience. */
export function searchFoods(query: string, limit = 40): FoodItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...FOODS].sort((a, b) => (a.region === 'indian' ? -1 : 1) - (b.region === 'indian' ? -1 : 1)).slice(0, limit);
  }
  const scored: { food: FoodItem; score: number }[] = [];
  for (const f of FOODS) {
    const name = f.name.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (f.id.includes(q.replace(/\s+/g, ''))) score = 2;
    if (score >= 0) {
      // Tie-break: Indian foods slightly preferred, higher protein preferred.
      scored.push({ food: f, score: score * 2 + (f.region === 'indian' ? -0.5 : 0) - f.proteinPer100 / 400 });
    }
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.food);
}

export const CATEGORY_LABELS: Record<FoodCategory, string> = {
  protein: 'Protein',
  carb: 'Carbs',
  fat: 'Fats',
  vegetable: 'Vegetables',
  fruit: 'Fruit',
  dairy: 'Dairy',
  supplement: 'Supplements',
  drink: 'Drinks',
  other: 'Other',
};
