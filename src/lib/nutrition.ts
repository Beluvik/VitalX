/**
 * Nutrition engine.
 *
 * Pure functions, no React, no I/O. Everything the demo shows on the
 * dashboard is derived here, so this file is the single source of truth for
 * the numbers.
 *
 * Model, in order:
 *   1. BMR        - Mifflin-St Jeor (needs sex) or Katch-McArdle (needs body fat %)
 *   2. TDEE       - BMR x activity multiplier
 *   3. Adjustment - signed kcal offset from the user's goal + intensity tier
 *   4. Protein    - density from bodyweight, floored for safety
 *   5. Fat        - percentage of the post-adjustment target
 *   6. Carbs      - whatever is left
 *
 * The multiplier is the standard activity factor and it already accounts for
 * training frequency, which is why tracked gym burn and step data are NOT
 * added on top here. Doing so would double-count. Phase 3 wires the tracked
 * numbers into lib/energy.ts as a verification layer instead.
 */

import {
  ActivityLevel,
  BmrFormula,
  BulkTier,
  CutTier,
  Goal,
  NutritionPlan,
  NutritionWarning,
  Profile,
  RecompositionProjection,
} from '../types';

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };
const KCAL_PER_KG_FAT = 7700;

/** Protein density, g per kg of bodyweight, straight from the spec. */
export const PROTEIN_MIN_G_PER_KG = 1.6;
/** Recomposition goals push higher because lean gain is the actual objective. */
export const PROTEIN_RECOMP_G_PER_KG = 1.8;
/** Above this the app warns and pushes remaining calories to carbs + fat. */
export const PROTEIN_WARN_G_PER_KG = 2.0;

/** Fat as a share of total calories. Spec allows 25-30%; we default to the middle. */
export const FAT_TARGET_PCT = 0.275;
export const FAT_PCT_MIN = 0.25;
export const FAT_PCT_MAX = 0.3;

/** Protein above this share of total calories is a sign the split is degenerate. */
export const PROTEIN_SHARE_WARN = 0.4;

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, { mult: number; label: string; hint: string }> = {
  sedentary: { mult: 1.2, label: 'Sedentary', hint: 'Desk job, little or no exercise' },
  light: { mult: 1.375, label: 'Lightly active', hint: 'Light exercise 1-3 days a week' },
  moderate: { mult: 1.55, label: 'Moderately active', hint: 'Moderate exercise 3-5 days a week' },
  active: { mult: 1.725, label: 'Very active', hint: 'Hard exercise 6-7 days a week' },
  very_active: { mult: 1.9, label: 'Extra active', hint: 'Twice daily, or physical job' },
};

/** Signed daily offset from TDEE, by goal and intensity tier. */
export const CUT_DEFICITS: Record<CutTier, number> = {
  slow: 500,
  moderate: 600,
  aggressive: 800,
};

export const BULK_SURPLUSES: Record<BulkTier, number> = {
  slight: 250,
  moderate: 550,
  excess: 1000,
};

export const GOAL_META: Record<
  Goal,
  { title: string; short: string; blurb: string; direction: 'deficit' | 'surplus' | 'maintain' }
> = {
  cut_recomp: {
    title: 'Lose weight, gain muscle',
    short: 'Recomposition',
    blurb:
      'Lose fat and add lean mass at the same time. Needs a mild deficit and consistent progressive overload.',
    direction: 'deficit',
  },
  bulk: {
    title: 'Gain weight and muscle',
    short: 'Bulk',
    blurb: 'Add mass on purpose. Surplus depends on how much fat you accept gaining.',
    direction: 'surplus',
  },
  maintain_recomp: {
    title: 'Maintain weight, gain muscle',
    short: 'Recomp at maintenance',
    blurb: 'Calories in equals calories burned, so all training gains show as lean mass.',
    direction: 'maintain',
  },
  cut_fat_only: {
    title: 'Lose body fat only',
    short: 'Fat loss',
    blurb:
      'Get the weight down. Muscle is not the objective, so this tolerates a harder deficit than recomposition.',
    direction: 'deficit',
  },
};

export const CUT_TIER_META: Record<CutTier, { label: string; blurb: string }> = {
  slow: { label: 'Slow', blurb: 'Sustainable. Almost no muscle loss risk.' },
  moderate: { label: 'Moderate', blurb: 'The most reliable rate of progress.' },
  aggressive: { label: 'Aggressive', blurb: 'Fast, but hard to sustain and costs muscle if protein slips.' },
};

export const BULK_TIER_META: Record<BulkTier, { label: string; blurb: string }> = {
  slight: { label: 'Slight', blurb: 'Mostly muscle, negligible fat gain.' },
  moderate: { label: 'Moderate', blurb: 'Muscle and some fat. The usual choice.' },
  excess: { label: 'Excess', blurb: 'Fast scale gain, but a lot of it will be fat.' },
};

// ---------------------------------------------------------------------------
// BMR
// ---------------------------------------------------------------------------

/** Mifflin-St Jeor. The default when body fat is unknown. */
export function bmrMifflin(weightKg: number, heightCm: number, age: number, sex: Profile['sex']): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** Katch-McArdle. Body-fat based, so it is independent of sex. */
export function bmrKatch(weightKg: number, bodyFatPct: number): number {
  const leanMassKg = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * leanMassKg;
}

export function canUseKatch(p: Pick<Profile, 'bodyFatPct'>): boolean {
  return typeof p.bodyFatPct === 'number' && p.bodyFatPct > 0 && p.bodyFatPct < 70;
}

// ---------------------------------------------------------------------------
// Weight-loss target (how much, by when)
// ---------------------------------------------------------------------------

/** Weekly loss above this share of bodyweight gets a warning. */
export const LOSS_RATE_WARN_PCT = 1;
/** Above this the warning becomes a danger. */
export const LOSS_RATE_DANGER_PCT = 1.5;
/** A custom deficit above this share of TDEE is flagged. */
export const CUSTOM_DEFICIT_WARN_FRACTION = 0.25;
export const MIN_HEALTHY_BMI = 18.5;

export interface WeightGoalAssessment {
  /** False when the inputs cannot describe a real goal, so callers fall back. */
  valid: boolean;
  lossKg: number;
  weeks: number;
  /** Daily deficit needed to hit the goal on time. */
  dailyDeficitKcal: number;
  weeklyLossKg: number;
  /** Weekly loss as a percentage of current bodyweight. */
  weeklyLossPct: number;
  level: 'ok' | 'fast' | 'too_fast';
  /** Shortest whole number of weeks that stays at or under the warning rate. */
  saferWeeks: number;
}

/** Daily kcal deficit needed to lose `lossKg` in `weeks`. */
export function deficitForGoal(lossKg: number, weeks: number): number {
  return Math.round((lossKg * KCAL_PER_KG_FAT) / (weeks * 7));
}

/**
 * Judge a "lose X kg in Y weeks" goal.
 *
 * Uses the usual 7,700 kcal per kg of body fat. That is an approximation:
 * real weight change also moves water and lean mass, so treat the output as a
 * planning number, not a promise.
 */
export function assessWeightGoal(weightKg: number, lossKg: number, weeks: number): WeightGoalAssessment {
  const usable =
    isFinite(weightKg) && weightKg > 0 &&
    isFinite(lossKg) && lossKg > 0 && lossKg < weightKg &&
    isFinite(weeks) && weeks >= 1;

  if (!usable) {
    return {
      valid: false,
      lossKg: 0,
      weeks: 0,
      dailyDeficitKcal: 0,
      weeklyLossKg: 0,
      weeklyLossPct: 0,
      level: 'ok',
      saferWeeks: 0,
    };
  }

  const weeklyLossKg = lossKg / weeks;
  const weeklyLossPct = (weeklyLossKg / weightKg) * 100;
  const level =
    weeklyLossPct > LOSS_RATE_DANGER_PCT ? 'too_fast' : weeklyLossPct > LOSS_RATE_WARN_PCT ? 'fast' : 'ok';

  return {
    valid: true,
    lossKg,
    weeks,
    dailyDeficitKcal: deficitForGoal(lossKg, weeks),
    weeklyLossKg: round2(weeklyLossKg),
    weeklyLossPct: round2(weeklyLossPct),
    level,
    saferWeeks: Math.ceil(lossKg / (weightKg * (LOSS_RATE_WARN_PCT / 100))),
  };
}

/** Body-mass index after losing `lossKg`, or null if height is unusable. */
export function bmiAfterLoss(weightKg: number, heightCm: number, lossKg: number): number | null {
  if (!isFinite(heightCm) || heightCm <= 0) return null;
  const m = heightCm / 100;
  return round1((weightKg - lossKg) / (m * m));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Goal resolution
// ---------------------------------------------------------------------------

export function usesCutTiers(goal: Goal): boolean {
  return goal === 'cut_recomp' || goal === 'cut_fat_only';
}

export function usesBulkTiers(goal: Goal): boolean {
  return goal === 'bulk';
}

/** The signed daily calorie adjustment for a profile. */
export function adjustmentFor(p: Profile): number {
  if (p.goal === 'cut_recomp' || p.goal === 'cut_fat_only') {
    const mode = p.deficitMode ?? 'tier';

    if (mode === 'target') {
      const g = assessWeightGoal(p.weightKg, p.targetLossKg ?? 0, p.targetWeeks ?? 0);
      if (g.valid) return -g.dailyDeficitKcal;
    }
    if (mode === 'custom') {
      const c = p.customDeficitKcal;
      if (typeof c === 'number' && isFinite(c) && c > 0) return -Math.round(c);
    }

    // Unusable target or custom input falls through to the tier rather than
    // producing NaN or a zero deficit, either of which would silently break
    // the dashboard.
    const tier = p.cutTier ?? 'moderate';
    return -(CUT_DEFICITS[tier] ?? CUT_DEFICITS.moderate);
  }
  if (p.goal === 'bulk') {
    const tier = p.bulkTier ?? 'moderate';
    return BULK_SURPLUSES[tier] ?? BULK_SURPLUSES.moderate;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeNutritionPlan(p: Profile): NutritionPlan {
  const useKatch = p.bmrFormula === 'katch' && canUseKatch(p);

  const bmr = useKatch
    ? bmrKatch(p.weightKg, p.bodyFatPct as number)
    : bmrMifflin(p.weightKg, p.heightCm, p.age, p.sex);

  const tdee = bmr * ACTIVITY_MULTIPLIERS[p.activityLevel].mult;
  const adjustment = adjustmentFor(p);

  // Never plan below a conservative floor. Below this, a deficit is
  // unsustainable and the split starts breaking down.
  const safeFloor = p.sex === 'male' ? 1500 : 1200;
  const uncapped = tdee + adjustment;
  const targetCalories = Math.round(Math.max(uncapped, safeFloor));

  const warnings: NutritionWarning[] = [];

  if (uncapped < safeFloor) {
    warnings.push({
      code: 'below_safe_floor',
      severity: 'danger',
      title: 'Target floored for safety',
      body: `Your numbers put the target at ${Math.round(uncapped)} kcal, which is too low to hit safely. We raised it to ${targetCalories} kcal. A lighter deficit will still move the needle.`,
    });
  }

  // --- protein -------------------------------------------------------------
  const proteinDensity =
    p.goal === 'cut_recomp' || p.goal === 'maintain_recomp'
      ? PROTEIN_RECOMP_G_PER_KG
      : PROTEIN_MIN_G_PER_KG;

  const proteinG = Math.round(proteinDensity * p.weightKg);
  const proteinKcal = proteinG * KCAL_PER_G.protein;

  if (proteinG >= PROTEIN_WARN_G_PER_KG * p.weightKg) {
    warnings.push({
      code: 'protein_over_2x',
      severity: 'warning',
      title: 'Protein above 2x bodyweight',
      body: `Your target is ${proteinG} g, which is over 2 g/kg. Beyond that point extra protein stops adding much, and the fat and carbs that drive training get squeezed. Put the remaining calories into carbs around your workout and fats elsewhere.`,
    });
  }

  // --- fat -----------------------------------------------------------------
  const fatKcal = targetCalories * FAT_TARGET_PCT;
  const fatG = Math.round(fatKcal / KCAL_PER_G.fat);

  // --- carbs ---------------------------------------------------------------
  const remaining = targetCalories - proteinKcal - fatKcal;
  const carbsG = Math.max(0, Math.round(remaining / KCAL_PER_G.carbs));

  const proteinPercent = proteinKcal / targetCalories;
  const fatPercent = fatKcal / targetCalories;
  const carbPercent = Math.max(0, remaining / targetCalories);

  if (proteinPercent > PROTEIN_SHARE_WARN) {
    warnings.push({
      code: 'protein_share_high',
      severity: 'warning',
      title: 'Protein is crowding out the rest',
      body: `Protein is taking ${Math.round(proteinPercent * 100)}% of your calories, so only ${Math.round(targetCalories * (1 - proteinPercent))} kcal is left for fat and carbs. That will make training and recovery hard. Consider a smaller deficit tier.`,
    });
  }

  if (carbsG < 60 && p.goal === 'bulk') {
    warnings.push({
      code: 'carbs_very_low',
      severity: 'warning',
      title: 'Very little carbohydrate headroom',
      body: `Only ${carbsG} g of carbs are left after protein and fat. Bulk performance usually needs more, so a surplus tier of ${BULK_TIER_META[p.bulkTier ?? 'moderate'].label.toLowerCase()} would help.`,
    });
  }

  if (adjustment >= 1000) {
    warnings.push({
      code: 'excess_surplus',
      severity: 'warning',
      title: 'Large surplus',
      body: `A ${adjustment} kcal surplus is only appropriate for very lean, advanced lifters. Most of the scale gain here is fat. The app is showing it because you asked for it.`,
    });
  }

  // --- carb quality --------------------------------------------------------
  // Recomposition: 70/30 complex-to-simple split. Bulk leans higher on complex
  // for the extra volume. Pure cut keeps carbs moderate to protect protein.
  const complexRatio = p.goal === 'bulk' ? 0.75 : p.goal === 'cut_fat_only' ? 0.68 : 0.7;
  const fibreG = Math.round((14 * targetCalories) / 1000);

  const plan: NutritionPlan = {
    bmr: Math.round(bmr),
    bmrFormulaUsed: useKatch ? 'katch' : 'mifflin',
    tdee: Math.round(tdee),
    adjustment,
    targetCalories,
    proteinG,
    fatG,
    carbsG,
    fatPercent,
    carbPercent,
    proteinPercent,
    carbs: {
      complexG: Math.round(carbsG * complexRatio),
      simpleG: Math.round(carbsG * (1 - complexRatio)),
      fibreG,
    },
    warnings,
    computedAt: Date.now(),
  };

  if (usesCutTiers(p.goal)) {
    warnings.push(...deficitGoalWarnings(p, { tdee, uncapped, targetCalories, safeFloor }));
  }

  if (p.goal === 'cut_recomp') {
    const proj = projectRecomposition(p, plan, targetCalories);
    plan.recomposition = proj;
    if (proj.warning) warnings.push(proj.warning);
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Warnings for a chosen target or custom deficit
// ---------------------------------------------------------------------------

function deficitGoalWarnings(
  p: Profile,
  calc: { tdee: number; uncapped: number; targetCalories: number; safeFloor: number }
): NutritionWarning[] {
  const out: NutritionWarning[] = [];
  const mode = p.deficitMode ?? 'tier';

  if (mode === 'target') {
    const g = assessWeightGoal(p.weightKg, p.targetLossKg ?? 0, p.targetWeeks ?? 0);
    if (!g.valid) return out;

    if (g.level !== 'ok') {
      out.push({
        code: 'goal_too_fast',
        severity: g.level === 'too_fast' ? 'danger' : 'warning',
        title: g.level === 'too_fast' ? 'That pace is too fast' : 'That pace is aggressive',
        body: `Losing ${g.lossKg} kg in ${g.weeks} weeks is ${g.weeklyLossKg} kg a week, about ${g.weeklyLossPct}% of your bodyweight. Most guidance keeps this under roughly ${LOSS_RATE_WARN_PCT}% a week to protect muscle and energy. ${g.saferWeeks} weeks would keep you inside that.`,
      });
    }

    // The safety floor can override the deficit the goal needs. Say so, and
    // say what the real timeline becomes, instead of quietly missing the date.
    if (calc.uncapped < calc.safeFloor) {
      const actualDeficit = calc.tdee - calc.targetCalories;
      out.push({
        code: 'goal_slower_than_asked',
        severity: 'warning',
        title: 'Your date needs a longer timeline',
        body:
          actualDeficit > 0
            ? `Reaching ${g.lossKg} kg in ${g.weeks} weeks would mean eating about ${Math.round(calc.uncapped)} kcal, below the ${calc.safeFloor} kcal minimum. At ${calc.targetCalories} kcal you would lose about ${round2((actualDeficit * 7) / KCAL_PER_KG_FAT)} kg a week, so it would take about ${Math.ceil((g.lossKg * KCAL_PER_KG_FAT) / (actualDeficit * 7))} weeks.`
            : `Your safe minimum of ${calc.safeFloor} kcal is already at or above what you burn, so eating less is not the way to lose weight here. Extend the timeline and add activity.`,
      });
    }

    const bmi = bmiAfterLoss(p.weightKg, p.heightCm, g.lossKg);
    if (bmi !== null && bmi < MIN_HEALTHY_BMI) {
      out.push({
        code: 'goal_underweight',
        severity: 'danger',
        title: 'This target is in the underweight range',
        body: `Losing ${g.lossKg} kg would put your BMI at about ${bmi}, under ${MIN_HEALTHY_BMI}. Pick a smaller amount, or talk to a doctor or dietitian before going this low.`,
      });
    }
  }

  if (mode === 'custom') {
    const c = p.customDeficitKcal;
    if (typeof c === 'number' && isFinite(c) && c > 0 && c > calc.tdee * CUSTOM_DEFICIT_WARN_FRACTION) {
      out.push({
        code: 'custom_deficit_large',
        severity: 'warning',
        title: 'Large deficit',
        body: `A ${Math.round(c)} kcal deficit is ${Math.round((c / calc.tdee) * 100)}% of what you burn. Past about a quarter it gets hard to keep protein, training quality and energy up. A smaller deficit held for longer usually works better.`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Recomposition projection
// ---------------------------------------------------------------------------

/**
 * Rough weekly split of a deficit between fat and lean mass.
 *
 * This is an ESTIMATE with wide error bars, not a prediction. A deficit is
 * roughly paid 80% from fat and 20% from lean mass when protein and training
 * are adequate. Training stimulus can add a small amount of lean mass back.
 */
function projectRecomposition(p: Profile, plan: NutritionPlan, targetCalories: number) {
  const weeklyDeficitKcal = Math.max(0, (plan.tdee - targetCalories) * 7);

  const fatChangeKgPerWeek = -(weeklyDeficitKcal * 0.8) / KCAL_PER_KG_FAT;
  const leanLossKgPerWeek = (weeklyDeficitKcal * 0.2) / KCAL_PER_KG_FAT;

  // Training stimulus ceiling. This is where progressive overload earns its
  // place: without it there is no mechanism to add lean mass.
  const sessions = Math.max(0, p.sessionsPerWeek);
  let trainingGainKgPerWeek = 0;
  if (sessions >= 4) trainingGainKgPerWeek = 0.1;
  else if (sessions >= 2) trainingGainKgPerWeek = 0.05;
  else if (sessions === 1) trainingGainKgPerWeek = 0.02;

  const leanChangeKgPerWeek = trainingGainKgPerWeek - leanLossKgPerWeek;

  const bf = p.bodyFatPct;
  let caveat: string;
  let warning: NutritionWarning | undefined;

  if (typeof bf === 'number' && bf < 12) {
    caveat =
      'At your current body fat, a deficit and lean mass gain are hard to run at the same time. Expect to hold or lose a little lean mass. Consider the maintenance goal instead.';
    warning = {
      code: 'recomp_unrealistic',
      severity: 'info',
      title: 'Recomp at this body fat is tight',
      body: caveat,
    };
  } else if (p.sessionsPerWeek < 2) {
    caveat =
      'One session a week is not enough stimulus to add lean mass. The fat will come off, but expect lean mass to drift down. Train at least twice weekly for this goal to work.';
    warning = {
      code: 'recomp_unrealistic',
      severity: 'info',
      title: 'Not enough training frequency',
      body: caveat,
    };
  } else if (typeof bf === 'number' && bf > 25) {
    caveat =
      'Higher body fat gives you room to lose fat and hold or add lean mass at the same time. This is the window where recomposition works best.';
  } else {
    caveat = 'Lean mass will mostly be held rather than gained. Treat this as a body recomposition, not a pure muscle gain.';
  }

  const result: RecompositionProjection = {
    weeklyDeficitKcal: Math.round(weeklyDeficitKcal),
    fatChangeKgPerWeek: round3(fatChangeKgPerWeek),
    leanChangeKgPerWeek: round3(leanChangeKgPerWeek),
    caveat,
  };
  return Object.assign(result, { warning });
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Carb education content (spec asks the app to explain simple vs complex)
// ---------------------------------------------------------------------------

export const CARB_EDUCATION = {
  simple: {
    title: 'Simple carbs',
    body: 'Single sugar units. They digest fast, spike blood sugar, and leave you hungry again quickly. Good for quick energy right before or during a hard session; poor choices for everything else.',
    examples: ['White rice and roti', 'Table sugar, honey', 'Sugary drinks', 'Candy, pastries', 'Flavoured yogurt'],
  },
  complex: {
    title: 'Complex carbs',
    body: 'Longer chains with fibre attached, so they release energy slowly and keep you full for hours. They also support training volume and recovery, which is why VitalX puts most of your carbs here.',
    examples: ['Oats, brown rice, whole wheat roti', 'Whole potato', 'Lentils, chickpeas, kidney beans', 'Whole fruit with the skin on'],
  },
} as const;
